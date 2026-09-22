/**
 * touwaka TranscriptStore 适配器 × erix-agent 契约测试（真实 MariaDB）
 *
 * 在测试库（llm_kit_test）内用适配器定义的 Sequelize 模型建出
 * llm_kit_transcripts 表，逐测试清空后跑库的 transcriptStoreContract 全部断言。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 * 运行：node --test tests/llm-kit-adapters/
 */

import { test, after } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// logs/ 目录当前是 root 属主（容器残留），logger 写文件会 EACCES 掩盖真实错误。
// 测试环境把 logger 降级为 console-only（在 db.connect() 之前补丁即可，logger 是模块级单例）。
// TODO: sudo chown -R eric:eric logs/ 后可移除此补丁。
import logger from "../../lib/logger.js";
for (const m of ["info", "warn", "error", "debug"]) {
  if (typeof logger[m] === "function") logger[m] = () => {};
}

import Database from "../../lib/db.js";
import { createTouwakaTranscriptStore } from "../../lib/llm-kit-adapters/transcript-store.js";

import { transcriptStoreContract } from "erix-agent/contract-tests";

const CREDS_PATH = join(homedir(), ".config/mcp/creds/touwaka-test-db.json");

function loadCreds() {
  try {
    return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  } catch {
    return null;
  }
}

const creds = loadCreds();

let db = null;
let Transcript = null;
// run-state 契约断言（saveRunState/loadRunState/markRunState）独占一张表
// llm_kit_run_state_contract_test：无条件拥有——开头 DROP + 按生产 DDL 重建，
// 结束 DROP，避免并发测试进程共享 llm_kit_run_state 时互相误删/误清。
const RUN_STATE_TABLE_NAME = "llm_kit_run_state_contract_test";

if (creds) {
  db = new Database({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });

  await db.connect();

  // 独占表：无条件重建（DROP IF EXISTS + 生产 DDL），不检查存在性、不清他人行。
  await db.sequelize.query(`DROP TABLE IF EXISTS ${RUN_STATE_TABLE_NAME}`);
  // 与 scripts/upgrade-database.js 迁移后的生产 schema 保持一致（state TEXT NULL）
  await db.sequelize.query(`
    CREATE TABLE ${RUN_STATE_TABLE_NAME} (
      run_id VARCHAR(128) NOT NULL,
      state TEXT NULL,
      checkpoint JSON NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const setupStore = createTouwakaTranscriptStore({
    db,
    runStateTableName: RUN_STATE_TABLE_NAME,
  });
  Transcript = db.sequelize.models.llm_kit_transcript;
  await setupStore.sync({ force: true });
}

after(async () => {
  if (!db) return;

  await db.sequelize.query(`DROP TABLE IF EXISTS ${RUN_STATE_TABLE_NAME}`);
  await Transcript.drop();
  if (typeof db.close === "function") {
    await db.close();
  } else if (db.sequelize) {
    await db.sequelize.close();
  }
});

if (!creds) {
  test("touwaka TranscriptStore 适配器契约（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  transcriptStoreContract("touwaka TranscriptStore", async () => {
    await Transcript.destroy({ truncate: true });
    return createTouwakaTranscriptStore({
      db,
      runStateTableName: RUN_STATE_TABLE_NAME,
    });
  });
}
