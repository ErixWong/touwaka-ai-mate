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
 * 差异三分类（issue #1196）：identical / ordering_only / content_diff
 *   展示面按列重组 record 时把 reasoning 块固定排在 text 块之后，而 canonical 存的是
 *   **引擎原始顺序**。于是「块集合与文字一字不差、只有先后不同」这种差异以前被算成
 *   真差异、与 #1150 那类真回归共用 exit=3，exit code 长期是噪音，真内容回归会被埋掉。
 *   现在分三类：
 *     - identical     ：深比对无差异。
 *     - ordering_only ：深比对**已经报出差异之后**，再单独确认「两侧只是 content[] 元素
 *                       先后不同、块集合与块内容全同」（判据见 classifyIssueKind）。
 *                       排序只用来**解释一个已经报出的差异**，从来不用排序后 stringify
 *                       代替深比对：要不要报差异，判据仍是 canonicalize + 逐路径深比对。
 *     - content_diff  ：其余全部差异（少块 / 多块 / 文字不同 / 键集不同 / 一侧缺行…）。
 *   exit code **只由 content_diff 触发 = 3**；ordering_only 单独计数、单独列明细（哪个
 *   request、哪一轮、哪个块数组、哪两个块换了序），报告 JSON 里三类计数齐备。
 *
 * 用法
 *   node scripts/verify-transcript-read-parity.js                        # 全库
 *   node scripts/verify-transcript-read-parity.js --limit 20
 *   node scripts/verify-transcript-read-parity.js --request-id <id>
 *   node scripts/verify-transcript-read-parity.js --report temp/parity.json
 *   退出码：无 content_diff = 0（哪怕有 ordering_only）；有 content_diff = 3（**是信号不是崩**）；
 *   用法/连接错误 = 1。
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

// ==================== issue #1196：差异归因（**不是**另一种比对） ====================

/**
 * 只把「块数组」按元素排序：已规范化值里挂在 `content` 键下、元素都是带字符串 `type` 的
 * 对象的那些数组（record.messages[].content 与 record.response.content 都算）。
 * 其余一律原样不动。**自下而上**排（先把元素内部排完再排本层），保证元素比的是稳定形。
 *
 * 用途只有一个：给深比对**已经报出**的差异做归因。排完序两边全等 ⇒ 差异**只可能**
 * 出自这些数组的元素先后（排序动不到别的任何东西），因此「块集合与内容全同、仅顺序异」。
 * 它绝不参与「要不要报差异」——报不报只看 normalizedDiffPaths。
 */
export function sortBlockArrays(value, keyName = "") {
  if (Array.isArray(value)) {
    const items = value.map((item) => sortBlockArrays(item, ""));
    const isBlockArray = keyName === "content"
      && items.length > 1
      && items.every((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.type === "string");
    if (!isBlockArray) return items;
    return [...items].sort((left, right) => {
      const a = JSON.stringify(left);
      const b = JSON.stringify(right);
      if (a === b) return 0;
      return a < b ? -1 : 1;
    });
  }
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value)) out[key] = sortBlockArrays(value[key], key);
  return out;
}

/** 块序无关的规范化串：只在深比对报出差异**之后**用于归因。 */
export function stableStringifyIgnoringBlockOrder(value) {
  return JSON.stringify(sortBlockArrays(canonicalize(value)));
}

/**
 * 给一条**已由深比对确认存在差异**的记录对归因（#1196）：
 *   两侧把块数组排序后全等 → ordering_only；否则 content_diff。
 * 一侧缺行（alignRounds 填的字符串标记）永远是 content_diff：少一整轮不是顺序问题。
 * 注意调用方必须已经拿到非空 diff_paths——本函数不会把「无差异」误报成任何一种。
 */
export function classifyIssueKind(legacyValue, newValue) {
  if (typeof legacyValue === "string" || typeof newValue === "string") return "content_diff";
  return stableStringifyIgnoringBlockOrder(legacyValue) === stableStringifyIgnoringBlockOrder(newValue)
    ? "ordering_only"
    : "content_diff";
}

/** 块的人读标签（报告样例用）：type + 正文前段。 */
function blockLabel(block) {
  const type = block && typeof block.type === "string" ? block.type : "?";
  const head = typeof block?.text === "string" ? block.text.replace(/\s+/g, " ").trim().slice(0, 24) : "";
  return head === "" ? type : `${type}(${head}…)`;
}

