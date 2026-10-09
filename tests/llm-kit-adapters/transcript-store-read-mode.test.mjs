/**
 * issue #1156 Stage C — 读侧模式开关 `ERIX_TRANSCRIPT_READ_MODE` 与 **两模式等价**
 *
 * 四组断言（全部对真实 MariaDB 测试库 llm_kit_test，破坏性操作前一律过
 * openTestDatabase() 的 #1167 硬断言）：
 *   ① **等价断言**：一份有代表性的语料（种子轮 / appendUserTurn 同轮双行 / tool 调用与
 *      tool 结果 / is_error tool 行 / folded 轮 / 有 usage 的轮 / 写入方没给 dedupKey·ts·folded
 *      的轮）在 `legacy` 与 `new` 下，三个读方法（load / loadByDedupKey / loadMaxRound）
 *      的输出**规范化后逐轮深相等**。不是"条数相等"：比对用的是 parity 脚本自己的
 *      canonicalize / alignRounds / readUnder（复用同一份实现，不在测试里再抄一份）。
 *   ② 默认读模式必须是 `legacy`（红线：生产切不切 `new` 由 Eric 拍，代码不许自己翻）。
 *   ③ 未知取值回落 `legacy` **且**打出结构化告警（不静默、不抛错、不带倒 load()）。
 *   ④ `new` 档真的换了真相源：把 canonical 行改掉一处，`new` 看得见、`legacy` 不受影响
 *      （钉住"new 确实读 canonical"，而不是两个档都在读同一张表、①只是同义反复）。
 *
 * 语料形状说明（不是随手挑的）：全部取 erix/erix-agent 的 canonical 形状，即
 * 展示面拆行 → 重组本就应该无损的那些形状。已知展示面**有损**的形状（纯 tool 消息上的
 * message.meta、块序非 [text→tool_use→reasoning]、浮点 duration、显式 is_error:false）
 * 刻意不进等价语料：它们是展示面自身的既有损点（#1147 已记录），拿进来会把"读侧改造"
 * 与"展示面既有损"两件事混成一锅。
 *
 * 依赖顺序（勿删）：本文件排在 transcript-rounds-ddl / transcript-store-canonical 之后
 * （那文件会 DROP 这两张新表；`--test-concurrency=1` 串行保证顺序），before() 另外做
 * "缺表就补建"，单独跑本文件也不会因为缺表而假绿。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
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

const {
  createTouwakaTranscriptStore,
  CANONICAL_TABLE,
  TRANSCRIPT_READ_MODE_ENV,
  TRANSCRIPT_READ_MODE_LEGACY,
  TRANSCRIPT_READ_MODE_NEW,
  DEFAULT_TRANSCRIPT_READ_MODE,
  resolveTranscriptReadMode,
} = await import("../../lib/llm-kit-adapters/transcript-store.js");
// 复用 parity 脚本的规范化与比对实现：测试与运维脚本必须用同一把尺子。
const {
  canonicalize,
  alignRounds,
  readUnder,
  compareRequest,
} = await import("../../scripts/verify-transcript-read-parity.js");
const { runMigrationSteps, parseUpgradeOptions } = await import("../../scripts/upgrade-database.js");

const db = dbCtx?.db ?? null;
const ns = randomUUID().slice(0, 8);
let userId = "u_readmode_1156c";
let expertId = null;

if (db) {
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  userId = user?.[0]?.id ?? userId;
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  expertId = expert?.[0]?.id ?? null;
}

const requestContext = { topic_id: null, user_id: userId, expert_id: expertId };

function runId(label) {
  return `run-1156c-${ns}-${label}`;
}

/** runMigrationSteps 逐行打日志会干扰 node --test 的 IPC 解析：静默掉。 */
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

