/**
 * issue #1156 Stage B — 写入侧：canonical 落库 + 单事务原子性 + 孤儿 tool 行可观测
 *
 * 四组断言（全部对真实 MariaDB 测试库 llm_kit_test，破坏性操作前一律过 openTestDatabase()
 * 的 #1167 硬断言）：
 *   ① record_json 往返保真：整份 RoundRecord 原样落 canonical，深比较含 tool 子块 /
 *      usage / folded / stopReason，不裁字段不改字段名（决策③′）。
 *   ② 三张表同事务回滚：注入一次 chat_tool_calls 写入失败 → agent_rounds / messages /
 *      chat_tool_calls / agent_transcript_rounds **全部无残留**。旧实现逐条自提交，这条
 *      会留下「有轮无工具」的孤儿态（#1168 那类缺陷的根因证明）。
 *   ③ dedup_key 重复写：先到先得，不产生第二行、不覆盖原 record_json（与旧表
 *      INSERT IGNORE 语义逐字一致；改成 REPLACE / UPDATE 覆盖就会变红）。
 *   ④ load() 孤儿 tool 行：**不装配**（丢弃，与基点 26a5df7 的 `WHERE round_id IN (...)`
 *      读语义零差异）**且**走项目 logger 打结构化告警（不是 console.log、也不静默）。
 *      Stage B 曾实现成“挂到首轮”，那反而是相对基点的行为回归（#1156 Stage C 修正）。
 *
 * 依赖顺序（勿删）：`tests/llm-kit-adapters/transcript-rounds-ddl.test.mjs` 会在 before /
 * 用例中途 DROP 这两张新表，npm run test:llm-kit 用 `--test-concurrency=1` 串行跑文件、
 * 且本文件排在其之后，所以拿到的是「已建表」态；本文件 before() 另外做「缺表就补建」，
 * 单独跑本文件也不会因为缺表而假绿。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// logs/ 目录可能非本用户属主：屏蔽文件写入，别让日志权限错误掩盖数据库结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { openTestDatabase, DEFAULT_CREDS_PATH } = await import("../helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;

// upgrade-database.js 在建模块时就读 DB_*，因此凭据必须先于 import 落地。
if (creds) {
  process.env.DB_HOST = String(creds.host ?? "localhost");
  process.env.DB_PORT = String(creds.port ?? 3306);
  process.env.DB_USER = creds.user;
  process.env.DB_PASSWORD = creds.password;
  process.env.DB_NAME = creds.database;
}

const { createTouwakaTranscriptStore, CANONICAL_TABLE } = await import(
  "../../lib/llm-kit-adapters/transcript-store.js"
);
const { runMigrationSteps, parseUpgradeOptions } = await import("../../scripts/upgrade-database.js");

// This suite checks the legacy display-row loader; pin it explicitly, independent of the process default.
process.env.ERIX_TRANSCRIPT_READ_MODE = "legacy";

const db = dbCtx?.db ?? null;
// 本文件独占的 request_id 命名空间，只清自己写入的行
const ns = randomUUID().slice(0, 8);
let userId = "u_canonical_1156b";
let expertId = null;

if (db) {
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  userId = user?.[0]?.id ?? userId;
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  expertId = expert?.[0]?.id ?? null;
}

const requestContext = { topic_id: null, user_id: userId, expert_id: expertId };

function runId(label) {
  return `run-1156b-${ns}-${label}`;
}

/** runMigrationSteps 会给全部步骤逐行打日志：node --test 子进程里会干扰 IPC 解析，静默掉。 */
async function quiet(fn) {
  const originals = { log: console.log, error: console.error, warn: console.warn };
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, originals);
  }
}

async function tableExists(table) {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { replacements: { table } },
  );
  return Number(rows[0].n) > 0;
}

/** 缺表就补建（走 Stage A 现成建表步骤，不自己抄一份 DDL）。 */
async function ensureCanonicalTable() {
  if (await tableExists(CANONICAL_TABLE)) return;
  const connection = {
    execute: async (sql, params = []) =>
      db.sequelize.query(sql, { replacements: params.length ? params : {} }),
  };
  await quiet(() => runMigrationSteps(connection, parseUpgradeOptions(["--step", "#1156 Stage A"])));
  assert.ok(await tableExists(CANONICAL_TABLE), `${CANONICAL_TABLE} 补建失败`);
}

