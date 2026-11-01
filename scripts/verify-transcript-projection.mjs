/**
 * issue #1227 阶段 3 切片 C1 —— **投影可重建：对账器 + 孤儿检测 + 基线统计**（默认 dry-run，纯只读）
 *
 * 做什么（三件事 + 基线）
 *   ① canonical → 投影重建对账：以 `agent_transcript_rounds.record_json`（引擎面唯一真相）为准，
 *      用 `agent_rounds` 的生成列 `kind` / `seq` / `part_of` 取载体行与消息行，按**写侧同一份**
 *      推导（`buildAgentRoundRecordSnapshot` / `projectMessageRow` / `foldMessageRows`）重建
 *      “应有投影”，与盘上实际逐格比对，差异**分类**输出（`PROJECTION_DIFF_KINDS`）。
 *   ② 孤儿检测：`chat_tool_calls` 里找不到宿主轮的行；轮已完成但 `result_json IS NULL` 的工具行
 *      （canonical 有结果 ⇒ 真丢正文；canonical 没有 ⇒ 引擎未 settle，仅计数）。
 *   ③ legacy 差异探针：同一请求分别按现网 `legacy` 读法与「只取载体行装配」装配，报告条数 /
 *      形状 / 正文长度差，给 C2 当靶子。**不改运行时**。
 *   ④ 基线统计：每请求行数 / 每轮行数比 / `SUM(CHAR_LENGTH(record_json))`，以及
 *      `information_schema.TABLES` 的 `DATA_LENGTH / INDEX_LENGTH`。
 *
 * 用法
 *   node scripts/verify-transcript-projection.mjs --request-id <id> [--request-id <id> ...]
 *   node scripts/verify-transcript-projection.mjs --since 2026-10-31 --limit 20
 *   node scripts/verify-transcript-projection.mjs --request-id <id> --explain
 *   node scripts/verify-transcript-projection.mjs --request-id <id> --json --report temp/projection.json
 *   node scripts/verify-transcript-projection.mjs --request-id <id> --apply     # 仅非生产库
 *
 * 退出码
 *   0 = 无缺陷（只剩 `host_enriched_reasoning` 这类“非投影缺陷”的信息项，或 legacy 探针的
 *       块顺序差）
 *   3 = 有真差异（对账 diff / 孤儿 / 丢正文）
 *   1 = 用法 / 连接 / `--apply` 被拒
 *
 * 连哪个库（与 scripts/verify-transcript-read-parity.js 同约定）
 *   - 默认（没给 DB_*）：走 `tests/helpers/test-db-guard.mjs` 的 `openTestDatabase()`，建连接之前
 *     先硬断言目标库在测试库白名单里（issue #1167），只会是 `llm_kit_test`。
 *   - 指定库（主 agent 跑生产只读核对）：给 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`，且
 *     **必须**同时给 `ALLOW_NON_TEST_DB=1` 显式确认，否则被守卫拦下。
 *   - `--apply` **额外**要求目标库名明确且 `!== touwaka_mate`（生产库一律拒绝，exit 1）。
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
  PRODUCTION_DATABASE_NAME,
  PROJECTION_DIFF_KINDS,
  assertProjectionApplyAllowed,
  collectBaselineStats,
  detectOrphans,
  explainReconcileQueries,
  probeLegacyVsCarrierOnly,
  projectRequest,
  reconcileRequest,
} = await import("../lib/llm-kit-adapters/transcript-projection.js");
const { CANONICAL_TABLE } = await import("../lib/llm-kit-adapters/transcript-store.js");
const { openTestDatabase, assertTestDatabase, ALLOW_ENV_VAR } = await import(
  "../tests/helpers/test-db-guard.mjs"
);

const DEFAULT_REPORT_PATH = "temp/verify-transcript-projection.json";

/** 「非投影缺陷」的信息项：不触发 exit=3（但照旧列出来，不静默）。 */
export const INFORMATIONAL_DIFF_KINDS = Object.freeze(["host_enriched_reasoning"]);

