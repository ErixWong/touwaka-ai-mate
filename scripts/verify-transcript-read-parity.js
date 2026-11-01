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
 *   node scripts/verify-transcript-read-parity.js --snapshot temp/parity-snapshot.json   # 采三格快照
 *   node scripts/verify-transcript-read-parity.js --gate --baseline temp/parity-snapshot.json
 *   退出码：无 content_diff = 0（哪怕有 ordering_only）；有 content_diff = 3（**是信号不是崩**）；
 *   用法/连接错误 = 1。
 *
 * 回滚演练门禁（#1227 阶段 3 切片 C2，`--snapshot` / `--gate`）
 *   阶段 4 要拿 `legacy` 当**真回滚档**，所以这条修法必须能可重复地证明两件事：
 *     ① 0.23 请求（有 `kind='message'` 行）在 legacy 与 canonical 之间**只剩块顺序差**；
 *     ② 老账本请求（无消息行）**不因改动丢内容**。
 *   判据是「三格对账」（轮数 / 条数 / 正文总长 / `tool_result` 条数）+ **块形状多重集**
 *   （逐消息比块种类与数量，允许纯顺序差与宿主增强 reasoning），**不是**深比对——
 *   展示面本来就不存 `erix` / `metadata` / 浮点 `duration` / 每条消息的 `ts` 信封
 *   （#1147 既有损点），拿深比对当闸门会把“读不到的东西”算成内容丢失。
 *   `--snapshot` 采一次（改动前后各一次）；`--gate --baseline <快照>` 逐格比，失败逐条列出
 *   `cells_mismatch` / `shape_regression` / `legacy_cells_drift` / `parity_regression`。
 *   **`--gate` 模式下退出码由门禁自己定**（不再被存量 content_diff 拖着红）。
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
import { mkdir, readFile, writeFile } from "node:fs/promises";

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

