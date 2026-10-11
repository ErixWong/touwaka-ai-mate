/**
 * issue #1156 双层闸门 **第①层** — 消息面**行级 SQL 不变式**（只读 SELECT，零写入）
 *
 * 为什么要有这个脚本（与 scripts/verify-transcript-read-parity.js 的分工）
 *   parity 脚本是**深比对**：两侧都调 lib/llm-kit-adapters/transcript-store.js 的同一份
 *   装配逻辑（这是刻意的，脚本自己抄一份装配就等于引入第三份实现、比对结论失去意义）。
 *   代价是一个**已知盲区**：装配本身出错时两边一起瞎——同一份错代码产出的两份结果自然相等。
 *   本次迁移抓到的真实 bug 证明两类工具**不可互替**：
 *     - #1150（旧读法自己发明 ts/folded/dedupKey 字段）、#1196（content[] 块顺序差异）
 *       只有深比对能抓——行级 SQL 看不见"record 里有哪些键、块什么顺序"。
 *     - #1168（chat_tool_calls 孤儿行：round_id 找不到宿主轮，load() 直接丢弃）
 *       **只有独立 SQL 能抓**——孤儿行两侧都被同一句
 *       `WHERE round_id IN (...)` 筛掉，深比对结构上不可能发现它。
 *   所以本脚本刻意**不 import transcript-store 的任何装配函数**：它只查行、只按
 *   "两张表互相之间必须成立的关系"下判据，是**独立第三方视角**。便宜、可常驻、
 *   不依赖读模式，是挂在第②层（深比对）底下的地板。
 *
 * 五条不变式（每条抓的是哪一类 bug 写在各自查表的注释里，也写进报告 JSON；
 * 写不出"抓什么 bug"的判据不许加——条数不是指标）
 *   I1 round_coverage        轮覆盖：agent_rounds 的 (request_id, round_no) ⊇ canonical
 *   I2 orphan_tool_calls     孤儿工具调用：chat_tool_calls.round_id 必须有宿主轮
 *   I3 dedup_key_unique      dedup_key 唯一性（两张轮表各自查）
 *   I4 max_round_equal       每 request 的 MAX(round_no) 两侧相等
 *   I5 message_row_count     展示面 messages 行数 == canonical record 应有的行数
 *
 * 用法
 *   node scripts/check-transcript-sql-invariants.mjs
 *   node scripts/check-transcript-sql-invariants.mjs --limit 20
 *   node scripts/check-transcript-sql-invariants.mjs --request-id <id>
 *   node scripts/check-transcript-sql-invariants.mjs --report temp/invariants.json
 *   退出码：全过 = 0；有违反 = 3（**是闸门信号不是崩**）；用法/连接/表结构错 = 1。
 *
 * 连哪个库（与 scripts/verify-transcript-read-parity.js / backfill-transcript-canonical.js 同约定）
 *   - 默认（没给 DB_*）：走 tests/helpers/test-db-guard.mjs 的 openTestDatabase()，
 *     建连接之前先硬断言目标库在测试库白名单里（issue #1167），只会是 llm_kit_test。
 *   - 指定库（主 agent 跑 dev/生产）：给 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME，
 *     且**必须**同时给 ALLOW_NON_TEST_DB=1 显式确认，否则被守卫拦下。
 *   本脚本全程只读（只有 SELECT），但仍照旧走守卫，不给"手滑指错库"留门。
 *
 * 注意：stdout 是报告，**不要接 `| head`**（管道提前关闭 = SIGPIPE 杀 node，本仓踩过）。
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import logger from "../lib/logger.js";
// logs/ 目录可能非本用户属主：脚本只往 stdout 打报告，不让 logger 写文件失败盖住结果。
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { openTestDatabase, assertTestDatabase, ALLOW_ENV_VAR } = await import("../tests/helpers/test-db-guard.mjs");

const DEFAULT_REPORT_PATH = "temp/check-transcript-sql-invariants.json";

/** 涉及的四张表（表名/列名已按 information_schema 核实，见 REQUIRED_COLUMNS 的自检）。 */
const DISPLAY_ROUNDS_TABLE = "agent_rounds";
const CANONICAL_ROUNDS_TABLE = "agent_transcript_rounds";
const TOOL_CALLS_TABLE = "chat_tool_calls";
const MESSAGES_TABLE = "messages";