export function parseArgs(argv) {
  const options = {
    requestIds: [],
    since: null,
    limit: null,
    apply: false,
    json: false,
    explain: false,
    skipProbe: false,
    reportPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--request-id") options.requestIds.push(String(next()));
    else if (arg === "--since") options.since = String(next());
    else if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--explain") options.explain = true;
    else if (arg === "--no-probe") options.skipProbe = true;
    else if (arg === "--report") options.reportPath = String(next());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}（--help 看用法）`);
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new Error(`--limit 必须是非负整数，收到 ${options.limit}`);
  }
  if (options.since !== null && Number.isNaN(new Date(options.since).getTime())) {
    throw new Error(`--since 必须是可解析的日期，收到 ${options.since}`);
  }
  return options;
}

/** 连接解析：与 backfill / parity 脚本同一套约定（默认测试库，DB_* + ALLOW_NON_TEST_DB 才连别的库）。 */
export async function resolveConnection() {
  const envTarget = process.env.DB_NAME;
  if (!envTarget) {
    const ctx = await openTestDatabase();
    if (!ctx) {
      throw new Error("没给 DB_* 环境变量，也读不到测试库凭据（~/.config/mcp/creds/touwaka-test-db.json）");
    }
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

/** 候选 request_id：canonical 与投影的并集（只有一侧有行的会话也要进报告）。 */
export async function listRequestIds(sequelize, { requestIds, since, limit }) {
  if (requestIds.length > 0) return requestIds;
  const where = since ? "WHERE created_at >= :since" : "";
  const replacements = since ? { since: new Date(since) } : {};
  const [rows] = await sequelize.query(`
    SELECT request_id, MAX(created_at) AS last_created
      FROM (
        SELECT request_id, created_at FROM agent_rounds ${where}
        UNION ALL
        SELECT request_id, created_at FROM ${CANONICAL_TABLE} ${where}
      ) t
     GROUP BY request_id
     ORDER BY last_created DESC, request_id ASC
     ${limit === null ? "" : "LIMIT :limit"}
  `, { replacements: limit === null ? replacements : { ...replacements, limit } });
  return rows.map((row) => row.request_id);
}

/** 一个请求的完整报告（dry-run 分支：只有 SELECT）。 */
export async function inspectRequest({ sequelize, runId, options = {}, requestContext = {} }) {
  const reconciliation = await reconcileRequest({ sequelize, runId, requestContext });
  const orphans = await detectOrphans({ sequelize, runId });
  const probe = options.skipProbe
    ? null
    : await probeLegacyVsCarrierOnly({ sequelize, runId, requestContext, logger });
  const explain = options.explain ? await explainReconcileQueries({ sequelize, runId }) : null;
  return { runId, reconciliation, orphans, probe, explain };
}

export function isRealDefect(entry) {
  const realDiffs = entry.reconciliation.diffs.filter(
    (item) => !INFORMATIONAL_DIFF_KINDS.includes(item.kind),
  );
  const realOrphans = entry.orphans.orphanToolRows.length
    + entry.orphans.completedRoundsWithNullResult.filter((row) => row.kind === "tool_result_missing").length;
  return realDiffs.length > 0 || realOrphans > 0;
}

function formatDiffLine(item) {
  const where = [item.table, item.dedupKey, item.sequenceNo === undefined ? "" : `#${item.sequenceNo}`,
    item.toolUseId ?? ""].filter(Boolean).join(" ");
  const detail = item.fields?.length ? ` fields=${item.fields.join(",")}` : "";
  return `    - [${item.kind}] ${item.label} ${where}${detail}`;
}

/** 人类可读报告（逐请求）。 */
export function renderRequest(entry) {
  const { runId, reconciliation, orphans, probe } = entry;
  const stats = reconciliation.stats;
  const lines = [];
  lines.push(`== ${runId}`);
  lines.push(
    `  canonical ${stats.canonical_rows} 行（载体 ${stats.canonical_carriers} / 消息行 ${stats.canonical_message_rows}）`
    + ` → 投影 agent_rounds ${stats.projection_rows} 行（载体 ${stats.projection_carriers} / 消息行 ${stats.projection_message_rows}`
    + `${stats.projection_other_rows > 0 ? ` / 其它 ${stats.projection_other_rows}` : ""}）`
    + `；messages ${stats.messages_rows} 行（宿主行 ${stats.host_written_message_rows}）；工具 ${stats.tool_rows} 行`
    + `；${stats.rounds} 轮，${stats.rows_per_round} 行/轮`,
  );
  if (reconciliation.diffs.length === 0) {
    lines.push("  对账：✅ 无差异（canonical 可完整重建投影）");
  } else {
    const real = reconciliation.diffs.filter((item) => !INFORMATIONAL_DIFF_KINDS.includes(item.kind));
    lines.push(`  对账：${real.length === 0 ? "✅ 无缺陷差异" : `❌ ${real.length} 条缺陷差异`}`
      + `（分类：${Object.entries(reconciliation.counts).map(([kind, count]) => `${kind}×${count}`).join(", ")}）`);
    for (const item of reconciliation.diffs) lines.push(formatDiffLine(item));
  }
  const orphanTotal = orphans.orphanToolRows.length + orphans.completedRoundsWithNullResult.length;
  if (orphanTotal === 0) {
    lines.push("  孤儿：✅ 无");
  } else {
    lines.push(`  孤儿：❌ ${orphans.orphanToolRows.length} 条孤儿工具行；`
      + `${orphans.counts.tool_result_missing} 条丢正文；`
      + `${orphans.counts.tool_result_pending} 条结果待补（canonical 也没有结果）`);
    for (const row of orphans.orphanToolRows) {
      lines.push(`    - [orphan_tool_row] ${row.toolUseId} round_id=${row.roundId} name=${row.name}`);
    }
    for (const row of orphans.completedRoundsWithNullResult) {
      lines.push(`    - [${row.kind}] ${row.toolUseId} round=${row.roundNo} name=${row.name}`);
    }
  }
  if (probe) {
    const summarize = (name, side) => {
      const kinds = {};
      for (const item of side.differences) kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
      const detail = Object.entries(kinds).map(([kind, count]) => `${kind}×${count}`).join(", ") || "无";
      return `    ${name}: ${side.candidate_rounds} 轮（canonical ${side.baseline_rounds}），差异 ${side.differences.length} 条 → ${detail}`;
    };
    lines.push(`  legacy 探针（给 C2 的靶子）：`);
    lines.push(summarize("legacy     ", probe.legacy));
    lines.push(summarize("carrier-only", probe.carrier_only));
  }
  return lines.join("\n");
}

