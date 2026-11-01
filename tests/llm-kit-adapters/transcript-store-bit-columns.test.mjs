/**
 * issue #1227 阶段 3 切片 C2c — **`BIT(1)` 读侧不许恒真**：`reconstructMessages` 不再给所有
 * `tool_result` 挂假 `is_error`（同一转换器顺带修 `agent_rounds.folded`）
 *
 * 病灶（已由 C2c 修掉，本文件是防回归）：
 *   `lib/llm-kit-adapters/transcript-store.js` 的 `reconstructMessages` 原来写
 *   `...(row.is_error ? { is_error: true } : {})`。`chat_tool_calls.is_error` 是 `BIT(1)`，
 *   mysql2 在没有连接级 `typeCast` 的连接上返回 **`Buffer`**，而 `Boolean(Buffer.from([0])) === true`
 *   ⇒ **每一个** `tool_result` 都被挂上 `is_error:true`：resume 上下文、legacy 展示全被污染，
 *   2026-10-09 那批 canonical 回填还把这个假阳性**落进了盘**（29 条，C2d 清理，本刀不碰数据）。
 *   `agent_rounds.folded` 是同一类（`Boolean(Buffer)` 恒真 ⇒ 每一轮都被读成「已折叠」）。
 *
 * ── 为什么本文件要跑**两条连接**（关键）────────────────────────────────────────
 * 这个缺陷**只在某些连接上显形**：
 *   - 通道 A（typeCast）：`lib/db.js` 的 `dialectOptions.typeCast` 把 `BIT(1)` 提前转成 JS
 *     boolean —— server 与 `openTestDatabase()` 走这条，缺陷被**掩盖**；
 *   - 通道 B（raw）：`scripts/*` 的 `DB_*` 直连（`new Sequelize(...)` 不带 typeCast，canonical
 *     回填 / parity / verify 脚本都走它）拿到 `Buffer` —— 缺陷显形。
 * 读侧不许依赖连接级配置，所以**两条通道都要断言同一结论**。只用通道 A 测，这个缺陷永远
 * 测不出来（这也是它上线这么久没被单测抓到的原因）。
 *
 * ── 断言强度（刻意写死）──────────────────────────────────────────────────────
 * `is_error` 为 0 时断言的是 **`is_error` 键不存在**（`Object.hasOwn(block,"is_error") === false`），
 * 不是"值不为 true"——引擎契约是「无键 = 非错误」，`is_error:false` 与"无键"在 canonical 里
 * 不是一回事（#1147 已记录：显式 `is_error:false` 是展示面既有损点）。
 * 为 1 时断言 `=== true` 且键存在。两方向都断言，才能同时排除"整轮恒真"与"整轮恒假"。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则整文件 skip。
 */

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { openTestDatabase, DEFAULT_CREDS_PATH } = await import("../helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;

if (creds) {
  process.env.DB_HOST = String(creds.host ?? "localhost");
  process.env.DB_PORT = String(creds.port ?? 3306);
  process.env.DB_USER = creds.user;
  process.env.DB_PASSWORD = creds.password;
  process.env.DB_NAME = creds.database;
}

const { createTouwakaTranscriptStore, CANONICAL_TABLE, TRANSCRIPT_READ_MODE_ENV } = await import(
  "../../lib/llm-kit-adapters/transcript-store.js"
);

const db = dbCtx?.db ?? null;
const ns = randomUUID().slice(0, 8);
let userId = "u_bit_1227c";
let expertId = null;

if (db) {
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  userId = user?.[0]?.id ?? userId;
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  expertId = expert?.[0]?.id ?? null;
}

const requestContext = { topic_id: null, user_id: userId, expert_id: expertId };

/**
 * 通道 B：与 `scripts/*` 的 `DB_*` 直连同形状的连接——**不带** `dialectOptions.typeCast`，
 * 因此 `BIT(1)` 列原样返回 `Buffer`。凭据已经过 `openTestDatabase()` 的 #1167 硬断言
 * （同一个 creds 对象，不会再指向别的库）。
 */
let rawSequelize = null;
if (creds) {
  const { Sequelize } = await import("sequelize");
  rawSequelize = new Sequelize(creds.database, creds.user, creds.password, {
    host: creds.host ?? "localhost",
    port: Number(creds.port ?? 3306),
    dialect: "mysql",
    logging: false,
  });
  await rawSequelize.authenticate();
}

/** 两条读通道：A=lib/db.js（typeCast 已转 boolean）、B=raw（BIT 列是 Buffer）。 */
const CHANNELS = [
  { name: "A:typeCast（lib/db.js，BIT→boolean）", sequelize: db?.sequelize ?? null, expectBuffer: false },
  { name: "B:raw（scripts DB_* 直连，BIT→Buffer）", sequelize: rawSequelize, expectBuffer: true },
].filter((channel) => channel.sequelize !== null);

function runId(label) {
  return `run-1227c-${ns}-${label}`;
}

/** 只在 legacy 档跑一个动作（本文件钉的就是 legacy 逐行装配）。 */
async function underLegacy(fn) {
  const previous = process.env[TRANSCRIPT_READ_MODE_ENV];
  process.env[TRANSCRIPT_READ_MODE_ENV] = "legacy";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[TRANSCRIPT_READ_MODE_ENV];
    else process.env[TRANSCRIPT_READ_MODE_ENV] = previous;
  }
}