async function ownRoundIds(id) {
  const [rows] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id = :rid",
    { replacements: { rid: id } },
  );
  return rows.map((row) => row.id);
}

async function countByRequest(table, id) {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM \`${table}\` WHERE request_id = :rid`,
    { replacements: { rid: id } },
  );
  return Number(rows[0].n);
}

async function cleanup() {
  if (!db) return;
  const ids = (await db.sequelize.query(
    "SELECT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern: `run-1156b-${ns}-%` } },
  ))[0].map((row) => row.rid);
  for (const id of ids.length ? ids : [runId("noop")]) {
    const roundIds = await ownRoundIds(id);
    if (roundIds.length > 0) {
      await db.sequelize.query("DELETE FROM messages WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
      await db.sequelize.query("DELETE FROM chat_tool_calls WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
    }
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE request_id = :rid", { replacements: { rid: id } });
    await db.sequelize.query("DELETE FROM messages WHERE request_id = :rid", { replacements: { rid: id } });
    await db.sequelize.query("DELETE FROM agent_rounds WHERE request_id = :rid", { replacements: { rid: id } });
    await db.sequelize.query(
      `DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`,
      { replacements: { rid: id } },
    );
  }
}

/** 一轮内容足够丰富的 record：文本 + tool_use + tool_result + usage + stopReason + folded。 */
function richRecord(overrides = {}) {
  const toolUse = {
    type: "tool_use",
    id: `tu-${ns}-${overrides.round ?? 1}`,
    name: "read_file",
    input: { path: "/tmp/a.txt", offset: 0 },
  };
  const toolResult = {
    type: "tool_result",
    tool_use_id: toolUse.id,
    content: "file body",
    duration: 17,
  };
  return {
    round: 1,
    roundKey: `${overrides.dedupKey ?? "rk"}:round:${overrides.round ?? 1}`,
    dedupKey: `dk-${ns}-${overrides.round ?? 1}`,
    ts: "2026-10-09T00:00:00.000Z",
    messages: [
      { role: "user", content: [{ type: "text", text: "读一下 a.txt" }] },
      { role: "assistant", content: [{ type: "text", text: "我读一下" }, toolUse] },
      { role: "user", content: [toolResult] },
    ],
    response: {
      content: [{ type: "text", text: "我读一下" }, toolUse],
      stopReason: "tool_use",
      usage: { prompt_tokens: 1234, completion_tokens: 56 },
    },
    folded: false,
    meta: { synthetic: false },
    toolUses: 1,
    ...overrides,
  };
}

async function readCanonical(id, dedupKey) {
  const [rows] = await db.sequelize.query(
    `SELECT id, round_no, dedup_key, record_json, created_at, updated_at
       FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid AND dedup_key = :key`,
    { replacements: { rid: id, key: dedupKey } },
  );
  return rows;
}

after(async () => {
  if (db) await cleanup();
  if (dbCtx && typeof db?.close === "function") await db.close();
  else if (dbCtx?.db?.sequelize) await db.sequelize.close();
});

if (!creds) {
  test("#1156 Stage B 写入侧（真实 MariaDB）", { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  beforeEach(async () => {
    assert.equal(creds.database, "llm_kit_test", "本文件会在测试库上删行，目标库必须是 llm_kit_test");
    await ensureCanonicalTable();
    await cleanup();
  });

  test("① canonical record_json 与传入 record 往返保真（含 tool 子块 / usage / folded / stopReason）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("fidelity");
    const record = richRecord({ round: 1, dedupKey: `${id}:engine:round:1` });
    await store.appendRound(id, record);

    const rows = await readCanonical(id, record.dedupKey);
    assert.equal(rows.length, 1, "canonical 必须落一行");
    assert.equal(rows[0].round_no, 1);
    assert.ok(rows[0].created_at instanceof Date, "created_at 必须应用侧写入并落库");
    assert.ok(rows[0].updated_at instanceof Date, "updated_at 必须应用侧写入并落库");
    assert.match(rows[0].id, /^atr_/, "canonical 行 id 必须是 atr_ 前缀（data-model.md 前缀登记）");

    // JSON 往返保真：整份 record 原样，不裁字段、不改字段名、不注宿主私有标记
    const expected = JSON.parse(JSON.stringify(record));
    assert.deepEqual(JSON.parse(rows[0].record_json), expected);
    const parsed = JSON.parse(rows[0].record_json);
    assert.deepEqual(parsed.response.usage, { prompt_tokens: 1234, completion_tokens: 56 });
    assert.equal(parsed.response.stopReason, "tool_use");
    assert.equal(parsed.folded, false);
    assert.deepEqual(
      parsed.messages[1].content.map((block) => block.type),
      ["text", "tool_use"],
      "tool_use 子块必须在 record_json 里",
    );
    assert.equal(parsed.messages[2].content[0].type, "tool_result");
    assert.ok(!("__hostSynthesizedColumns" in parsed), "canonical 里不得出现展示面私有标记");

    // 展示面照写（Stage B 不切读路径）
    assert.equal(await countByRequest("agent_rounds", id), 1);
    assert.equal(await countByRequest("chat_tool_calls", id), 1);
    assert.equal(await countByRequest("messages", id), 2);

    // 读路径语义不变：load() 仍能正常装配
    const loaded = await store.load(id);
    assert.equal(loaded.length, 1);
    assert.deepEqual(loaded[0].response.usage, record.response.usage);
    assert.equal(loaded[0].response.stopReason, "tool_use");
  });

  test("② chat_tool_calls 写入失败 → agent_rounds / messages / chat_tool_calls / canonical 全部回滚", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("rollback");
    // 注入非法值：chat_tool_calls.name 是 varchar(255)，测试库 sql_mode 含
    // STRICT_TRANS_TABLES（实测），300 字符 → error 1406，且这条写在 agent_rounds
    // 与 canonical **之后**，正是旧实现留下孤儿轮 / 孤儿 tool 行的位置。
    const record = richRecord({
      round: 2,
      dedupKey: `${id}:engine:round:2`,
      messages: [
        { role: "assistant", content: [
          { type: "tool_use", id: `tu-long-${ns}`, name: "x".repeat(300), input: { p: 1 } },
        ] },
      ],
    });

    await assert.rejects(() => store.appendRound(id, record), /Data too long|1406|Truncated/i);

    assert.equal(await countByRequest("agent_rounds", id), 0, "agent_rounds 不得留下孤儿轮");
    assert.equal(await countByRequest("chat_tool_calls", id), 0, "chat_tool_calls 不得留下孤儿行");
    assert.equal(await countByRequest("messages", id), 0, "messages 不得留下孤儿行");
    assert.equal((await readCanonical(id, record.dedupKey)).length, 0, "canonical 不得留下半条真相");
  });

  test("③ dedup_key 重复写：先到先得，不多行、不覆盖原 record_json", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("firstwins");
    const dedupKey = `${id}:engine:round:3`;
    const first = richRecord({ round: 3, dedupKey, textPreview: "第一版" });
    const second = richRecord({
      round: 3,
      dedupKey,
      textPreview: "第二版",
      response: { content: [{ type: "text", text: "第二版" }], stopReason: "end_turn", usage: { prompt_tokens: 9, completion_tokens: 9 } },
    });

    await store.appendRound(id, first);
    await store.appendRound(id, second);

    const [canonicalRows] = await db.sequelize.query(
      `SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`,
      { replacements: { rid: id } },
    );
    assert.equal(Number(canonicalRows[0].n), 1, "同 dedup_key 只能有一行 canonical");
    const rows = await readCanonical(id, dedupKey);
    assert.deepEqual(
      JSON.parse(rows[0].record_json),
      JSON.parse(JSON.stringify(first)),
      "后到的一轮不得覆盖先到的 record_json",
    );
    const [roundRows] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM agent_rounds WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    assert.equal(Number(roundRows[0].n), 1, "展示面同样先到先得（幂等复用 round_id）");
  });

  test("④ 孤儿 tool 行：load() **不装配**（丢弃，与基点读语义一致），但必打出结构化告警", async () => {
    const warnings = [];
    const store = createTouwakaTranscriptStore({
      db,
      requestContext,
      logger: { warn: (message, meta) => warnings.push({ message, meta }) },
    });
    const id = runId("orphan");
    await store.appendRound(id, richRecord({ round: 4, dedupKey: `${id}:engine:round:4` }));

    const beforeLoad = await store.load(id);
    warnings.length = 0;

    // 直接插一条宿主轮次缺失的 tool 行（单事务之前的失败留档形状）
    const [roundRow] = await db.sequelize.query(
      "SELECT id FROM agent_rounds WHERE request_id = :rid LIMIT 1",
      { replacements: { rid: id } },
    );
    assert.ok(roundRow?.[0]?.id);
    const ghostRoundId = `round_ghost_${ns}`;
    await db.sequelize.query(
      `INSERT INTO chat_tool_calls
         (tool_use_id, request_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at)
       VALUES (:id, :rid, :ghost, 'ghost_tool', '{"a":1}', '{"ok":true}', b'0', 5, NOW())`,
      { replacements: { id: `tu-ghost-${ns}`, rid: id, ghost: ghostRoundId } },
    );

    const afterLoad = await store.load(id);
    // 与基点 26a5df7 零语义差异：轮数不变、首轮内容不变、load() 不抛错
    assert.equal(afterLoad.length, beforeLoad.length, "load() 轮数不变");
    const blocks = afterLoad
      .flatMap((record) => record.messages ?? [])
      .filter((message) => Array.isArray(message.content))
      .flatMap((message) => message.content)
      .filter((block) => block?.type === "tool_use");
    // #1156 Stage C 语义修正：孤儿行必须被**丢弃**。Stage B 曾实现成“挂到首轮”，
    // 那是相对基点（`WHERE round_id IN (:roundIds)` = 取不到 = 丢弃）的**行为回归**：
    // tool 行会被当成首轮内容喂进 resume 上下文。改成 attach 就会变红。
    assert.ok(
      !blocks.some((block) => block.id === `tu-ghost-${ns}`),
      "孤儿 tool 行不得出现在 load() 输出里（丢弃，不得挂到首轮）",
    );
    assert.deepEqual(
      afterLoad.map((record) => JSON.parse(JSON.stringify(record))),
      beforeLoad.map((record) => JSON.parse(JSON.stringify(record))),
      "孤儿行不得改变任何一轮的内容（等价于基点的静默丢弃）",
    );
    // 丢弃 ≠ 静默：可观测性必须保留
    assert.ok(blocks.length > 0, "用例本身得真有 tool_use 块，否则上面那条断言是空跑");

    assert.equal(warnings.length, 1, "必须且只打一条结构化告警（按孤儿 round_id 聚合）");
    assert.match(warnings[0].message, /孤儿/);
    assert.deepEqual(
      {
        event: warnings[0].meta?.event,
        request_id: warnings[0].meta?.request_id,
        orphan_round_id: warnings[0].meta?.orphan_round_id,
        orphan_tool_row_count: warnings[0].meta?.orphan_tool_row_count,
        sample_tool_use_ids: warnings[0].meta?.sample_tool_use_ids,
        disposition: warnings[0].meta?.disposition,
      },
      {
        event: "transcript_orphan_tool_row",
        request_id: id,
        orphan_round_id: ghostRoundId,
        orphan_tool_row_count: 1,
        sample_tool_use_ids: [`tu-ghost-${ns}`],
        disposition: "dropped",
      },
    );

    // 日志实现抛错不得带倒 load()（告警一直被 try/catch 包住，这里钉住它）
    const throwing = createTouwakaTranscriptStore({
      db,
      requestContext,
      logger: { warn: () => { throw new Error("logs/ 不可写"); } },
    });
    assert.ok(Array.isArray(await throwing.load(id)), "logger.warn 抛错时 load() 仍必须正常返回");

    // 清掉这条孤儿行，避免影响后面的断言与别的文件
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE tool_use_id = :id", {
      replacements: { id: `tu-ghost-${ns}` },
    });
    void roundRow;
  });
}
