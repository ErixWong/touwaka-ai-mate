/**
 * touwaka ModelConfigProvider 适配器 × erix-agent 契约测试（真实 MariaDB）
 *
 * 在测试库（llm_kit_test）内用 sequelize sync 建出 providers / ai_models 两表的真实结构，
 * 播种后跑库的 modelConfigProviderContract 全部断言。
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
import { createTouwakaModelConfigProvider } from "../../lib/llm-kit-adapters/model-config-provider.js";

import { modelConfigProviderContract } from "erix-agent/contract-tests";

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

if (creds) {
  db = new Database({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });

  await db.connect();

  // 真实模型定义 sync 建表（force 重建，保证干净的契约环境）
  await db.models.provider.sync({ force: true });
  await db.models.ai_model.sync({ force: true });

  // 播种：两个 provider（不同 api_key），三个模型
  await db.models.provider.bulkCreate([
    { id: "p-main", name: "主网关", base_url: "http://127.0.0.1:8317/v1", api_key: "main-secret-key", is_active: true },
    { id: "p-fold", name: "折叠专用", base_url: "http://127.0.0.1:8317/v1", api_key: "fold-secret-key", is_active: true },
    { id: "p-off", name: "停用", base_url: "http://127.0.0.1:9/v1", api_key: "off-key", is_active: false },
  ]);
  await db.models.ai_model.bulkCreate([
    // 默认文本模型（created_at 最新 → default slot 命中它）
    { id: "m-default", name: "默认文本", model_name: "qwen3-default", model_type: "text", provider_id: "p-main", max_tokens: 131072, max_output_tokens: 8192, is_active: true, created_at: "2026-08-01 00:00:00", updated_at: "2026-08-01 00:00:00" },
    // 命名槽位模型（slot = ai_model.id）
    { id: "m-fold", name: "折叠", model_name: "qwen3-fold", model_type: "text", provider_id: "p-fold", max_tokens: 32768, max_output_tokens: 4096, is_active: true, created_at: "2026-07-01 00:00:00", updated_at: "2026-07-01 00:00:00" },
    // 更老的默认候选（不应命中 default）
    { id: "m-old", name: "旧模型", model_name: "qwen-old", model_type: "text", provider_id: "p-main", max_tokens: 8192, max_output_tokens: 2048, is_active: true, created_at: "2026-06-01 00:00:00", updated_at: "2026-06-01 00:00:00" },
    // 非文本模型（不应命中 default）
    { id: "m-emb", name: "嵌入", model_name: "bge-m3", model_type: "embedding", provider_id: "p-main", is_active: true, created_at: "2026-08-02 00:00:00", updated_at: "2026-08-02 00:00:00" },
  ]);

}

after(async () => {
  if (!db) return;

  await db.models.ai_model.drop();
  await db.models.provider.drop();
  if (typeof db.close === "function") {
    await db.close();
  } else if (db.sequelize) {
    await db.sequelize.close();
  }
});

if (!creds) {
  test("touwaka ModelConfigProvider 适配器契约（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  const provider = createTouwakaModelConfigProvider({ db });
  modelConfigProviderContract("touwaka ModelConfigProvider", async () => ({
    provider,
    slot: "m-fold",
    expect: {
      defaultModel: "qwen3-default",
      slotModel: "qwen3-fold",
      materializedKey: "fold-secret-key",
    },
  }));
}