async function ownRoundIds(sequelize, id) {
  const [rows] = await sequelize.query("SELECT id FROM agent_rounds WHERE request_id = :rid", {
    replacements: { rid: id },
  });
  return rows.map((row) => row.id);
}

async function cleanup() {
  if (!db) return;
  const pattern = `run-1227c-${ns}-%`;
  const [displayIds] = await db.sequelize.query(
    "SELECT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern } },
  );
  const [canonicalIds] = await db.sequelize.query(
    `SELECT request_id AS rid FROM \`${CANONICAL_TABLE}\` WHERE request_id LIKE :pattern`,
    { replacements: { pattern } },
  );
  for (const id of new Set([...displayIds, ...canonicalIds].map((row) => row.rid))) {
    const roundIds = await ownRoundIds(db.sequelize, id);
    if (roundIds.length > 0) {
      await db.sequelize.query("DELETE FROM messages WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
      await db.sequelize.query("DELETE FROM chat_tool_calls WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
    }
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE request_id = :rid", { replacements: { rid: id } });
    await db.sequelize.query("DELETE FROM messages WHERE request_id = :rid", { replacements: { rid: id } });
    await db.sequelize.query("DELETE FROM agent_rounds WHERE request_id = :rid", { replacements: { rid: id } });
    await db.sequelize.query(`DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`, { replacements: { rid: id } });
  }
}

if (db) {
  after(cleanup);
  beforeEach(cleanup);
}

/** 一轮里的全部 `tool_result` 块（展平，按出现序）。 */
function toolResultsOf(records) {
  const blocks = [];
  for (const record of records) {
    for (const message of record.messages ?? []) {
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block?.type === "tool_result") blocks.push(block);
      }
    }
  }
  return blocks;
}

/** `is_error` 的**键有无 + 取值**，失败信息里直接给形状，不用二次排查。 */
function isErrorShape(block) {
  return Object.hasOwn(block, "is_error")
    ? { hasKey: true, value: block.is_error }
    : { hasKey: false };
}

/**
 * 播种一轮：两个工具调用，`is_error` 一真一假（这正是"整轮恒真/恒假"最能暴露的形状）。
 * 写入侧走 `appendRound`（`isError: Boolean(block.is_error)`，引擎传 JS boolean，无辜），
 * 落库后用 SQL 把列值钉成 `b'0'`/`b'1'`，保证被测的是**列值**而不是写入侧的形状。
 */
