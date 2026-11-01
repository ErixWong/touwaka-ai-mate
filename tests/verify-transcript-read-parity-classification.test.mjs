/**
 * issue #1196 —— parity 差异三分类（identical / ordering_only / content_diff）的用例化
 *
 * 修的是什么：parity 以前把「同轮内 content[] 块先后顺序不同」和「内容真的不同」混成
 * 同一个差异、共用 exit=3。展示面按列重组时会把 reasoning 块固定排在 text 块之后，而
 * canonical 存的是引擎原始顺序（= 正确侧），于是纯顺序差异把 exit code 变成长期噪音，
 * 真内容回归会被埋掉。
 *
 * 断言分两层：
 *   ① 不依赖数据库的归因函数（classifyIssueKind / findBlockOrderDiffs / sortBlockArrays）：
 *      纯顺序 → ordering_only；少块 / 改一个字 / 键集不同 → content_diff。
 *      并且钉住**比对强度没被弱化**：ordering_only 的那些样本，深比对
 *      （normalizedDiffPaths）本身照样报差异；窄剔除面（ts/folded/dedupKey 不剔）一字未动。
 *   ② llm_kit_test 上造三条真 fixture 请求，跑**脚本本体**（spawnSync），看分类与退出码：
 *        fixture ①（两侧完全相同）      → identical      exit=0
 *        fixture ②（同块仅换序）        → ordering_only  exit=0   ← 改前这里是 exit=3 误报
 *        fixture ③（少一个 text 块 / 改一个字）→ content_diff exit=3
 *
 * ③ #1227 阶段 3 切片 C2 的回滚演练门禁（`--snapshot` / `--gate --baseline`）：
 *    三格对账（轮数/条数/正文总长/tool_result 条数）+ 块形状多重集。断言：
 *      - 0.23 形状请求（有 `kind='message'` 行）在 legacy 与 canonical 之间**只剩块顺序差**；
 *      - 老账本请求三格与**改动前快照**逐格相等（不因分流丢内容）；
 *      - 失败判据逐条可定位（cells_mismatch / shape_regression / legacy_cells_drift /
 *        parity_regression），用**改坏的基线**反证每一条都能红。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import logger from "../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { openTestDatabase, assertTestDatabase, DEFAULT_CREDS_PATH } = await import("./helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const db = dbCtx?.db ?? null;

const { createTouwakaTranscriptStore, CANONICAL_TABLE } = await import("../lib/llm-kit-adapters/transcript-store.js");
const parity = await import("../scripts/verify-transcript-read-parity.js");
const { runMigrationSteps, parseUpgradeOptions } = await import("../scripts/upgrade-database.js");

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_PATH = path.join(ROOT, "scripts/verify-transcript-read-parity.js");
const REPORT_DIR = await mkdtemp(path.join(tmpdir(), "parity-1196-"));

const ns = randomUUID().slice(0, 8);
let userId = "u_parity1196";
let expertId = null;
if (db) {
  const [user] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  userId = user?.[0]?.id ?? userId;
  const [expert] = await db.sequelize.query("SELECT id FROM experts LIMIT 1");
  expertId = expert?.[0]?.id ?? null;
}

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

async function columnExists(table, column) {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { table, column } },
  );
  return Number(rows[0].n) > 0;
}

async function runStep(step) {
  const connection = {
    execute: async (sql, params = []) =>
      db.sequelize.query(sql, { replacements: params.length ? params : {} }),
  };
  await quiet(() => runMigrationSteps(connection, parseUpgradeOptions(["--step", step])));
}

async function ensureTables() {
  if (!(await tableExists("agent_rounds"))) await runStep("create agent_rounds table");
  if (!(await tableExists("chat_tool_calls"))) await runStep("create chat_tool_calls table");
  if (!(await tableExists(CANONICAL_TABLE))) await runStep("#1156 Stage A");
  if (!(await columnExists("messages", "round_id"))) await runStep("messages.round_id column add");
  if (!(await columnExists("messages", "sequence_no"))) await runStep("messages.sequence_no column add");
}

function requestLabel(name) {
  return `run-1196-${ns}-${name}`;
}

function makeStore() {
  return createTouwakaTranscriptStore({
    db: { sequelize: db.sequelize },
    requestContext: { topic_id: null, user_id: userId, expert_id: expertId },
  });
}

/**
 * 一条**形状无损**的轮：唯一变量是 content[] 里 text 与 reasoning 的先后。
 * 展示面重组固定产 [text, reasoning]（messages.content 存正文、reasoning_content 存思考，
 * canonicalFromRow 先放正文再补 reasoning），canonical 则原样存写入方顺序。
 */
