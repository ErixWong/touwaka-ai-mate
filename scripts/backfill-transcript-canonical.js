/**
 * issue #1156 Stage B — 一次性回填 + **全量逐轮比对** agent_transcript_rounds
 *
 * 做什么
 *   1. 回填：从旧展示面 `agent_rounds`（+ `messages` / `chat_tool_calls` 子行）重建
 *      canonical 行落 `agent_transcript_rounds`。**不自己写第二份序列化**：record 用
 *      load() 同一个装配函数 assembleRoundRecord，字符串用 appendRound 同一个
 *      buildCanonicalRecordJson / insertCanonicalRound（两边各写一份必然漂移）。
 *   2. 全量比对：逐轮给出「旧侧重建 record 的规范化哈希」vs「新表 record_json 的规范化
 *      哈希」+ 两侧条数，末尾给总数与不一致清单；报告落文件，stdout 打摘要。
 *      运维取向（issue #1156）：语料仅 69 轮，**离线穷举全量 diff 严格强于在线抽样双写**。
 *
 * 幂等
 *   canonical 走 `INSERT IGNORE` + `UNIQUE(dedup_key)`：**先到先得、后到忽略**，与
 *   appendRound 写侧逐字同语义，重复跑不产生重复行、不覆盖既有真相。
 *
 * 默认不写（安全第一，回填是一次性动作）：
 *   node scripts/backfill-transcript-canonical.js                    # = --dry-run
 *   node scripts/backfill-transcript-canonical.js --write            # 真回填
 *   node scripts/backfill-transcript-canonical.js --verify-only      # 只比对（不重建不写）
 *   node scripts/backfill-transcript-canonical.js --limit 20 --request-id <id> --report temp/x.json
 *
 * 连哪个库
 *   - 默认（没给 DB_* 环境变量）：走 tests/helpers/test-db-guard.mjs 的 openTestDatabase()
 *     ——建连接之前先硬断言目标库在测试库白名单里（issue #1167），只会是 llm_kit_test。
 *   - 生产（主 agent 执行）：给定 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME（读取方式
 *     同 scripts/upgrade-database.js），此时**必须**同时给 ALLOW_NON_TEST_DB=1 显式确认，
 *     否则同样被守卫拦下。写生产请务必先 --dry-run 预演。
 *
 * 注意：本脚本的 stdout 是报告，**不要接 `| head`**（管道提前关闭 = SIGPIPE 杀死迁移进程，
 * 本仓踩过）。
 */

import crypto from "node:crypto";
import path from "node:path";
import { mkdir } from "node:fs/promises";

import logger from "../lib/logger.js";
// logs/ 目录可能非本用户属主：脚本只往 stdout 打报告，不让 logger 写文件失败盖住结果。
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { CANONICAL_TABLE, assembleRoundRecord, insertCanonicalRound, newCanonicalRoundId, buildCanonicalRecordJson } =
  await import("../lib/llm-kit-adapters/transcript-store.js");
const { openTestDatabase, assertTestDatabase, ALLOW_ENV_VAR } = await import("../tests/helpers/test-db-guard.mjs");

const DEFAULT_REPORT_PATH = "temp/backfill-canonical-report.json";

/**
 * 规范化哈希里**剔除**的字段与理由（写进报告，便于事后追问）。
 * 判据：两侧值可能只因「什么时候写 / 从哪一列补齐」而不同，本身不承载内容语义。
 */
const VOLATILE_KEYS = {
  ts: "轮时间戳：写入方没给 ts 时宿主会用 now 补 agent_rounds.ts（#1150 字段发明防止），旧侧一定有个值、canonical 侧可能压根没这个键",
  created_at: "行落库时刻，非 record 内容",
  updated_at: "行落库时刻，非 record 内容",
  dedupKey: "身份已按 dedup_key 列逐行对齐；record 里这一列是 NOT NULL 补齐产物，两侧表达形式不同",
  folded: "agent_rounds.folded 是 NOT NULL 列，旧侧一定是 true/false，canonical 侧保持写入方原样（可能缺键）",
  duration: "tool_result 耗时：旧侧经 chat_tool_calls.duration_ms 的 INT 列（取整）往返，与原始浮点秒差在小数部分",
  duration_ms: "同上（列形态）",
  latency_ms: "非 record 内容的耗时统计",
  __hostSynthesizedColumns: "展示面私有标记（agent_rounds.record_json 专用），canonical 里按决策③′ 不得出现",
};

/** 递归剔除易变字段 + 键名排序，得到可稳定比对的规范化 JSON。 */
function canonicalize(value) {
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

function normalizedHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex").slice(0, 16);
}