/**
 * 本脚本要读的列。连不上表 / 少列 = **用法层错误直接 exit 1**，不能让"库根本没升级"
 * 冒充成"不变式被违反"（否则报告里的红色毫无意义）。列名以 information_schema 为准。
 */
const REQUIRED_COLUMNS = {
  [DISPLAY_ROUNDS_TABLE]: ["id", "request_id", "round_no", "dedup_key"],
  [CANONICAL_ROUNDS_TABLE]: ["id", "request_id", "round_no", "dedup_key", "record_json"],
  [TOOL_CALLS_TABLE]: ["tool_use_id", "request_id", "round_id"],
  [MESSAGES_TABLE]: ["id", "round_id", "sequence_no"],
};

/** 每条不变式抓的是哪一类 bug（写进报告 JSON，便于事后追问"这条凭什么存在"）。 */
export const INVARIANTS = [
  {
    id: "I1",
    key: "round_coverage",
    title: "轮覆盖：agent_rounds 的 (request_id, round_no) 必须 ⊇ canonical",
    catches:
      "backfill 漏轮 / 写侧只写了一张表：某轮在展示面有行、canonical 没有，切到 new 读档后这一轮"
      + "从档案里凭空消失（引擎 resume 少一轮上下文）。深比对看不见：它按 dedupKey 对齐两侧，"
      + "一侧缺行只会报成「该轮差异」，报不出「canonical 少了一整轮」这个方向性结论。",
  },
  {
    id: "I2",
    key: "orphan_tool_calls",
    title: "孤儿工具调用：chat_tool_calls.round_id 必须指向本会话一行 agent_rounds",
    catches:
      "#1168 那一类：写侧事务半失败 / crash 后遗留 / 轮行被删，留下 round_id 找不到宿主轮的 tool 行。"
      + "load() 按 row.round_id === round.id 逐轮筛，孤儿行既不挂轮也不报错（只打告警），"
      + "深比对**结构上看不见**它——两侧都用同一句 WHERE round_id IN (...) 把它筛掉了。"
      + "顺带钉住「宿主轮存在但属于别的 request」：那种行同样取不回来，等价于孤儿。",
  },
  {
    id: "I3",
    key: "dedup_key_unique",
    title: "dedup_key 唯一性：两张轮表各自按 dedup_key 分组，重复组必须为 0",
    catches:
      "并发去重竞态（Stage D 已加 ERR_TRANSCRIPT_DEDUP_RACE 守卫）。唯一索引是「这个库到底有没有"
      + "那道护栏」的运行时事实，不能拿建表脚本当保证：升级步骤没跑全、或库里存在索引建立之前的"
      + "存量重复行时，同一轮会落两份，load() 就多一轮重复内容、loadByDedupKey 命中哪份看扫描顺序。"
      + "本条不依赖索引存在，直接数行——常驻探针。",
  },
  {
    id: "I4",
    key: "max_round_equal",
    title: "每 request 的 MAX(round_no) 两侧相等（含只有一侧有行的情况）",
    catches:
      "两张表都在写，某侧漏写最后一轮、或写了不该写的轮（例如把 appendUserTurn 预写行只落了一边），"
      + "表现就是两侧最大轮号不等。I1 只管 (request_id, round_no) 的**包含**方向，管不到「canonical"
      + "多出整轮/整会话」的方向；本条从另一侧把口子闭上，并顺带抓「某会话只有一张表有行」。",
  },
  {
    id: "I5",
    key: "message_row_count",
    title: "messages 行数 == canonical record 按拆行判据应有的行数",
    catches:
      "拆行半失败 / 写重 / 种子轮被误拆：canonical 里那一轮有 N 条会产行的 message，展示面 messages"
      + "却只有 M 行。new 读档（读 canonical）看得见、legacy 读档（读展示面）看不见，切档时前端"
      + "少一条气泡而深比对只在**切档之后**才比得出来。判据见 expectedRowsForRecord 的注释。",
  },
];

