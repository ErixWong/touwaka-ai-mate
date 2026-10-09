/**
 * issue #1156 Stage C — **两模式读侧等价比对** `legacy` vs `new`（只读，零写入）
 *
 * 做什么
 *   对库里每个 `request_id`，在 `ERIX_TRANSCRIPT_READ_MODE=legacy`（`agent_rounds` +
 *   `messages` / `chat_tool_calls` 展示面装配）与 `=new`（canonical
 *   `agent_transcript_rounds.record_json` 为真相）两种读法下，分别取**三个读方法**
 *   （`load` / `loadByDedupKey` / `loadMaxRound`）的输出，做**深比对**：
 *     - `load`         : 逐轮（按 round_no + 同轮内出现序对齐）比规范化后的整份 record
 *     - `loadByDedupKey`: 用 load 输出里出现的 dedupKey / roundKey 逐个点查，比命中内容与
 *                        命中/未命中结论（含一条必然未命中的探针键，钉住 null 语义）
 *     - `loadMaxRound` : 比返回值本身
 *   输出逐请求差异 + 总数摘要到报告 JSON；stdout 打摘要。
 *
 * **复用而非复制**：两侧都调 store 现成的读方法（同一个 createTouwakaTranscriptStore、
 * 同一处模式解析 resolveTranscriptReadMode），本脚本**不写任何一份装配逻辑**。这是刻意的：
 * 比对脚本自己抄一份装配，就变成"第三份实现"，比对结论随之失去意义。
 *
 * 规范化（写进报告 JSON，含"剔除了哪些、为什么"）
 *   递归剔除易变键 + 对象键名排序后 stringify。剔除面**刻意比
 *   scripts/backfill-transcript-canonical.js 更窄**：那份是给回填当闸门用的，
 *   `ts` / `folded` / `dedupKey` 它剔了；本脚本**不剔**这三项——#1150 的字段发明防止
 *   本来就该让两侧在这三个键上一致，剔掉等于把"读侧发明字段"这类真差异藏起来。
 *   窄剔除 = 更强的信号（只可能报得多，不会把真差异抹平）。
 *
 * 用法
 *   node scripts/verify-transcript-read-parity.js                        # 全库
 *   node scripts/verify-transcript-read-parity.js --limit 20
 *   node scripts/verify-transcript-read-parity.js --request-id <id>
 *   node scripts/verify-transcript-read-parity.js --report temp/parity.json
 *   退出码：全一致 = 0；有差异 = 3（**是信号不是崩**，方便当闸门用）；用法/连接错误 = 1。
 *
 * 连哪个库（与 scripts/backfill-transcript-canonical.js 同约定）
 *   - 默认（没给 DB_*）：走 tests/helpers/test-db-guard.mjs 的 openTestDatabase()，
 *     建连接之前先硬断言目标库在测试库白名单里（issue #1167），只会是 llm_kit_test。
 *   - 指定库（主 agent 跑生产）：给 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME，
 *     且**必须**同时给 ALLOW_NON_TEST_DB=1 显式确认，否则被守卫拦下。
 *   本脚本只读（不 INSERT/UPDATE/DELETE/DDL），但仍照旧走守卫，不给"手滑指错库"留门。
 *
 * 注意：stdout 是报告，**不要接 `| head`**（管道提前关闭 = SIGPIPE 杀进程，本仓踩过）。
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import logger from "../lib/logger.js";
// logs/ 目录可能非本用户属主：脚本只往 stdout 打报告，不让 logger 写文件失败盖住结果。
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const {
  createTouwakaTranscriptStore,
  CANONICAL_TABLE,
  TRANSCRIPT_READ_MODE_ENV,
  TRANSCRIPT_READ_MODE_LEGACY,
  TRANSCRIPT_READ_MODE_NEW,
} = await import("../lib/llm-kit-adapters/transcript-store.js");
const { openTestDatabase, assertTestDatabase, ALLOW_ENV_VAR } = await import("../tests/helpers/test-db-guard.mjs");

const DEFAULT_REPORT_PATH = "temp/verify-transcript-read-parity.json";

/**
 * 规范化里**剔除**的键与理由（同时写进报告 JSON，便于事后追问"你到底比掉了什么"）。
 * 判据：这个键的值只可能因「哪张表 / 什么时候落库 / 列形态」而不同，本身不承载 record 内容语义。
 *
 * 注意 ts / folded / dedupKey **故意不在这里**（见文件头"比回填脚本更窄"）。
 */