function recordWith(id, blocks) {
  return {
    round: 1,
    roundKey: `${id}:engine:round:1`,
    dedupKey: `${id}:engine:round:1`,
    ts: "2026-11-01T00:00:01.000Z",
    messages: [
      { role: "user", content: [{ type: "text", text: "问一句" }] },
      { role: "assistant", content: blocks },
    ],
    response: { content: [{ type: "text", text: "最终答复" }], stopReason: "end_turn" },
    // 故意**不给** `folded`：显式写 folded:false 会撞上一条与 #1196 无关的已知不对称
    // （展示面从 NOT NULL 列补值、canonical 保留写入方原样，实测 legacy=true / new=false），
    // 那是产品侧的事（已写进报告），本文件只钉块顺序归因这一件事。
  };
}

async function seed(id, blocks) {
  await makeStore().appendRound(id, recordWith(id, blocks));
  return id;
}

async function cleanup(id) {
  const [roundRows] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id = :rid",
    { replacements: { rid: id } },
  );
  const roundIds = roundRows.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query("DELETE FROM messages WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
    await db.sequelize.query("DELETE FROM chat_tool_calls WHERE round_id IN (:ids)", { replacements: { ids: roundIds } });
  }
  await db.sequelize.query("DELETE FROM messages WHERE request_id = :rid", { replacements: { rid: id } });
  await db.sequelize.query("DELETE FROM agent_rounds WHERE request_id = :rid", { replacements: { rid: id } });
  await db.sequelize.query(`DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`, { replacements: { rid: id } });
}

async function cleanupAll() {
  if (!db) return;
  assertTestDatabase(creds.database, { env: process.env });
  const collect = async (sql) => (await db.sequelize.query(sql, { replacements: { pattern: `run-1196-${ns}-%` } }))[0]
    .map((row) => row.rid);
  const ids = new Set([
    ...await collect("SELECT DISTINCT request_id AS rid FROM agent_rounds WHERE request_id LIKE :pattern"),
    ...await collect(`SELECT DISTINCT request_id AS rid FROM \`${CANONICAL_TABLE}\` WHERE request_id LIKE :pattern`),
  ]);
  for (const id of ids) await cleanup(id);
}

function runParity(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_HOST: String(creds.host ?? "localhost"),
      DB_PORT: String(creds.port ?? 3306),
      DB_USER: creds.user,
      DB_PASSWORD: creds.password,
      DB_NAME: creds.database,
    },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