export function parseArgs(argv) {
  const options = {
    limit: null,
    requestId: null,
    reportPath: DEFAULT_REPORT_PATH,
    snapshotPath: null,
    gate: false,
    baselinePath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--limit") options.limit = Number(next());
    else if (arg === "--request-id") options.requestId = next();
    else if (arg === "--report") options.reportPath = next();
    else if (arg === "--snapshot") options.snapshotPath = next();
    else if (arg === "--gate") options.gate = true;
    else if (arg === "--baseline") options.baselinePath = next();
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}（--help 看用法）`);
  }
  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 0)) {
    throw new Error(`--limit 必须是非负整数，收到 ${options.limit}`);
  }
  // --gate 必须配基线快照：没有“改动前”就没有“不因改动丢内容”的判据。
  if (options.gate && !options.baselinePath) {
    throw new Error("--gate 必须同时给 --baseline <改动前的快照 JSON>（用 --snapshot 采）");
  }
  if (options.baselinePath && !options.gate) {
    throw new Error("--baseline 只用于 --gate（采快照用 --snapshot）");
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

// ==================== 回滚演练门禁（#1227 阶段 3 切片 C2） ====================
//
// 为什么需要它：C2 把 `legacy` 读档修成「按请求形状分流」（0.23 请求：载体行当轮宿主；
// 老账本请求：逐行装配）。阶段 4 要拿 `legacy` 当**真回滚档**，所以这条修法必须能
// **可重复地**证明两件事：
//   ① 0.23 请求：`legacy` 与 canonical 之间**只剩块顺序差**（#1196 已判定非缺陷）；
//   ② 老账本请求：**不因这次改动丢内容**（三格对账 + 与改动前快照逐格相等）。
// 判据只用「正文总长 / 轮数 / tool_result 条数」这三格 + 块类型多重集——刻意**不用**深比对
// 当闸门：展示面本来就不存 `erix` / `metadata` / 浮点 `duration` / 每条消息的 `ts` 信封
// （#1147 记录的既有损点），拿深比对当闸门会把这些“读不到的东西”算成内容丢失。

/**
 * 三格画像：轮数 / 条数 / 正文总长（含 tool_result 正文）/ tool_result 条数。
 * 口径与 `transcript-projection.js#profileRound` 逐字一致（同一条判据，别处不另算）。
 */
export function profileLedgerCells(records) {
  let messages = 0;
  let textLength = 0;
  let toolResults = 0;
  let toolUses = 0;
  for (const record of Array.isArray(records) ? records : []) {
    for (const message of Array.isArray(record?.messages) ? record.messages : []) {
      messages += 1;
      for (const block of Array.isArray(message?.content) ? message.content : []) {
        if (block?.type === "text") textLength += String(block.text ?? "").length;
        else if (block?.type === "tool_result") {
          toolResults += 1;
          textLength += JSON.stringify(block.content ?? null).length;
        } else if (block?.type === "tool_use") toolUses += 1;
      }
    }
  }
  return {
    rounds: Array.isArray(records) ? records.length : 0,
    messages,
    textLength,
    toolResults,
    toolUses,
  };
}

/** 三格对账要逐格比的键（顺序稳定，报告与失败信息都用它）。 */
export const LEDGER_CELL_KEYS = Object.freeze(["rounds", "messages", "textLength", "toolResults"]);

/** 逐消息的块类型表：`{round, role, types}`（types 已排序）。 */
function blockTypeRows(records) {
  const rows = [];
  for (const record of Array.isArray(records) ? records : []) {
    const round = Number.isSafeInteger(record?.round) ? record.round : "?";
    for (const message of Array.isArray(record?.messages) ? record.messages : []) {
      rows.push({
        round,
        role: message?.role ?? "?",
        types: (Array.isArray(message?.content) ? message.content : [])
          .map((block) => (typeof block?.type === "string" ? block.type : "?"))
          .sort(),
      });
    }
  }
  return rows;
}

/** 多重集差：`left` 里扣掉 `right` 的配额后剩下的元素。 */
function multisetMinus(left, right) {
  const budget = new Map();
  for (const item of right) budget.set(item, (budget.get(item) ?? 0) + 1);
  const rest = [];
  for (const item of left) {
    const available = budget.get(item) ?? 0;
    if (available > 0) budget.set(item, available - 1);
    else rest.push(item);
  }
  return rest;
}

/**
 * 块形状对账（**内容粒度**的「只剩块顺序差」判据）。
 *
 * 两侧逐消息（按轮 + 轮内出现序对齐）比**块类型多重集**：
 *   - `equal_up_to_order`：每个位置的多重集都相等 ⇒ 只可能差块先后
 *     （`assistant[reasoning+text]` vs `assistant[text+reasoning]` 在这里判等）。
 *   - `reasoning_enriched`：某一侧多了 **且只多了** `reasoning` 块 ⇒ 宿主增强 reasoning
 *     （终稿单写把整个 run 的累积推理写回 `messages.reasoning_content`，canonical 每轮只有
 *     本轮那一段；对账器把这一类归 `host_enriched_reasoning` 非缺陷）。**不是内容丢失**：
 *     正文块一个没少，legacy 侧是 canonical 的超集。
 *   - 其余（缺块 / 多出非 reasoning 块 / 消息条数不同）⇒ 失败，逐条列出缺/多。
 *
 * 这比深比对弱（不比较块**内容**与 envelope 字段）、比「条数相等」强（逐消息比块种类与数量）。
 * 为什么不用深比对当闸门：展示面本来就不存 `erix` / `metadata` / 浮点 `duration` / 每条消息
 * 的 `ts` 信封（#1147 既有损点），拿深比对当闸门会把“读不到的东西”算成内容丢失。
 */
export function compareBlockShapes(legacyRecords, canonicalRecords) {
  const legacyRows = blockTypeRows(legacyRecords);
  const canonicalRows = blockTypeRows(canonicalRecords);
  if (legacyRows.length !== canonicalRows.length) {
    return {
      equal_up_to_order: false,
      reasoning_enriched: false,
      ok: false,
      reason: "message_count",
      legacy_messages: legacyRows.length,
      canonical_messages: canonicalRows.length,
      missing: [],
      extra: [],
    };
  }
  const missing = [];
  const extra = [];
  let equalUpToOrder = true;
  for (let index = 0; index < legacyRows.length; index += 1) {
    const left = legacyRows[index];
    const right = canonicalRows[index];
    const missingHere = multisetMinus(right.types, left.types);
    const extraHere = multisetMinus(left.types, right.types);
    if (missingHere.length === 0 && extraHere.length === 0) continue;
    equalUpToOrder = false;
    if (missingHere.length > 0) {
      missing.push({ round: right.round, role: right.role, index, types: missingHere });
    }
    if (extraHere.length > 0) {
      extra.push({ round: left.round, role: left.role, index, types: extraHere });
    }
  }
  const onlyReasoningExtra = missing.length === 0
    && extra.every((item) => item.types.every((type) => type === "reasoning"));
  return {
    equal_up_to_order: equalUpToOrder,
    reasoning_enriched: !equalUpToOrder && onlyReasoningExtra,
    ok: equalUpToOrder || onlyReasoningExtra,
    reason: equalUpToOrder ? "identical" : (onlyReasoningExtra ? "reasoning_enriched" : "shape_diff"),
    missing,
    extra,
  };
}

/**
 * 单请求的三格对账（legacy vs canonical）。
 * @returns {{legacy: object, canonical: object, cells_match: boolean, mismatched_cells: string[],
 *   shape: object}}
 */
export function compareLedgerCells(legacyRecords, canonicalRecords) {
  const legacy = profileLedgerCells(legacyRecords);
  const canonical = profileLedgerCells(canonicalRecords);
  const mismatched = LEDGER_CELL_KEYS.filter((key) => legacy[key] !== canonical[key]);
  return {
    legacy,
    canonical,
    cells_match: mismatched.length === 0,
    mismatched_cells: mismatched,
    shape: compareBlockShapes(legacyRecords, canonicalRecords),
  };
}

/** 哪些请求已经有 0.23 消息行（`kind='message'`，生成列现算）——形状分流的判据。 */
export async function loadMessageRowFlags({ sequelize, requestIds }) {
  const flags = new Map();
  if (!Array.isArray(requestIds) || requestIds.length === 0) return flags;
  const [rows] = await sequelize.query(`
    SELECT request_id, SUM(kind = 'message') AS message_rows
    FROM agent_rounds
    WHERE request_id IN (:requestIds)
    GROUP BY request_id
  `, { replacements: { requestIds } });
  for (const row of rows) flags.set(row.request_id, Number(row.message_rows ?? 0) > 0);
  return flags;
}

/**
 * 逐请求采一次「回滚演练快照」：三格对账 + 块形状 + parity 分类。
 *
 * 快照是**改动前后各采一次**再逐格比的东西（`--snapshot`），也是门禁的输入（`--gate`）。
 * 只读：两侧都调 store 现成的读方法。
 */
export async function collectRollbackSnapshot({ sequelize, store, requests }) {
  const flags = await loadMessageRowFlags({
    sequelize,
    requestIds: requests.map((item) => item.request_id),
  });
  const entries = [];
  for (const item of requests) {
    const runId = item.request_id;
    const legacyOut = await readUnder(store, TRANSCRIPT_READ_MODE_LEGACY, runId);
    const newOut = await readUnder(store, TRANSCRIPT_READ_MODE_NEW, runId);
    const cells = compareLedgerCells(legacyOut.rounds, newOut.rounds);
    const parity = await compareRequest(store, runId);
    entries.push({
      request_id: runId,
      has_message_rows: flags.get(runId) === true,
      legacy_cells: cells.legacy,
      canonical_cells: cells.canonical,
      cells_match: cells.cells_match,
      mismatched_cells: cells.mismatched_cells,
      shape_up_to_order: cells.shape.equal_up_to_order,
      shape_reasoning_enriched: cells.shape.reasoning_enriched,
      shape_ok: cells.shape.ok,
      shape_reason: cells.shape.reason,
      ...(cells.shape.ok ? {} : { shape_missing: cells.shape.missing, shape_extra: cells.shape.extra }),
      parity_classification: parity.classification,
      parity_issues_content_diff: parity.issues_content_diff,
      parity_issues_ordering_only: parity.issues_ordering_only,
      legacy_rounds: parity.legacy_round_count,
      canonical_rounds: parity.new_round_count,
    });
  }
  return {
    generated_at: new Date().toISOString(),
    modes_compared: [TRANSCRIPT_READ_MODE_LEGACY, TRANSCRIPT_READ_MODE_NEW],
    cell_keys: LEDGER_CELL_KEYS,
    requests: entries,
  };
}

/**
 * 回滚演练门禁：拿当前快照与基线快照逐格比。
 *
 * 失败判据（逐条都能定位到 request + 格）：
 *  1. `cells_mismatch`：三格任一不等 canonical（**丢内容**，任何形状都不允许）；
 *  2. `shape_regression`：0.23 请求（有消息行）的块形状多重集不等 ⇒ 不止是块顺序差；
 *  3. `legacy_cells_drift`：老账本请求的 legacy 三格与基线不等（本次改动动了老账本语义）；
 *  4. `parity_regression`：parity 分类变差（变成 content_diff）或 content_diff 条数变多。
 *
 * 第 3 条只对**基线里没有消息行**的请求生效：0.23 请求这次就是要改（轮数会变少），
 * 它们的“改动前后”比对没有意义，闸门对它们用的是第 1、2 条（对 canonical 的绝对判据）。
 */
export function evaluateRollbackGate({ current, baseline }) {
  const failures = [];
  const baselineById = new Map(
    (baseline?.requests ?? []).map((entry) => [entry.request_id, entry]),
  );
  let zero23 = 0;
  let legacyShape = 0;
  for (const entry of current.requests) {
    if (entry.has_message_rows) zero23 += 1;
    else legacyShape += 1;

    if (!entry.cells_match) {
      failures.push({
        request_id: entry.request_id,
        reason: "cells_mismatch",
        detail: `legacy ${JSON.stringify(entry.legacy_cells)} vs canonical ${JSON.stringify(entry.canonical_cells)}`,
        mismatched_cells: entry.mismatched_cells,
      });
    }
    if (entry.has_message_rows && !entry.shape_ok) {
      failures.push({
        request_id: entry.request_id,
        reason: "shape_regression",
        detail: "0.23 请求的块形状与 canonical 不等（不只是块顺序差，也不是宿主增强 reasoning）",
        shape_reason: entry.shape_reason,
        shape_missing: entry.shape_missing,
        shape_extra: entry.shape_extra,
      });
    }
    const before = baselineById.get(entry.request_id);
    if (before !== undefined) {
      if (!before.has_message_rows) {
        const drifted = LEDGER_CELL_KEYS.filter(
          (key) => entry.legacy_cells[key] !== before.legacy_cells[key],
        );
        if (drifted.length > 0) {
          failures.push({
            request_id: entry.request_id,
            reason: "legacy_cells_drift",
            detail: `老账本请求的 legacy 三格变了：${JSON.stringify(before.legacy_cells)} → ${JSON.stringify(entry.legacy_cells)}`,
            drifted_cells: drifted,
          });
        }
      }
      const wasContentDiff = before.parity_classification === "content_diff";
      const isContentDiff = entry.parity_classification === "content_diff";
      if ((isContentDiff && !wasContentDiff)
        || (isContentDiff && wasContentDiff
          && entry.parity_issues_content_diff > before.parity_issues_content_diff)) {
        failures.push({
          request_id: entry.request_id,
          reason: "parity_regression",
          detail: `parity 分类变差：${before.parity_classification}(${before.parity_issues_content_diff})`
            + ` → ${entry.parity_classification}(${entry.parity_issues_content_diff})`,
        });
      }
    }
  }
  const missingFromBaseline = current.requests
    .filter((entry) => baselineById.size > 0 && !baselineById.has(entry.request_id))
    .map((entry) => entry.request_id);
  return {
    ok: failures.length === 0,
    failures,
    summary: {
      requests: current.requests.length,
      requests_with_message_rows: zero23,
      requests_legacy_shape: legacyShape,
      cells_match: current.requests.filter((entry) => entry.cells_match).length,
      shape_up_to_order: current.requests.filter((entry) => entry.shape_up_to_order).length,
      shape_ok: current.requests.filter((entry) => entry.shape_ok).length,
      shape_reasoning_enriched: current.requests.filter((entry) => entry.shape_reasoning_enriched).length,
      parity_content_diff: current.requests.filter((entry) => entry.parity_classification === "content_diff").length,
      baseline_requests: baselineById.size,
      requests_not_in_baseline: missingFromBaseline.length,
    },
    requests_not_in_baseline: missingFromBaseline,
  };
}

export async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("用法：node scripts/verify-transcript-read-parity.js [--limit N] [--request-id <id>] [--report <path>]\n"
      + "      node scripts/verify-transcript-read-parity.js --snapshot temp/parity-snapshot.json        # 采三格快照（改动前后各一次）\n"
      + "      node scripts/verify-transcript-read-parity.js --gate --baseline temp/parity-snapshot.json  # 回滚演练门禁");
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

  // 回滚演练快照（#1227 阶段 3 切片 C2）：改动前后各采一次，供 --gate 逐格比。
  const rollbackSnapshot = options.snapshotPath !== null || options.gate
    ? await collectRollbackSnapshot({ sequelize, store, requests })
    : null;
  let snapshotPath = null;
  if (options.snapshotPath !== null) {
    snapshotPath = path.resolve(process.cwd(), options.snapshotPath);
    await mkdir(path.dirname(snapshotPath), { recursive: true });
    await writeFile(snapshotPath, JSON.stringify(rollbackSnapshot, null, 2), "utf8");
  }
  let gate = null;
  if (options.gate) {
    const baselinePath = path.resolve(process.cwd(), options.baselinePath);
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    gate = evaluateRollbackGate({ current: rollbackSnapshot, baseline });
    gate.baseline_path = baselinePath;
  }

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

  if (rollbackSnapshot !== null) {
    console.log(renderRollbackSnapshot(rollbackSnapshot, { snapshotPath }));
  }
  if (gate !== null) {
    console.log(renderRollbackGate(gate));
  }

  await sequelize.close();
  // 退出码：**--gate 模式由门禁自己定**（它已经把 parity 分类逐请求与基线比过一遍，
  // 见 evaluateRollbackGate 的 `parity_regression`），否则沿用 #1196 的老口径
  // 「只有真内容差异才红」。存量老账本请求的 content_diff 是展示面既有损点（erix/metadata/
  // 浮点 duration/ts 信封），不是本次改动引入——拿它当回滚门禁的 exit 会让闸门永远红。
  if (gate !== null) {
    if (!gate.ok) process.exitCode = 3;
  } else if (contentDiff.length > 0) process.exitCode = 3;
}

