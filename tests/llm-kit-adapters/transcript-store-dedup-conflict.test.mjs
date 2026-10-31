/**
 * issue #1227 阶段 2 切片 B2 —— 同 key 异 payload 冲突指纹（写侧判据 × 真库）。
 *
 * 判据来源（只读参照）：erix-agent 0.29.0 `src/store/transcript-dedup.js`
 *   `:35` PAYLOAD_VOLATILE_FIELDS（剥**顶层** dedupKey/roundKey/round/ts；嵌套 ts 属 payload）
 *   `:133` payloadFingerprint（对象键排序、数组保序、`sha256:` + 24 hex）
 *   `:150` dedupConflictError（`code:"dedup_payload_conflict"` + key + 两份指纹 + differingFields）
 * 上游该模块**不在包公共面**（`exports` 只有 `.` / `./tools` / `./contract-tests`，深路径
 * import 抛 ERR_PACKAGE_PATH_NOT_EXPORTED），故宿主侧有一份本地副本
 * `lib/llm-kit-adapters/transcript-payload-fingerprint.js`；本文件验证的是**宿主 store 的行为**
 * 是否与那份判据一致，判据本身与上游的逐字对照在
 * `tests/llm-kit-adapters/transcript-payload-fingerprint.test.mjs`（差分守卫）。
 *
 * 七组断言（前六组对真实 MariaDB 测试库 llm_kit_test，破坏性操作前一律过 openTestDatabase()
 * 的 #1167 硬断言）：
 *   ① 异 payload ⇒ 抛可判定冲突错，盘上原行一字未改（既不覆盖）；
 *   ② 同 payload（字段顺序不同 / 顶层 ts、round 漂移）⇒ 幂等 no-op，不多行、不抛错；
 *   ③ 冲突**先于任何投影写**（canonical-first）⇒ agent_rounds / messages / chat_tool_calls
 *      一条都没多出来（既不静默丢，也不让投影面与 canonical 分叉）；
 *   ④ **并发**：同 key 异 payload 两个 appendRound 并发 ⇒ 恰好一个成功、另一个得到可判定冲突错；
 *   ⑤ 冲突不污染 store：冲突之后同 payload 重放照旧幂等、新 key 照旧能写；
 *   ⑥ 嵌套 `ts` 是 payload、顶层 `ts` 是信封（store 级对照，钉住 volatile 只剥顶层）；
 *   ⑦ 顺序断言（mock 事务）：撞键后**只**回读既有行，投影写句一条都没发。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after } from "node:test";
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

const {
  createTouwakaTranscriptStore,
  CANONICAL_TABLE,
} = await import("../../lib/llm-kit-adapters/transcript-store.js");
const {
  DEDUP_CONFLICT_CODE,
  payloadFingerprint,
} = await import("../../lib/llm-kit-adapters/transcript-payload-fingerprint.js");
const { runMigrationSteps, parseUpgradeOptions } = await import("../../scripts/upgrade-database.js");

// 本切片只判写侧行为；读回一律用 canonical 真相档，避免外部 shell 残留 legacy 让断言含义漂移。
process.env.ERIX_TRANSCRIPT_READ_MODE = "new";

const db = dbCtx?.db ?? null;
const ns = randomUUID().slice(0, 8);
let userId = "u_dedup_conflict_b2";
let expertId = null;

if (db) {
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  userId = user?.[0]?.id ?? userId;
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  expertId = expert?.[0]?.id ?? null;
}

const requestContext = { topic_id: null, user_id: userId, expert_id: expertId };

function runId(label) {
  return `run-b2-${ns}-${label}`;
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

async function countByRequest(table, id) {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM \`${table}\` WHERE request_id = :rid`,
    { replacements: { rid: id } },
  );
  return Number(rows[0].n);
}

async function readCanonical(id, dedupKey) {
  const [rows] = await db.sequelize.query(
    `SELECT id, round_no, dedup_key, record_json FROM \`${CANONICAL_TABLE}\`
      WHERE request_id = :rid AND dedup_key = :key`,
    { replacements: { rid: id, key: dedupKey } },
  );
  return rows;
}

async function cleanup() {
  if (!db) return;
  const [ids] = await db.sequelize.query(
    "SELECT DISTINCT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern: `run-b2-${ns}-%` } },
  );
  const [canonicalIds] = await db.sequelize.query(
    `SELECT DISTINCT request_id AS rid FROM \`${CANONICAL_TABLE}\` WHERE request_id LIKE :pattern`,
    { replacements: { pattern: `run-b2-${ns}-%` } },
  );
  const allIds = [...new Set([...ids, ...canonicalIds].map((row) => row.rid))];
  for (const id of allIds) {
    const [rounds] = await db.sequelize.query(
      "SELECT id FROM agent_rounds WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    const roundIds = rounds.map((row) => row.id);
    if (roundIds.length > 0) {
      await db.sequelize.query(
        "DELETE FROM messages WHERE round_id IN (:ids)",
        { replacements: { ids: roundIds } },
      );
      await db.sequelize.query(
        "DELETE FROM chat_tool_calls WHERE round_id IN (:ids)",
        { replacements: { ids: roundIds } },
      );
    }
    await db.sequelize.query(
      "DELETE FROM messages WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    await db.sequelize.query(
      "DELETE FROM chat_tool_calls WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    await db.sequelize.query(
      `DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`,
      { replacements: { rid: id } },
    );
    await db.sequelize.query(
      "DELETE FROM agent_rounds WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
  }
}

/** 一轮带 tool_use/tool_result 的记录：冲突时三张投影表都必须一条不多。 */
function roundRecord({ round = 1, dedupKey, text = "第一版正文", toolId }) {
  return {
    round,
    dedupKey,
    roundKey: dedupKey,
    ts: "2026-10-31T00:00:00.000Z",
    messages: [
      { role: "user", content: [{ type: "text", text }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "我查一下" },
          { type: "tool_use", id: toolId, name: "read_file", input: { path: "/tmp/x" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolId, content: "body", duration: 7 }],
      },
    ],
    response: { content: [{ type: "text", text: "我查一下" }], stopReason: "tool_use" },
  };
}

