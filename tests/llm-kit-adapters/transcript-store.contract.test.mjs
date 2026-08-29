/**
 * touwaka TranscriptStore 适配器 × erix-llm-kit 契约测试（真实 MariaDB）
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

// TODO: @erix/llm-kit 发布到 Gitea npm registry 后改为包导入：
//   import { transcriptStoreContract } from "@erix/llm-kit/contract-tests";
import { transcriptStoreContract } from "../../../erix-llm-kit/test/contract/transcript-store.js";

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

if (creds) {
  db = new Database({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });

  await db.connect();

  const setupStore = createTouwakaTranscriptStore({ db });
  Transcript = db.sequelize.models.llm_kit_transcript;
  await setupStore.sync({ force: true });
}

after(async () => {
  if (!db) return;

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
    return createTouwakaTranscriptStore({ db });
  });
}