/** 快照的人读渲染（三格 + 形状判据，逐请求一行）。 */
export function renderRollbackSnapshot(snapshot, { snapshotPath = null } = {}) {
  const lines = [];
  const zero23 = snapshot.requests.filter((entry) => entry.has_message_rows);
  const legacyShape = snapshot.requests.filter((entry) => !entry.has_message_rows);
  lines.push(`== 回滚演练快照（三格：${snapshot.cell_keys.join(" / ")}）`);
  lines.push(`  0.23 形状（有 kind='message' 行）：${zero23.length} 个请求；老账本形状：${legacyShape.length} 个请求`);
  lines.push(`  三格与 canonical 全等：${snapshot.requests.filter((entry) => entry.cells_match).length}/${snapshot.requests.length}；`
    + `块形状（忽略块序）全等：${snapshot.requests.filter((entry) => entry.shape_up_to_order).length}/${snapshot.requests.length}`);
  for (const entry of zero23) {
    lines.push(`    [0.23] ${entry.request_id} rounds ${entry.legacy_cells.rounds}/${entry.canonical_cells.rounds}`
      + ` 正文 ${entry.legacy_cells.textLength}/${entry.canonical_cells.textLength}`
      + ` tool_result ${entry.legacy_cells.toolResults}/${entry.canonical_cells.toolResults}`
      + ` 三格=${entry.cells_match ? "✅" : `❌ ${entry.mismatched_cells.join(",")}`}`
      + ` 形状=${entry.shape_up_to_order ? "仅块顺序 ✅" : (entry.shape_reasoning_enriched ? "宿主增强 reasoning（非缺陷）" : `❌ ${entry.shape_reason}`)}`);
  }
  for (const entry of legacyShape) {
    lines.push(`    [老账本] ${entry.request_id} rounds ${entry.legacy_cells.rounds}/${entry.canonical_cells.rounds}`
      + ` 正文 ${entry.legacy_cells.textLength}/${entry.canonical_cells.textLength}`
      + ` tool_result ${entry.legacy_cells.toolResults}/${entry.canonical_cells.toolResults}`
      + ` 三格=${entry.cells_match ? "✅" : `❌ ${entry.mismatched_cells.join(",")}`}`);
  }
  if (snapshotPath !== null) lines.push(`  快照：${snapshotPath}`);
  return lines.join("\n");
}

