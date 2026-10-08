/**
 * touwaka ModelConfigProvider 适配器 × erix-agent 契约测试（真实 MariaDB）
 *
 * 在测试库（llm_kit_test）内用 sequelize sync 建出 providers / ai_models 两表的真实结构，
 * 播种后跑库的 modelConfigProviderContract 全部断言。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 * 运行：node --test tests/llm-kit-adapters/
 *
 * issue #1167（破坏性测试安全）：
 *   - 建连接之前必须先过硬断言（tests/helpers/test-db-guard.mjs）：目标库不是测试库就直接终止，
 *     避免凭据文件被换成生产库（touwaka_mate）时一次测试就把线上表重建掉。
 *   - 不再使用 `sync({ force: true })` / `drop()`（那是 DROP TABLE + CREATE TABLE）：
 *     改为「只建缺失表 + 只删本文件自己插入的固定 id 行 + 隔离前置断言」。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";

// logs/ 目录当前是 root 属主（容器残留），logger 写文件会 EACCES 掩盖真实错误。
// 测试环境把 logger 降级为 console-only（在 db.connect() 之前补丁即可，logger 是模块级单例）。
// TODO: sudo chown -R eric:eric logs/ 后可移除此补丁。
import logger from "../../lib/logger.js";
for (const m of ["info", "warn", "error", "debug"]) {
  if (typeof logger[m] === "function") logger[m] = () => {};
}

import { createTouwakaModelConfigProvider } from "../../lib/llm-kit-adapters/model-config-provider.js";
import { openTestDatabase, DEFAULT_CREDS_PATH } from "../helpers/test-db-guard.mjs";

import { modelConfigProviderContract } from "erix-agent/contract-tests";

// 本文件独占的数据命名空间：只认这些固定 id，播种前与 teardown 都只清理它们。
const PROVIDER_IDS = ["p-main", "p-fold", "p-off"];
const MODEL_IDS = ["m-default", "m-fold", "m-old", "m-emb"];

// 守卫 → 才建连接（openTestDatabase 内部先 assertTestDatabase，再 new Database / connect）
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const db = dbCtx?.db ?? null;

if (dbCtx) {
  // 只建缺失表：**不带 force**，绝不 DROP / 重建既有表（#1167）。
  // 取舍：schema drift 不再被 force 静默刷新，若模型定义与库里旧表结构分叉，这里会以契约断言
  // 失败的形式暴露出来（在测试库上，人工 DROP 一次即可），而不是被 DROP TABLE 悄悄抹平。
  await db.models.provider.sync();
  await db.models.ai_model.sync();

  // 幂等前置清理：只删本文件自己用的固定 id（上次运行中途崩溃时可能残留）。
  // 顺序：先子表 ai_model 再父表 providers，避免外键阻塞。
  await db.models.ai_model.destroy({ where: { id: MODEL_IDS } });
  await db.models.provider.destroy({ where: { id: PROVIDER_IDS } });

  // 隔离前置断言：defaultModel 解析走全表扫描
  //（lib/llm-kit-adapters/model-config-provider.js resolveDefault: findOne order created_at DESC），
  // 表里混进别人的行就会假阳性/假阴性。这里 **fail loudly**，而不是 DROP 掉别人的数据。
  const isolationTargets = [
    ["providers", db.models.provider, PROVIDER_IDS],
    ["ai_models", db.models.ai_model, MODEL_IDS],
  ];
  for (const [label, model, ids] of isolationTargets) {
    const foreign = await model.count({ where: { id: { [db.Op.notIn]: ids } } });
    assert.equal(
      foreign,
      0,
      `[${label}] 表里存在 ${foreign} 行不属于本契约测试的数据；本测试不再用 DROP 强行清空，` +
        "请先人工确认并清理测试库 llm_kit_test 中的该表（本文件只负责 id=" + ids.join(",") + "）",
    );
  }

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

  // 只删自己插入的行；**不再 drop()**（drop = DROP TABLE，和 sync({force}) 同级破坏性，#1167）
  await db.models.ai_model.destroy({ where: { id: MODEL_IDS } });
  await db.models.provider.destroy({ where: { id: PROVIDER_IDS } });
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