async function cleanup() {
  if (!db) return;
  const ids = (await db.sequelize.query(
    "SELECT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern: `run-1156c-${ns}-%` } },
  ))[0].map((row) => row.rid);
  const canonicalIds = (await db.sequelize.query(
    `SELECT request_id AS rid FROM \`${CANONICAL_TABLE}\` WHERE request_id LIKE :pattern`,
    { replacements: { pattern: `run-1156c-${ns}-%` } },
  ))[0].map((row) => row.rid);
  for (const id of new Set([...ids, ...canonicalIds])) {
    const roundIds = await ownRoundIds(id);
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

/** 只在指定模式下跑一个动作（与 parity 脚本的 readUnder 同理，但这里要探的是自定义调用）。 */
async function underMode(mode, fn) {
  const previous = process.env[TRANSCRIPT_READ_MODE_ENV];
  process.env[TRANSCRIPT_READ_MODE_ENV] = mode;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[TRANSCRIPT_READ_MODE_ENV];
    else process.env[TRANSCRIPT_READ_MODE_ENV] = previous;
  }
}

/**
 * 有代表性的语料（一个会话 7 行 / 6 轮，形状全部取"展示面拆行可无损往返"的那些）。
 * 覆盖点写死在 label 里，方便失败时定位是哪一类形状不等价：
 *   seed      : round 0 种子轮（appendRound 有意不拆行，messages 只活在 record_json）
 *   plain     : 纯文本 + reasoning（无工具），带 usage / stopReason
 *   tool      : tool_use + tool_result，且 tool_result 是 **is_error:true**
 *   sameA/B   : 同 round_no 两行（appendUserTurn 预写用户行 vs 引擎轮）→ 同轮保序
 *   folded    : folded:true + foldedRoundRange
 *   synthesized: 写入方**没给** dedupKey / ts / folded（#1150 字段发明防止路径）
 */
async function seedCorpus(store, id) {
  const toolUse = { type: "tool_use", id: `tu-${ns}`, name: "read_file", input: { path: "/tmp/a.txt" } };
  const records = [
    {
      round: 0,
      dedupKey: `${id}:seed`,
      ts: "2026-11-01T00:00:00.000Z",
      messages: [
        { role: "system", content: [{ type: "text", text: "系统提示：你是 touwaka" }] },
        { role: "user", content: [{ type: "text", text: "历史问题" }] },
        { role: "assistant", content: [{ type: "text", text: "历史回答" }] },
      ],
      meta: { synthetic: true, source: "seed" },
      folded: false,
    },
    {
      round: 1,
      roundKey: `${id}:engine:round:1`,
      dedupKey: `${id}:engine:round:1`,
      ts: "2026-11-01T00:00:01.000Z",
      messages: [
        { role: "user", content: [{ type: "text", text: "讲讲等价比对" }] },
        { role: "assistant", content: [
          { type: "text", text: "先规范再比" },
          { type: "reasoning", text: "先把易变键剔掉" },
        ] },
      ],
      response: {
        content: [{ type: "text", text: "先规范再比" }],
        stopReason: "end_turn",
        usage: { prompt_tokens: 1200, completion_tokens: 42 },
      },
      folded: false,
    },
    {
      round: 2,
      roundKey: `${id}:engine:round:2`,
      dedupKey: `${id}:engine:round:2`,
      ts: "2026-11-01T00:00:02.000Z",
      messages: [
        { role: "user", content: [{ type: "text", text: "读 a.txt" }] },
        { role: "assistant", content: [{ type: "text", text: "我读一下" }, toolUse] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "boom", is_error: true, duration: 17 }] },
      ],
      response: {
        content: [{ type: "text", text: "我读一下" }, toolUse],
        stopReason: "tool_use",
        usage: { prompt_tokens: 1300, completion_tokens: 30 },
      },
      folded: false,
      toolUses: 1,
    },
    {
      round: 3,
      roundKey: `${id}:user:round:3`,
      dedupKey: `${id}:user:round:3`,
      ts: "2026-11-01T00:00:03.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "同轮预写的用户行" }] }],
      folded: false,
    },
    {
      round: 3,
      roundKey: `${id}:engine:round:3`,
      dedupKey: `${id}:engine:round:3`,
      ts: "2026-11-01T00:00:04.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "同轮的引擎轮" }] }],
      response: { content: [{ type: "text", text: "同轮的引擎轮" }], stopReason: "end_turn" },
      folded: false,
    },
    {
      round: 4,
      roundKey: `${id}:engine:round:4`,
      dedupKey: `${id}:engine:round:4`,
      ts: "2026-11-01T00:00:05.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "这一轮被折叠了" }] }],
      folded: true,
      foldedRoundRange: [1, 2],
    },
    // 写入方没给 dedupKey / ts / folded：legacy 侧靠 #1150 的宿主标记把补齐列删回去，
    // canonical 侧压根没这些键。两侧必须同样"都没有"才算等价（这条最能测出发明字段）。
    {
      round: 5,
      roundKey: `${id}:engine:round:5`,
      messages: [{ role: "assistant", content: [{ type: "text", text: "写入方没给 dedupKey/ts/folded" }] }],
      response: { content: [{ type: "text", text: "x" }], stopReason: "end_turn" },
    },
  ];
  for (const record of records) await store.appendRound(id, record);
  return records;
}