async function runAndClassify(name, argsLabel) {
  const id = requestLabel(name);
  const reportPath = path.join(REPORT_DIR, `${argsLabel}.json`);
  const result = runParity(["--request-id", id, "--report", reportPath]);
  assert.ifError(result.error);
  assert.equal(result.signal, null, `不许被信号杀掉（stdout 别接 head）：${result.signal}`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  return { id, result, report, stdout: result.stdout };
}

// ==================== ① 不依赖数据库：归因函数 ====================

const TEXT = { type: "text", text: "最终答复" };
const REASONING = { type: "reasoning", text: "先想一下再答" };
const recordOf = (blocks) => ({
  round: 1,
  dedupKey: "req:engine:round:1",
  ts: "2026-11-01T00:00:01.000Z",
  messages: [{ role: "assistant", content: blocks }],
  response: { content: blocks, stopReason: "end_turn" },
});

test("归因：同块仅换序 → ordering_only；且深比对本身照样报差异（强度没降）", () => {
  const legacy = recordOf([TEXT, REASONING]);
  const canonical = recordOf([REASONING, TEXT]);
  // 深比对**必须**仍然报差异：ordering_only 是"报出差异之后的归因"，不是"不比了"
  assert.ok(parity.normalizedDiffPaths(legacy, canonical).length > 0, "深比对不许因为允许换序就不报差异");
  assert.equal(parity.classifyIssueKind(legacy, canonical), "ordering_only");

  const swaps = parity.findBlockOrderDiffs(legacy, canonical);
  assert.equal(swaps.length, 2, "messages[].content 与 response.content 两处都要定位");
  assert.equal(swaps[0].path, "messages[0].content");
  assert.deepEqual(swaps[0].swapped_pairs, ["text(最终答复…) <-> reasoning(先想一下再答…)"]);
  assert.deepEqual(swaps[0].legacy_order, ["text(最终答复…)", "reasoning(先想一下再答…)"]);
  assert.deepEqual(swaps[0].new_order, ["reasoning(先想一下再答…)", "text(最终答复…)"]);
});

test("归因：少一个块 / 改一个字 / 键集不同 → content_diff（不许被排序洗成纯顺序）", () => {
  assert.equal(
    parity.classifyIssueKind(recordOf([TEXT, REASONING]), recordOf([REASONING])),
    "content_diff",
    "少一个 text 块是真差异",
  );
  assert.equal(
    parity.classifyIssueKind(recordOf([TEXT, REASONING]), recordOf([REASONING, { ...TEXT, text: "最终答复!" }])),
    "content_diff",
    "文字改一个字是真差异",
  );
  assert.equal(
    parity.classifyIssueKind(recordOf([TEXT, REASONING]), recordOf([{ ...TEXT, erixRound: 3 }, REASONING])),
    "content_diff",
    "块上多一个键（键集不同）是真差异",
  );
  assert.equal(
    parity.classifyIssueKind(recordOf([TEXT, REASONING]), "<canonical 缺行>"),
    "content_diff",
    "一侧缺行不是顺序问题",
  );
  // 同一会话里既有换序又有真差异：整体必须归 content_diff（换序不许把真差异带走）
  assert.equal(
    parity.classifyIssueKind({ round: 1, messages: [{ role: "a", content: [TEXT, REASONING] }] },
      { round: 1, messages: [{ role: "a", content: [REASONING, TEXT] }, { role: "a", content: [TEXT] }] }),
    "content_diff",
  );
});

test("归因实现：只有挂在 content 键下的块数组会被排序；窄剔除面一字未动", () => {
  // 换序两侧同串（这就是归因判据的全部威力），但未排序两侧不同
  assert.equal(
    parity.stableStringifyIgnoringBlockOrder(recordOf([TEXT, REASONING])),
    parity.stableStringifyIgnoringBlockOrder(recordOf([REASONING, TEXT])),
  );
  const value = { messages: [{ content: [REASONING, TEXT], other: [REASONING, TEXT] }] };
  const sorted = parity.sortBlockArrays(parity.canonicalize(value), "");
  assert.deepEqual(sorted.messages[0].other.map((block) => block.type), ["reasoning", "text"], "非 content 键不许排");
  assert.deepEqual(sorted.messages[0].content.map((block) => JSON.stringify(block)),
    parity.sortBlockArrays(parity.canonicalize({ content: [TEXT, REASONING] }), "content").content.map((block) => JSON.stringify(block)),
    "content 块数组的排完序形与传入序无关（才能用来归因）");
  assert.deepEqual(sorted.messages[0].other.map((block) => block.type), ["reasoning", "text"], "非 content 键不许排");
  // 元素内容不同的两个块，排序也洗不平（stableStringifyIgnoringBlockOrder 两侧不等）
  assert.notEqual(
    parity.stableStringifyIgnoringBlockOrder(recordOf([TEXT, REASONING])),
    parity.stableStringifyIgnoringBlockOrder(recordOf([TEXT, { ...REASONING, text: "另一个思考" }])),
  );
  // 刻意窄剔除：ts / folded / dedupKey 不许被剔掉（#1150 的字段发明防止靠这三个键发声）
  assert.deepEqual(Object.keys(parity.VOLATILE_KEYS).sort(),
    ["__hostSynthesizedColumns", "created_at", "duration_ms", "id", "latency_ms", "updated_at"]);
  for (const key of ["ts", "folded", "dedupKey"]) {
    assert.ok(!(key in parity.VOLATILE_KEYS), `${key} 必须保持不剔`);
  }
});

// ==================== ② 真 fixture + 脚本本体（退出码语义） ====================

// ==================== ③ 回滚演练门禁（#1227 阶段 3 切片 C2） ====================

/** 造一份「一轮两消息」的账本，块按入参给（用来量块形状判据）。 */
function ledgerOf(blocks) {
  return [{
    round: 1,
    dedupKey: "req:engine:round:1",
    messages: [
      { role: "user", content: [{ type: "text", text: "问一句" }] },
      { role: "assistant", content: blocks },
    ],
  }];
}

const cellSnapshotOf = (overrides = {}) => ({
  request_id: "req",
  has_message_rows: false,
  legacy_cells: { rounds: 2, messages: 3, textLength: 100, toolResults: 1, toolUses: 1 },
  canonical_cells: { rounds: 2, messages: 3, textLength: 100, toolResults: 1, toolUses: 1 },
  cells_match: true,
  mismatched_cells: [],
  shape_up_to_order: true,
  shape_reasoning_enriched: false,
  shape_ok: true,
  shape_reason: "identical",
  parity_classification: "identical",
  parity_issues_content_diff: 0,
  parity_issues_ordering_only: 0,
  ...overrides,
});

test("门禁归因：只有块顺序差 → 判等；少一个块 → 精确报出缺哪条消息的哪个块", () => {
  const canonical = ledgerOf([TEXT, REASONING]);
  const reordered = ledgerOf([REASONING, TEXT]);
  const same = parity.compareBlockShapes(reordered, canonical);
  assert.deepEqual(
    { ok: same.ok, equal_up_to_order: same.equal_up_to_order, reason: same.reason },
    { ok: true, equal_up_to_order: true, reason: "identical" },
    "块集合与数量全同、只是先后不同 ⇒ 只可能是块顺序差",
  );

  const lost = ledgerOf([TEXT]);
  const missing = parity.compareBlockShapes(lost, canonical);
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "shape_diff");
  assert.deepEqual(missing.missing, [{ round: 1, role: "assistant", index: 1, types: ["reasoning"] }]);
  assert.deepEqual(missing.extra, []);

  const extraText = parity.compareBlockShapes(ledgerOf([TEXT, REASONING, { type: "text", text: "多一段" }]), canonical);
  assert.equal(extraText.ok, false, "多出非 reasoning 块不是宿主增强，必须红");
  assert.deepEqual(extraText.extra, [{ round: 1, role: "assistant", index: 1, types: ["text"] }]);

  // 少一整条消息（不是少一个块）
  const fewerMessages = parity.compareBlockShapes(
    [{ round: 1, dedupKey: "req:engine:round:1", messages: [{ role: "user", content: [TEXT] }] }],
    canonical,
  );
  assert.equal(fewerMessages.ok, false);
  assert.equal(fewerMessages.reason, "message_count");
});