export const VOLATILE_KEYS = {
  id: "行主键：展示面是 round_ 前缀、canonical 是 atr_ 前缀，两侧本来就不同，不是 record 内容",
  created_at: "行落库时刻，非 record 内容（canonical 行有、装配出的 record 里没有，形态也不同）",
  updated_at: "行落库时刻，非 record 内容",
  duration_ms: "chat_tool_calls 的 INT 列形态；record 里的原字段是 duration（浮点秒），取整会差小数部分",
  latency_ms: "宿主侧耗时统计，非 record 内容",
  __hostSynthesizedColumns: "展示面 record_json 私有标记（#1150 字段发明防止），canonical 按决策③′ 不得出现",
};

/** 递归剔除易变键 + 键名排序，得到可跨模式稳定比对的规范化值。 */
export function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (Object.hasOwn(VOLATILE_KEYS, key)) continue;
    const child = value[key];
    if (child === undefined) continue;
    out[key] = canonicalize(child);
  }
  return out;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

/** 两侧规范化值的路径级差异（最多 12 条，够定位就行，报告不撑爆）。 */
export function normalizedDiffPaths(a, b, base = "", found = []) {
  if (found.length >= 12) return found;
  const ca = canonicalize(a);
  const cb = canonicalize(b);
  if (stableStringify(ca) === stableStringify(cb)) return found;
  if (Array.isArray(ca) || Array.isArray(cb)) {
    if (!Array.isArray(ca) || !Array.isArray(cb) || ca.length !== cb.length) found.push(`${base}[len]`);
    else for (let i = 0; i < ca.length; i += 1) normalizedDiffPaths(ca[i], cb[i], `${base}[${i}]`, found);
    return found;
  }
  if (ca && cb && typeof ca === "object" && typeof cb === "object") {
    for (const key of new Set([...Object.keys(ca), ...Object.keys(cb)])) {
      normalizedDiffPaths(ca[key], cb[key], base ? `${base}.${key}` : key, found);
    }
    return found;
  }
  found.push(base || "$");
  return found;
}

function parseArgs(argv) {
  const options = { limit: null, requestId: null, reportPath: DEFAULT_REPORT_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--request-id") options.requestId = next();
    else if (arg === "--report") options.reportPath = next();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}（--help 看用法）`);
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new Error(`--limit 必须是非负整数，收到 ${options.limit}`);
  }
  return options;
}

/** 连接解析：与 backfill 脚本同一套约定（默认测试库，DB_* + ALLOW_NON_TEST_DB 才连别的库）。 */
async function resolveConnection() {
  const envTarget = process.env.DB_NAME;
  if (!envTarget) {
    const ctx = await openTestDatabase();
    if (!ctx) throw new Error("没给 DB_* 环境变量，也读不到测试库凭据（~/.config/mcp/creds/touwaka-test-db.json）");
    return { sequelize: ctx.db.sequelize, database: ctx.creds.database, source: "openTestDatabase()" };
  }
  assertTestDatabase(envTarget, { env: process.env });
  const { Sequelize } = await import("sequelize");
  const sequelize = new Sequelize(envTarget, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    dialect: "mysql",
    logging: false,
  });
  await sequelize.authenticate();
  return {
    sequelize,
    database: envTarget,
    source: `DB_* 环境变量（${process.env.DB_HOST || "localhost"}，${ALLOW_ENV_VAR}=${process.env[ALLOW_ENV_VAR] ?? "未设"}）`,
  };
}

/** 候选 request_id：两张表的并集（只有一侧有行的会话也必须进报告）。 */
async function listRequestIds(sequelize, { limit, requestId }) {
  const where = requestId ? "WHERE request_id = :requestId" : "";
  const replacements = requestId ? { requestId } : {};
  const [rows] = await sequelize.query(`
    SELECT request_id, MAX(in_display) AS in_display, MAX(in_canonical) AS in_canonical
      FROM (
        SELECT request_id, 1 AS in_display, 0 AS in_canonical FROM agent_rounds ${where}
        UNION ALL
        SELECT request_id, 0 AS in_display, 1 AS in_canonical FROM \`${CANONICAL_TABLE}\` ${where}
      ) t
     GROUP BY request_id
     ORDER BY request_id ASC
     ${limit === null ? "" : "LIMIT :limit"}
  `, { replacements: limit === null ? replacements : { ...replacements, limit } });
  return rows.map((row) => ({
    request_id: row.request_id,
    in_display: Number(row.in_display) > 0,
    in_canonical: Number(row.in_canonical) > 0,
  }));
}

/**
 * 在指定读模式下取三个读方法的输出（模式只经 resolveTranscriptReadMode 那一处生效）。
 * 必须**串行**调：它靠改 process.env 切模式，并发两个模式会互踩。
 * 导出供测试复用——测试断言的是脚本自己走的同一条取值与比对路径，不是另一份实观。
 */