/** 单条不变式在报告里最多列多少条违反明细（超出只报总数，报告不撑爆）。 */
const MAX_VIOLATIONS_IN_REPORT = 50;
const MAX_ROUND_DETAIL_IN_REPORT = 10;

// ==================== 工具 ====================

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
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

/** 连接解析：与 parity / backfill 脚本同一套约定（默认测试库，DB_* + ALLOW_NON_TEST_DB 才连别的库）。 */
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

/** 表/列自检：缺表缺列是**环境问题**（exit 1），不许冒充成不变式违反（exit 3）。 */
async function assertSchema(sequelize) {
  const tables = Object.keys(REQUIRED_COLUMNS);
  const [rows] = await sequelize.query(
    `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (:tables)`,
    { replacements: { tables } },
  );
  const have = new Map();
  for (const row of rows) {
    if (!have.has(row.TABLE_NAME)) have.set(row.TABLE_NAME, new Set());
    have.get(row.TABLE_NAME).add(row.COLUMN_NAME);
  }
  const missing = [];
  for (const table of tables) {
    const columns = have.get(table);
    if (!columns) {
      missing.push(`${table}（表不存在）`);
      continue;
    }
    for (const column of REQUIRED_COLUMNS[table]) {
      if (!columns.has(column)) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `缺少表/列：${missing.join(", ")} —— 本脚本要求的列名以 information_schema 为准；`
      + "先跑 node scripts/upgrade-database.js 把库升到位（输出别接 head）",
    );
  }
}

/**
 * 候选 request_id：两张轮表的并集，按 request_id 升序（**不用 ORDER BY id**：
 * 本库 9/13 之前的 id 是旧替换式混淆、字典序不保序，见 parity 脚本同款取数）。
 * --request-id 给了就直接用它，不再查候选表。
 */
async function listRequestIds(sequelize, { limit, requestId }) {
  if (requestId) return [requestId];
  const [rows] = await sequelize.query(`
    SELECT request_id FROM (
      SELECT request_id FROM \`${DISPLAY_ROUNDS_TABLE}\`
      UNION
      SELECT request_id FROM \`${CANONICAL_ROUNDS_TABLE}\`
    ) t
    GROUP BY request_id
    ORDER BY request_id ASC
    ${limit === null ? "" : "LIMIT :limit"}
  `, { replacements: limit === null ? {} : { limit } });
  return rows.map((row) => row.request_id);
}

/** 把 request 集合变成可复用的作用域片段：null = 全库不加 WHERE。 */
function scope(column, requestIds) {
  if (requestIds === null) return { sql: "", replacements: {} };
  if (requestIds.length === 0) return { sql: "AND FALSE", replacements: {} };
  return { sql: `AND ${column} IN (:__scope)`, replacements: { __scope: requestIds } };
}

// ==================== I5 的判据（唯一与写侧共享语义的地方） ====================

/**
 * canonical record 的 messages 拆行后**应该**产生几行 messages。
 *
 * 判据来源：lib/llm-kit-adapters/transcript-store.js 的 messageRowFor()（写侧唯一的拆行入口，
 * 约 215-277 行），逐条对齐，不是凭猜：
 *   - `text` 块 → textParts；`reasoning` 块 → reasoningParts（text ?? reasoning ?? ""）；
 *     `image` / `multimodal` 块 → multimodalBlocks（multimodal 会摊开内层 content）。
 *   - **`tool_use` / `tool_result` 块不进 messages 行**（进 chat_tool_calls）。
 *   - content = multimodal 信封 ?? 拼接后的 text；两者皆空 → content === null。
 *   - content === null 时：**reasoning 拼接后也为空才 return null（不插行）**；
 *     只有 reasoning 的轮写空串 content（messages.content 是 NOT NULL，真机缺陷修出来的分支）。
 *   所以产行判据 = 拼接后 text 非空 **或** 有 image/multimodal 块 **或** 拼接后 reasoning 非空。
 *   一条 message 至多一行（多块会被拼进同一行），sequence_no = 该 message 在 record.messages 的下标。
 *
 * 种子轮（round_no === 0）例外：appendRound 对 round 0 **整轮跳过拆行**（其 messages 是完整初始
 * 上下文，照常拆行会让每跑一次 run 多出一整套历史副本），所以期望恒为 0 行。
 *
 * 这是本脚本与写侧唯一共享的语义。刻意不在这里 import 装配代码（第①层的价值就是独立视角），
 * 代价是"写侧改了判据而这里没跟上"的风险——由 tests/transcript-sql-invariants.test.mjs 里
 * "真调 appendRound 落库再跑不变式"的那条用例钉住：判据漂了那条用例就红。
 */