test("门禁归因：宿主增强 reasoning（legacy 侧是超集）不算丢内容；三格不等就是丢内容", () => {
  const canonical = ledgerOf([TEXT]);
  const enriched = parity.compareBlockShapes(ledgerOf([REASONING, TEXT]), canonical);
  assert.equal(enriched.reasoning_enriched, true);
  assert.equal(enriched.ok, true, "终稿单写把整个 run 的累积推理写回 reasoning_content（对账器归 host_enriched_reasoning）");

  const cells = parity.compareLedgerCells(
    ledgerOf([TEXT, REASONING]),
    ledgerOf([{ type: "text", text: "更长的最终答复" }, REASONING]),
  );
  assert.equal(cells.cells_match, false);
  assert.deepEqual(cells.mismatched_cells, ["textLength"]);

  const equal = parity.compareLedgerCells(ledgerOf([TEXT, REASONING]), ledgerOf([REASONING, TEXT]));
  assert.equal(equal.cells_match, true);
  assert.equal(equal.shape.ok, true, "三格相等 + 块形状只差顺序 ⇒ 回滚档可接受");
});

test("门禁判据：老账本三格漂移 / 0.23 形状回归 / parity 变差 都要红，且逐条可定位", () => {
  const baseline = {
    requests: [
      cellSnapshotOf({ request_id: "legacy-shape" }),
      cellSnapshotOf({ request_id: "zero23", has_message_rows: true }),
    ],
  };
  const current = {
    requests: [
      cellSnapshotOf({ request_id: "legacy-shape" }),
      cellSnapshotOf({ request_id: "zero23", has_message_rows: true }),
    ],
  };
  const ok = parity.evaluateRollbackGate({ current, baseline });
  assert.equal(ok.ok, true, `基线自比必须通过：${JSON.stringify(ok.failures)}`);
  assert.equal(ok.summary.requests_with_message_rows, 1);
  assert.equal(ok.summary.requests_legacy_shape, 1);

  // ① 三格不等 canonical（任何形状都不允许）
  const cellsBad = parity.evaluateRollbackGate({
    current: {
      requests: [
        cellSnapshotOf({ request_id: "legacy-shape" }),
        cellSnapshotOf({
          request_id: "zero23",
          has_message_rows: true,
          cells_match: false,
          mismatched_cells: ["toolResults"],
          legacy_cells: { rounds: 2, messages: 3, textLength: 100, toolResults: 0, toolUses: 1 },
        }),
      ],
    },
    baseline,
  });
  assert.equal(cellsBad.ok, false);
  assert.deepEqual(
    cellsBad.failures.map((failure) => `${failure.request_id}:${failure.reason}`),
    ["zero23:cells_mismatch"],
    "三格不等 canonical 单独一条；这条在基线里是 0.23 形状，故不再叠 legacy_cells_drift（那条只对老账本生效）",
  );

  // ② 0.23 请求形状回归（不只是块顺序差）
  const shapeBad = parity.evaluateRollbackGate({
    current: {
      requests: [
        cellSnapshotOf({ request_id: "legacy-shape" }),
        cellSnapshotOf({
          request_id: "zero23",
          has_message_rows: true,
          shape_up_to_order: false,
          shape_ok: false,
          shape_reason: "shape_diff",
          shape_missing: [{ round: 1, role: "user", index: 1, types: ["tool_result"] }],
        }),
      ],
    },
    baseline,
  });
  assert.equal(shapeBad.ok, false);
  assert.deepEqual(shapeBad.failures.map((failure) => failure.reason), ["shape_regression"]);
  assert.deepEqual(shapeBad.failures[0].shape_missing, [{ round: 1, role: "user", index: 1, types: ["tool_result"] }]);

  // ③ 老账本请求的 legacy 三格与改动前不等（分流动了老账本语义）
  const drift = parity.evaluateRollbackGate({
    current: {
      requests: [
        cellSnapshotOf({
          request_id: "legacy-shape",
          legacy_cells: { rounds: 2, messages: 3, textLength: 42, toolResults: 1, toolUses: 1 },
        }),
        cellSnapshotOf({ request_id: "zero23", has_message_rows: true }),
      ],
    },
    baseline,
  });
  assert.equal(drift.ok, false);
  assert.deepEqual(drift.failures.map((failure) => `${failure.request_id}:${failure.reason}`), [
    "legacy-shape:legacy_cells_drift",
  ]);
  assert.deepEqual(drift.failures[0].drifted_cells, ["textLength"]);

  // ④ parity 分类变差：identical → content_diff，或 content_diff 条数变多
  const parityBad = parity.evaluateRollbackGate({
    current: {
      requests: [
        cellSnapshotOf({ request_id: "legacy-shape", parity_classification: "content_diff", parity_issues_content_diff: 1 }),
        cellSnapshotOf({ request_id: "zero23", has_message_rows: true }),
      ],
    },
    baseline,
  });
  assert.equal(parityBad.ok, false);
  assert.deepEqual(parityBad.failures.map((failure) => failure.reason), ["parity_regression"]);

  const parityWorse = parity.evaluateRollbackGate({
    current: {
      requests: [
        cellSnapshotOf({
          request_id: "legacy-shape",
          parity_classification: "content_diff",
          parity_issues_content_diff: 3,
        }),
        cellSnapshotOf({ request_id: "zero23", has_message_rows: true }),
      ],
    },
    baseline: {
      requests: [
        cellSnapshotOf({ request_id: "legacy-shape", parity_classification: "content_diff", parity_issues_content_diff: 1 }),
        cellSnapshotOf({ request_id: "zero23", has_message_rows: true }),
      ],
    },
  });
  assert.equal(parityWorse.ok, false, "存量 content_diff 从 1 条涨到 3 条也算变差");
  assert.deepEqual(parityWorse.failures.map((failure) => failure.reason), ["parity_regression"]);
});