after(async () => {
  if (db) await cleanup();
  if (dbCtx && typeof db?.close === "function") await db.close();
  else if (dbCtx?.db?.sequelize) await db.sequelize.close();
});

if (!creds) {
  test("#1156 Stage C 读侧模式（真实 MariaDB）", { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  beforeEach(async () => {
    assert.equal(creds.database, "llm_kit_test", "本文件会在测试库上删行，目标库必须是 llm_kit_test");
    delete process.env[TRANSCRIPT_READ_MODE_ENV];
    await ensureCanonicalTable();
    await cleanup();
  });

  test("① legacy 与 new 在代表性语料上三个读方法**逐轮深相等**（规范化后）", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("parity");
    await seedCorpus(store, id);

    const legacyOut = await readUnder(store, TRANSCRIPT_READ_MODE_LEGACY, id);
    const newOut = await readUnder(store, TRANSCRIPT_READ_MODE_NEW, id);

    // 语料本身必须真落地（否则下面的"相等"是两个空数组在自嗨）
    assert.equal(legacyOut.rounds.length, 7, "语料必须恰好落 7 轮（7 个 dedup 身份 / 6 个 round_no）");
    assert.equal(newOut.rounds.length, legacyOut.rounds.length);
    const blockTypes = legacyOut.rounds
      .flatMap((record) => record.messages ?? [])
      .flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .map((block) => block?.type);
    for (const type of ["text", "reasoning", "tool_use", "tool_result"]) {
      assert.ok(blockTypes.includes(type), `语料必须真含 ${type} 块（legacy 侧），实际 ${[...new Set(blockTypes)]}`);
    }
    assert.ok(
      legacyOut.rounds.some((record) => record.folded === true && record.foldedRoundRange),
      "语料必须真含 folded 轮",
    );
    assert.ok(
      legacyOut.rounds.some((record) => record.response?.usage),
      "语料必须真含带 usage 的轮",
    );
    assert.ok(
      legacyOut.rounds.filter((record) => record.round === 3).length === 2,
      "语料必须真含 appendUserTurn 同轮双行",
    );
    assert.ok(
      legacyOut.rounds.some((record) => record.round === 0 && Array.isArray(record.messages)),
      "语料必须真含种子轮（messages 只活在 record_json）",
    );

    // === load：按领域身份（dedupKey / roundKey）对齐后逐轮深相等 ===
    const aligned = alignRounds(legacyOut.rounds, newOut.rounds);
    assert.equal(aligned.length, legacyOut.rounds.length, "两侧轮集合必须一一对应，不许一侧多一侧少");
    for (const entry of aligned) {
      assert.deepEqual(
        canonicalize(entry.legacy),
        canonicalize(entry.new),
        `load() 第 ${entry.key} 轮（round_no=${entry.round_no}）两模式输出必须深相等`,
      );
    }

    // === loadMaxRound：值本身 ===
    assert.equal(newOut.max_round, legacyOut.max_round, "loadMaxRound 两模式必须同值");
    assert.equal(legacyOut.max_round, 5, "语料最大轮应是 5（防两侧同时错成同一个值）");

    // === loadByDedupKey：每个键的命中内容与命中/未命中结论 ===
    assert.ok(newOut.probes.length >= 8, `点查探针至少 8 个，实际 ${newOut.probes.length}`);
    const newProbes = new Map(newOut.probes.map((probe) => [probe.dedup_key, probe.record]));
    let hits = 0;
    for (const probe of legacyOut.probes) {
      if (probe.record !== null) hits += 1;
      assert.deepEqual(
        canonicalize(probe.record),
        canonicalize(newProbes.get(probe.dedup_key)),
        `loadByDedupKey(${probe.dedup_key}) 两模式输出必须深相等`,
      );
    }
    assert.ok(hits >= 6, `至少 6 次真命中（否则等价断言等于没测探针），实际 ${hits}`);
    // 必然未命中的那条：两侧都必须返回 null（不是 undefined、不是抛错）
    const missKey = `${id}:parity:always-miss`;
    assert.equal(legacyOut.probes.find((probe) => probe.dedup_key === missKey)?.record ?? null, null);
    assert.equal(newProbes.get(missKey) ?? null, null, "new 档未命中必须同样返回 null");

    // 脚本自身的整会话比对结论也必须判"一致"（不让测试与脚本各说各话）
    const report = await compareRequest(store, id);
    assert.equal(report.match, true, `compareRequest 必须判一致，实际差异：${JSON.stringify(report.issues)}`);
  });

  test("② 默认读模式必须是 legacy（没设 / 空串都算没设）", async () => {
    delete process.env[TRANSCRIPT_READ_MODE_ENV];
    assert.equal(DEFAULT_TRANSCRIPT_READ_MODE, TRANSCRIPT_READ_MODE_LEGACY,
      "代码里的默认读模式常量必须是 legacy（红线：切 new 是 Eric 的运维决策）");
    assert.equal(resolveTranscriptReadMode(), "legacy", "没设环境变量时必须解析成 legacy");
    assert.equal(TRANSCRIPT_READ_MODE_NEW, "new");
    process.env[TRANSCRIPT_READ_MODE_ENV] = "   ";
    assert.equal(resolveTranscriptReadMode(), "legacy", "空串/全空白按没设处理，仍必须是 legacy");
    process.env[TRANSCRIPT_READ_MODE_ENV] = "NEW";
    assert.equal(resolveTranscriptReadMode(), "new", "取值按 trim + 小写归一（运维大小写手滑不该回退）");

    // 行为级：不设环境变量时，store 的读输出必须与显式 legacy 一字不差。
    // 这里必须**真的把变量删掉**再读：上一行刚把 "NEW" 设进去，不删就会让这一段
    // 在"默认已是 new"的情况下仍然绿（变异实测抓到的假绿，已铉死）。
    delete process.env[TRANSCRIPT_READ_MODE_ENV];
    assert.equal(resolveTranscriptReadMode(), "legacy", "进入行为级比对前必须确认当下就是默认态");
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("default-legacy");
    await seedCorpus(store, id);
    const roundsDefault = await store.load(id);
    const roundsForced = (await readUnder(store, TRANSCRIPT_READ_MODE_LEGACY, id)).rounds;
    assert.deepEqual(canonicalize(roundsDefault), canonicalize(roundsForced),
      "默认必须走 legacy 读法：与显式 legacy 输出必须一致");
    // 且默认读法真的**不是** canonical：canonical 里插一条只有 new 档才看得见的行
    const [canonicalRoundCount] = await db.sequelize.query(
      `SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`,
      { replacements: { rid: id } },
    );
    assert.equal(Number(canonicalRoundCount[0].n), 7, "语料应落 7 行 canonical（7 条 record，同轮双行是两个身份）");
    assert.equal(canonicalize(roundsDefault).length, 7, "默认（legacy）装配出的轮数必须还是现状的 7 行");
  });

  test("③ 未知取值：回落 legacy + 打一条结构化告警，且 load() 不许被带倒", async () => {
    const warnings = [];
    // 每次用没告过的取值：同一取值只告一次（防刷日志），复用旧值会被去重挡掉
    process.env[TRANSCRIPT_READ_MODE_ENV] = `totally-bogus-${ns}`;
    assert.equal(resolveTranscriptReadMode({ logger: { warn: (m, meta) => warnings.push({ m, meta }) } }), "legacy",
      "未知取值必须回落到 legacy，不崩、不静默");
    assert.equal(warnings.length, 1, "必须打一条结构化告警");
    assert.deepEqual(
      { event: warnings[0].meta?.event, configured_value: warnings[0].meta?.configured_value, effective: warnings[0].meta?.effective_read_mode },
      { event: "transcript_read_mode_unknown", configured_value: `totally-bogus-${ns}`, effective: "legacy" },
    );

    // 同一个未知取值再解析不得重复刷屏
    const before = warnings.length;
    resolveTranscriptReadMode({ logger: { warn: (m, meta) => warnings.push({ m, meta }) } });
    assert.equal(warnings.length, before, "同一未知取值只告一次（不刷日志）");

    // 读路径不许被未知取值带倒，也不许被日志实现抛错带倒
    const id = runId("bogus");
    await createTouwakaTranscriptStore({ db, requestContext }).appendRound(id, {
      round: 1, dedupKey: `${id}:engine:round:1`, ts: "2026-11-01T00:00:00.000Z",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const noisy = createTouwakaTranscriptStore({
      db,
      requestContext,
      logger: { warn: () => { throw new Error("logs/ 不可写"); } },
    });
    const loaded = await noisy.load(id);
    assert.equal(loaded.length, 1, "日志实现抛错 + 未知模式时 load() 仍必须按 legacy 正常返回");
    assert.equal(await noisy.loadMaxRound(id), 1, "loadMaxRound 同样不许被带倒");
  });

  test("⑤ 候选窗口语义（#1166）在 new 档同样成立：窗口外=未命中、窗口内=命中且内容相等", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("window");
    // 形状抄 #1166 那个文件：真命中是**最老**的一条（dedup_key = TRUE_KEY），
    // 其后三行的 record_json.roundKey 都等于 TRUE_KEY，但自己的 dedupKey 已定义且不等
    // → 按上游 `??` 判据是必须 miss 的伪候选。窗口收到 1 时只剩最新那条伪候选。
    const trueKey = `${id}:true-key`;
    await store.appendRound(id, {
      round: 1, dedupKey: trueKey, roundKey: `${id}:round:1`, ts: "2026-11-01T00:00:01.000Z", folded: false,
      messages: [{ role: "assistant", content: [{ type: "text", text: "真命中（最老那条）" }] }],
    });
    for (let i = 2; i <= 4; i += 1) {
      await store.appendRound(id, {
        round: i, dedupKey: `${id}:decoy:${i}`, roundKey: trueKey, ts: `2026-11-01T00:00:0${i}.000Z`, folded: false,
        messages: [{ role: "assistant", content: [{ type: "text", text: `伪候选 ${i}` }] }],
      });
    }
    const candidateEnv = "LLM_KIT_DEDUP_CANDIDATE_LIMIT";
    const original = process.env[candidateEnv];
    try {
      process.env[candidateEnv] = "1";
      const legacyMiss = await underMode(TRANSCRIPT_READ_MODE_LEGACY, () => store.loadByDedupKey(id, trueKey));
      const newMiss = await underMode(TRANSCRIPT_READ_MODE_NEW, () => store.loadByDedupKey(id, trueKey));
      assert.equal(legacyMiss, null, "legacy 档窗口外必须未命中（#1166 既有语义，不许放宽判据）");
      assert.equal(newMiss, null, "new 档窗口外必须同样未命中（不许悄悄退化成全量扫）");

      delete process.env[candidateEnv];
      const legacyHit = await underMode(TRANSCRIPT_READ_MODE_LEGACY, () => store.loadByDedupKey(id, trueKey));
      const newHit = await underMode(TRANSCRIPT_READ_MODE_NEW, () => store.loadByDedupKey(id, trueKey));
      assert.equal(legacyHit?.dedupKey, trueKey, "窗口放回默认后 legacy 必须命中最老那条（不许 LIMIT 1 化）");
      assert.equal(newHit?.dedupKey, trueKey, "窗口放回默认后 new 必须命中同一条");
      assert.deepEqual(canonicalize(newHit), canonicalize(legacyHit), "命中内容两模式必须深相等");
    } finally {
      if (original === undefined) delete process.env[candidateEnv];
      else process.env[candidateEnv] = original;
    }
  });

  test("④ new 档真的读 canonical：改 canonical 一处，new 看得见、legacy 不受影响", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("truth-source");
    const dedupKey = `${id}:engine:round:1`;
    await store.appendRound(id, {
      round: 1,
      dedupKey,
      ts: "2026-11-01T00:00:00.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "原文" }] }],
    });

    const legacyBefore = await readUnder(store, TRANSCRIPT_READ_MODE_LEGACY, id);
    const newBefore = await readUnder(store, TRANSCRIPT_READ_MODE_NEW, id);
    assert.deepEqual(canonicalize(legacyBefore.rounds), canonicalize(newBefore.rounds), "改前先等价");

    // 只改 canonical 的 record_json（展示面一字不动）
    await db.sequelize.query(
      `UPDATE \`${CANONICAL_TABLE}\`
          SET record_json = JSON_REPLACE(record_json, '$.messages[0].content[0].text', 'canonical 侧改过')
        WHERE request_id = :rid AND dedup_key = :key`,
      { replacements: { rid: id, key: dedupKey } },
    );

    const legacyAfter = await readUnder(store, TRANSCRIPT_READ_MODE_LEGACY, id);
    const newAfter = await readUnder(store, TRANSCRIPT_READ_MODE_NEW, id);
    assert.equal(newAfter.rounds[0].messages[0].content[0].text, "canonical 侧改过",
      "new 档必须真的以 canonical 为真相");
    assert.equal(legacyAfter.rounds[0].messages[0].content[0].text, "原文",
      "legacy 档必须仍只读展示面，不受 canonical 影响");
    assert.deepEqual(
      canonicalize(legacyAfter.rounds), canonicalize(legacyBefore.rounds),
      "legacy 语义一行都不许变（canonical 被动了也不许受影响）",
    );
  });

  test("⑥ new 与 legacy 的 loadByDedupKey / loadMaxRound 必须读各自的表", async () => {
    const store = createTouwakaTranscriptStore({ db, requestContext });
    const id = runId("canonical-only-guards");
    const baselineKey = `${id}:baseline`;
    const dedupKey = `${id}:canonical-only:${ns}`;
    const canonicalId = `atr_readmode_${ns}`;

    await store.appendRound(id, {
      round: 4,
      dedupKey: baselineKey,
      ts: "2026-10-09T00:00:00.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "旧表基线轮" }] }],
    });

    const [legacyMaxRows] = await db.sequelize.query(
      "SELECT MAX(round_no) AS max_round FROM agent_rounds WHERE request_id = :rid",
      { replacements: { rid: id } },
    );
    const previousMax = Number(legacyMaxRows[0]?.max_round);
    assert.ok(Number.isSafeInteger(previousMax), "基线轮必须存在于 legacy 表");
    const roundNo = previousMax + 1;
    const record = {
      round: roundNo,
      roundKey: `${id}:round:${roundNo}`,
      dedupKey,
      ts: "2026-10-09T00:00:01.000Z",
      messages: [{ role: "assistant", content: [{ type: "text", text: "仅存在于 canonical" }] }],
      response: {
        content: [{ type: "text", text: "仅存在于 canonical" }],
        stopReason: "end_turn",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      folded: false,
      toolUses: 0,
    };

    try {
      await db.sequelize.query(
        `INSERT INTO \`${CANONICAL_TABLE}\`
           (id, request_id, round_no, dedup_key, record_json, created_at, updated_at)
         VALUES (:id, :rid, :roundNo, :dedupKey, :record, NOW(), NOW())`,
        {
          replacements: {
            id: canonicalId,
            rid: id,
            roundNo,
            dedupKey,
            record: JSON.stringify(record),
          },
        },
      );

      const [[canonicalRows], [legacyRows]] = await Promise.all([
        db.sequelize.query(
          `SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\`
            WHERE request_id = :rid AND dedup_key = :dedupKey`,
          { replacements: { rid: id, dedupKey } },
        ),
        db.sequelize.query(
          "SELECT COUNT(*) AS n FROM agent_rounds WHERE request_id = :rid AND dedup_key = :dedupKey",
          { replacements: { rid: id, dedupKey } },
        ),
      ]);
      assert.equal(Number(canonicalRows[0].n), 1, "唯一标记行必须确实存在于 canonical 表");
      assert.equal(Number(legacyRows[0].n), 0, "唯一标记行不得存在于 agent_rounds");
      assert.ok(roundNo > previousMax, "canonical-only 轮号必须高于 legacy 原有最大轮号");

      const newHit = await underMode(
        TRANSCRIPT_READ_MODE_NEW,
        () => store.loadByDedupKey(id, dedupKey),
      );
      assert.deepEqual(newHit, record, "new 档的 loadByDedupKey 必须命中 canonical-only 行");
      assert.equal(
        await underMode(TRANSCRIPT_READ_MODE_NEW, () => store.loadMaxRound(id)),
        roundNo,
        "new 档的 loadMaxRound 必须包含 canonical-only 最大轮号",
      );

      assert.equal(
        await underMode(TRANSCRIPT_READ_MODE_LEGACY, () => store.loadByDedupKey(id, dedupKey)),
        null,
        "legacy 档的 loadByDedupKey 不得看见 canonical-only 行",
      );
      assert.equal(
        await underMode(TRANSCRIPT_READ_MODE_LEGACY, () => store.loadMaxRound(id)),
        previousMax,
        "legacy 档的 loadMaxRound 必须仍返回 agent_rounds 的旧最大轮号",
      );
    } finally {
      await db.sequelize.query(
        `DELETE FROM \`${CANONICAL_TABLE}\`
          WHERE id = :id AND request_id = :rid AND dedup_key = :dedupKey`,
        { replacements: { id: canonicalId, rid: id, dedupKey } },
      );
      const [remainingRows] = await db.sequelize.query(
        `SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\`
          WHERE id = :id AND request_id = :rid AND dedup_key = :dedupKey`,
        { replacements: { id: canonicalId, rid: id, dedupKey } },
      );
      assert.equal(Number(remainingRows[0].n), 0, "只清除的 canonical-only 标记行必须没有残留");
    }
  });
}