async function seedMixedRound(sequelize, id) {
  const store = createTouwakaTranscriptStore({ db: { sequelize }, requestContext });
  const okTool = { type: "tool_use", id: `tu-ok-${ns}`, name: "read_file", input: { path: "/tmp/ok.txt" } };
  const badTool = { type: "tool_use", id: `tu-bad-${ns}`, name: "read_file", input: { path: "/tmp/bad.txt" } };
  await store.appendRound(id, {
    round: 1,
    roundKey: `${id}:engine:round:1`,
    dedupKey: `${id}:engine:round:1`,
    ts: "2026-11-01T00:00:01.000Z",
    messages: [
      { role: "user", content: [{ type: "text", text: "读两个文件" }] },
      { role: "assistant", content: [{ type: "text", text: "我读一下" }, okTool, badTool] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: okTool.id, content: "ok", duration: 11 },
          { type: "tool_result", tool_use_id: badTool.id, content: "boom", is_error: true, duration: 12 },
        ],
      },
    ],
    response: { content: [{ type: "text", text: "我读一下" }], stopReason: "tool_use" },
    folded: false,
  });
  // 显式钉列值：`b'0'` / `b'1'`（不依赖写入侧推断，被测对象就是这两格）
  await sequelize.query("UPDATE chat_tool_calls SET is_error = b'0' WHERE tool_use_id = :id", {
    replacements: { id: okTool.id },
  });
  await sequelize.query("UPDATE chat_tool_calls SET is_error = b'1' WHERE tool_use_id = :id", {
    replacements: { id: badTool.id },
  });
  return { okId: okTool.id, badId: badTool.id };
}

/** 播种两轮：`folded` 列一真一假（同一类缺陷的第二处读点）。 */
async function seedFoldedRounds(sequelize, id) {
  const store = createTouwakaTranscriptStore({ db: { sequelize }, requestContext });
  for (const [round, folded] of [[1, true], [2, false]]) {
    await store.appendRound(id, {
      round,
      roundKey: `${id}:engine:round:${round}`,
      dedupKey: `${id}:engine:round:${round}`,
      ts: `2026-11-01T00:00:0${round}.000Z`,
      messages: [{ role: "assistant", content: [{ type: "text", text: `第 ${round} 轮` }] }],
      response: { content: [{ type: "text", text: `第 ${round} 轮` }], stopReason: "end_turn" },
      folded,
    });
  }
  // 写入方给了 folded ⇒ 列值就是它；再用 SQL 钉一遍，防写入侧将来改口径
  await sequelize.query("UPDATE agent_rounds SET folded = b'1' WHERE request_id = :rid AND round_no = 1", {
    replacements: { rid: id },
  });
  await sequelize.query("UPDATE agent_rounds SET folded = b'0' WHERE request_id = :rid AND round_no = 2", {
    replacements: { rid: id },
  });
}