function expectedRowsForRecord(record) {
  const messages = Array.isArray(record?.messages) ? record.messages : [];
  let rows = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const blocks = Array.isArray(message.content)
      ? message.content
      : (typeof message.content === "string" ? [{ type: "text", text: message.content }] : []);
    let text = "";
    let reasoning = "";
    let hasMedia = false;
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text") text += String(block.text ?? "");
      else if (block.type === "reasoning") reasoning += String(block.text ?? block.reasoning ?? "");
      else if (block.type === "image" || block.type === "multimodal") hasMedia = true;
      // tool_use / tool_result：不进 messages 行
    }
    // 与写侧一致：多块拼进同一行，所以 reasoning 的分隔符不影响"是否产行"
    if (text !== "" || hasMedia || reasoning !== "") rows += 1;
  }
  return rows;
}

// ==================== 五条查表 ====================

/** I1 轮覆盖 */
async function checkRoundCoverage(sequelize, requestIds) {
  const where = scope("d.request_id", requestIds);
  const [rows] = await sequelize.query(`
    SELECT d.request_id AS request_id, d.round_no AS round_no,
           GROUP_CONCAT(d.dedup_key ORDER BY d.dedup_key SEPARATOR '|') AS dedup_keys
      FROM \`${DISPLAY_ROUNDS_TABLE}\` d
      LEFT JOIN \`${CANONICAL_ROUNDS_TABLE}\` c
        ON c.request_id = d.request_id AND c.round_no = d.round_no
     WHERE c.id IS NULL ${where.sql}
     GROUP BY d.request_id, d.round_no
     ORDER BY d.request_id ASC, d.round_no ASC
  `, { replacements: where.replacements });
  return rows.map((row) => ({
    request_id: row.request_id,
    round_no: Number(row.round_no),
    dedup_keys: String(row.dedup_keys ?? "").split("|").filter(Boolean),
    detail: `展示面有 round_no=${row.round_no}，canonical 无该轮任何行`,
  }));
}

/** I2 孤儿工具调用 */
async function checkOrphanToolCalls(sequelize, requestIds) {
  const where = scope("t.request_id", requestIds);
  const [rows] = await sequelize.query(`
    SELECT t.tool_use_id AS tool_use_id, t.request_id AS request_id, t.round_id AS round_id,
           t.name AS name, h.request_id AS host_request_id
      FROM \`${TOOL_CALLS_TABLE}\` t
      LEFT JOIN \`${DISPLAY_ROUNDS_TABLE}\` h ON h.id = t.round_id
     WHERE (h.id IS NULL OR h.request_id <> t.request_id) ${where.sql}
     ORDER BY t.request_id ASC, t.created_at ASC, t.tool_use_id ASC
  `, { replacements: where.replacements });
  return rows.map((row) => ({
    request_id: row.request_id,
    tool_use_id: row.tool_use_id,
    round_id: row.round_id,
    name: row.name,
    host_request_id: row.host_request_id ?? null,
    detail: row.host_request_id === undefined || row.host_request_id === null
      ? "round_id 在 agent_rounds 里找不到宿主轮（#1168 形态：load() 静默丢弃）"
      : `宿主轮存在但属于 request_id=${row.host_request_id}，本会话取不回来`,
  }));
}

