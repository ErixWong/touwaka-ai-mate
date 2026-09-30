/**
 * touwaka TranscriptStore v2 拆行行为测试（真实 MariaDB）
 *
 * issue #1134 T2：跨轮 tool_use/tool_result 配对 UPSERT、requestContext 归属、
 * multimodal/reasoning 列映射、createErixStore（loop-bridge）最小方法面。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "os";

// logs/ 目录当前是 root 属主，避免 logger 写文件的权限错误掩盖数据库测试结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import Database from "../../lib/db.js";
import { createTouwakaTranscriptStore } from "../../lib/llm-kit-adapters/transcript-store.js";
import { createErixStore } from "../../lib/llm-kit-adapters/loop-bridge.js";

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
let ns = null;
let UserId = null;

if (creds) {
  db = new Database({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });
  await db.connect();
  ns = randomUUID().slice(0, 8);
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  UserId = user?.[0]?.id ?? "u_meta";
}

const requestContext = {
  topic_id: null,
  user_id: UserId ?? "u_meta",
  expert_id: null, // experts 表 FK：测试库 experts 可能为空，归属映射由 contract 测试覆盖
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
  test("touwaka TranscriptStore v2 拆行行为（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  beforeEach(cleanup);

  test("tool_use 轮 N / tool_result 轮 N+1 落同一行并更新 is_error", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("pairing");
    // 模拟乱序容忍的常规形态：round 1 assistant 发 tool_use，round 2 user 消息带 tool_result
    await store.appendRound(id, {
      round: 1,
      ts: "2026-08-29T00:00:00.000Z",
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "tc-1", name: "bash", input: { cmd: "ls" } }] },
      ],
    });
    await store.appendRound(id, {
      round: 2,
      ts: "2026-08-29T00:00:10.000Z",
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tc-1", content: "boom", is_error: true }],
        },
        { role: "assistant", content: [{ type: "text", text: "fixing" }] },
      ],
    });

    const [rows] = await db.sequelize.query(
      "SELECT * FROM chat_tool_calls WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rows.length, 1, "同一 tool_use_id 只有一行（全生命周期）");
    assert.equal(rows[0].name, "bash");
    assert.equal(JSON.parse(rows[0].input_json).cmd, "ls");
    assert.equal(JSON.parse(rows[0].result_json), "boom");
    assert.equal(Boolean(rows[0].is_error), true);

    // round_id 保持 tool_use 发生轮
    const [rounds] = await db.sequelize.query(
      "SELECT * FROM agent_rounds WHERE request_id = :id ORDER BY round_no ASC",
      { replacements: { id } },
    );
    assert.equal(rows[0].round_id, rounds[0].id);

    // load 重组：round 1 还原 assistant tool_use；tool_result 属 round 1（tool_use 轮）
    const loaded = await store.load(id);
    assert.deepEqual(loaded[0].messages, [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "tc-1", name: "bash", input: { cmd: "ls" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tc-1", content: "boom", is_error: true }] },
    ]);
    assert.deepEqual(loaded[1].messages, [
      { role: "assistant", content: [{ type: "text", text: "fixing" }] },
    ]);
  });

  test("乱序容忍：tool_result 先于 tool_use 到达也能配对", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("reorder");
    await store.appendRound(id, {
      round: 1,
      ts: "2026-08-29T00:00:00.000Z",
      messages: [
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tc-9", content: "early result" }] },
      ],
    });
    await store.appendRound(id, {
      round: 2,
      ts: "2026-08-29T00:00:10.000Z",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "tc-9", name: "note_read", input: {} }] },
      ],
    });

    const [rows] = await db.sequelize.query(
      "SELECT * FROM chat_tool_calls WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rows.length, 1);
    assert.equal(JSON.parse(rows[0].result_json), "early result");
    assert.equal(rows[0].name, "note_read");

    const loaded = await store.load(id);
    // 乱序场景的归属取舍：整行（tool_use + tool_result 生命周期）挂先到达轮
    // （round 1），load 在该轮重组出完整配对；后到的 tool_use 不再挪窝
    assert.deepEqual(loaded[0].messages, [
      { role: "assistant", content: [{ type: "tool_use", id: "tc-9", name: "note_read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tc-9", content: "early result" }] },
    ]);
    assert.deepEqual(loaded[1].messages, []);
  });

  test("多 tool_use 同行配对：assistant 消息 content 尾追加全部 tool_use 块", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("multi");
    await store.appendRound(id, {
      round: 1,
      ts: "2026-08-29T00:00:00.000Z",
      messages: [
        { role: "user", content: [{ type: "text", text: "double" }] },
        { role: "assistant", content: [
          { type: "text", text: "calling two" },
          { type: "tool_use", id: "m1", name: "a", input: { n: 1 } },
          { type: "tool_use", id: "m2", name: "b", input: { n: 2 } },
        ] },
        { role: "user", content: [
          { type: "tool_result", tool_use_id: "m1", content: "r1" },
          { type: "tool_result", tool_use_id: "m2", content: "r2" },
        ] },
      ],
    });

    const loaded = await store.load(id);
    assert.deepEqual(loaded[0].messages, [
      { role: "user", content: [{ type: "text", text: "double" }] },
      { role: "assistant", content: [
        { type: "text", text: "calling two" },
        { type: "tool_use", id: "m1", name: "a", input: { n: 1 } },
        { type: "tool_use", id: "m2", name: "b", input: { n: 2 } },
      ] },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "m1", content: "r1" },
        { type: "tool_result", tool_use_id: "m2", content: "r2" },
      ] },
    ]);
  });

  test("reasoning/multimodal 列映射与还原（D2-i 兼容形态）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("blocks");
    await store.appendRound(id, {
      round: 1,
      ts: "2026-08-29T00:00:00.000Z",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "look:" },
            { type: "reasoning", text: "hmm" },
            { type: "image", image_url: { url: "https://example.com/a.png" } },
          ],
        },
      ],
    });

    const [rounds] = await db.sequelize.query(
      "SELECT * FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    const [rows] = await db.sequelize.query(
      "SELECT * FROM messages WHERE round_id = :roundId",
      { replacements: { roundId: rounds[0].id } },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reasoning_content, "hmm");
    const content = JSON.parse(rows[0].content);
    assert.equal(content.type, "multimodal");
    assert.deepEqual(content.content[0], { type: "text", text: "look:" });
    assert.deepEqual(content.content[1], { type: "image", image_url: { url: "https://example.com/a.png" } });

    const loaded = await store.load(id);
    assert.deepEqual(loaded[0].messages, [
      {
        role: "assistant",
        content: [
          { type: "text", text: "look:" },
          { type: "image", image_url: { url: "https://example.com/a.png" } },
          { type: "reasoning", text: "hmm" },
        ],
      },
    ]);
  });

  test("requestContext 缺失时 user_id 落 NULL 以外的不报错路径（erix 直调）", async () => {
    // createErixStore 不传 requestContext：messages.user_id 为 NULL 会触发
    // NOT NULL 约束——erix 运行时调用点（agent-loop）必定注入；这里验证的是
    // 无工具轮（无 messages 拆行）时缺 requestContext 也能正常工作。
    const store = createErixStore({ db });
    assert.deepEqual(Object.keys(store).sort(), ["appendRound", "load"]);
    const id = runId("noctx");
    await store.appendRound(id, {
      round: 1,
      ts: "2026-08-29T00:00:00.000Z",
      messages: [{ role: "assistant", content: [{ type: "tool_use", id: "x1", name: "noop", input: {} }] }],
    });
    const loaded = await store.load(id);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].messages, [
      { role: "assistant", content: [{ type: "tool_use", id: "x1", name: "noop", input: {} }] },
    ]);
  });
}