function normalizedDiffPaths(a, b, base = "", found = []) {
  if (found.length >= 12) return found;
  if (a === b) return found;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) found.push(`${base}[len]`);
    else for (let index = 0; index < a.length; index += 1) normalizedDiffPaths(a[index], b[index], `${base}[${index}]`, found);
    return found;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (Object.hasOwn(VOLATILE_KEYS, key)) continue;
      normalizedDiffPaths(a[key], b[key], base ? `${base}.${key}` : key, found);
    }
    return found;
  }
  found.push(base || "$");
  return found;
}

function parseArgs(argv) {
  const options = {
    mode: "dry-run", limit: null, requestId: null, reportPath: DEFAULT_REPORT_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--dry-run") options.mode = "dry-run";
    else if (arg === "--write") options.mode = "write";
    else if (arg === "--verify-only") options.mode = "verify-only";
    else if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--request-id") options.requestId = next();
    else if (arg === "--report") options.reportPath = next();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}（--help 看用法）`);
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new Error(`--limit 必须是非负整数，收到 ${options.limit}`);
  }
  if (options.mode === "write" && argv.includes("--verify-only") && argv.includes("--write")) {
    throw new Error("--write 与 --verify-only 互斥（后出现的胜出，但请只给一个）");
  }
  return options;
}

/** 连接解析：默认测试库（守卫在建连接之前），给了 DB_* 才连指定库。 */
async function resolveConnection() {
  const envTarget = process.env.DB_NAME;
  if (!envTarget) {
    const ctx = await openTestDatabase();
    if (!ctx) throw new Error(`没给 DB_* 环境变量，也读不到测试库凭据（~/.config/mcp/creds/touwaka-test-db.json）`);
    return { sequelize: ctx.db.sequelize, database: ctx.creds.database, source: "openTestDatabase()" };
  }
  // 显式 DB_* 路径；upgrade-database.js 也读取这些变量，但使用 mysql2/promise 建立连接。
  // 非测试库必须显式确认。
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

async function loadOldRounds(sequelize, { limit, requestId }) {
  const where = [];
  const replacements = {};
  if (requestId) { where.push("request_id = :requestId"); replacements.requestId = requestId; }
  const [rows] = await sequelize.query(`
    SELECT id, request_id, round_no, dedup_key, stop_reason, \`usage\`, folded, folded_range,
           record_json, ts, created_at
      FROM agent_rounds
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY request_id ASC, round_no ASC, id ASC
     ${limit === null ? "" : "LIMIT :limit"}
  `, { replacements: limit === null ? replacements : { ...replacements, limit } });
  return rows;
}