export async function readUnder(store, mode, runId) {
  const previous = process.env[TRANSCRIPT_READ_MODE_ENV];
  process.env[TRANSCRIPT_READ_MODE_ENV] = mode;
  try {
    const rounds = await store.load(runId);
    const maxRound = await store.loadMaxRound(runId);
    // 点查探针：两侧 load 输出里出现过的 dedupKey / roundKey 都要试（并集，避免只按
    // legacy 侧的键去点查而漏掉"new 侧能命中、legacy 侧命中不了"这种单向差异），
    // 再加一条必然未命中的键，钉住"未命中返回 null"的语义在两个档也一致。
    const keys = new Set();
    for (const record of rounds) {
      if (typeof record?.dedupKey === "string" && record.dedupKey !== "") keys.add(record.dedupKey);
      if (typeof record?.roundKey === "string" && record.roundKey !== "") keys.add(record.roundKey);
    }
    keys.add(`${runId}:parity:always-miss`);
    const probes = [];
    for (const key of [...keys].sort()) {
      probes.push({ dedup_key: key, record: await store.loadByDedupKey(runId, key) });
    }
    return { rounds, max_round: maxRound, probes };
  } finally {
    if (previous === undefined) delete process.env[TRANSCRIPT_READ_MODE_ENV];
    else process.env[TRANSCRIPT_READ_MODE_ENV] = previous;
  }
}

/**
 * 把两轮序列对齐成 {key, legacy, new}：按 dedupKey（领域身份）对齐，缺则退 round_no + 出现序。
 * 按身份而不是按下标对齐：一侧多一行/少一行时必须报「哪一侧缺行」，不能整列错开假报差异。
 */
export function alignRounds(legacyRounds, newRounds) {
  const keyOf = (record, index) => String(record?.dedupKey ?? record?.roundKey ?? `#${index}`);
  const legacyMap = new Map(legacyRounds.map((record, index) => [keyOf(record, index), record]));
  const newMap = new Map(newRounds.map((record, index) => [keyOf(record, index), record]));
  const keys = [...new Set([...legacyMap.keys(), ...newMap.keys()])];
  return keys.map((key) => ({
    key,
    round_no: legacyMap.get(key)?.round ?? newMap.get(key)?.round ?? null,
    legacy: legacyMap.has(key) ? legacyMap.get(key) : "<legacy 缺行>",
    new: newMap.has(key) ? newMap.get(key) : "<canonical 缺行>",
  }));
}