/** 找出**哪两个块**换了序（按新侧下标的逆序对，最多 3 对）。 */
function swappedBlockPairs(legacyBlocks, newBlocks) {
  const keyOf = (block) => JSON.stringify(block);
  const newIndex = new Map(newBlocks.map((block, index) => [keyOf(block), index]));
  const sequence = legacyBlocks.map((block) => newIndex.get(keyOf(block)) ?? -1);
  const pairs = [];
  for (let i = 0; i < sequence.length && pairs.length < 3; i += 1) {
    for (let j = i + 1; j < sequence.length && pairs.length < 3; j += 1) {
      if (sequence[i] > sequence[j]) {
        pairs.push(`${blockLabel(legacyBlocks[i])} <-> ${blockLabel(legacyBlocks[j])}`);
      }
    }
  }
  return pairs;
}

/**
 * 定位到具体是哪个块数组换了序，产出报告样例：块数组路径 + 两侧块序 + 换了序的块对。
 * 只在 classifyIssueKind 给出 ordering_only 后调用（内容差异时这里的输出无意义）。
 */
export function findBlockOrderDiffs(a, b, base = "", found = [], alreadyCanonical = false) {
  const left = alreadyCanonical ? a : canonicalize(a);
  const right = alreadyCanonical ? b : canonicalize(b);
  if (JSON.stringify(left) === JSON.stringify(right)) return found;
  if (Array.isArray(left) && Array.isArray(right)) {
    const isBlockArray = (base === "content" || base.endsWith(".content"))
      && left.every((block) => block && typeof block === "object" && typeof block.type === "string")
      && right.every((block) => block && typeof block === "object" && typeof block.type === "string");
    if (isBlockArray) {
      const leftKeys = left.map((block) => JSON.stringify(block)).sort().join("\u0000");
      const rightKeys = right.map((block) => JSON.stringify(block)).sort().join("\u0000");
      if (leftKeys === rightKeys) {
        found.push({
          path: base,
          legacy_order: left.map((block) => blockLabel(block)),
          new_order: right.map((block) => blockLabel(block)),
          swapped_pairs: swappedBlockPairs(left, right),
        });
        return found;
      }
    }
    if (left.length === right.length) {
      for (let index = 0; index < left.length; index += 1) {
        findBlockOrderDiffs(left[index], right[index], `${base}[${index}]`, found, true);
      }
    }
    return found;
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      findBlockOrderDiffs(left[key], right[key], base ? `${base}.${key}` : key, found, true);
    }
    return found;
  }
  return found;
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
      // 比对强度一分没降：报不报差异只看 normalizedDiffPaths（逐路径深比对）。
      // classifyIssueKind 是在**已经报出差异之后**做归因（#1196）。
      const paths = normalizedDiffPaths(entry.legacy, entry.new);
      if (paths.length > 0) {
        const kind = classifyIssueKind(entry.legacy, entry.new);
        const issue = {
          method: "load",
          key: entry.key,
          round_no: entry.round_no,
          kind,
          diff_paths: paths,
          legacy_side: stableStringify(entry.legacy).slice(0, 400),
          new_side: stableStringify(entry.new).slice(0, 400),
        };
        if (kind === "ordering_only") {
          issue.block_order_swaps = findBlockOrderDiffs(entry.legacy, entry.new);
        }
        issues.push(issue);
      }
    }

    if (legacyOut.max_round !== newOut.max_round) {
      issues.push({ method: "loadMaxRound", key: "max_round", kind: "content_diff", diff_paths: ["$"],
        legacy_side: String(legacyOut.max_round), new_side: String(newOut.max_round) });
    }

    const legacyProbes = new Map(legacyOut.probes.map((probe) => [probe.dedup_key, probe.record]));
    const newProbes = new Map(newOut.probes.map((probe) => [probe.dedup_key, probe.record]));
    for (const key of new Set([...legacyProbes.keys(), ...newProbes.keys()])) {
      const legacyHit = legacyProbes.has(key) ? legacyProbes.get(key) : "<未点查>";
      const newHit = newProbes.has(key) ? newProbes.get(key) : "<未点查>";
      const paths = normalizedDiffPaths(legacyHit, newHit);
      if (paths.length > 0) {
        const kind = classifyIssueKind(legacyHit, newHit);
        const issue = { method: "loadByDedupKey", key, kind, diff_paths: paths,
          legacy_side: stableStringify(legacyHit).slice(0, 400),
          new_side: stableStringify(newHit).slice(0, 400) };
        if (kind === "ordering_only") issue.block_order_swaps = findBlockOrderDiffs(legacyHit, newHit);
        issues.push(issue);
      }
    }

    // 会话级三分类：有任一条 content_diff 就是 content_diff；全部是 ordering_only 才是
    // ordering_only；无差异才是 identical。match 维持旧语义（= 一字不差），供旧调用方用。
    const issuesContentDiff = issues.filter((issue) => issue.kind === "content_diff").length;
    const issuesOrderingOnly = issues.filter((issue) => issue.kind === "ordering_only").length;
    const classification = issues.length === 0
      ? "identical"
      : (issuesContentDiff > 0 ? "content_diff" : "ordering_only");

    return {
      request_id: runId,
      classification,
      issues_content_diff: issuesContentDiff,
      issues_ordering_only: issuesOrderingOnly,
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
  const identical = entries.filter((entry) => entry.classification === "identical");
  const orderingOnly = entries.filter((entry) => entry.classification === "ordering_only");
  const contentDiff = entries.filter((entry) => entry.classification === "content_diff");
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
    // issue #1196：三分类的判据写进报告，事后能追问「这条为何被归为纯顺序」。
    classification: {
      identical: "normalizedDiffPaths 无差异",
      ordering_only: "深比对已报出差异，且只对挂在 content 键下的块数组做元素排序后两侧全等"
        + " ⇒ 块集合与块内容全同、仅先后不同（排序只做归因，没替代深比对）",
      content_diff: "其余全部差异：少块/多块/文字不同/键集不同/一侧缺行/max_round 不等",
      request_level_rule: "会话内有任何 content_diff 条目就是 content_diff；全部条目都是 ordering_only 才是 ordering_only",
      exit_code_rule: "exit=3 只由 content_diff 触发；ordering_only 单独计数、单独列明细，不影响 exit",
      evidence_fields: "ordering_only 的 issue 带 block_order_swaps：块数组路径 + 两侧块序 + 换了序的块对",
    },
    totals: {
      requests_compared: entries.length,
      requests_identical: identical.length,
      requests_ordering_only: orderingOnly.length,
      requests_content_diff: contentDiff.length,
      // 旧字段保留：matched = 一字不差；mismatched = 有任何差异（含纯顺序）
      requests_matched: identical.length,
      requests_mismatched: mismatched.length,
      issues_total: entries.reduce((sum, entry) => sum + entry.issues.length, 0),
      issues_ordering_only: entries.reduce((sum, entry) => sum + entry.issues_ordering_only, 0),
      issues_content_diff: entries.reduce((sum, entry) => sum + entry.issues_content_diff, 0),
      rounds_legacy: entries.reduce((sum, entry) => sum + entry.legacy_round_count, 0),
      rounds_new: entries.reduce((sum, entry) => sum + entry.new_round_count, 0),
      probes_compared: entries.reduce((sum, entry) => sum + entry.probe_count, 0),
      requests_only_in_display_side: requests.filter((item) => item.in_display && !item.in_canonical).length,
      requests_only_in_canonical_side: requests.filter((item) => !item.in_display && item.in_canonical).length,
    },
    mismatches: mismatched,
    content_diff_requests: contentDiff,
    ordering_only_requests: orderingOnly,
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
    `  一字不差   : ${report.totals.requests_identical} 个会话（identical）`,
    `  纯块顺序   : ${report.totals.requests_ordering_only} 个会话（ordering_only，#1196：**不扣 exit**）`,
    `  真内容差异 : ${report.totals.requests_content_diff} 个会话（content_diff，exit=3 的唯一来源）`,
    `  差异条目   : ${report.totals.issues_total} 条（纯顺序 ${report.totals.issues_ordering_only} / 真内容 ${report.totals.issues_content_diff}）`,
    `  报告       : ${reportPath}`,
  ].join("\n"));
  for (const entry of contentDiff.slice(0, 20)) {
    const first = entry.issues.find((issue) => issue.kind === "content_diff") ?? entry.issues[0];
    console.log(`  ! ${entry.request_id} ${first.method} key=${first.key} 差异=${first.diff_paths.join(",")}`);
  }
  if (contentDiff.length > 20) console.log(`  ! …另有 ${contentDiff.length - 20} 个会话有真内容差异，见报告文件`);
  for (const entry of orderingOnly.slice(0, 20)) {
    const first = entry.issues[0];
    const swap = first.block_order_swaps?.[0];
    const where = swap ? `${swap.path} ${swap.swapped_pairs.join(" , ")}` : first.key;
    console.log(`  ~ ${entry.request_id} 仅块顺序（不影响 exit）：${where}`);
  }
  if (orderingOnly.length > 20) console.log(`  ~ …另有 ${orderingOnly.length - 20} 个会话仅块顺序，见报告文件`);

  await sequelize.close();
  // 只有**真内容差异**才让闸门红：纯块顺序是已知噪音，单独计数看报告（issue #1196）。
  // 这是信号不是崩。
  if (contentDiff.length > 0) process.exitCode = 3;
}

// 只有**直接跑**本文件才执行 main（测试 import 拿工具函数时不能连带跑一轮真比对）。
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) await main();