export function renderBaseline(baseline) {
  const lines = [];
  lines.push("== 基线统计（写放大口径）");
  lines.push("  request_id\tcanonical_rows\trounds\trows/round\tcanonical_bytes\tagent_rounds_rows\tagent_rounds_bytes\tmessages_rows\ttool_rows");
  for (const row of baseline.perRequest) {
    lines.push([
      `  ${row.request_id}`,
      row.canonical_rows,
      row.rounds,
      row.rows_per_round,
      row.canonical_bytes,
      row.agent_rounds_rows,
      row.agent_rounds_bytes,
      row.messages_rows,
      row.tool_rows,
    ].join("\t"));
  }
  lines.push("  表级 DATA_LENGTH / INDEX_LENGTH（information_schema.TABLES）：");
  for (const table of baseline.tables) {
    lines.push(`    ${table.table_name}\trows=${table.table_rows}\tdata=${table.data_length}\tindex=${table.index_length}`);
  }
  return lines.join("\n");
}

export function renderExplain(explainByRequest) {
  const lines = ["== EXPLAIN（对账取行必须走 idx_agent_rounds_request_kind）"];
  for (const entry of explainByRequest) {
    for (const [label, rows] of [["carriers(kind IS NULL)", entry.explain.carriers],
      ["message_rows(kind='message')", entry.explain.message_rows]]) {
      for (const row of rows) {
        lines.push(`  ${entry.runId} ${label}\ttype=${row.type}\tkey=${row.key}\tkey_len=${row.key_len}\trows=${row.rows}\tExtra=${row.Extra}`);
      }
    }
  }
  return lines.join("\n");
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("用法：node scripts/verify-transcript-projection.mjs "
      + "[--request-id <id> ...] [--since <ISO>] [--limit <n>] [--apply] [--json] [--explain] [--no-probe] [--report <path>]");
    return;
  }

  const { sequelize, database, source } = await resolveConnection();
  // --apply 的库名判据**先于**任何写入（生产库在这里就被拒，exit 1）。
  assertProjectionApplyAllowed({ database, apply: options.apply });

  const runIds = await listRequestIds(sequelize, options);
  if (runIds.length === 0) {
    console.log("没有匹配的 request_id（检查 --request-id / --since / --limit）");
    await sequelize.close();
    return;
  }

  const entries = [];
  const applyResults = [];
  for (const runId of runIds) {
    if (options.apply) {
      const applied = await projectRequest({ sequelize, runId, database, apply: true });
      applyResults.push(applied);
    }
    entries.push(await inspectRequest({ sequelize, runId, options }));
  }
  const baseline = await collectBaselineStats({ sequelize, runIds });

  const report = {
    generated_at: new Date().toISOString(),
    database,
    connection: source,
    mode: options.apply ? "apply" : "dry-run",
    diff_kinds: PROJECTION_DIFF_KINDS,
    requests: entries,
    baseline,
    apply: applyResults,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const entry of entries) console.log(renderRequest(entry));
    console.log(renderBaseline(baseline));
    if (options.explain) {
      console.log(renderExplain(entries.filter((entry) => entry.explain)));
    }
    if (applyResults.length > 0) {
      console.log("== --apply 结果（写入口：projectRequest → applyProjectionWrites）");
      for (const applied of applyResults) {
        console.log(`  ${applied.runId}\tbefore=${applied.diffsBefore.length}\twritten=${JSON.stringify(applied.written)}\tafter=${applied.diffsAfter.length}`);
      }
    }
  }

  if (options.reportPath) {
    const target = path.resolve(options.reportPath || DEFAULT_REPORT_PATH);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (!options.json) console.log(`报告已写入 ${target}`);
  }

  await sequelize.close();
  // 只有**真缺陷**才让闸门红；host_enriched_reasoning 是已知非缺陷（终稿单写增强）。
  if (entries.some(isRealDefect)) process.exitCode = 3;
}

// 只有**直接跑**本文件才执行 main（测试 import 拿工具函数时不能连带跑一轮真比对）。
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(`[verify-transcript-projection] ${error?.message ?? error}`);
    if (error?.code) console.error(`  code=${error.code}`);
    process.exitCode = 1;
  }
}