export function compareRequest(store, runId) {
  const run = async () => {
    // 必须**串行**：readUnder 靠改 process.env 切模式，并发跑会互相踩环境变量。
    const legacyOut = await readUnder(store, TRANSCRIPT_READ_MODE_LEGACY, runId);
    const newOut = await readUnder(store, TRANSCRIPT_READ_MODE_NEW, runId);
    const issues = [];

    const aligned = alignRounds(legacyOut.rounds, newOut.rounds);
    for (const entry of aligned) {
      const paths = normalizedDiffPaths(entry.legacy, entry.new);
      if (paths.length > 0) {
        issues.push({
          method: "load",
          key: entry.key,
          round_no: entry.round_no,
          diff_paths: paths,
          legacy_side: stableStringify(entry.legacy).slice(0, 400),
          new_side: stableStringify(entry.new).slice(0, 400),
        });
      }
    }

    if (legacyOut.max_round !== newOut.max_round) {
      issues.push({ method: "loadMaxRound", key: "max_round", diff_paths: ["$"],
        legacy_side: String(legacyOut.max_round), new_side: String(newOut.max_round) });
    }

    const legacyProbes = new Map(legacyOut.probes.map((probe) => [probe.dedup_key, probe.record]));
    const newProbes = new Map(newOut.probes.map((probe) => [probe.dedup_key, probe.record]));
    for (const key of new Set([...legacyProbes.keys(), ...newProbes.keys()])) {
      const legacyHit = legacyProbes.has(key) ? legacyProbes.get(key) : "<未点查>";
      const newHit = newProbes.has(key) ? newProbes.get(key) : "<未点查>";
      const paths = normalizedDiffPaths(legacyHit, newHit);
      if (paths.length > 0) {
        issues.push({ method: "loadByDedupKey", key, diff_paths: paths,
          legacy_side: stableStringify(legacyHit).slice(0, 400),
          new_side: stableStringify(newHit).slice(0, 400) });
      }
    }

    return {
      request_id: runId,
      legacy_round_count: legacyOut.rounds.length,
      new_round_count: newOut.rounds.length,
      legacy_max_round: legacyOut.max_round,
      new_max_round: newOut.max_round,
      probe_count: legacyOut.probes.length,
      match: issues.length === 0,
      issues,
    };
  };
  return run();
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("用法：node scripts/verify-transcript-read-parity.js [--limit N] [--request-id <id>] [--report <path>]");
    return;
  }
  const { sequelize, database, source } = await resolveConnection();

  const [tableCheck] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { replacements: { table: CANONICAL_TABLE } },
  );
  if (Number(tableCheck[0].n) === 0) {
    throw new Error(`${CANONICAL_TABLE} 不存在于 ${database}：先跑 node scripts/upgrade-database.js --step "#1156 Stage A"（输出别接 head）`);
  }

  const requests = await listRequestIds(sequelize, options);
  // 一个 store 实例跑两侧：模式切换只经 resolveTranscriptReadMode 那一处，
  // 这样"两侧用了不同装配实现"这种作弊在结构上不可能发生。
  const store = createTouwakaTranscriptStore({ db: { sequelize } });
  const entries = [];
  for (const item of requests) {
    entries.push(await compareRequest(store, item.request_id));
  }

  const mismatched = entries.filter((entry) => !entry.match);
  const report = {
    generated_at: new Date().toISOString(),
    database,
    connection_source: source,
    read_mode_env: TRANSCRIPT_READ_MODE_ENV,
    modes_compared: [TRANSCRIPT_READ_MODE_LEGACY, TRANSCRIPT_READ_MODE_NEW],
    methods_compared: ["load", "loadByDedupKey", "loadMaxRound"],
    filters: { limit: options.limit, request_id: options.requestId },
    normalization: {
      algorithm: "递归剔除易变键 + 对象键名排序后 JSON.stringify 逐路径比对",
      stripped_keys: VOLATILE_KEYS,
      deliberately_not_stripped: {
        ts: "写入方没给 ts 时宿主会补列（#1150 字段发明防止），两侧本就该一致；剔掉会藏住读侧发明字段",
        folded: "展示面是 NOT NULL 列、canonical 保持写入方原样；两侧本就该一致（标记会删掉补的值）",
        dedupKey: "领域身份，是 record 内容，不能比掉",
      },
    },
    totals: {
      requests_compared: entries.length,
      requests_matched: entries.length - mismatched.length,
      requests_mismatched: mismatched.length,
      rounds_legacy: entries.reduce((sum, entry) => sum + entry.legacy_round_count, 0),
      rounds_new: entries.reduce((sum, entry) => sum + entry.new_round_count, 0),
      probes_compared: entries.reduce((sum, entry) => sum + entry.probe_count, 0),
      requests_only_in_display_side: requests.filter((item) => item.in_display && !item.in_canonical).length,
      requests_only_in_canonical_side: requests.filter((item) => !item.in_display && item.in_canonical).length,
    },
    mismatches: mismatched,
    requests: entries,
  };

  const reportPath = path.resolve(process.cwd(), options.reportPath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log([
    `[#1156 Stage C 两模式等价比对] 库=${database}  ${TRANSCRIPT_READ_MODE_ENV}: ${TRANSCRIPT_READ_MODE_LEGACY} vs ${TRANSCRIPT_READ_MODE_NEW}`,
    `  会话比对   : ${report.totals.requests_compared} 个（展示面独有 ${report.totals.requests_only_in_display_side} / canonical 独有 ${report.totals.requests_only_in_canonical_side}）`,
    `  轮数       : legacy ${report.totals.rounds_legacy} 轮 vs new ${report.totals.rounds_new} 轮`,
    `  点查探针   : ${report.totals.probes_compared} 次（含必然未命中的一条）`,
    `  一致       : ${report.totals.requests_matched} 个会话`,
    `  不一致     : ${report.totals.requests_mismatched} 个会话`,
    `  报告       : ${reportPath}`,
  ].join("\n"));
  for (const entry of mismatched.slice(0, 20)) {
    const first = entry.issues[0];
    console.log(`  ! ${entry.request_id} ${first.method} key=${first.key} 差异=${first.diff_paths.join(",")}`);
  }
  if (mismatched.length > 20) console.log(`  ! …另有 ${mismatched.length - 20} 个会话不一致，见报告文件`);

  await sequelize.close();
  // 有差异就非零退出：这是信号，不是崩
  if (mismatched.length > 0) process.exitCode = 3;
}

// 只有**直接跑**本文件才执行 main（测试 import 拿工具函数时不能连带跑一轮真比对）。
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) await main();