/** 门禁结果的人读渲染（失败清单逐条可定位）。 */
export function renderRollbackGate(gate) {
  const lines = [];
  lines.push("== 回滚演练门禁（legacy 与 canonical 只剩块顺序差；老账本不因改动丢内容）");
  lines.push(`  基线：${gate.baseline_path}`);
  lines.push(`  请求 ${gate.summary.requests} 个（0.23 ${gate.summary.requests_with_message_rows} / 老账本 ${gate.summary.requests_legacy_shape}）`
    + `；三格全等 ${gate.summary.cells_match}；块形状全等 ${gate.summary.shape_up_to_order}`
    + `（另有 ${gate.summary.shape_reasoning_enriched} 个是宿主增强 reasoning，非缺陷）`
    + `；基线 ${gate.summary.baseline_requests} 个（不在基线 ${gate.summary.requests_not_in_baseline}）`);
  if (gate.ok) {
    lines.push("  结论：✅ 通过（0.23 请求只剩块顺序差；老账本请求三格与改动前逐格相等）");
    lines.push(`  注：parity 另有 ${gate.summary.parity_content_diff} 个会话仍是 content_diff（存量展示面漂移：`
      + "erix/metadata/浮点 duration/每条消息 ts 信封；与基线逐请求比过，无新增/无加重）");
  } else {
    lines.push(`  结论：❌ ${gate.failures.length} 条失败`);
    for (const failure of gate.failures) {
      lines.push(`    - [${failure.reason}] ${failure.request_id} ${failure.detail}`);
    }
  }
  return lines.join("\n");
}

// 只有**直接跑**本文件才执行 main（测试 import 拿工具函数时不能连带跑一轮真比对）。
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) await main();