for (const channel of CHANNELS) {
  test(`[${channel.name}] 列值 b'0' → tool_result 里没有 is_error 键；b'1' → is_error:true（键必须在）`, async () => {
    assert.ok(db, "测试库凭据缺失：本文件应在无凭据时整体 skip");
    const id = runId(`mixed-${channel.expectBuffer ? "raw" : "typed"}`);
    const { okId, badId } = await seedMixedRound(channel.sequelize, id);

    // 先证明这条通道真的拿到了它该拿的形态（否则本用例会静默退化成"只测了 typeCast 通道"）
    const [columnRows] = await channel.sequelize.query(
      "SELECT tool_use_id, is_error FROM chat_tool_calls WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    for (const row of columnRows) {
      assert.equal(
        Buffer.isBuffer(row.is_error),
        channel.expectBuffer,
        `${channel.name}：is_error 列形态应为 ${channel.expectBuffer ? "Buffer" : "boolean"}，实际 ${Object.prototype.toString.call(row.is_error)}`,
      );
    }

    const store = createTouwakaTranscriptStore({ db: { sequelize: channel.sequelize }, requestContext });
    const records = await underLegacy(() => store.load(id));
    const blocks = toolResultsOf(records);
    assert.equal(blocks.length, 2, `应装配出 2 个 tool_result，实际 ${blocks.length}`);

    const okBlock = blocks.find((block) => block.tool_use_id === okId);
    const badBlock = blocks.find((block) => block.tool_use_id === badId);
    assert.ok(okBlock && badBlock, "两个 tool_result 都要装配出来");

    // 断言的是**键的有无**，不是"值不为 true"：引擎契约 = 无键即非错误
    assert.deepEqual(
      isErrorShape(okBlock),
      { hasKey: false },
      `列 b'0' 的 tool_result 不许带 is_error 键（实际 ${JSON.stringify(isErrorShape(okBlock))}）`,
    );
    assert.deepEqual(
      isErrorShape(badBlock),
      { hasKey: true, value: true },
      `列 b'1' 的 tool_result 必须 is_error:true（实际 ${JSON.stringify(isErrorShape(badBlock))}）`,
    );
  });

  test(`[${channel.name}] 整轮 legacy 装配：一轮两个工具结果（一真一假）只有那个带 is_error`, async () => {
    assert.ok(db, "测试库凭据缺失：本文件应在无凭据时整体 skip");
    const id = runId(`round-${channel.expectBuffer ? "raw" : "typed"}`);
    const { badId } = await seedMixedRound(channel.sequelize, id);

    const store = createTouwakaTranscriptStore({ db: { sequelize: channel.sequelize }, requestContext });
    const records = await underLegacy(() => store.load(id));

    // 整轮形状（不只是"哪块有键"）：user → assistant(text+tool_use×2) → user(tool_result×2)
    assert.equal(records.length, 1, `应装配出 1 轮，实际 ${records.length}`);
    const messages = records[0].messages;
    assert.deepEqual(
      messages.map((message) => [message.role, message.content.map((block) => block.type)]),
      [
        ["user", ["text"]],
        ["assistant", ["text", "tool_use", "tool_use"]],
        ["user", ["tool_result", "tool_result"]],
      ],
    );

    const blocks = toolResultsOf(records);
    const withKey = blocks.filter((block) => Object.hasOwn(block, "is_error"));
    assert.equal(
      withKey.length,
      1,
      `整轮里只能有 1 个 tool_result 带 is_error（实际 ${withKey.length}：${JSON.stringify(blocks.map(isErrorShape))}）——` +
        "多于 1 个说明又回到了「整轮恒真」，0 个说明「整轮恒假」",
    );
    assert.equal(withKey[0].tool_use_id, badId);
    assert.equal(withKey[0].is_error, true);
  });

  test(`[${channel.name}] agent_rounds.folded（同类读点）：列 b'1' → true、b'0' → false`, async () => {
    assert.ok(db, "测试库凭据缺失：本文件应在无凭据时整体 skip");
    const id = runId(`folded-${channel.expectBuffer ? "raw" : "typed"}`);
    await seedFoldedRounds(channel.sequelize, id);

    const [columnRows] = await channel.sequelize.query(
      "SELECT round_no, folded FROM agent_rounds WHERE request_id = :rid ORDER BY round_no",
      { replacements: { rid: id } },
    );
    for (const row of columnRows) {
      assert.equal(
        Buffer.isBuffer(row.folded),
        channel.expectBuffer,
        `${channel.name}：folded 列形态应为 ${channel.expectBuffer ? "Buffer" : "boolean"}`,
      );
    }

    const store = createTouwakaTranscriptStore({ db: { sequelize: channel.sequelize }, requestContext });
    const records = await underLegacy(() => store.load(id));
    const foldedByRound = new Map(records.map((record) => [record.round, record.folded]));
    assert.equal(foldedByRound.get(1), true, `列 b'1' 的轮必须 folded:true（实际 ${foldedByRound.get(1)}）`);
    assert.equal(foldedByRound.get(2), false, `列 b'0' 的轮必须 folded:false（实际 ${foldedByRound.get(2)}）`);
  });
}
