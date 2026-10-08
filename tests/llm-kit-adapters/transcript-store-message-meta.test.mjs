/**
 * touwaka TranscriptStore message 级 meta 保真测试（真实 MariaDB，issue #1147）
 *
 * 覆盖 erix-agent 0.16.0 "Store fidelity requirements" 的最后一处缺口：
 * `messages[].meta` 随新列 messages.meta_json 原样往返。
 *
 * 判别点（故意设计成白名单实现过不了）：
 * - meta 里的未知键（myHostKey / 嵌套对象）必须存活——上游契约原话
 *   "including fields it does not understand"，禁止按固定键重建；
 * - 经我们 store 往返后 projectTranscriptForDisplay 必须输出
 *   meta.synthetic === true 且 meta.source === "judge-control"（#1146 里是 false）；
 * - 历史行 meta_json 为 NULL：不报错，也不得挂出空 meta 对象。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// logs/ 目录当前是 root 属主，避免 logger 写文件的权限错误掩盖数据库测试结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import { openTestDatabase, DEFAULT_CREDS_PATH } from "../helpers/test-db-guard.mjs";
import { createTouwakaTranscriptStore } from "../../lib/llm-kit-adapters/transcript-store.js";
import { projectTranscriptForDisplay } from "erix-agent";

// issue #1167：目标库必须是测试库。openTestDatabase() 内部先跑硬断言
//（tests/helpers/test-db-guard.mjs），白名单（llm_kit_test）不命中就在**建连接之前**抛错终止，
// 不会静默把破坏性测试打到生产库。凭据文件缺失时返回 null → 用例 skip（保持原行为）。
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
let db = null;
let ns = null;
let UserId = null;

if (dbCtx) {
  db = dbCtx.db;
  ns = randomUUID().slice(0, 8);
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  UserId = user?.[0]?.id ?? "u_msgmeta";
}

const requestContext = {
  topic_id: null,
  user_id: UserId ?? "u_msgmeta",
  expert_id: null, // experts 表 FK：测试库可能为空，归属映射由 contract 测试覆盖
};

async function cleanup() {
  if (!db) return;
  // agent_rounds/chat_tool_calls 未挂进 init-models（models/ 禁手改），走 raw query
  const [rounds] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern: `run-${ns}-%` } },
  );
  const roundIds = rounds.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query("DELETE FROM messages WHERE round_id IN (:roundIds)", { replacements: { roundIds } });
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE round_id IN (:roundIds)", { replacements: { roundIds } });
  }
  await db.sequelize.query("DELETE FROM agent_rounds WHERE request_id LIKE :pattern", { replacements: { pattern: `run-${ns}-%` } });
}

function runId(label) {
  return `run-${ns}-${label}`;
}

after(async () => {
  if (!db) return;
  await cleanup();
  if (typeof db.close === "function") {
    await db.close();
  } else if (db.sequelize) {
    await db.sequelize.close();
  }
});

if (!creds) {
  test("TranscriptStore message 级 meta 保真（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  beforeEach(cleanup);

  test("messages[].meta 往返保真：source 与未知键都原样回来（issue #1147）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("meta-roundtrip");
    // 写入形态对齐 erix orchestrator 的 judge 方向提示轮（orchestrator.js:2301-2306：
    // 独立 user text 消息 + meta.source = "judge-control"），再额外挂一个宿主未知键
    // 与一个嵌套结构，用来识破"固定键白名单"式实现。
    const meta = {
      source: "judge-control",
      myHostKey: "v",
      hostNested: { deep: [1, 2, 3], flag: true },
    };
    await store.appendRound(id, {
      round: 1,
      ts: "2026-10-08T00:00:00.000Z",
      messages: [
        { role: "user", content: [{ type: "text", text: "继续" }] },
        { role: "user", meta, content: [{ type: "text", text: "【Judge 评审意见】换个方向" }] },
      ],
    });

    // 写侧确实落列（不是靠 record_json 兜底：本轮 messages 走的是拆行路径）
    const [rounds] = await db.sequelize.query(
      "SELECT id, record_json FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rounds.length, 1);
    assert.equal(
      Array.isArray(JSON.parse(rounds[0].record_json).messages),
      false,
      "本轮 messages 不在 record_json 里（证明确实走拆行路径，meta 只能来自 meta_json 列）",
    );
    const [rows] = await db.sequelize.query(
      "SELECT role, content, meta_json FROM messages WHERE round_id = :roundId ORDER BY sequence_no ASC",
      { replacements: { roundId: rounds[0].id } },
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].meta_json, null, "无 meta 的行落 NULL");
    assert.deepEqual(JSON.parse(rows[1].meta_json), meta);

    // 读侧整对象挂回，未知键存活
    const [loaded] = await store.load(id);
    assert.deepEqual(loaded.messages[1].meta, meta);
    assert.equal(loaded.messages[1].meta.source, "judge-control");
    assert.equal(loaded.messages[1].meta.myHostKey, "v", "未知键必须存活（白名单反模式判别点）");
    assert.deepEqual(loaded.messages[1].meta.hostNested, { deep: [1, 2, 3], flag: true });
    // 无 meta 的消息不得被挂出空对象
    assert.equal("meta" in loaded.messages[0], false);
    // 除 meta 外的既有保真不回归
    assert.deepEqual(loaded.messages[0], { role: "user", content: [{ type: "text", text: "继续" }] });
  });

  test("投影翻绿：store 往返后 projectTranscriptForDisplay 判 synthetic=true / source=judge-control", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("projection");
    await store.appendRound(id, {
      round: 5,
      ts: "2026-10-08T00:00:00.000Z",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "上一轮输出" }] },
        {
          role: "user",
          meta: { source: "judge-control" },
          content: [{ type: "text", text: "【Judge 评审意见】请换方向" }],
        },
      ],
    });

    const turns = projectTranscriptForDisplay(await store.load(id));
    const hintTurn = turns.find((turn) => turn.role === "user");
    assert.ok(hintTurn, "投影里有该 user 轮");
    // #1146 里这两项是 synthetic=false（meta 没落库，只能回退文本前缀启发式，
    // 而上游启发式不认识【Judge 评审意见】前缀）；本 issue 后必须翻绿。
    assert.equal(hintTurn.meta.synthetic, true);
    assert.equal(hintTurn.meta.source, "judge-control");
    // 来自 message.meta.source 的分类不得带 sourceInferred 标记（那是启发式兜底的告警）
    assert.equal("sourceInferred" in hintTurn.meta, false);
  });

  test("评委可见性：往返后 judge 的 judge-control 排除规则重新生效", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("judge-filter");
    await store.appendRound(id, {
      round: 1,
      ts: "2026-10-08T00:00:00.000Z",
      messages: [
        { role: "user", content: [{ type: "text", text: "真实用户发言" }] },
        { role: "user", meta: { source: "judge-control" }, content: [{ type: "text", text: "方向提示" }] },
      ],
    });

    const messages = (await store.load(id)).flatMap((record) => record.messages ?? []);
    // 复刻 erix reflection/judge.js:279 的可见集过滤（该模块不导出，形状一致即可验证）
    const visible = messages.filter((message) => message?.meta?.source !== "judge-control");
    assert.deepEqual(
      visible.map((message) => message.content[0].text),
      ["真实用户发言"],
      "方向提示必须被排除出评委可见上下文（meta 丢失时这条会退化成两条都可见）",
    );
  });

  test("历史行兼容：meta_json 为 NULL 不报错、不挂出空 meta 对象", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("legacy-null-meta");
    await store.appendRound(id, {
      round: 1,
      ts: "2026-10-08T00:00:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "老数据" }] }],
    });
    // 模拟本列上线前写入的历史行：直接确认列为 NULL（写侧无 meta 即 NULL），
    // 再把值显式刷成 NULL 之外的历史形态（空串）验证读侧同样不挂 meta、不抛错。
    const [rounds] = await db.sequelize.query(
      "SELECT id FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    const [before] = await db.sequelize.query(
      "SELECT meta_json FROM messages WHERE round_id = :roundId",
      { replacements: { roundId: rounds[0].id } },
    );
    assert.equal(before[0].meta_json, null, "无 meta 的行落 NULL（历史行天然形态）");

    let loaded = await store.load(id);
    assert.equal("meta" in loaded[0].messages[0], false, "NULL 行不得挂出 meta 键");

    await db.sequelize.query(
      "UPDATE messages SET meta_json = '' WHERE round_id = :roundId",
      { replacements: { roundId: rounds[0].id } },
    );
    loaded = await store.load(id);
    assert.equal("meta" in loaded[0].messages[0], false, "空串同样不得挂出 meta 键");
    assert.deepEqual(loaded[0].messages[0], { role: "user", content: [{ type: "text", text: "老数据" }] });

    // 脏值（非 JSON / 非对象）也不得让 load() 抛错
    await db.sequelize.query(
      "UPDATE messages SET meta_json = 'not-json' WHERE round_id = :roundId",
      { replacements: { roundId: rounds[0].id } },
    );
    loaded = await store.load(id);
    assert.equal("meta" in loaded[0].messages[0], false);
  });

  test("非对象 meta（数组 / 标量）同样原样往返，不静默降级", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("meta-non-object");
    // 上游 typedef 是 { source?, [key: string]: any }，但宿主不得假设"非对象就丢掉"：
    // 任何已定义的 meta 值都必须原样回来（写侧 JSON.stringify、读侧 JSON.parse 整值）。
    await store.appendRound(id, {
      round: 1,
      ts: "2026-10-08T00:00:00.000Z",
      messages: [
        { role: "user", meta: ["a", 1, { deep: true }], content: [{ type: "text", text: "数组 meta" }] },
        { role: "user", meta: { count: 0, emptyText: "", nestedNull: null }, content: [{ type: "text", text: "假值键" }] },
      ],
    });

    const [loaded] = await store.load(id);
    assert.deepEqual(loaded.messages[0].meta, ["a", 1, { deep: true }]);
    // 值为假值（0 / "" / null）的键不得因为 falsy 判断而被丢掉
    assert.deepEqual(loaded.messages[1].meta, { count: 0, emptyText: "", nestedNull: null });
  });

  test("幂等重复 appendRound 不破坏 meta（先写先赢，meta_json 不被覆盖成 NULL）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("meta-idempotent");
    const record = {
      round: 1,
      ts: "2026-10-08T00:00:00.000Z",
      messages: [{ role: "user", meta: { source: "judge-control", myHostKey: "v" }, content: [{ type: "text", text: "重复轮" }] }],
    };
    await store.appendRound(id, record);
    await store.appendRound(id, record);

    const loaded = await store.load(id);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].messages[0].meta, { source: "judge-control", myHostKey: "v" });
  });
}
