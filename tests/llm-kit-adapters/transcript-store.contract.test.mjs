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

// logs/ 目录当前是 root 属主，避免 logger 写文件的权限错误掩盖数据库测试结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import { openTestDatabase, DEFAULT_CREDS_PATH } from "../helpers/test-db-guard.mjs";
import { createTouwakaTranscriptStore } from "../../lib/llm-kit-adapters/transcript-store.js";

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

// issue #1167：目标库必须是测试库。openTestDatabase() 内部先跑硬断言
//（tests/helpers/test-db-guard.mjs），白名单（llm_kit_test）不命中就在**建连接之前**抛错终止，
// 不会静默把破坏性测试打到生产库。凭据文件缺失时返回 null → 用例 skip（保持原行为）。
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
let db = null;
let UserId = null;
let ExpertId = null;
// 本文件独占的 runId 命名空间（随机后缀），只清自己写入的行
let ns = null;

if (dbCtx) {
  db = dbCtx.db;

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
  // #1156 Stage B：canonical 与展示面同事务写入，清理也要一起清
  await db.sequelize.query("DELETE FROM agent_transcript_rounds WHERE request_id LIKE :pattern", { replacements: { pattern: `run-${ns}-%` } });
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

  test("store 方法面 = 必需能力 + 成对快路径探针（#78 分级 + #1150）", () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    // issue #1150：erix-agent 0.17.0 的两条可选探针已实现（成对），
    // run snapshot / run-state 等其余可选 capability 仍有意不实现。
    assert.deepEqual(Object.keys(store).sort(),
      ["appendRound", "load", "loadByDedupKey", "loadMaxRound"]);
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
    // issue #1146：response/roundKey/meta 已移出白名单，随 record_json 原样往返
    // （stop_reason/usage 两列仍在、与 record_json 重复，供查询用）
    assert.deepEqual(snapshot.response, ROUND_1.response);
    assert.equal(snapshot.roundKey, ROUND_1.roundKey);

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

  // 真机 e2e 缺陷 1：round 0 seed 的 messages 是完整初始上下文（系统技能提示 +
  // 之前所有历史对话），照常拆行会让每跑一次 run 就多出一整套历史副本。
  const seedRecord = (id, messages) => ({
    round: 0,
    roundKey: `${id}:round:0`,
    dedupKey: `${id}:engine:round:0:seed`,
    ts: "2026-08-29T00:00:00.000Z",
    messages,
    summary: "missing",
    l0facts: [],
  });

  test("seed 轮不物化历史：messages/chat_tool_calls 零新增，record_json 保留 messages", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("seed-no-materialize");
    const history = [
      { role: "system", content: [{ type: "text", text: "系统技能提示" }] },
      { role: "user", content: [{ type: "text", text: "5 天前的问题" }] },
      { role: "assistant", content: [{ type: "text", text: "5 天前的回答" }, { type: "reasoning", text: "旧思考" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "old-1", content: "旧工具结果" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "old-2", name: "bash", input: { cmd: "ls" } }] },
    ];
    // 计数在 user_id 之外再按 request_id 收窄：node --test 并行跑多个测试文件时，
    // 兄弟文件会向同一 user_id 写行，仅按 user_id 计数会假失败；按 request_id 收窄后
    // 断言仍完整覆盖“seed 把历史复制进 messages”缺陷（旧实现会以 request_id=runId
    // 多插 history.length 行）。
    const countRunMessages = async () => {
      const [rows] = await db.sequelize.query(
        "SELECT COUNT(*) AS n FROM messages WHERE user_id = :userId AND request_id = :id",
        { replacements: { userId: requestContext.user_id, id } },
      );
      return rows[0].n;
    };
    assert.equal(await countRunMessages(), 0, "seed 写入前本 run 无 messages 行");

    await store.appendRound(id, seedRecord(id, history));

    const [rounds] = await db.sequelize.query(
      "SELECT * FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rounds.length, 1, "seed 落 1 行 agent_rounds");
    assert.equal(rounds[0].round_no, 0);
    assert.equal(rounds[0].dedup_key, `${id}:engine:round:0:seed`);
    assert.deepEqual(
      JSON.parse(rounds[0].record_json).messages,
      history,
      "seed 的 messages 必须完整保留在 record_json（SUMMARY_FIELDS 例外）",
    );

    const [messageRows] = await db.sequelize.query(
      "SELECT * FROM messages WHERE round_id = :roundId",
      { replacements: { roundId: rounds[0].id } },
    );
    assert.equal(messageRows.length, 0, "seed 轮不拆 messages 行");
    const [toolRows] = await db.sequelize.query(
      "SELECT * FROM chat_tool_calls WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(toolRows.length, 0, "seed 轮不写 chat_tool_calls");
    assert.equal(await countRunMessages(), 0, "messages 表本 run 零新增行");

    // load() 还原 seed 轮：messages 与输入等价（原样返回，不合成 tool_use/tool_result）
    const loaded = await store.load(id);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].round, 0);
    assert.deepEqual(loaded[0].messages, history);
  });

  test("同一 request 连续两次 run（不同 runId）：seed 不复制历史", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const countRunMessages = async (runIds) => {
      const [rows] = await db.sequelize.query(
        "SELECT COUNT(*) AS n FROM messages WHERE user_id = :userId AND request_id IN (:runIds)",
        { replacements: { userId: requestContext.user_id, runIds } },
      );
      return rows[0].n;
    };
    // 与真机取证同形：system 技能提示 + 多轮历史对话
    const history = [
      { role: "system", content: [{ type: "text", text: "系统技能提示" }] },
      ...Array.from({ length: 5 }, (_, index) => [
        { role: "user", content: [{ type: "text", text: `历史问题 ${index}` }] },
        { role: "assistant", content: [{ type: "text", text: `历史回答 ${index}` }] },
      ]).flat(),
    ];

    const runIds = [runId("two-runs-a"), runId("two-runs-b")];
    for (const id of runIds) {
      await store.appendRound(id, seedRecord(id, history));
      assert.equal(await countRunMessages(runIds), 0, `run ${id} 的 seed 未向 messages 表复制历史`);
    }

    // 防回归不能连真轮一起跳过：非 seed 轮照常拆行（旧实现此处会是 1 + 2×11 行）
    await store.appendRound(runIds[1], ROUND_2);
    assert.equal(await countRunMessages(runIds), 1, "非 seed 轮照常拆 messages 行");
    const loaded = await store.load(runIds[1]);
    assert.deepEqual(loaded.map((record) => record.round), [0, ROUND_2.round]);
    assert.deepEqual(loaded[0].messages, history);
    assert.deepEqual(loaded[1].messages, ROUND_2.messages);
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

  // ── issue #1146：erix-agent 0.16.0 新增两条 store 义务（本地等价断言）──
  // 复刻上游 0.16.0 test/contract/transcript-store.js 的“同轮追加序”与“字段保真”
  // 两个用例（上游文件不导出 fixture，按本仓三层拆行 schema 重写）。
  // 上游注释明确：这两条对不合规 store 故意失败，那是迁移信号，不是可以削弱的测试。

  test("同 round 记录保持持久化追加顺序（0.16.0 Load order）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("same-round-order");
    // 与上游同形：引擎轮先落，appendUserTurn 有意复用同一 max round 预写的用户行后落
    const engineKey = `${id}:engine:round:2`;
    const inputKey = `${id}:input:m1`;

    await store.appendRound(id, {
      round: 2,
      dedupKey: engineKey,
      ts: "2026-08-29T00:02:00.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "engine round" }] }],
    });
    await store.appendRound(id, {
      round: 2,
      dedupKey: inputKey,
      ts: "2026-08-29T00:02:30.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "pre-written user row" }] }],
    });

    const loaded = await store.load(id);
    assert.deepEqual(loaded.map((record) => record.dedupKey), [engineKey, inputKey]);
    assert.deepEqual(
      loaded.flatMap((record) => record.messages ?? [])
        .map((message) => message.content?.[0]?.text),
      ["engine round", "pre-written user row"],
    );

    // 反向取证：两行确实同 round（否则上面断言只是 round_no 在起作用，走不到二级键）
    assert.deepEqual(loaded.map((record) => record.round), [2, 2]);
  });

  test("roundKey/meta/response 完整往返（0.16.0 Store fidelity，不再白名单重建）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("field-fidelity");
    const record = {
      round: 3,
      roundKey: `${id}:round:3`,
      dedupKey: `${id}:engine:round:3`,
      ts: "2026-08-29T00:03:00.000Z",
      meta: { hostMetadata: { retained: true }, unknownNested: { deep: [1, 2, 3] } },
      messages: [{ role: "assistant", content: [{ type: "text", text: "fidelity" }] }],
      response: {
        content: [
          { type: "text", text: "fidelity" },
          { type: "reasoning", text: "deep thought" },
          { type: "tool_use", id: "fid-1", name: "inspect", input: { path: "." } },
        ],
        stopReason: "tool_use",
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      },
    };

    await store.appendRound(id, record);

    const [loaded] = await store.load(id);
    // 这三项此前被 SUMMARY_FIELDS 剥掉（roundKey/meta 两头不落，response 被列合成覆盖），
    // 移出白名单后必须与写入值逐字等价。
    assert.equal(loaded.roundKey, record.roundKey);
    assert.deepEqual(loaded.meta, record.meta);
    assert.deepEqual(loaded.response, record.response);
    // response.content 单独钉住：列合成只会重建 stopReason/usage，内容丢失时
    // 上面的 deepEqual 会挂，这里额外指明是哪一类字段回归了。
    assert.deepEqual(loaded.response?.content, record.response.content);

    // 旧行为不回归：两列仍写（供查询），且与 record_json 内容一致
    const [rows] = await db.sequelize.query(
      "SELECT stop_reason, `usage`, record_json FROM agent_rounds WHERE request_id = :id",
      { replacements: { id } },
    );
    assert.equal(rows[0].stop_reason, "tool_use");
    assert.deepEqual(JSON.parse(rows[0].usage), record.response.usage);
    assert.deepEqual(JSON.parse(rows[0].record_json).response, record.response);
  });

  test("历史行兼容：record_json 缺 response 时仍用 stop_reason/usage 列合成", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("legacy-response");
    // 升级前写入的行形状：旧白名单把 response 从 record_json 剔掉了，只剩两列
    await db.sequelize.query(`
      INSERT INTO agent_rounds
        (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
         folded, folded_range, record_json, ts, created_at)
      VALUES
        (:id, :runId, :roundNo, :dedupKey, :stopReason, :usage, NULL,
         b'0', NULL, :recordJson, :ts, :now)
    `, {
      replacements: {
        id: `round_legacy_${ns}`,
        runId: id,
        roundNo: 4,
        dedupKey: `${id}:engine:round:4`,
        stopReason: "end_turn",
        usage: JSON.stringify({ prompt_tokens: 3, completion_tokens: 1 }),
        recordJson: JSON.stringify({ textPreview: "legacy" }),
        ts: "2026-08-29T00:04:00.000Z",
        now: new Date(),
      },
    });

    const [loaded] = await store.load(id);
    assert.equal(loaded.round, 4);
    assert.equal(loaded.textPreview, "legacy");
    assert.equal(loaded.response?.stopReason, "end_turn");
    assert.deepEqual(loaded.response?.usage, { prompt_tokens: 3, completion_tokens: 1 });
  });
}