/** I3 dedup_key 唯一性（两张轮表各自查） */
async function checkDedupKeyUnique(sequelize, requestIds) {
  const violations = [];
  for (const table of [DISPLAY_ROUNDS_TABLE, CANONICAL_ROUNDS_TABLE]) {
    const where = scope("request_id", requestIds);
    const [rows] = await sequelize.query(`
      SELECT dedup_key, COUNT(*) AS n, GROUP_CONCAT(id ORDER BY id SEPARATOR '|') AS ids,
             GROUP_CONCAT(DISTINCT request_id ORDER BY request_id SEPARATOR '|') AS request_ids
        FROM \`${table}\`
       ${where.sql === "" ? "" : `WHERE ${where.sql.replace(/^AND /, "")}`}
       GROUP BY dedup_key
      HAVING COUNT(*) > 1
       ORDER BY COUNT(*) DESC, dedup_key ASC
    `, { replacements: where.replacements });
    for (const row of rows) {
      violations.push({
        table,
        dedup_key: row.dedup_key,
        copies: Number(row.n),
        round_ids: String(row.ids ?? "").split("|").filter(Boolean),
        // dedup_key 全局唯一，同一 dedup_key 只可能属于一个 request；留数组以防库里本来就有脏行
        request_id: String(row.request_ids ?? "").split("|").filter(Boolean)[0] ?? null,
        request_ids: String(row.request_ids ?? "").split("|").filter(Boolean),
        detail: `${table} 里 dedup_key=${row.dedup_key} 有 ${row.n} 行`,
      });
    }
  }
  return violations;
}

/** I4 每 request 的 MAX(round_no) 两侧相等 */
async function checkMaxRoundEqual(sequelize, requestIds) {
  const where = scope("request_id", requestIds);
  const [rows] = await sequelize.query(`
    SELECT u.request_id AS request_id,
           MAX(CASE WHEN u.src = 'display' THEN u.round_no END) AS display_max,
           MAX(CASE WHEN u.src = 'canonical' THEN u.round_no END) AS canonical_max,
           SUM(u.src = 'display') AS display_rows,
           SUM(u.src = 'canonical') AS canonical_rows
      FROM (
        SELECT request_id, round_no, 'display' AS src FROM \`${DISPLAY_ROUNDS_TABLE}\` ${where.sql ? `WHERE ${where.sql.slice(4)}` : ""}
        UNION ALL
        SELECT request_id, round_no, 'canonical' AS src FROM \`${CANONICAL_ROUNDS_TABLE}\` ${where.sql ? `WHERE ${where.sql.slice(4)}` : ""}
      ) u
     GROUP BY u.request_id
     ORDER BY u.request_id ASC
  `, { replacements: where.replacements });
  const violations = [];
  for (const row of rows) {
    const displayMax = row.display_max === null ? null : Number(row.display_max);
    const canonicalMax = row.canonical_max === null ? null : Number(row.canonical_max);
    if (displayMax === canonicalMax) continue;
    const presentSide = displayMax === null ? "canonical" : "display";
    const absentSide = displayMax === null ? "display" : "canonical";
    violations.push({
      request_id: row.request_id,
      display_max_round_no: displayMax,
      canonical_max_round_no: canonicalMax,
      display_rows: Number(row.display_rows),
      canonical_rows: Number(row.canonical_rows),
      detail: displayMax === null || canonicalMax === null
        ? `只有 ${presentSide} 侧有该会话的行，${absentSide} 侧 0 行（MAX(round_no) 一侧为 NULL）`
        : `MAX(round_no) 两侧不等：展示面 ${displayMax} vs canonical ${canonicalMax}`,
    });
  }
  return violations;
}

