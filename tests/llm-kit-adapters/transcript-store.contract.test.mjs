/**
 * touwaka TranscriptStore v2 × erix-agent 0.12.0 契约测试（真实 MariaDB）
 *
 * issue #1134：三层拆行（agent_rounds/messages/chat_tool_calls）后只实现
 * erix #78 capability 分级的必需面 {appendRound, load}。
 *
 * 取舍说明：erix 的 transcriptStoreContract 套件覆盖完整表面（含 run snapshot /
 * run-state 可选方法断言），touwaka store 是最小实现、不再实现可选能力，
 * 故不可整用；本文件引用其必需面用例（append/load 往返保真、未知 runId、
 * 多 runId 隔离、round 0 保序、folded 元数据）以本地等价断言实现。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 * 运行：node --test tests/llm-kit-adapters/
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

const CREDS_PATH = join(homedir(), ".config/mcp/creds/touwaka-test-db.json");

// 与 erix test/contract/transcript-store.js 相同形状（该文件不导出 fixture，本地复刻）
const ROUND_1 = {
  round: 1,
  roundKey: "run-1:round:1",
  dedupKey: "run-1:engine:round:1",
  ts: "2026-08-29T00:00:00.000Z",
  messages: [
    { role: "user", content: [{ type: "text", text: "inspect files" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list", input: { path: "." } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "README.md" }] },
  ],
  response: { content: [{ type: "tool_use", id: "t1", name: "list", input: { path: "." } }], stopReason: "tool_use" },
  textPreview: "",
  toolUses: 1,
};
const ROUND_2 = {
  round: 2,
  ts: "2026-08-29T00:01:00.000Z",
  messages: [{ role: "assistant", content: [{ type: "text", text: "summary" }] }],
  response: { content: [{ type: "text", text: "summary" }], stopReason: "end_turn", usage: { prompt_tokens: 10, completion_tokens: 5 } },
  textPreview: "summary",
};

function loadCreds() {
  try {
    return JSON.parse(readFileSync(CREDS_PATH, "utf8"));
  } catch {
    return null;
  }
}

const creds = loadCreds();
let db = null;
let UserId = null;
let ExpertId = null;
// 本文件独占的 runId 命名空间（随机后缀），只清自己写入的行
let ns = null;

if (creds) {
  db = new Database({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });
  await db.connect();

  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  UserId = user?.[0]?.id ?? "test_user_contract";
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  ExpertId = expert?.[0]?.id ?? null;
  ns = randomUUID().slice(0, 8);
}

const requestContext = { topic_id: null, user_id: UserId ?? "u_contract", expert_id: ExpertId };

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
  test("touwaka TranscriptStore v2 契约（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  beforeEach(cleanup);

  test("store 方法面恰为必需能力 {appendRound, load}（#78 capability 分级）", () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    assert.deepEqual(Object.keys(store).sort(), ["appendRound", "load"]);
    for (const optional of [
      "saveRunState", "loadRunState", "markRunState",
      "saveRunSnapshot", "loadLatestRunSnapshot",
      "saveCheckpoint", "appendCheckpoint", "loadLatestCheckpoint",
    ]) {
      assert.equal(store[optional], undefined, `不应实现可选方法 ${optional}`);
    }
  });

  test("appendRound/load 往返保真（块结构与元数据）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("roundtrip");
    await store.appendRound(id, ROUND_1);
    await store.appendRound(id, ROUND_2);

    const loaded = await store.load(id);
    assert.equal(loaded.length, 2);
    assert.deepEqual(loaded[0].round, ROUND_1.round);
    assert.deepEqual(loaded[0].ts, ROUND_1.ts);
    assert.deepEqual(loaded[0].messages, ROUND_1.messages);
    assert.deepEqual(loaded[1].messages, ROUND_2.messages);
    assert.deepEqual(loaded[1].response?.usage, ROUND_2.response.usage);
    assert.equal(loaded[1].response?.stopReason, "end_turn");
    assert.equal(loaded[0].textPreview, ROUND_1.textPreview);
    assert.equal(loaded[0].toolUses, 1);
  });

  test("拆行：三表行数与字段映射正确", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("split");
    await store.appendRound(id, ROUND_1);
    await store.appendRound(id, ROUND_2);

    const [rounds] = await db.sequelize.query(
      "SELECT * FROM agent_rounds WHERE request_id = :id ORDER BY round_no ASC",
      { replacements: { id } },
    );
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0].round_no, 1);
    assert.equal(rounds[0].stop_reason, "tool_use");
    assert.equal(rounds[0].dedup_key, ROUND_1.dedupKey);
    assert.equal(rounds[0].latency_ms, null);
    assert.equal(Boolean(rounds[0].folded), false);
    const snapshot = JSON.parse(rounds[0].record_json);
    assert.equal(snapshot.textPreview, "");
    assert.equal(snapshot.toolUses, 1);
    assert.equal(snapshot.messages, undefined, "messages 不进 record_json");
    assert.equal(snapshot.response, undefined, "response 拆 stop_reason/usage 列");

    // ROUND_1：user(text) 一行；纯 tool_use assistant 与 tool_result user 消息不插行
    const [messages] = await db.sequelize.query(
      "SELECT * FROM messages WHERE round_id IN (:roundIds) ORDER BY sequence_no ASC",
      { replacements: { roundIds: rounds.map((r) => r.id) } },
    );
    assert.equal(messages.length, 2); // ROUND_1 user text + ROUND_2 assistant text
    assert.equal(messages[0].role, "user");
    assert.equal(messages[0].content, "inspect files");
    assert.equal(messages[0].sequence_no, 0);
    assert.equal(messages[0].request_id, id);
    assert.equal(messages[0].user_id, requestContext.user_id);
    assert.equal(messages[0].expert_id, requestContext.expert_id);
    assert.equal(messages[1].role, "assistant");
    assert.equal(messages[1].content, "summary");

    const [toolCalls] = await db.sequelize.query(
      "SELECT * FROM chat_tool_calls WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].tool_use_id, "t1");
    assert.equal(toolCalls[0].name, "list");
    assert.deepEqual(JSON.parse(toolCalls[0].input_json), { path: "." });
    assert.equal(JSON.parse(toolCalls[0].result_json), "README.md");
    assert.equal(Boolean(toolCalls[0].is_error), false);
  });

  test("dedup_key 幂等：重复 appendRound 不产生重复行", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("dedup");
    await store.appendRound(id, ROUND_1);
    const [firstCount] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM messages WHERE request_id = :id",
      { replacements: { id } },
    );
    await store.appendRound(id, { ...ROUND_1, ts: "2026-08-29T00:09:00.000Z" });

    const [rounds] = await db.sequelize.query(
      "SELECT * FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].ts, ROUND_1.ts, "重复写入不覆盖首轮行");

    // 全局按 request_id 计数：重复调用不得产生挂在孤儿 round_id 下的拆分行
    const [afterCount] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM messages WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(afterCount[0].n, firstCount[0].n, "messages 全局行数不变（无孤儿行）");

    const [messages] = await db.sequelize.query(
      "SELECT * FROM messages WHERE round_id = :roundId",
      { replacements: { roundId: rounds[0].id } },
    );
    assert.equal(messages.length, 1);
  });

  test("部分失败重试：agent_rounds 已落、messages 未落时复用 round_id", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("partial-retry");
    // 模拟上轮写入部分失败：agent_rounds 行已落（带 dedup_key），messages 拆行未落
    const preexistingRoundId = `round_manual_${ns}`;
    await db.sequelize.query(`
      INSERT INTO agent_rounds
        (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
         folded, folded_range, record_json, ts, created_at)
      VALUES
        (:id, :runId, :roundNo, :dedupKey, NULL, NULL, NULL,
         b'0', NULL, NULL, :ts, :now)
    `, {
      replacements: {
        id: preexistingRoundId,
        runId: id,
        roundNo: ROUND_1.round,
        dedupKey: ROUND_1.dedupKey,
        ts: ROUND_1.ts,
        now: new Date(),
      },
    });

    // 重试完整 record：必须复用已存在 round_id，messages 落到其下
    await store.appendRound(id, ROUND_1);

    const [rounds] = await db.sequelize.query(
      "SELECT * FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rounds.length, 1, "不产生第二个 agent_rounds 行");
    assert.equal(rounds[0].id, preexistingRoundId, "复用已存在的 round_id");

    const [messages] = await db.sequelize.query(
      "SELECT * FROM messages WHERE request_id = :id ORDER BY sequence_no ASC",
      { replacements: { id } },
    );
    assert.equal(messages.length, 1, "拆行落到已存在 round 下且行数正确");
    assert.equal(messages[0].round_id, preexistingRoundId);
    assert.equal(messages[0].content, "inspect files");

    const [toolCalls] = await db.sequelize.query(
      "SELECT * FROM chat_tool_calls WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0].round_id, preexistingRoundId);

    // load() 重组与输入等价
    const loaded = await store.load(id);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].messages, ROUND_1.messages);

    // 再次重试同一 record：仍幂等
    await store.appendRound(id, ROUND_1);
    const [again] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM messages WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(again[0].n, 1);
  });

  test("reasoning/folded/foldedPayload 往返", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("folded");
    const payload = [
      { role: "user", content: [{ type: "text", text: "early" }] },
      { role: "assistant", content: [{ type: "text", text: "reply" }] },
    ];
    await store.appendRound(id, {
      round: 5,
      folded: true,
      foldedRoundRange: { from: 1, to: 4 },
      ts: "2026-08-29T00:05:00.000Z",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "visible" },
            { type: "reasoning", text: "thinking deep" },
          ],
        },
      ],
      foldedPayload: payload,
    });

    const loaded = await store.load(id);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].folded, true);
    assert.deepEqual(loaded[0].foldedRoundRange, { from: 1, to: 4 });
    assert.deepEqual(loaded[0].foldedPayload, payload);
    assert.deepEqual(loaded[0].messages, [
      {
        role: "assistant",
        content: [
          { type: "text", text: "visible" },
          { type: "reasoning", text: "thinking deep" },
        ],
      },
    ]);
  });

  test("load 未知 runId 返回空数组", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    assert.deepEqual(await store.load(runId("nonexistent")), []);
  });

  test("多 runId 隔离", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const a = runId("iso-a");
    const b = runId("iso-b");
    await store.appendRound(a, ROUND_1);
    await store.appendRound(b, ROUND_2);

    assert.equal((await store.load(a)).length, 1);
    assert.equal((await store.load(b)).length, 1);
    assert.equal((await store.load(a))[0].round, 1);
    assert.equal((await store.load(b))[0].round, 2);
  });

  test("round 0 种子记录保序（loop resume 依赖）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("seed");
    await store.appendRound(id, {
      round: 0,
      ts: "2026-08-29T00:00:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "seed initial context" }] }],
    });
    await store.appendRound(id, ROUND_1);
    await store.appendRound(id, ROUND_2);

    const loaded = await store.load(id);
    assert.deepEqual(loaded.map((record) => record.round), [0, 1, 2]);
  });

  test("合成 dedupKey：缺省时按 ${runId}:round:${round} 幂等", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("default-dedup");
    const seed = { round: 0, ts: "2026-08-29T00:00:00.000Z", messages: [] };
    await store.appendRound(id, seed);
    await store.appendRound(id, seed);

    const [rounds] = await db.sequelize.query(
      "SELECT * FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rounds.length, 1);
    assert.equal(rounds[0].dedup_key, `${id}:round:0`);
  });
}