test("门禁 CLI 参数：--gate 必须带 --baseline，--baseline 只用于 --gate", () => {
  assert.throws(() => parity.parseArgs(["--gate"]), /--baseline/);
  assert.throws(() => parity.parseArgs(["--baseline", "x.json"]), /只用于 --gate/);
  assert.deepEqual(
    parity.parseArgs(["--snapshot", "a.json"]).snapshotPath,
    "a.json",
  );
  const gate = parity.parseArgs(["--gate", "--baseline", "a.json"]);
  assert.equal(gate.gate, true);
  assert.equal(gate.baselinePath, "a.json");
});

if (!creds) {
  test("parity 三分类（llm_kit_test fixture）", { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  await ensureTables();

  after(async () => {
    try {
      await cleanupAll();
    } finally {
      await db.close();
      await rm(REPORT_DIR, { recursive: true, force: true });
    }
  });

  test("fixture ①：两侧完全相同 → identical 且 exit=0", async () => {
    const id = await seed(requestLabel("identical"), [TEXT, REASONING]);
    try {
      const { result, report, stdout } = await runAndClassify("identical", "identical");
      assert.equal(result.status, 0, `identical 必须 exit=0\nstdout:\n${result.stdout}\nissues:\n${JSON.stringify(report.requests[0].issues, null, 1).slice(0, 2000)}`);
      assert.equal(report.totals.requests_compared, 1);
      assert.equal(report.totals.requests_identical, 1);
      assert.equal(report.totals.requests_ordering_only, 0);
      assert.equal(report.totals.requests_content_diff, 0);
      assert.equal(report.requests[0].classification, "identical");
      assert.equal(report.requests[0].match, true, "match 的旧语义（一字不差）要保持不变");
      assert.match(stdout, /一字不差\s+: 1/);
      assert.match(stdout, /真内容差异\s+: 0/);
    } finally {
      await cleanup(id);
    }
  });

  test("fixture ②：同块仅换序 → ordering_only 且 exit=0（#1196 的核心：改前这里误报 exit=3）", async () => {
    const id = await seed(requestLabel("ordering"), [REASONING, TEXT]);
    try {
      // 语料必须真产生了"仅换序"这件事：canonical 侧是引擎原序，展示面重组是固定序
      const [rows] = await db.sequelize.query(
        `SELECT record_json FROM \`${CANONICAL_TABLE}\` WHERE request_id = :rid`,
        { replacements: { rid: id } },
      );
      const canonicalBlocks = JSON.parse(rows[0].record_json).messages[1].content.map((block) => block.type);
      assert.deepEqual(canonicalBlocks, ["reasoning", "text"], "canonical 必须存引擎原序");

      const { result, report, stdout } = await runAndClassify("ordering", "ordering");
      assert.equal(result.status, 0, `纯顺序差异不该让闸门红\nstdout:\n${result.stdout}\nissues:\n${JSON.stringify(report.requests[0].issues, null, 1).slice(0, 2000)}`);
      assert.equal(report.totals.requests_identical, 0);
      assert.equal(report.totals.requests_ordering_only, 1);
      assert.equal(report.totals.requests_content_diff, 0);
      const entry = report.requests[0];
      assert.equal(entry.classification, "ordering_only");
      assert.equal(entry.match, false, "ordering_only 不是 identical");
      assert.ok(entry.issues.length > 0 && entry.issues.every((issue) => issue.kind === "ordering_only"));
      // 深比对仍然报了差异路径：分类只是归因，没有把差异咽下去
      assert.ok(entry.issues[0].diff_paths.length > 0, "diff_paths 必须非空（比对强度没降）");
      assert.ok(entry.issues[0].block_order_swaps.length > 0, "明细要给出换了序的块");
      assert.match(entry.issues[0].block_order_swaps[0].path, /messages\[\d+\]\.content/);
      assert.match(stdout, /纯块顺序\s+: 1/);
      assert.match(stdout, /真内容差异\s+: 0/);
    } finally {
      await cleanup(id);
    }
  });

  test("fixture ③：少一个 text 块 / 文字改一个字 → content_diff 且 exit=3", async () => {
    const missing = await seed(requestLabel("missing-block"), [TEXT, REASONING]);
    const changed = await seed(requestLabel("text-changed"), [TEXT, REASONING]);
    try {
      // (a) 少一个 text 块：展示面正文列被抹空（只剩 reasoning 块能重组出来）
      await db.sequelize.query(
        "UPDATE messages SET content = '' WHERE request_id = :rid AND role = 'assistant'",
        { replacements: { rid: missing } },
      );
      const missingRun = await runAndClassify("missing-block", "missing");
      assert.equal(missingRun.result.status, 3, `真内容差异必须 exit=3\n${missingRun.stdout}`);
      assert.equal(missingRun.report.totals.requests_content_diff, 1);
      assert.equal(missingRun.report.totals.requests_ordering_only, 0);
      assert.equal(missingRun.report.requests[0].classification, "content_diff");
      assert.match(missingRun.stdout, /真内容差异\s+: 1/);

      // (b) 文字改一个字
      await db.sequelize.query(
        "UPDATE messages SET content = CONCAT(content, '。') WHERE request_id = :rid AND role = 'assistant' AND content <> ''",
        { replacements: { rid: changed } },
      );
      const changedRun = await runAndClassify("text-changed", "changed");
      assert.equal(changedRun.result.status, 3, `改一个字必须 exit=3\n${changedRun.stdout}`);
      assert.equal(changedRun.report.requests[0].classification, "content_diff");
      assert.ok(changedRun.report.requests[0].issues.some((issue) =>
        issue.diff_paths.some((p) => p.includes("text"))));
    } finally {
      await cleanup(missing);
      await cleanup(changed);
    }
  });

  test("混合场景：同一批里换序与会真差异并存时，exit 仍由 content_diff 决定", async () => {
    const ordering = await seed(requestLabel("mix-ordering"), [REASONING, TEXT]);
    const content = await seed(requestLabel("mix-content"), [TEXT, REASONING]);
    try {
      await db.sequelize.query(
        "UPDATE messages SET content = '被改掉的字' WHERE request_id = :rid AND role = 'assistant'",
        { replacements: { rid: content } },
      );
      const reportPath = path.join(REPORT_DIR, "mixed.json");
      const result = runParity(["--report", reportPath, "--limit", "500"]);
      assert.ifError(result.error);
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      const mine = report.requests.filter((entry) => entry.request_id.startsWith(`run-1196-${ns}-`));
      assert.equal(mine.length, 2, "两条 fixture 都要进这次比对");
      const byId = new Map(mine.map((entry) => [entry.request_id, entry]));
      assert.equal(byId.get(ordering).classification, "ordering_only");
      assert.equal(byId.get(content).classification, "content_diff");
      assert.ok(report.totals.requests_ordering_only >= 1);
      assert.ok(report.totals.requests_content_diff >= 1);
      assert.ok(report.ordering_only_requests.some((entry) => entry.request_id === ordering));
      assert.ok(report.content_diff_requests.some((entry) => entry.request_id === content));
      assert.equal(result.status, 3, `有 content_diff 在场时 exit 必须是 3\n${result.stdout}`);
    } finally {
      await cleanup(ordering);
      await cleanup(content);
    }
  });

  /**
   * 回滚演练门禁的**端到端**用例（#1227 阶段 3 切片 C2）：
   * 造一条 0.23 形状请求（载体 + 消息行 + 分片 + 工具轮）和一条老账本形状请求，
   * 采一次快照、再拿它当基线跑门禁 ⇒ 必须绿；随后**改坏基线**，逐条判据都要红。
   */
  test("门禁端到端：0.23 请求只剩块顺序差、老账本三格不变；改坏基线后每条判据都红", async () => {
    const id023 = requestLabel("gate-023");
    const idLegacy = requestLabel("gate-legacy");
    const toolId = `tu-gate-${ns}`;
    const carrier = (round) => `${id023}:engine:round:${round}`;
    const store = makeStore();
    const zero23Records = [
      {
        round: 0,
        roundKey: `${id023}:round:0`,
        dedupKey: `${id023}:engine:round:0:seed`,
        ts: "2026-11-01T00:00:00.000Z",
        messages: [{ role: "system", content: [{ type: "text", text: "seed" }] }],
      },
      {
        round: 1,
        roundKey: `${id023}:round:1`,
        dedupKey: carrier(1),
        ts: "2026-11-01T00:00:01.000Z",
        response: { stopReason: "tool_use" },
      },
      {
        round: 1,
        roundKey: `${id023}:round:1`,
        dedupKey: `${id023}:msg:1:0`,
        kind: "message",
        seq: 0,
        ts: "2026-11-01T00:00:01.100Z",
        messages: [{
          role: "assistant",
          content: [
            { type: "reasoning", text: "先查一下" },
            { type: "tool_use", id: toolId, name: "list", input: { path: "." } },
          ],
        }],
      },
      {
        round: 1,
        roundKey: `${id023}:round:1`,
        dedupKey: `${id023}:msg:1:1`,
        kind: "message",
        seq: 1,
        ts: "2026-11-01T00:00:01.200Z",
        messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "ok-1" }] }],
      },
      {
        round: 2,
        roundKey: `${id023}:round:2`,
        dedupKey: carrier(2),
        ts: "2026-11-01T00:00:02.000Z",
        response: { stopReason: "end_turn" },
      },
      {
        // 终稿轮：reasoning 在前、text 在后 ⇒ legacy 重组成 [text, reasoning]（只差块顺序）
        round: 2,
        roundKey: `${id023}:round:2`,
        dedupKey: `${id023}:msg:2:0`,
        kind: "message",
        seq: 0,
        ts: "2026-11-01T00:00:02.100Z",
        messages: [{
          role: "assistant",
          content: [
            { type: "reasoning", text: "收尾" },
            { type: "text", text: "做完了" },
          ],
        }],
      },
    ];
    const legacyRecords = [
      {
        round: 1,
        roundKey: `${idLegacy}:engine:round:1`,
        dedupKey: `${idLegacy}:engine:round:1`,
        ts: "2026-11-01T00:00:01.000Z",
        messages: [
          { role: "user", content: [{ type: "text", text: "老账本问一句" }] },
          {
            role: "assistant",
            content: [
              { type: "text", text: "先查一下" },
              { type: "tool_use", id: `${toolId}-legacy`, name: "list", input: { path: "." } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: `${toolId}-legacy`, content: "ok-legacy" }],
          },
        ],
        response: { stopReason: "tool_use" },
      },
      {
        round: 2,
        roundKey: `${idLegacy}:engine:round:2`,
        dedupKey: `${idLegacy}:engine:round:2`,
        ts: "2026-11-01T00:00:02.000Z",
        messages: [{ role: "assistant", content: [{ type: "text", text: "老账本收尾" }] }],
        response: { content: [{ type: "text", text: "老账本收尾" }], stopReason: "end_turn" },
      },
    ];

    try {
      for (const record of zero23Records) await store.appendRound(id023, record);
      for (const record of legacyRecords) await store.appendRound(idLegacy, record);

      const requests = [{ request_id: id023 }, { request_id: idLegacy }];
      const snapshot = await parity.collectRollbackSnapshot({
        sequelize: db.sequelize,
        store,
        requests,
      });
      const byId = new Map(snapshot.requests.map((entry) => [entry.request_id, entry]));

      const zero23 = byId.get(id023);
      assert.equal(zero23.has_message_rows, true, "0.23 fixture 必须有 kind='message' 行");
      assert.equal(zero23.cells_match, true, `三格必须与 canonical 相等：${JSON.stringify(zero23)}`);
      assert.equal(zero23.shape_up_to_order, true, `0.23 请求只允许块顺序差：${JSON.stringify(zero23)}`);
      assert.equal(zero23.legacy_cells.rounds, 3, "legacy 档不得把消息行当轮宿主（种子 + 工具轮 + 终稿轮）");
      assert.equal(zero23.canonical_cells.rounds, 3);
      assert.equal(zero23.legacy_cells.toolResults, 1, "工具轮的 tool_result 必须读得回来");

      const legacyEntry = byId.get(idLegacy);
      assert.equal(legacyEntry.has_message_rows, false, "老账本 fixture 不得有 kind='message' 行");
      assert.equal(legacyEntry.cells_match, true, "老账本三格必须与 canonical 相等（逐行装配语义不变）");

      const gate = parity.evaluateRollbackGate({ current: snapshot, baseline: snapshot });
      assert.equal(gate.ok, true, `基线自比必须通过：${JSON.stringify(gate.failures)}`);
      assert.equal(gate.summary.requests_with_message_rows, 1);
      assert.equal(gate.summary.requests_legacy_shape, 1);

      // 改坏基线：把 0.23 请求的“改动前”写成多两个空轮 + 形状不等（= C2 之前的真实形状）
      const brokenShape = JSON.parse(JSON.stringify(snapshot));
      const zero23Broken = brokenShape.requests.find((entry) => entry.request_id === id023);
      zero23Broken.legacy_cells = { ...zero23Broken.legacy_cells, rounds: 5 };
      zero23Broken.cells_match = false;
      zero23Broken.mismatched_cells = ["rounds"];
      zero23Broken.shape_up_to_order = false;
      zero23Broken.shape_ok = false;
      zero23Broken.shape_reason = "shape_diff";
      const brokenGate = parity.evaluateRollbackGate({ current: brokenShape, baseline: snapshot });
      assert.equal(brokenGate.ok, false);
      assert.deepEqual(
        brokenGate.failures.map((failure) => `${failure.request_id}:${failure.reason}`).sort(),
        [`${id023}:cells_mismatch`, `${id023}:shape_regression`],
        "0.23 请求回归必须同时报 cells_mismatch 与 shape_regression（且不报 legacy_cells_drift）",
      );

      // 改坏基线：老账本请求的三格与“改动前”不等 ⇒ legacy_cells_drift
      const driftedBaseline = JSON.parse(JSON.stringify(snapshot));
      const legacyBefore = driftedBaseline.requests.find((entry) => entry.request_id === idLegacy);
      legacyBefore.legacy_cells = { ...legacyBefore.legacy_cells, textLength: legacyBefore.legacy_cells.textLength - 1 };
      const driftGate = parity.evaluateRollbackGate({ current: snapshot, baseline: driftedBaseline });
      assert.equal(driftGate.ok, false);
      assert.deepEqual(driftGate.failures.map((failure) => failure.reason), ["legacy_cells_drift"]);
      assert.deepEqual(driftGate.failures[0].drifted_cells, ["textLength"]);

      // === CLI 端到端：--snapshot 采一次，--gate 拿它当基线 ⇒ exit 0 ===
      const snapPath = path.join(REPORT_DIR, "gate-snapshot.json");
      const snapRun = runParity(["--request-id", id023, "--snapshot", snapPath,
        "--report", path.join(REPORT_DIR, "gate-snap-report.json")]);
      assert.ifError(snapRun.error);
      assert.equal(snapRun.status, 3, `0.23 fixture 仍有存量 content_diff（展示面既有损点），parity 老口径 exit=3\n${snapRun.stdout}`);
      const gateRun = runParity(["--request-id", id023, "--gate", "--baseline", snapPath,
        "--report", path.join(REPORT_DIR, "gate-report.json")]);
      assert.ifError(gateRun.error);
      assert.equal(gateRun.status, 0, `--gate 必须 exit 0\nstdout:\n${gateRun.stdout}`);
      assert.match(gateRun.stdout, /结论：✅ 通过/);
      assert.match(gateRun.stdout, /0\.23 1 \//, "门禁摘要必须报出 0.23 形状请求数（=1）");

      // --gate 不给基线 ⇒ 用法错误（exit 1，不许默默当成普通比对跑）
      const noBaseline = runParity(["--request-id", id023, "--gate"]);
      assert.equal(noBaseline.status, 1, "缺少 --baseline 必须 exit 1");
      assert.match(`${noBaseline.stderr}${noBaseline.stdout}`, /--baseline/);
    } finally {
      await cleanup(id023);
      await cleanup(idLegacy);
    }
  });
}