async function childRowsFor(sequelize, requestId) {
  const [messages] = await sequelize.query(`
    SELECT id, role, content, reasoning_content, round_id, sequence_no, meta_json
      FROM messages WHERE request_id = :rid ORDER BY round_id ASC, sequence_no ASC
  `, { replacements: { rid: requestId } });
  const [tools] = await sequelize.query(`
    SELECT tool_use_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at
      FROM chat_tool_calls WHERE request_id = :rid ORDER BY round_id ASC, created_at ASC, tool_use_id ASC
  `, { replacements: { rid: requestId } });
  return { messages, tools };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("用法：node scripts/backfill-transcript-canonical.js [--dry-run|--write|--verify-only] [--limit N] [--request-id <id>] [--report <path>]");
    return;
  }
  const { sequelize, database, source } = await resolveConnection();

  const tableCheck = await sequelize.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { replacements: { table: CANONICAL_TABLE } },
  );
  if (Number(tableCheck[0][0].n) === 0) {
    throw new Error(`${CANONICAL_TABLE} 不存在于 ${database}：请先跑 node scripts/upgrade-database.js --step "#1156 Stage A"（输出别接 head）`);
  }

  const [beforeCount] = await sequelize.query(`SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\``);
  const canonicalBefore = Number(beforeCount[0].n);

  const oldRounds = options.mode === "verify-only" ? [] : await loadOldRounds(sequelize, options);

  // 回填（--write 才真写；--dry-run 只统计将要写多少）
  let written = 0;
  let ignored = 0;
  if (options.mode === "write") {
    for (const old of oldRounds) {
      const { messages, tools } = await childRowsFor(sequelize, old.request_id);
      const record = assembleRoundRecord(
        old,
        messages.filter((row) => row.round_id === old.id),
        tools.filter((row) => row.round_id === old.id),
      );
      // 与 appendRound 同一套：整份 record 原样 stringify + INSERT IGNORE 先到先得
      const { affectedRows } = await insertCanonicalRound({
        sequelize, runId: old.request_id, record, dedupKey: old.dedup_key,
        id: newCanonicalRoundId(), now: new Date(),
      });
      if (affectedRows > 0) written += 1; else ignored += 1;
    }
  }
  const planned = options.mode === "dry-run" ? oldRounds.length : 0;

  // 全量逐轮比对：旧侧重建 vs 新表 record_json（verify-only 也要跑，所以这里独立取旧行）
  const roundsToCompare = options.mode === "verify-only"
    ? await loadOldRounds(sequelize, options)
    : oldRounds;
  const entries = [];
  const childCache = new Map();
  for (const old of roundsToCompare) {
    if (!childCache.has(old.request_id)) childCache.set(old.request_id, await childRowsFor(sequelize, old.request_id));
    const { messages, tools } = childCache.get(old.request_id);
    const rebuilt = assembleRoundRecord(
      old,
      messages.filter((row) => row.round_id === old.id),
      tools.filter((row) => row.round_id === old.id),
    );
    const [canonicalRows] = await sequelize.query(
      `SELECT id, record_json FROM \`${CANONICAL_TABLE}\` WHERE dedup_key = :key`,
      { replacements: { key: old.dedup_key } },
    );
    const oldHash = normalizedHash(rebuilt);
    const newHash = canonicalRows.length > 0 ? normalizedHash(JSON.parse(canonicalRows[0].record_json)) : null;
    const diffPaths = canonicalRows.length > 0
      ? normalizedDiffPaths(canonicalize(rebuilt), canonicalize(JSON.parse(canonicalRows[0].record_json)))
      : ["<canonical 缺行>"];
    entries.push({
      request_id: old.request_id,
      round_no: old.round_no,
      dedup_key: old.dedup_key,
      old_side: {
        agent_rounds_id: old.id,
        canonical_row_count: canonicalRows.length,
        message_rows: messages.filter((row) => row.round_id === old.id).length,
        tool_call_rows: tools.filter((row) => row.round_id === old.id).length,
        normalized_hash: oldHash,
      },
      new_side: {
        canonical_id: canonicalRows[0]?.id ?? null,
        canonical_row_count: canonicalRows.length,
        normalized_hash: newHash,
      },
      match: canonicalRows.length === 1 && oldHash === newHash,
      diff_paths: diffPaths,
    });
  }

  const [afterCount] = await sequelize.query(`SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\``);
  const [orphanCanonical] = await sequelize.query(`
    SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\` c
     WHERE NOT EXISTS (SELECT 1 FROM agent_rounds a WHERE a.dedup_key = c.dedup_key)
  `);

  const mismatched = entries.filter((entry) => !entry.match);
  const report = {
    generated_at: new Date().toISOString(),
    database,
    connection_source: source,
    mode: options.mode,
    filters: { limit: options.limit, request_id: options.requestId },
    canonical_table: CANONICAL_TABLE,
    normalization: {
      algorithm: "递归剔除易变键 + 对象键名排序后 JSON.stringify，sha256 取前 16 位",
      stripped_keys: VOLATILE_KEYS,
    },
    totals: {
      old_rounds_compared: entries.length,
      rounds_planned_to_write: planned,
      rounds_written: written,
      rounds_ignored_existing: ignored,
      rounds_matched: entries.length - mismatched.length,
      rounds_mismatched: mismatched.length,
      rounds_missing_in_canonical: mismatched.filter((entry) => entry.new_side.canonical_row_count === 0).length,
      canonical_rows_before: canonicalBefore,
      canonical_rows_after: Number(afterCount[0].n),
      canonical_rows_without_old_counterpart: Number(orphanCanonical[0].n),
    },
    mismatches: mismatched,
    rounds: entries,
  };

  const reportPath = path.resolve(process.cwd(), options.reportPath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log([
    `[#1156 Stage B 回填/比对] 库=${database} 模式=${options.mode}`,
    `  旧轮比对   : ${report.totals.old_rounds_compared} 轮`,
    `  将要写入   : ${planned} 轮（dry-run 不写）`,
    `  实际写入   : ${written} 轮 / 已存在忽略 ${ignored} 轮`,
    `  一致       : ${report.totals.rounds_matched} 轮`,
    `  不一致     : ${report.totals.rounds_mismatched} 轮（其中 canonical 缺行 ${report.totals.rounds_missing_in_canonical}）`,
    `  canonical  : ${canonicalBefore} → ${report.totals.canonical_rows_after} 行；无旧行对应的 ${report.totals.canonical_rows_without_old_counterpart} 行`,
    `  报告       : ${reportPath}`,
  ].join("\n"));
  for (const entry of mismatched.slice(0, 20)) {
    console.log(`  ! ${entry.request_id} round=${entry.round_no} dedup_key=${entry.dedup_key} 差异=${entry.diff_paths.join(",")}`);
  }
  if (mismatched.length > 20) console.log(`  ! …另有 ${mismatched.length - 20} 条不一致，见报告文件`);

  await sequelize.close();
  // 有不一致就非零退出，方便主 agent 把回填当闸门用
  if (mismatched.length > 0) process.exitCode = 3;
}

await main();