function isConflictError(error) {
  return error?.code === DEDUP_CONFLICT_CODE
    && typeof error.key === "string" && error.key.length > 0
    && /^sha256:[0-9a-f]{24}$/u.test(String(error.existingFingerprint))
    && /^sha256:[0-9a-f]{24}$/u.test(String(error.incomingFingerprint))
    && error.existingFingerprint !== error.incomingFingerprint
    && Array.isArray(error.differingFields)
    && String(error.message).includes(String(error.key));
}

after(async () => {
  if (db) await cleanup();
  if (dbCtx && typeof db?.close === "function") await db.close();
  else if (dbCtx?.db?.sequelize) await db.sequelize.close();
});

if (!creds) {
  test("同 key 异 payload 冲突指纹（真实 MariaDB）", { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  await ensureCanonicalTable();

  test("① 异 payload：抛 dedup_payload_conflict，盘上原行一字未改", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("conflict");
    const dedupKey = `${id}:engine:round:1`;
    const first = roundRecord({ dedupKey, toolId: `tu-${ns}-c1` });
    const second = roundRecord({ dedupKey, text: "同一 key 却换了正文", toolId: `tu-${ns}-c1` });

    await store.appendRound(id, first);
    const before = await readCanonical(id, dedupKey);
    assert.equal(before.length, 1, "第一次写入应落一行 canonical");

    await assert.rejects(
      () => store.appendRound(id, second),
      (error) => {
        assert.ok(isConflictError(error), `冲突错形状不对：${error?.code} ${error?.message}`);
        assert.equal(error.key, dedupKey);
        assert.equal(error.runId, id);
        assert.deepEqual(error.differingFields, ["messages"], "差异字段必须点名 messages");
        assert.equal(
          error.existingFingerprint, payloadFingerprint(first),
          "既有侧指纹必须能由盘上 record_json 即时重算出来",
        );
        assert.equal(error.incomingFingerprint, payloadFingerprint(second));
        return true;
      },
      "同 key 异 payload 必须明确报冲突（既不覆盖也不静默丢）",
    );

    const after = await readCanonical(id, dedupKey);
    assert.equal(after.length, 1, "冲突不得落第二行");
    assert.deepEqual(
      JSON.parse(after[0].record_json),
      JSON.parse(JSON.stringify(first)),
      "冲突不得覆盖原 record_json",
    );
    assert.deepEqual(
      (await store.load(id)).map((record) => record.dedupKey),
      [dedupKey],
      "load 出来的仍是先落的那一版",
    );
  });

  test("② 同 payload（字段顺序不同 / 顶层 ts、round 漂移）是幂等 no-op", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("identical");
    const dedupKey = `${id}:engine:round:2`;
    const first = roundRecord({ round: 2, dedupKey, toolId: `tu-${ns}-i1` });

    await store.appendRound(id, first);
    // 字段顺序全换 + 顶层 ts/round 漂移（崩溃重跑形状）：payload 未变 ⇒ 必须幂等
    await store.appendRound(id, {
      response: first.response,
      messages: first.messages,
      ts: "2026-11-01T09:09:09.000Z",
      round: 9,
      roundKey: first.roundKey,
      dedupKey: first.dedupKey,
    });

    assert.equal((await readCanonical(id, dedupKey)).length, 1, "同 payload 重放不得落第二行");
    const loaded = await store.load(id);
    assert.equal(loaded.length, 1, "load 只该有一条");
    assert.deepEqual(loaded[0], first, "先落的那条是事实，后到的只被当作重放");
  });

  test("③ 冲突先于任何投影写：三张投影表一条都没多", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("noprojection");
    const dedupKey = `${id}:engine:round:1`;
    const first = roundRecord({ dedupKey, toolId: `tu-${ns}-p1` });
    const second = roundRecord({ dedupKey, text: "换一段正文", toolId: `tu-${ns}-p1` });

    await store.appendRound(id, first);
    const snapshot = {
      agent_rounds: await countByRequest("agent_rounds", id),
      messages: await countByRequest("messages", id),
      chat_tool_calls: await countByRequest("chat_tool_calls", id),
    };
    assert.ok(snapshot.agent_rounds >= 1, "先落的那次必须留下投影行");

    await assert.rejects(() => store.appendRound(id, second), isConflictError);

    assert.deepEqual(
      {
        agent_rounds: await countByRequest("agent_rounds", id),
        messages: await countByRequest("messages", id),
        chat_tool_calls: await countByRequest("chat_tool_calls", id),
      },
      snapshot,
      "冲突必须在任何投影写之前发生（canonical-first）：三张投影表一条都不许动",
    );
    const [textRows] = await db.sequelize.query(
      "SELECT COUNT(*) AS n FROM messages WHERE request_id = :rid AND content = :text",
      { replacements: { rid: id, text: "换一段正文" } },
    );
    assert.equal(Number(textRows[0].n), 0, "后到那份正文不得出现在 messages 里");
  });

  test("④ 并发：同 key 异 payload 恰好一个成功、另一个得到可判定冲突错", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("concurrent");
    const dedupKey = `${id}:engine:round:1`;
    const toolId = `tu-${ns}-cc`;
    const left = roundRecord({ dedupKey, text: "并发甲", toolId });
    const right = roundRecord({ dedupKey, text: "并发乙", toolId });

    const settled = await Promise.allSettled([
      store.appendRound(id, left),
      store.appendRound(id, right),
    ]);
    const fulfilled = settled.filter((item) => item.status === "fulfilled");
    const rejected = settled.filter((item) => item.status === "rejected");

    assert.equal(fulfilled.length, 1, `必须恰好一个成功，实际=${JSON.stringify(settled.map((s) => s.status))}`);
    assert.equal(rejected.length, 1, "另一个必须失败");
    assert.ok(
      isConflictError(rejected[0].reason),
      `落败方必须得到可判定冲突错（不是竞态错、也不是静默成功），实际：${rejected[0].reason?.code} ${rejected[0].reason?.message}`,
    );

    const rows = await readCanonical(id, dedupKey);
    assert.equal(rows.length, 1, "并发同 key 只能有一行 canonical");
    const stored = JSON.parse(rows[0].record_json);
    const storedText = stored.messages[0].content[0].text;
    assert.ok(["并发甲", "并发乙"].includes(storedText), `盘上必须是其中一方的 payload，实际=${storedText}`);
    assert.equal(
      rejected[0].reason.existingFingerprint, payloadFingerprint(stored),
      "落败方报的既有指纹必须等于盘上那一行（锁定读看得见并发赢家）",
    );
    assert.equal(
      rejected[0].reason.incomingFingerprint,
      payloadFingerprint(storedText === "并发甲" ? right : left),
      "落败方的 incoming 指纹必须是自己那份",
    );
  });

  test("⑤ 冲突不污染 store：之后同 payload 幂等、新 key 能写", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("recover");
    const dedupKey = `${id}:engine:round:1`;
    const first = roundRecord({ dedupKey, toolId: `tu-${ns}-r1` });

    await store.appendRound(id, first);
    await assert.rejects(
      () => store.appendRound(id, roundRecord({ dedupKey, text: "另一段", toolId: `tu-${ns}-r1` })),
      isConflictError,
    );
    // 同 payload 重放照旧幂等
    await store.appendRound(id, roundRecord({ dedupKey, toolId: `tu-${ns}-r1` }));
    // 新 key 照旧能写
    await store.appendRound(id, roundRecord({
      round: 2,
      dedupKey: `${id}:engine:round:2`,
      toolId: `tu-${ns}-r2`,
    }));

    const loaded = await store.load(id);
    assert.deepEqual(
      loaded.map((record) => record.dedupKey),
      [dedupKey, `${id}:engine:round:2`],
      "冲突后账本必须仍可正常追加",
    );
  });

  test("⑥ 嵌套 ts 是 payload、顶层 ts 是信封（volatile 只剥顶层）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("nested-ts");
    const dedupKey = `${id}:engine:round:1`;
    const base = {
      round: 1,
      dedupKey,
      roundKey: dedupKey,
      ts: "2026-10-31T00:00:00.000Z",
      messages: [{
        role: "assistant",
        content: [{ type: "text", text: "带时间戳的消息" }],
        ts: "2026-10-31T00:00:01.000Z",
      }],
    };

    await store.appendRound(id, base);
    // 顶层 ts 漂移 ⇒ 幂等（信封）
    await store.appendRound(id, { ...base, ts: "2026-12-12T12:12:12.000Z" });
    assert.equal((await readCanonical(id, dedupKey)).length, 1, "顶层 ts 不得参与 payload");

    // 嵌套 ts 变了 ⇒ 冲突（内容）
    await assert.rejects(
      () => store.appendRound(id, {
        ...base,
        messages: [{ ...base.messages[0], ts: "2026-10-31T00:00:02.000Z" }],
      }),
      (error) => isConflictError(error) && error.differingFields.includes("messages"),
      "嵌套 ts 属于 payload，改了就是冲突",
    );
  });

  test("⑦ 顺序断言（mock 事务）：撞键后只回读既有行，投影写句一条都没发", async () => {
    const dedupKey = "run-b2-mock:engine:round:1";
    const existingRecord = roundRecord({ dedupKey, text: "盘上那份", toolId: "tu-mock" });
    const incoming = roundRecord({ dedupKey, text: "新来的那份", toolId: "tu-mock" });
    const issued = [];
    const tx = {};
    const mockDb = {
      sequelize: {
        async query(sql, options = {}) {
          const statement = String(sql).replace(/\s+/g, " ").trim();
          issued.push(statement);
          assert.equal(options.transaction, tx, "写侧每条语句都必须沿用同一事务");
          if (/^INSERT IGNORE INTO agent_transcript_rounds/.test(statement)) {
            return [{ affectedRows: 0 }, []];
          }
          if (/^SELECT record_json FROM agent_transcript_rounds/.test(statement)) {
            assert.match(statement, /FOR UPDATE$/, "回读既有行必须是锁定读（否则快照读看不见并发赢家）");
            return [[{ record_json: JSON.stringify(existingRecord) }], []];
          }
          throw new Error(`冲突路径不该发出这条 SQL：${statement}`);
        },
        async transaction(callback) {
          return callback(tx);
        },
      },
    };
    const store = createTouwakaTranscriptStore({
      db: mockDb,
      requestContext: { user_id: "u-mock" },
    });

    await assert.rejects(() => store.appendRound("run-b2-mock", incoming), isConflictError);

    assert.equal(issued.length, 2, `冲突路径只该有 2 条 SQL（写入 + 回读），实际：\n${issued.join("\n")}`);
    assert.match(issued[0], /^INSERT IGNORE INTO agent_transcript_rounds/);
    assert.match(issued[1], /^SELECT record_json FROM agent_transcript_rounds/);
    assert.ok(
      !issued.some((statement) => /agent_rounds|chat_tool_calls|\bINTO messages\b/.test(statement)),
      "冲突必须在任何投影写之前抛出（canonical-first）",
    );
  });
}