/** I5 messages 行数 == canonical record 应有行数 */
async function checkMessageRowCount(sequelize, requestIds) {
  const canonicalWhere = scope("request_id", requestIds);
  const [canonicalRows] = await sequelize.query(`
    SELECT request_id, round_no, dedup_key, record_json
      FROM \`${CANONICAL_ROUNDS_TABLE}\`
     ${canonicalWhere.sql ? `WHERE ${canonicalWhere.sql.slice(4)} AND round_no <> 0` : "WHERE round_no <> 0"}
     ORDER BY request_id ASC, round_no ASC, dedup_key ASC
  `, { replacements: canonicalWhere.replacements });

  const displayWhere = scope("request_id", requestIds);
  const [displayRows] = await sequelize.query(`
    SELECT id, request_id, round_no, dedup_key
      FROM \`${DISPLAY_ROUNDS_TABLE}\`
     ${displayWhere.sql ? `WHERE ${displayWhere.sql.slice(4)}` : ""}
     ORDER BY request_id ASC, round_no ASC, id ASC
  `, { replacements: displayWhere.replacements });

  // messages.round_id 只在 round 行存在时才有意义，按展示面轮 id 分片取行数
  const displayIds = displayRows.map((row) => row.id);
  const actualByRound = new Map();
  for (const ids of chunk(displayIds, 500)) {
    const [countRows] = await sequelize.query(`
      SELECT round_id, COUNT(*) AS n FROM \`${MESSAGES_TABLE}\`
       WHERE round_id IN (:ids)
       GROUP BY round_id
    `, { replacements: { ids } });
    for (const row of countRows) actualByRound.set(row.round_id, Number(row.n));
  }

  const byRequest = new Map();
  const ensure = (requestId) => {
    if (!byRequest.has(requestId)) byRequest.set(requestId, { expected: 0, actual: 0, rounds: new Map(), notes: [] });
    return byRequest.get(requestId);
  };
  const touchRound = (entry, key, seed = {}) => {
    if (!entry.rounds.has(key)) entry.rounds.set(key, { dedup_key: key, expected: 0, actual: 0, ...seed });
    return entry.rounds.get(key);
  };

  for (const row of canonicalRows) {
    const entry = ensure(row.request_id);
    let expected = 0;
    let note = null;
    let record = null;
    try {
      record = typeof row.record_json === "string" ? JSON.parse(row.record_json) : row.record_json;
    } catch (error) {
      note = `record_json 解析失败（${error.message}）：无法算出期望行数`;
    }
    if (note === null) expected = expectedRowsForRecord(record);
    const bucket = touchRound(entry, row.dedup_key, { round_no: Number(row.round_no) });
    bucket.expected += expected;
    entry.expected += expected;
    if (note !== null) {
      bucket.note = note;
      entry.notes.push(`${row.dedup_key}: ${note}`);
    }
  }
  for (const row of displayRows) {
    const entry = ensure(row.request_id);
    const actual = actualByRound.get(row.id) ?? 0;
    entry.actual += actual;
    const bucket = touchRound(entry, row.dedup_key, { round_no: Number(row.round_no) });
    bucket.actual += actual;
    if (Number(row.round_no) === 0 && actual > 0) {
      bucket.note = "round_no=0 是种子轮，写侧整轮跳过拆行，展示面不该有 messages 行";
    }
  }

  const violations = [];
  for (const [requestId, entry] of [...byRequest.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (entry.expected === entry.actual && entry.notes.length === 0) continue;
    const roundDetails = [...entry.rounds.values()]
      .filter((round) => round.expected !== round.actual || round.note)
      .sort((a, b) => (a.round_no - b.round_no) || (a.dedup_key < b.dedup_key ? -1 : 1))
      .map((round) => ({
        dedup_key: round.dedup_key,
        round_no: round.round_no ?? null,
        expected_messages_rows: round.expected,
        actual_messages_rows: round.actual,
        note: round.note ?? (round.actual === 0 ? "展示面无该轮 messages 行" : null),
      }));
    violations.push({
      request_id: requestId,
      expected_messages_rows: entry.expected,
      actual_messages_rows: entry.actual,
      mismatched_rounds: roundDetails.length,
      rounds: roundDetails.slice(0, MAX_ROUND_DETAIL_IN_REPORT),
      detail: `期望 ${entry.expected} 行 messages（按拆行判据），实际 ${entry.actual} 行`,
    });
  }
  return violations;
}

export const CHECKS = {
  round_coverage: checkRoundCoverage,
  orphan_tool_calls: checkOrphanToolCalls,
  dedup_key_unique: checkDedupKeyUnique,
  max_round_equal: checkMaxRoundEqual,
  message_row_count: checkMessageRowCount,
};

/**
 * 跑全套不变式。只读：整个函数里只有 SELECT。
 * @param {object} sequelize
 * @param {{requestIds?: string[]|null}} [options] null = 全库
 * @returns {Promise<{invariants: object[], totals: object}>}
 */
export async function runInvariants(sequelize, { requestIds = null } = {}) {
  const results = [];
  for (const meta of INVARIANTS) {
    const violations = await CHECKS[meta.key](sequelize, requestIds);
    const truncated = violations.length > MAX_VIOLATIONS_IN_REPORT;
    results.push({
      id: meta.id,
      key: meta.key,
      title: meta.title,
      catches: meta.catches,
      pass: violations.length === 0,
      violation_count: violations.length,
      violations: violations.slice(0, MAX_VIOLATIONS_IN_REPORT),
      violations_truncated: truncated,
      violations_total: violations.length,
    });
  }
  return {
    invariants: results,
    totals: {
      invariants_checked: results.length,
      invariants_violated: results.filter((item) => !item.pass).length,
      violations_total: results.reduce((sum, item) => sum + item.violation_count, 0),
    },
  };
}

function requestScopeLine(options, requestIds) {
  if (options.requestId) return `指定 request_id=${options.requestId}`;
  if (options.limit !== null) return `按 request_id 升序取前 ${options.limit} 个（--limit）`;
  return "全库（未加 --limit / --request-id）";
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("用法：node scripts/check-transcript-sql-invariants.mjs [--limit N] [--request-id <id>] [--report <path>]");
    console.log("退出码：全过 0 / 有违反 3（闸门信号）/ 用法·连接·表结构错 1");
    return;
  }

  const { sequelize, database, source } = await resolveConnection();
  await assertSchema(sequelize);
  const requestIds = await listRequestIds(sequelize, options);
  const outcome = await runInvariants(sequelize, { requestIds });

  const violated = outcome.invariants.filter((item) => !item.pass);
  const report = {
    generated_at: new Date().toISOString(),
    database,
    connection_source: source,
    layer: "第①层：行级 SQL 不变式（独立第三方视角，与 scripts/verify-transcript-read-parity.js 的深比对互补）",
    independence: "本脚本不 import lib/llm-kit-adapters/transcript-store.js 的任何装配逻辑；只有 SELECT",
    filters: { limit: options.limit, request_id: options.requestId },
    requests_in_scope: requestIds.length,
    ...outcome,
    exit_code: violated.length > 0 ? 3 : 0,
  };

  const reportPath = path.resolve(process.cwd(), options.reportPath);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log([
    `[#1156 第①层 行级 SQL 不变式] 库=${database} 连接来源=${source}`,
    `  范围       : ${requestScopeLine(options, requestIds)}（${requestIds.length} 个 request）`,
    ...outcome.invariants.map((item) => `  [${item.pass ? "PASS" : "FAIL"}] ${item.id} ${item.key.padEnd(18)} 违反 ${String(item.violation_count).padStart(3)}  —— ${item.title}`),
    `  合计       : ${report.totals.invariants_checked} 条不变式 / 违反 ${report.totals.invariants_violated} 条 / 违反行 ${report.totals.violations_total} 行`,
    `  报告       : ${reportPath}`,
  ].join("\n"));

  for (const item of violated) {
    console.log(`  ! ${item.id} ${item.key}（${item.violation_count} 条${item.violations_truncated ? "，明细截断" : ""}）`);
    for (const violation of item.violations.slice(0, 10)) {
      console.log(`      ${violation.request_id ?? "-"}: ${violation.detail}`);
    }
    if (item.violation_count > 10) console.log(`      …另有 ${item.violation_count - 10} 条，见报告文件`);
  }

  await sequelize.close();
  // 有违反就 exit 3：这是闸门信号，不是崩
  if (violated.length > 0) process.exitCode = 3;
}

// 只有**直接跑**本文件才执行 main（测试 import 拿函数时不能连带跑一轮全库检查）。
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.log(`[#1156 第①层 行级 SQL 不变式] 失败：${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
