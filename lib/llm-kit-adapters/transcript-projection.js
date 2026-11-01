/**
 * 投影可重建：canonical → 投影（`agent_rounds` / `messages` / `chat_tool_calls`）**对账器 + 孤儿检测 + 重建器**
 * （issue #1227 阶段 3 切片 C1）。
 *
 * 本文件是**唯一**知道「canonical 应该投影成什么形状」的地方：
 *
 * - 对账（`reconcileRequest`）：拿 canonical `agent_transcript_rounds.record_json`（引擎面唯一真相）
 *   推导“应有投影”，与盘上实际逐格比对，差异**分类**输出（见 {@link PROJECTION_DIFF_KINDS}）。
 * - 孤儿检测（`detectOrphans`）：`chat_tool_calls` 里找不到宿主轮的行；以及 canonical 已有
 *   `tool_result` 但投影 `result_json` 仍为 NULL 的行（轮已完成却丢结果）。
 * - legacy 差异探针（`probeLegacyVsCarrierOnly`）：同一请求分别按现有 `legacy` 读法（原样复用
 *   `store.load()`）与「只取载体行装配」读法装配，报告条数/形状/正文长度差，给 C2 当靶子。
 * - 重建（`projectRequest`）：**唯一写入口**，只在 `--apply` 且目标库不是生产库时可用。
 *
 * ── 为什么生成列/索引终于有消费者了 ────────────────────────────────────────────────
 * `agent_rounds.kind` / `seq` / `part_of` 是 #1229 加的 VIRTUAL 生成列（从 `record_json` 现算），
 * 配了非唯一索引 `idx_agent_rounds_request_kind (request_id, kind, seq)`。C1 之前全仓没有 SQL
 * 读这三列，本模块的取行就是它们的**第一个消费者**：
 *   - 载体行：`WHERE request_id = :runId AND kind IS NULL`（种子行也是 NULL）
 *   - 消息行：`WHERE request_id = :runId AND kind = 'message' ORDER BY round_no, seq`
 * 两条都实测走 `idx_agent_rounds_request_kind`（`EXPLAIN` 见 `explainReconcileQueries`）。
 *
 * ── 复用而非复制（硬约束）────────────────────────────────────────────────────────
 * - **折叠**：一律走 `transcript-store.js` 的 `buildLegacyRoundRecords()` / `foldMessageRows`
 *   （后者 = erix-agent 0.29.0 公共 API），本文件**不写第二份折叠**。
 * - **投影形状**：`agent_rounds.record_json` 走 `buildAgentRoundRecordSnapshot()`，
 *   `messages` 行字段走 `projectMessageRow()`，`chat_tool_calls` 行按写侧同一条拆分规则
 *   （tool_use INSERT / tool_result UPSERT，round_id 钉在 tool_use 那一行）。
 *   这三份都从 `transcript-store.js` 导入——那是**写侧**的实现，不是本文件另写的一套。
 * - **legacy 读法**：直接调 `createTouwakaTranscriptStore().load()` 并临时切
 *   `ERIX_TRANSCRIPT_READ_MODE=legacy`，不复制装配逻辑。
 *
 * ── 只读保证 ───────────────────────────────────────────────────────────────────
 * 除 {@link projectRequest}（且 `apply === true`、目标库非生产）之外，本文件所有导出都只发
 * `SELECT`。`tests/llm-kit-adapters/transcript-projection-reconcile.test.mjs` 用「写 SQL 就抛」的
 * sequelize 代理跑一遍 dry-run 分支，把这条约束钉成测试。
 */

import { isDeepStrictEqual } from "node:util";

import Utils from "../utils.js";
import {
  CANONICAL_TABLE,
  LEGACY_ASSEMBLY_CARRIER_ONLY,
  buildAgentRoundRecordSnapshot,
  buildLegacyRoundRecords,
  createTouwakaTranscriptStore,
  loadLegacyRawRows,
  projectMessageRow,
  TRANSCRIPT_READ_MODE_ENV,
  TRANSCRIPT_READ_MODE_LEGACY,
  TRANSCRIPT_READ_MODE_NEW,
} from "./transcript-store.js";

/**
 * 差异分类（稳定 code → 中文标签）。**每一类都有独立判据**，不用「至少报出一条」糊弄：
 *
 * | code | 判据 |
 * |---|---|
 * | `missing_carrier` | canonical 有载体行（`kind IS NULL`），`agent_rounds` 里同 `dedup_key` 无行 |
 * | `extra_carrier` | `agent_rounds` 有载体行，canonical 无同 `dedup_key` 行 |
 * | `missing_round_row` | canonical 有消息行（`kind='message'`），`agent_rounds` 里同 `dedup_key` 无行 |
 * | `extra_round_row` | `agent_rounds` 有消息行，canonical 无同 `dedup_key` 行 |
 * | `seq_mismatch` | 消息行的生成列 `seq` ≠ canonical `record_json.seq` |
 * | `part_of_mismatch` | 生成列 `part_of` ≠ canonical `record_json.partOf`；或 partOf 指向同轮不存在的行 / 自身 / 更晚的 seq |
 * | `record_json_mismatch` | `agent_rounds.record_json` ≠ 由 canonical 推导的快照（`buildAgentRoundRecordSnapshot`） |
 * | `missing_message_row` | canonical 消息应落 `messages` 行（有 text/reasoning/multimodal 内容），盘上没有 |
 * | `unexpected_message_row` | `messages` 行有 `round_id` 指向本请求投影行，但 canonical 没有对应消息（未被吸附） |
 * | `content_mismatch` | `messages` 行的 role/content/reasoning_content/meta_json 与 canonical 推导值不一致 |
 * | `missing_tool_row` | canonical 有 `tool_use`，`chat_tool_calls` 无该 `tool_use_id` |
 * | `extra_tool_row` | `chat_tool_calls` 有该行，canonical 没有对应 `tool_use`/`tool_result` |
 * | `tool_row_mismatch` | 工具行的 name/input_json/is_error 与 canonical 不一致 |
 * | `tool_result_mismatch` | canonical 有 `tool_result`，投影 `result_json` 与之不一致 |
 * | `tool_result_missing` | canonical 有 `tool_result`，投影 `result_json IS NULL`（**丢正文**） |
 */
export const PROJECTION_DIFF_KINDS = Object.freeze({
  missing_carrier: "缺载体",
  extra_carrier: "多载体",
  missing_round_row: "缺消息行（agent_rounds 投影行缺失）",
  extra_round_row: "多余消息行（agent_rounds 投影行无 canonical 来源）",
  seq_mismatch: "消息行 seq 不一致",
  part_of_mismatch: "分片 part_of 不一致",
  record_json_mismatch: "投影 record_json 不可重建",
  missing_message_row: "缺消息行（messages 表）",
  unexpected_message_row: "多余消息行（未被吸附）",
  content_mismatch: "正文不一致",
  missing_tool_row: "工具行缺失",
  extra_tool_row: "多余工具行（canonical 无对应 tool_use/tool_result）",
  tool_row_mismatch: "工具行元数据不一致",
  tool_result_mismatch: "工具结果正文不一致",
  tool_result_missing: "工具结果正文缺失（canonical 有结果，投影 result_json IS NULL）",
  host_enriched_reasoning: "宿主增强的 reasoning（非投影缺陷）",
});

/** 生产库名：`--apply` 在这里**一律拒绝**（写放大实验只在非生产库做）。 */
export const PRODUCTION_DATABASE_NAME = "touwaka_mate";

/** 读侧模式切回（探针临时改环境变量后必须恢复，避免污染同进程其它读）。 */
function withReadMode(mode, fn) {
  const previous = process.env[TRANSCRIPT_READ_MODE_ENV];
  process.env[TRANSCRIPT_READ_MODE_ENV] = mode;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env[TRANSCRIPT_READ_MODE_ENV];
    else process.env[TRANSCRIPT_READ_MODE_ENV] = previous;
  }
}

function parseJsonColumn(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  return value;
}

/**
 * `BIT(1)` 列 → 布尔。**不能写 `Boolean(Number(value))`**：mysql2 对 BIT 列返回的是
 * `Buffer`（`<Buffer 01>`），`Number(Buffer)` 是 `NaN` ⇒ 恒 false（把 `is_error=1` 全读成 false，
 * 于是每个工具错误行都会被误报成 `tool_row_mismatch`）。
 */
export function bitToBoolean(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (Buffer.isBuffer(value)) return value.some((byte) => byte !== 0);
  if (typeof value === "string") return value !== "" && value !== "0" && value !== "\0";
  return Boolean(value);
}

/** 稳定排序用的 key（同一轮内 `seq` 升序、`seq` 相同按落盘 id）。 */
function byRoundThenSeq(left, right) {
  return (left.roundNo - right.roundNo)
    || ((left.seq ?? -1) - (right.seq ?? -1))
    || String(left.dedupKey).localeCompare(String(right.dedupKey));
}

// ==================== 取行（只读；生成列/索引的唯一消费者） ====================

/**
 * canonical 行（唯一真相）。排序与 `store.load()` 的 `new` 档逐字一致：`round_no ASC, id ASC`
 * （#1146 同轮保序：id 是 `Utils.newID` 时间戳前缀，单调）。
 *
 * @returns {Promise<Array<{id: string, roundNo: number, dedupKey: string, record: object, createdAt: Date}>>}
 */
export async function loadCanonicalRows({ sequelize, runId }) {
  const [rows] = await sequelize.query(`
    SELECT id, request_id, round_no, dedup_key, record_json, created_at
    FROM ${CANONICAL_TABLE}
    WHERE request_id = :runId
    ORDER BY round_no ASC, id ASC
  `, { replacements: { runId } });
  return rows.map((row) => ({
    id: row.id,
    roundNo: row.round_no,
    dedupKey: row.dedup_key,
    record: parseJsonColumn(row.record_json) ?? {},
    createdAt: row.created_at,
  }));
}

/**
 * 盘上投影行。**两条主查询就是生成列索引的消费者**：
 * 载体行走 `(request_id, kind)` 前缀，消息行走 `(request_id, kind, seq)` 全键。
 * 第三条只兜底「kind 既不是 NULL 也不是 'message'」的异常行（例如 record_json 被改坏），
 * 保证“多余行”不会被静默漏掉。
 */
export async function loadProjectionRows({ sequelize, runId }) {
  const columns = `
    id, request_id, round_no, dedup_key, stop_reason, \`usage\`, folded, folded_range,
    record_json, ts, kind, seq, part_of, created_at
  `;
  const [carrierRows] = await sequelize.query(`
    SELECT ${columns} FROM agent_rounds
    WHERE request_id = :runId AND kind IS NULL
    ORDER BY round_no ASC, id ASC
  `, { replacements: { runId } });
  const [messageRows] = await sequelize.query(`
    SELECT ${columns} FROM agent_rounds
    WHERE request_id = :runId AND kind = 'message'
    ORDER BY round_no ASC, seq ASC, id ASC
  `, { replacements: { runId } });
  const [otherRows] = await sequelize.query(`
    SELECT ${columns} FROM agent_rounds
    WHERE request_id = :runId AND kind IS NOT NULL AND kind <> 'message'
    ORDER BY round_no ASC, id ASC
  `, { replacements: { runId } });

  const normalizeRound = (row) => ({
    id: row.id,
    roundNo: row.round_no,
    dedupKey: row.dedup_key,
    kind: row.kind,
    seq: row.seq === null || row.seq === undefined ? null : Number(row.seq),
    partOf: row.part_of,
    stopReason: row.stop_reason,
    usage: parseJsonColumn(row.usage),
    folded: bitToBoolean(row.folded),
    foldedRange: parseJsonColumn(row.folded_range),
    record: parseJsonColumn(row.record_json),
    ts: row.ts,
    createdAt: row.created_at,
  });

  const [messagesRows] = await sequelize.query(`
    SELECT id, request_id, topic_id, user_id, expert_id, role, content, reasoning_content,
           round_id, sequence_no, meta_json, created_at
    FROM messages
    WHERE request_id = :runId OR round_id IN (
      SELECT id FROM agent_rounds WHERE request_id = :runId
    )
    ORDER BY round_id ASC, sequence_no ASC, id ASC
  `, { replacements: { runId } });
  const [toolRows] = await sequelize.query(`
    SELECT tool_use_id, request_id, round_id, name, input_json, result_json, is_error,
           duration_ms, created_at
    FROM chat_tool_calls
    WHERE request_id = :runId OR round_id IN (
      SELECT id FROM agent_rounds WHERE request_id = :runId
    )
    ORDER BY round_id ASC, created_at ASC, tool_use_id ASC
  `, { replacements: { runId } });

  return {
    carriers: carrierRows.map(normalizeRound),
    messageRows: messageRows.map(normalizeRound),
    otherRows: otherRows.map(normalizeRound),
    allRoundRows: [
      ...carrierRows.map(normalizeRound),
      ...messageRows.map(normalizeRound),
      ...otherRows.map(normalizeRound),
    ],
    messages: messagesRows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      topicId: row.topic_id,
      userId: row.user_id,
      expertId: row.expert_id,
      role: row.role,
      content: row.content,
      reasoningContent: row.reasoning_content,
      roundId: row.round_id,
      sequenceNo: row.sequence_no === null || row.sequence_no === undefined ? null : Number(row.sequence_no),
      metaJson: row.meta_json,
      createdAt: row.created_at,
    })),
    // 原样 DB 行（snake_case）：保留给需要列名形态的调用方（对账本身只用归一化后的两份视图）。
    rawMessages: messagesRows,
    rawToolCalls: toolRows,
    toolCalls: toolRows.map((row) => ({
      toolUseId: row.tool_use_id,
      requestId: row.request_id,
      roundId: row.round_id,
      name: row.name,
      input: parseJsonColumn(row.input_json),
      inputJson: row.input_json,
      resultJson: row.result_json,
      result: parseJsonColumn(row.result_json),
      isError: bitToBoolean(row.is_error),
      durationMs: row.duration_ms === null || row.duration_ms === undefined ? null : Number(row.duration_ms),
      createdAt: row.created_at,
    })),
  };
}

// ==================== 应有投影（全部复用写侧实现） ====================

/**
 * 从 canonical 推导“应有投影”。
 *
 * 逐条对齐写侧 `appendRound` 的语义（**不是**重新发明一套）：
 * 1. `agent_rounds` 一行 = canonical 一行；`record_json` = `buildAgentRoundRecordSnapshot(record).recordSnapshot`。
 * 2. `messages` 行 = 对**非 round 0** 的每一行 `record.messages` 逐条调 `projectMessageRow`；
 *    返回 null（纯 tool_use / tool_result）不落行。`sequence_no` 是该行内下标（写侧同口径）。
 * 3. `chat_tool_calls` 一行 = 一个 `tool_use_id`；`round_id` 钉在 **tool_use 所在行**；
 *    `result_json`/`is_error`/`duration_ms` 由同 id 的 `tool_result` 补齐（写侧 UPSERT 语义）。
 *
 * @param {{canonicalRows: Array, runId: string, requestContext?: object}} params
 */
export function deriveProjectedRows({ canonicalRows, runId, requestContext = {} }) {
  const agentRounds = new Map();
  const messages = [];
  const toolCalls = new Map();

  for (const canonicalRow of canonicalRows) {
    const record = canonicalRow.record ?? {};
    const { recordSnapshot } = buildAgentRoundRecordSnapshot(record);
    const dedupKey = canonicalRow.dedupKey;
    agentRounds.set(dedupKey, {
      dedupKey,
      roundNo: canonicalRow.roundNo,
      kind: typeof record.kind === "string" ? record.kind : null,
      seq: Number.isSafeInteger(record.seq) ? record.seq : null,
      partOf: typeof record.partOf === "string" && record.partOf !== "" ? record.partOf : null,
      recordSnapshot,
      stopReason: record.response?.stopReason ?? null,
      usage: record.response?.usage ?? null,
      folded: Boolean(record.folded ?? false),
      foldedRange: record.foldedRoundRange ?? null,
      ts: typeof record.ts === "string" && record.ts !== "" ? record.ts : null,
    });

    // round 0 种子轮整轮跳过拆行（写侧硬规则：否则每跑一次 run 就多一整套历史副本）。
    if (canonicalRow.roundNo === 0) continue;
    const recordMessages = Array.isArray(record.messages) ? record.messages : [];
    for (const [index, message] of recordMessages.entries()) {
      if (message === null || typeof message !== "object" || Array.isArray(message)) continue;
      const row = projectMessageRow(
        message, index, "<projected>", runId, requestContext, new Date(0),
      );
      if (row) {
        messages.push({
          ownerDedupKey: dedupKey,
          sequenceNo: index,
          role: row.role,
          content: row.content,
          reasoningContent: row.reasoningContent,
          metaJson: row.metaJson,
        });
      }
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (block === null || typeof block !== "object") continue;
        if (block.type === "tool_use") {
          const toolUseId = String(block.id);
          const existing = toolCalls.get(toolUseId);
          if (existing === undefined) {
            toolCalls.set(toolUseId, {
              toolUseId,
              ownerDedupKey: dedupKey,
              name: String(block.name ?? ""),
              input: block.input === undefined ? null : block.input,
              resultPresent: false,
              result: null,
              isError: false,
              durationMs: null,
            });
          }
        } else if (block.type === "tool_result") {
          const toolUseId = String(block.tool_use_id);
          const existing = toolCalls.get(toolUseId) ?? {
            toolUseId,
            ownerDedupKey: dedupKey,
            name: "",
            input: null,
          };
          toolCalls.set(toolUseId, {
            ...existing,
            resultPresent: true,
            result: block.content === undefined ? null : block.content,
            isError: Boolean(block.is_error),
            durationMs: Number.isSafeInteger(block.erix?.durationMs)
              ? block.erix.durationMs
              : (Number.isSafeInteger(block.duration) ? block.duration : null),
          });
        }
      }
    }
  }

  return { agentRounds, messages, toolCalls };
}

// ==================== 对账（只读） ====================

function diff(kind, payload) {
  return { kind, label: PROJECTION_DIFF_KINDS[kind], ...payload };
}

/**
 * 宿主增强 reasoning 的判据（**不是**投影缺陷）。
 *
 * 终稿单写路径 `lib/chat-service.js#saveAssistantMessageAndCompleteRequest` 会 UPDATE
 * 引擎已落的那条 assistant `messages` 行，把 `reasoning_content` 换成**整个 run 的累积推理**
 * （canonical 每轮只存本轮那一段），并补 tokens/latency/model。所以终稿行的 reasoning 天然是
 * canonical 的超集（`endsWith` 成立），content/role/meta 仍应逐字一致。
 *
 * 判据只认这一种形态（后缀超集 + 只有 reasoning 一个字段不同），其它一律算 `content_mismatch`。
 */
export function isHostEnrichedReasoning({ expectedContent, expectedReasoning, actualContent, actualReasoning }) {
  if ((actualContent ?? null) !== (expectedContent ?? null)) return false;
  const expected = expectedReasoning ?? "";
  const actual = actualReasoning ?? "";
  if (actual.length <= expected.length) return false;
  return actual.endsWith(expected);
}

/** 单请求对账：canonical → 应有投影 vs 盘上实际，逐格分类。
 *
 * @returns {Promise<{runId: string, diffs: object[], counts: Record<string, number>, stats: object}>}
 */
export async function reconcileRequest({ sequelize, runId, requestContext = {} }) {
  const canonicalRows = await loadCanonicalRows({ sequelize, runId });
  const projection = await loadProjectionRows({ sequelize, runId });
  const expected = deriveProjectedRows({ canonicalRows, runId, requestContext });
  const diffs = [];

  const canonicalByKey = new Map(canonicalRows.map((row) => [row.dedupKey, row]));
  const actualByKey = new Map(projection.allRoundRows.map((row) => [row.dedupKey, row]));

  // ---- 1. agent_rounds：载体行 / 消息行 / seq / part_of / record_json ----
  for (const [dedupKey, expectedRow] of expected.agentRounds) {
    const actual = actualByKey.get(dedupKey);
    if (actual === undefined) {
      diffs.push(diff(expectedRow.kind === "message" ? "missing_round_row" : "missing_carrier", {
        table: "agent_rounds",
        dedupKey,
        roundNo: expectedRow.roundNo,
        expected: { kind: expectedRow.kind, seq: expectedRow.seq, partOf: expectedRow.partOf },
        actual: null,
      }));
      continue;
    }
    if (actual.kind !== expectedRow.kind) {
      diffs.push(diff("record_json_mismatch", {
        table: "agent_rounds",
        dedupKey,
        roundNo: expectedRow.roundNo,
        field: "kind",
        expected: expectedRow.kind,
        actual: actual.kind,
      }));
    }
    if ((actual.seq ?? null) !== expectedRow.seq) {
      diffs.push(diff("seq_mismatch", {
        table: "agent_rounds",
        dedupKey,
        roundNo: expectedRow.roundNo,
        expected: expectedRow.seq,
        actual: actual.seq,
      }));
    }
    if ((actual.partOf ?? null) !== expectedRow.partOf) {
      diffs.push(diff("part_of_mismatch", {
        table: "agent_rounds",
        dedupKey,
        roundNo: expectedRow.roundNo,
        expected: expectedRow.partOf,
        actual: actual.partOf,
      }));
    } else if (expectedRow.partOf !== null) {
      // 语义校验：partOf 必须指向**同轮、更早 seq** 的已存在行（上游 #430：partOf 只认首片）。
      const target = expected.agentRounds.get(expectedRow.partOf);
      const targetSeq = target?.seq;
      if (target === undefined
        || target.roundNo !== expectedRow.roundNo
        || target.kind !== "message"
        || !(Number.isSafeInteger(targetSeq) && Number.isSafeInteger(expectedRow.seq) && targetSeq < expectedRow.seq)) {
        diffs.push(diff("part_of_mismatch", {
          table: "agent_rounds",
          dedupKey,
          roundNo: expectedRow.roundNo,
          expected: expectedRow.partOf,
          actual: actual.partOf,
          detail: "partOf 指向同轮不存在的行 / 自身 / 不更早的 seq（分片只认首片）",
        }));
      }
    }
    const actualRecord = actual.record;
    if (!isDeepStrictEqual(actualRecord, expectedRow.recordSnapshot)) {
      diffs.push(diff("record_json_mismatch", {
        table: "agent_rounds",
        dedupKey,
        roundNo: expectedRow.roundNo,
        expected: expectedRow.recordSnapshot,
        actual: actualRecord,
      }));
    }
    if (expectedRow.ts !== null && actual.ts !== expectedRow.ts) {
      diffs.push(diff("record_json_mismatch", {
        table: "agent_rounds",
        dedupKey,
        roundNo: expectedRow.roundNo,
        field: "ts",
        expected: expectedRow.ts,
        actual: actual.ts,
      }));
    }
    if (actual.stopReason !== expectedRow.stopReason) {
      diffs.push(diff("record_json_mismatch", {
        table: "agent_rounds",
        dedupKey,
        roundNo: expectedRow.roundNo,
        field: "stop_reason",
        expected: expectedRow.stopReason,
        actual: actual.stopReason,
      }));
    }
  }

  for (const actual of projection.allRoundRows) {
    if (canonicalByKey.has(actual.dedupKey)) continue;
    diffs.push(diff(actual.kind === "message" ? "extra_round_row" : "extra_carrier", {
      table: "agent_rounds",
      dedupKey: actual.dedupKey,
      roundNo: actual.roundNo,
      expected: null,
      actual: { kind: actual.kind, seq: actual.seq, partOf: actual.partOf },
    }));
  }

  // ---- 2. messages 表 ----
  // 实际行的 round_id 指向 agent_rounds.id；先把它映射回 canonical dedup_key 才能与应有行对齐。
  const dedupKeyByRoundId = new Map(projection.allRoundRows.map((row) => [row.id, row.dedupKey]));
  const expectedMessages = new Map();
  for (const row of expected.messages) {
    expectedMessages.set(`${row.ownerDedupKey}::${row.sequenceNo}`, row);
  }
  const actualMessages = new Map();
  let hostWrittenMessageRows = 0;
  for (const row of projection.messages) {
    if (row.roundId === null || row.roundId === undefined) {
      // round_id NULL = 宿主自己写的用户提示行（saveUserMessage 路径），**不是** canonical 投影，
      // 不参与对账（否则每个会话都报一条假差异）。只计数。
      hostWrittenMessageRows += 1;
      continue;
    }
    const ownerDedupKey = dedupKeyByRoundId.get(row.roundId) ?? `round_id:${row.roundId}`;
    actualMessages.set(`${ownerDedupKey}::${row.sequenceNo}`, row);
  }
  for (const [key, expectedRow] of expectedMessages) {
    const actual = actualMessages.get(key);
    if (actual === undefined) {
      diffs.push(diff("missing_message_row", {
        table: "messages",
        dedupKey: expectedRow.ownerDedupKey,
        sequenceNo: expectedRow.sequenceNo,
        expected: {
          role: expectedRow.role,
          contentLength: expectedRow.content?.length ?? 0,
          hasReasoning: Boolean(expectedRow.reasoningContent),
          metaJson: expectedRow.metaJson,
        },
        actual: null,
      }));
      continue;
    }
    const fields = [];
    if (actual.role !== expectedRow.role) fields.push("role");
    if ((actual.content ?? null) !== (expectedRow.content ?? null)) fields.push("content");
    if ((actual.reasoningContent ?? null) !== (expectedRow.reasoningContent ?? null)) fields.push("reasoning_content");
    if ((actual.metaJson ?? null) !== (expectedRow.metaJson ?? null)) fields.push("meta_json");
    if (fields.length > 0) {
      const hostEnriched = fields.length === 1
        && fields[0] === "reasoning_content"
        && isHostEnrichedReasoning({
          expectedContent: expectedRow.content,
          expectedReasoning: expectedRow.reasoningContent,
          actualContent: actual.content,
          actualReasoning: actual.reasoningContent,
        });
      diffs.push(diff(hostEnriched ? "host_enriched_reasoning" : "content_mismatch", {
        table: "messages",
        dedupKey: expectedRow.ownerDedupKey,
        sequenceNo: expectedRow.sequenceNo,
        fields,
        ...(hostEnriched
          ? { detail: "终稿单写 UPDATE 把 reasoning 换成整个 run 的累积推理（canonical 是后缀），content/role/meta 仍一致" }
          : {}),
        expected: {
          role: expectedRow.role,
          contentLength: expectedRow.content?.length ?? 0,
          reasoningLength: expectedRow.reasoningContent?.length ?? 0,
          metaJson: expectedRow.metaJson,
        },
        actual: {
          role: actual.role,
          contentLength: actual.content?.length ?? 0,
          reasoningLength: actual.reasoningContent?.length ?? 0,
          metaJson: actual.metaJson,
        },
      }));
    }
  }
  for (const [key, actual] of actualMessages) {
    if (expectedMessages.has(key)) continue;
    diffs.push(diff("unexpected_message_row", {
      table: "messages",
      dedupKey: key.split("::")[0],
      sequenceNo: actual.sequenceNo,
      messageId: actual.id,
      expected: null,
      actual: {
        role: actual.role,
        contentLength: actual.content?.length ?? 0,
        reasoningLength: actual.reasoningContent?.length ?? 0,
      },
    }));
  }

  // ---- 3. chat_tool_calls ----
  const actualTools = new Map(projection.toolCalls.map((row) => [row.toolUseId, row]));
  for (const [toolUseId, expectedRow] of expected.toolCalls) {
    const actual = actualTools.get(toolUseId);
    if (actual === undefined) {
      diffs.push(diff("missing_tool_row", {
        table: "chat_tool_calls",
        dedupKey: expectedRow.ownerDedupKey,
        toolUseId,
        expected: { name: expectedRow.name, input: expectedRow.input, resultPresent: expectedRow.resultPresent },
        actual: null,
      }));
      continue;
    }
    if (actual.name !== expectedRow.name || !isDeepStrictEqual(actual.input ?? null, expectedRow.input ?? null)) {
      diffs.push(diff("tool_row_mismatch", {
        table: "chat_tool_calls",
        toolUseId,
        expected: { name: expectedRow.name, input: expectedRow.input },
        actual: { name: actual.name, input: actual.input },
      }));
    }
    if (expectedRow.resultPresent) {
      if (actual.resultJson === null || actual.resultJson === undefined) {
        diffs.push(diff("tool_result_missing", {
          table: "chat_tool_calls",
          toolUseId,
          expected: { resultPresent: true },
          actual: { resultJson: null },
        }));
      } else if (!isDeepStrictEqual(actual.result, expectedRow.result)) {
        diffs.push(diff("tool_result_mismatch", {
          table: "chat_tool_calls",
          toolUseId,
          expected: { resultLength: JSON.stringify(expectedRow.result ?? null)?.length ?? 0 },
          actual: { resultLength: actual.resultJson?.length ?? 0 },
        }));
      }
      if (actual.isError !== expectedRow.isError) {
        diffs.push(diff("tool_row_mismatch", {
          table: "chat_tool_calls",
          toolUseId,
          field: "is_error",
          expected: expectedRow.isError,
          actual: actual.isError,
        }));
      }
    }
  }
  const requestRoundIds = new Set(projection.allRoundRows.map((row) => row.id));
  for (const [toolUseId, actual] of actualTools) {
    if (expected.toolCalls.has(toolUseId)) continue;
    // round_id 不在本请求任何投影行里 ⇒ 归孤儿检测，不重复报。
    if (!requestRoundIds.has(actual.roundId)) continue;
    diffs.push(diff("extra_tool_row", {
      table: "chat_tool_calls",
      toolUseId,
      roundId: actual.roundId,
      expected: null,
      actual: { name: actual.name, resultJsonPresent: actual.resultJson !== null },
    }));
  }

  const counts = {};
  for (const item of diffs) counts[item.kind] = (counts[item.kind] ?? 0) + 1;

  const carrierCount = canonicalRows.filter((row) => row.record?.kind !== "message").length;
  return {
    runId,
    diffs,
    counts,
    stats: {
      canonical_rows: canonicalRows.length,
      canonical_carriers: carrierCount,
      canonical_message_rows: canonicalRows.length - carrierCount,
      projection_rows: projection.allRoundRows.length,
      projection_carriers: projection.carriers.length,
      projection_message_rows: projection.messageRows.length,
      projection_other_rows: projection.otherRows.length,
      messages_rows: projection.messages.length,
      host_written_message_rows: hostWrittenMessageRows,
      tool_rows: projection.toolCalls.length,
      rounds: new Set(canonicalRows.map((row) => row.roundNo)).size,
      rows_per_round: carrierCount === 0 ? null : Number((canonicalRows.length / carrierCount).toFixed(2)),
    },
  };
}

// ==================== 孤儿检测（只读） ====================

/**
 * 孤儿检测（任务 ②）。两类：
 * 1. `chat_tool_calls` 行的 `round_id` 在 `agent_rounds` 里找不到宿主轮（`load()` 只告警不装配）；
 * 2. 轮已完成（canonical 有该轮载体行）但工具行 `result_json IS NULL`：
 *    - canonical **有**该 tool_result ⇒ `tool_result_missing`（真丢正文，C2 靶子）；
 *    - canonical 没有该 tool_result ⇒ `tool_result_pending`（引擎侧未 settle / 中止，非投影缺陷，仅计数）。
 */
export async function detectOrphans({ sequelize, runId }) {
  const [orphanRows] = await sequelize.query(`
    SELECT t.tool_use_id, t.round_id, t.name, t.result_json, t.created_at
    FROM chat_tool_calls t
    LEFT JOIN agent_rounds r ON r.id = t.round_id
    WHERE t.request_id = :runId AND r.id IS NULL
    ORDER BY t.created_at ASC, t.tool_use_id ASC
  `, { replacements: { runId } });

  const [nullResultRows] = await sequelize.query(`
    SELECT t.tool_use_id, t.round_id, t.name, r.round_no
    FROM chat_tool_calls t
    JOIN agent_rounds r ON r.id = t.round_id
    WHERE t.request_id = :runId AND t.result_json IS NULL
    ORDER BY r.round_no ASC, t.tool_use_id ASC
  `, { replacements: { runId } });

  const canonicalRows = await loadCanonicalRows({ sequelize, runId });
  const completedRounds = new Set(
    canonicalRows.filter((row) => row.record?.kind !== "message").map((row) => row.roundNo),
  );
  const canonicalResultIds = new Set();
  for (const row of canonicalRows) {
    if (row.roundNo === 0) continue;
    for (const message of Array.isArray(row.record?.messages) ? row.record.messages : []) {
      for (const block of Array.isArray(message?.content) ? message.content : []) {
        if (block?.type === "tool_result") canonicalResultIds.add(String(block.tool_use_id));
      }
    }
  }

  const orphans = orphanRows.map((row) => ({
    kind: "orphan_tool_row",
    toolUseId: row.tool_use_id,
    roundId: row.round_id,
    name: row.name,
    resultJsonPresent: row.result_json !== null && row.result_json !== undefined,
  }));

  const nullResults = [];
  for (const row of nullResultRows) {
    const roundNo = Number(row.round_no);
    if (!completedRounds.has(roundNo)) continue; // 轮未完成 ⇒ result 缺失是预期（工具还在跑）
    nullResults.push({
      kind: canonicalResultIds.has(row.tool_use_id) ? "tool_result_missing" : "tool_result_pending",
      toolUseId: row.tool_use_id,
      roundId: row.round_id,
      roundNo,
      name: row.name,
    });
  }

  return {
    runId,
    orphanToolRows: orphans,
    completedRoundsWithNullResult: nullResults,
    counts: {
      orphan_tool_row: orphans.length,
      tool_result_missing: nullResults.filter((row) => row.kind === "tool_result_missing").length,
      tool_result_pending: nullResults.filter((row) => row.kind === "tool_result_pending").length,
    },
  };
}

// ==================== legacy 差异探针（只读，给 C2 当靶子） ====================

/** 一轮的正文画像：条数 / 形状 / 正文长度 / tool_result 条数（用于 legacy vs new vs carrier-only 对比）。 */
export function profileRound(record) {
  const messages = Array.isArray(record?.messages) ? record.messages : [];
  let textLength = 0;
  let toolResults = 0;
  let toolUses = 0;
  const shape = [];
  for (const message of messages) {
    const blocks = Array.isArray(message?.content) ? message.content : [];
    shape.push(`${message?.role}[${blocks.map((block) => block?.type).join("+")}]`);
    for (const block of blocks) {
      if (block?.type === "text") textLength += String(block.text ?? "").length;
      else if (block?.type === "tool_result") {
        toolResults += 1;
        textLength += JSON.stringify(block.content ?? null).length;
      } else if (block?.type === "tool_use") toolUses += 1;
    }
  }
  return { messageCount: messages.length, shape: shape.join(","), textLength, toolResults, toolUses };
}

/**
 * 「只取载体行装配」：**只用载体行当轮宿主**（`kind IS NULL`），把该轮消息行的投影
 * `messages` / `chat_tool_calls` 行挂回载体，再折一次。
 *
 * 这是 C2 的**反证口径**（counterfactual）：它只按消息行挂子行 ⇒ 老账本（没有
 * `kind='message'` 行）会被读成空壳（实测 30 个老请求正文/工具行归零、差异 3–62 条），
 * 这正是 C2 运行时**不能**无脑换 carrier-only 的证据。运行时走的是
 * `buildLegacyRoundRecords()` 的 `dispatch` 档（同一函数，按请求形状分流）。
 *
 * 实现上**不复制装配**：取行走 `transcript-store.js#loadLegacyRawRows()`，装配走
 * `buildLegacyRoundRecords({ mode: "carrier-only" })` —— 与 legacy 运行时同一个函数、
 * 同一份 `assembleRoundRecord()` / `foldMessageRows()`（都在 `buildLegacyRoundRecords()` 里）。
 */
export async function loadCarrierOnlyRounds({ sequelize, runId }) {
  const { rounds, messageRows, toolRows } = await loadLegacyRawRows({ sequelize, runId });
  return buildLegacyRoundRecords({
    rounds,
    messageRows,
    toolRows,
    mode: LEGACY_ASSEMBLY_CARRIER_ONLY,
  });
}

/**
 * legacy 差异探针：同一请求三档装配对比。
 *
 * - `new`：canonical 折叠（`store.load()`，默认档）= 真相基线
 * - `legacy`：现网 legacy 读法（原样调 `store.load()` 并临时切模式）
 * - `carrier_only`：{@link loadCarrierOnlyRounds}（C2 候选修法）
 *
 * 逐轮输出：条数差、形状差、正文长度差、tool_result 条数差。**不改运行时**，只报告。
 */
export async function probeLegacyVsCarrierOnly({ sequelize, runId, requestContext = {}, logger }) {
  const store = createTouwakaTranscriptStore({ db: { sequelize }, requestContext, logger });
  const canonical = await withReadMode(TRANSCRIPT_READ_MODE_NEW, () => store.load(runId));
  const legacy = await withReadMode(TRANSCRIPT_READ_MODE_LEGACY, () => store.load(runId));
  const carrierOnly = await loadCarrierOnlyRounds({ sequelize, runId });

  const compare = (baseline, candidate) => {
    const differences = [];
    const max = Math.max(baseline.length, candidate.length);
    for (let index = 0; index < max; index += 1) {
      const left = baseline[index];
      const right = candidate[index];
      if (left === undefined || right === undefined) {
        differences.push({
          kind: "round_count",
          index,
          round: left?.round ?? right?.round ?? null,
          baseline: left === undefined ? null : "present",
          candidate: right === undefined ? null : "present",
        });
        continue;
      }
      const leftProfile = profileRound(left);
      const rightProfile = profileRound(right);
      if (leftProfile.messageCount !== rightProfile.messageCount) {
        differences.push({
          kind: "message_count",
          round: left.round,
          baseline: leftProfile.messageCount,
          candidate: rightProfile.messageCount,
        });
      }
      if (leftProfile.shape !== rightProfile.shape) {
        differences.push({
          kind: "shape",
          round: left.round,
          baseline: leftProfile.shape,
          candidate: rightProfile.shape,
        });
      }
      if (leftProfile.textLength !== rightProfile.textLength) {
        differences.push({
          kind: "text_length",
          round: left.round,
          baseline: leftProfile.textLength,
          candidate: rightProfile.textLength,
          delta: rightProfile.textLength - leftProfile.textLength,
        });
      }
      if (leftProfile.toolResults !== rightProfile.toolResults) {
        differences.push({
          kind: "tool_result_count",
          round: left.round,
          baseline: leftProfile.toolResults,
          candidate: rightProfile.toolResults,
        });
      }
    }
    return {
      baseline_rounds: baseline.length,
      candidate_rounds: candidate.length,
      differences,
    };
  };

  return {
    runId,
    canonical_rounds: canonical.length,
    legacy_rounds: legacy.length,
    carrier_only_rounds: carrierOnly.length,
    legacy: compare(canonical, legacy),
    carrier_only: compare(canonical, carrierOnly),
  };
}

// ==================== 基线统计（只读） ====================

/**
 * 写放大基线（任务 2）：每请求行数 / 每轮行数比 / `SUM(CHAR_LENGTH(record_json))`，
 * 以及表级 `information_schema.TABLES.DATA_LENGTH / INDEX_LENGTH`。
 */
export async function collectBaselineStats({ sequelize, runIds }) {
  const perRequest = [];
  for (const runId of runIds) {
    const [[canonical]] = await sequelize.query(`
      SELECT COUNT(*) AS rows_, COALESCE(SUM(CHAR_LENGTH(record_json)), 0) AS bytes_,
             COUNT(DISTINCT round_no) AS rounds_
      FROM ${CANONICAL_TABLE} WHERE request_id = :runId
    `, { replacements: { runId } });
    const [[projection]] = await sequelize.query(`
      SELECT COUNT(*) AS rows_, COALESCE(SUM(CHAR_LENGTH(record_json)), 0) AS bytes_,
             SUM(kind IS NULL) AS carriers_, SUM(kind = 'message') AS message_rows_
      FROM agent_rounds WHERE request_id = :runId
    `, { replacements: { runId } });
    const [[messages]] = await sequelize.query(`
      SELECT COUNT(*) AS rows_, COALESCE(SUM(CHAR_LENGTH(content)), 0) AS content_chars_
      FROM messages WHERE request_id = :runId OR round_id IN (
        SELECT id FROM agent_rounds WHERE request_id = :runId
      )
    `, { replacements: { runId } });
    const [[tools]] = await sequelize.query(`
      SELECT COUNT(*) AS rows_, COALESCE(SUM(CHAR_LENGTH(result_json)), 0) AS result_chars_
      FROM chat_tool_calls WHERE request_id = :runId
    `, { replacements: { runId } });
    const rounds = Number(canonical.rounds_ ?? 0);
    perRequest.push({
      request_id: runId,
      canonical_rows: Number(canonical.rows_ ?? 0),
      canonical_bytes: Number(canonical.bytes_ ?? 0),
      rounds,
      agent_rounds_rows: Number(projection.rows_ ?? 0),
      agent_rounds_carriers: Number(projection.carriers_ ?? 0),
      agent_rounds_message_rows: Number(projection.message_rows_ ?? 0),
      agent_rounds_bytes: Number(projection.bytes_ ?? 0),
      messages_rows: Number(messages.rows_ ?? 0),
      messages_content_chars: Number(messages.content_chars_ ?? 0),
      tool_rows: Number(tools.rows_ ?? 0),
      tool_result_chars: Number(tools.result_chars_ ?? 0),
      rows_per_round: rounds === 0 ? null : Number((Number(canonical.rows_ ?? 0) / rounds).toFixed(2)),
      projection_rows_per_round: rounds === 0 ? null : Number((Number(projection.rows_ ?? 0) / rounds).toFixed(2)),
    });
  }

  const [tables] = await sequelize.query(`
    SELECT TABLE_NAME AS table_name, TABLE_ROWS AS table_rows,
           DATA_LENGTH AS data_length, INDEX_LENGTH AS index_length
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME IN ('agent_rounds', 'messages', 'chat_tool_calls', '${CANONICAL_TABLE}')
    ORDER BY TABLE_NAME ASC
  `);
  return {
    perRequest,
    tables: tables.map((row) => ({
      table_name: row.table_name,
      table_rows: Number(row.table_rows ?? 0),
      data_length: Number(row.data_length ?? 0),
      index_length: Number(row.index_length ?? 0),
    })),
  };
}

/** 对账 SQL 的 `EXPLAIN`（门禁 4 的自证材料）：证明两条取行真走 `idx_agent_rounds_request_kind`。 */
export async function explainReconcileQueries({ sequelize, runId }) {
  const columns = "id, dedup_key, round_no, kind, seq, part_of";
  const [carriers] = await sequelize.query(`
    EXPLAIN SELECT ${columns} FROM agent_rounds
    WHERE request_id = :runId AND kind IS NULL ORDER BY seq
  `, { replacements: { runId } });
  const [messageRows] = await sequelize.query(`
    EXPLAIN SELECT ${columns} FROM agent_rounds
    WHERE request_id = :runId AND kind = 'message' ORDER BY round_no, seq
  `, { replacements: { runId } });
  const pick = (rows) => rows.map((row) => ({
    table: row.table,
    type: row.type,
    possible_keys: row.possible_keys,
    key: row.key,
    key_len: row.key_len,
    rows: row.rows,
    Extra: row.Extra,
  }));
  return { carriers: pick(carriers), message_rows: pick(messageRows) };
}

// ==================== 写入口（唯一；仅 --apply + 非生产库） ====================
//
// ⚠ 本段之上**没有任何写 SQL**：dry-run 走 reconcileRequest / detectOrphans /
// probeLegacyVsCarrierOnly / collectBaselineStats / explainReconcileQueries，全是 SELECT。
// 写语句只出现在 applyProjectionWrites()，而它只由 projectRequest({apply:true}) 调用，
// 且 projectRequest 会先过 assertProjectionApplyAllowed() 的库名判据。

/** `--apply` 库名判据：生产库一律拒绝（**显式**校验，不靠「忘了配 DB_NAME」兜底）。 */
export function assertProjectionApplyAllowed({ database, apply }) {
  if (!apply) return { allowed: false, reason: "dry-run" };
  if (typeof database !== "string" || database.trim() === "") {
    const error = new Error("[transcript-projection] --apply 必须能确认目标库名（DB_NAME 为空，拒绝写入）");
    error.code = "ERR_PROJECTION_APPLY_UNKNOWN_DATABASE";
    throw error;
  }
  if (database.trim() === PRODUCTION_DATABASE_NAME) {
    const error = new Error(
      `[transcript-projection] --apply 拒绝在生产库 "${PRODUCTION_DATABASE_NAME}" 上执行（写放大实验只在非生产库做）`,
    );
    error.code = "ERR_PROJECTION_APPLY_FORBIDDEN";
    error.database = database;
    throw error;
  }
  return { allowed: true, reason: "non-production" };
}

// ==================== 存量漂移回填（#1227 阶段 3 切片 C2b） ====================
//
// 两个开关默认关：`--fix-is-error` / `--rewrite-record-json`。不带开关时本段不产生任何
// 写 SQL，脚本行为与 C1 完全一致（dry-run 只读）。
//
// 生产库允许写，但必须**双重显式**：开关本身 + `ALLOW_NON_TEST_DB=1`。缺任一即抛错，
// 错误码 `ERR_PROJECTION_BACKFILL_NEEDS_ALLOW_NON_TEST_DB`（用例钉住）。
//
// `--fix-is-error` 的方向是**单向**的：只允许 canonical 真 & 列 0 → 1；
// 「列真 & canonical 非真」一格（C 格）一律不动——那可能是合法的其它来源，动它要单独说理由。
// 为什么把三格方向**永远打出来**（而不是只报一个“命中数”）：#1227 C2b 复盘发现
// `agent_transcript_rounds` 自己的 `is_error` 曾被 2026-10-09 的 canonical 回填脚本污染
// （`reconstructMessages` 里 `row.is_error` 是 `BIT(1)` 的 Buffer，恒真），
// 只报命中数会把“canonical 假阳性”伪装成“投影丢位”。方向表让基准本身是否可信一眼可见。

/** 存量漂移回填写生产库时的显式确认环境变量（与 test-db-guard 同一名字）。 */
export const DRIFT_BACKFILL_ALLOW_ENV_VAR = "ALLOW_NON_TEST_DB";

/** 工具行 `is_error` 的三格方向（A 可回填 / B 无需动作 / C 禁止回填）。 */
export const TOOL_ERROR_DIRECTIONS = Object.freeze({
  A: "canonical 真 & 列 0（唯一允许回填的方向）",
  B: "两边皆真（无需动作）",
  C: "列真 & canonical 非真（禁止反向修改）",
});

/**
 * 存量漂移回填的库名/显式确认判据（**纯函数**，不连库）。
 *
 * @param {{database: string, fixIsError?: boolean, rewriteRecordJson?: boolean, env?: object}} params
 * @returns {{allowed: boolean, reason: string}}
 * @throws {Error} code=`ERR_PROJECTION_BACKFILL_UNKNOWN_DATABASE` / `ERR_PROJECTION_BACKFILL_NEEDS_ALLOW_NON_TEST_DB`
 */
export function assertDriftBackfillAllowed({
  database,
  fixIsError = false,
  rewriteRecordJson = false,
  env = process.env,
} = {}) {
  const writeRequested = Boolean(fixIsError) || Boolean(rewriteRecordJson);
  if (!writeRequested) return { allowed: false, reason: "no-write-flag" };
  if (typeof database !== "string" || database.trim() === "") {
    const error = new Error(
      "[transcript-projection] 存量漂移回填必须能确认目标库名（DB_NAME 为空，拒绝写入）",
    );
    error.code = "ERR_PROJECTION_BACKFILL_UNKNOWN_DATABASE";
    throw error;
  }
  const target = database.trim();
  if (target === PRODUCTION_DATABASE_NAME && env?.[DRIFT_BACKFILL_ALLOW_ENV_VAR] !== "1") {
    const error = new Error(
      `[transcript-projection] 拒绝在生产库 "${PRODUCTION_DATABASE_NAME}" 上回填：`
      + `${DRIFT_BACKFILL_ALLOW_ENV_VAR}=1 必须与 --fix-is-error / --rewrite-record-json 同时在场`,
    );
    error.code = "ERR_PROJECTION_BACKFILL_NEEDS_ALLOW_NON_TEST_DB";
    error.database = target;
    throw error;
  }
  return {
    allowed: true,
    reason: target === PRODUCTION_DATABASE_NAME ? "production-explicit" : "non-production",
  };
}

/**
 * 三格方向表：逐工具行判定 canonical 的 `is_error` 与列值。
 *
 * 只读（两查：canonical 行 + 投影行），复用 {@link deriveProjectedRows}（canonical 侧）与
 * `loadProjectionRows().toolCalls`（`bitToBoolean` 读列），不另写判据。
 *
 * @returns {Promise<Array<{runId: string, toolUseId: string, name: string,
 *   canonicalTrue: boolean, canonicalAbsent: boolean, columnTrue: boolean,
 *   direction: "A"|"B"|"C"|null, action: "set-1"|"forbidden"|"none"}>>}
 */
export async function collectToolErrorDirections({ sequelize, runIds }) {
  const rows = [];
  for (const runId of runIds) {
    const canonicalRows = await loadCanonicalRows({ sequelize, runId });
    const expected = deriveProjectedRows({ canonicalRows, runId });
    const projection = await loadProjectionRows({ sequelize, runId });
    for (const actual of projection.toolCalls) {
      const expectedRow = expected.toolCalls.get(actual.toolUseId);
      const canonicalTrue = expectedRow?.isError === true;
      const canonicalAbsent = expectedRow === undefined || expectedRow.resultPresent !== true;
      const columnTrue = actual.isError === true;
      let direction = null;
      if (canonicalTrue && !columnTrue) direction = "A";
      else if (canonicalTrue && columnTrue) direction = "B";
      else if (!canonicalTrue && columnTrue) direction = "C";
      rows.push({
        runId,
        toolUseId: actual.toolUseId,
        name: actual.name,
        canonicalTrue,
        canonicalAbsent,
        columnTrue,
        direction,
        action: direction === "A" ? "set-1" : (direction === "C" ? "forbidden" : "none"),
      });
    }
  }
  return rows;
}

/** 三格计数（报告固定输出用）。 */
export function summarizeToolErrorDirections(rows) {
  const summary = { A: 0, B: 0, C: 0, unchanged: 0, total: rows.length };
  for (const row of rows) {
    if (row.direction === null) summary.unchanged += 1;
    else summary[row.direction] += 1;
  }
  return summary;
}

/**
 * `--fix-is-error` 的写入口（**实现见文件末尾**，与 `applyProjectionWrites` 并列，
 * 保证「写 SQL 只出现在写入口函数体内」这条静态不变量仍然成立）。
 * 只改 A 格（canonical 真 & 列 0 → 1）：JS 侧只挑 `direction === "A"`，
 * SQL 侧再夹 `is_error = b'0'`，保证「列已经是 1 的行绝不会被翻回 0」。
 */

/** 两个 record 的键级差异摘要（只列键名，不列值，报告用）。 */
export function describeRecordDiff(oldRecord, newRecord) {
  const left = oldRecord !== null && typeof oldRecord === "object" && !Array.isArray(oldRecord)
    ? oldRecord : {};
  const right = newRecord !== null && typeof newRecord === "object" && !Array.isArray(newRecord)
    ? newRecord : {};
  const onlyExpected = Object.keys(right).filter((key) => !Object.hasOwn(left, key)).sort();
  const onlyActual = Object.keys(left).filter((key) => !Object.hasOwn(right, key)).sort();
  const changed = Object.keys(right)
    .filter((key) => Object.hasOwn(left, key) && !isDeepStrictEqual(left[key], right[key]))
    .sort();
  return { onlyExpected, onlyActual, changed };
}

/**
 * `--rewrite-record-json` 的**计划**（只读）：逐行用**写侧同一份**
 * `buildAgentRoundRecordSnapshot(canonical record).recordSnapshot` 重算应有快照，
 * 与盘上 `agent_rounds.record_json` 深比对，只收不一致的行。
 *
 * 禁止另写第二份快照实现——这里是唯一推导入口（C1 已把写侧推导抽成纯函数）。
 * 缺行（canonical 有、投影没有）不在本开关职责内（那属 `--apply` 重建），直接跳过。
 */
export async function planRecordJsonRewrites({ sequelize, runIds }) {
  const plans = [];
  for (const runId of runIds) {
    const canonicalRows = await loadCanonicalRows({ sequelize, runId });
    const projection = await loadProjectionRows({ sequelize, runId });
    const actualByKey = new Map(projection.allRoundRows.map((row) => [row.dedupKey, row]));
    for (const canonicalRow of canonicalRows) {
      const actual = actualByKey.get(canonicalRow.dedupKey);
      if (actual === undefined) continue;
      const { recordSnapshot } = buildAgentRoundRecordSnapshot(canonicalRow.record ?? {});
      if (isDeepStrictEqual(actual.record, recordSnapshot)) continue;
      plans.push({
        runId,
        dedupKey: canonicalRow.dedupKey,
        roundNo: canonicalRow.roundNo,
        oldRecord: actual.record ?? null,
        newRecord: recordSnapshot,
        diff: describeRecordDiff(actual.record ?? null, recordSnapshot),
      });
    }
  }
  return plans;
}

/**
 * `--rewrite-record-json` 的写入口（**实现见文件末尾**）。
 * 把计划里的 `record_json` 换成 `buildAgentRoundRecordSnapshot(canonical).recordSnapshot`；
 * 只改 `record_json` 一列（`kind`/`seq`/`part_of` 是 VIRTUAL 生成列，自动重算）。
 */

/**
 * 归一化 sequelize 原始 `query()` 的写入返回值（**两种形状**，本仓两种都出现过）：
 * - `INSERT ... ON DUPLICATE KEY UPDATE` → `[insertId, affectedRows]`（数字在第二位）
 * - `INSERT IGNORE` / `UPDATE` / `DELETE` → `[ResultSetHeader, ResultSetHeader]`（affectedRows 在第一位对象里）
 *
 * 为什么不能只读 `result[0].affectedRows`：前者会拿到 `insertId=0` ⇒ 幂等计数恒 0，
 * 第一次补齐也会被记成“没写”，第二次写 0 行就无法与它区分（幂等自证失效）。
 */
export function affectedRowsOf(result) {
  if (Array.isArray(result)) {
    if (typeof result[1] === "number") return result[1];
    if (typeof result[0] === "number") return result[0];
    return Number(result[0]?.affectedRows ?? 0);
  }
  if (typeof result === "number") return result;
  return Number(result?.affectedRows ?? 0);
}

/**
 * 重建写入需要的 requestContext（`messages.user_id` 是 NOT NULL + FK）。
 *
 * 来源优先级（都只读）：
 * 1. 调用方显式传入的 `user_id`；
 * 2. 本请求已有 `messages` 行（宿主行 / 引擎行都带 topic/user/expert）；
 * 3. `chat_requests` 行（erix runId 就是 `chat_requests.request_id`）。
 *
 * 三处都拿不到时抛可读错误，而不是把 `Column 'user_id' cannot be null` 丢给驱动层。
 */
export async function resolveProjectionRequestContext({ sequelize, runId, requestContext = {} }) {
  if (requestContext?.user_id) return requestContext;
  const [messageRows] = await sequelize.query(`
    SELECT topic_id, user_id, expert_id FROM messages
    WHERE request_id = :runId AND user_id IS NOT NULL
    ORDER BY created_at ASC LIMIT 1
  `, { replacements: { runId } });
  if (messageRows[0] !== undefined) {
    return {
      topic_id: messageRows[0].topic_id,
      user_id: messageRows[0].user_id,
      expert_id: messageRows[0].expert_id,
    };
  }
  const [requestRows] = await sequelize.query(`
    SELECT topic_id, user_id, expert_id FROM chat_requests
    WHERE request_id = :runId LIMIT 1
  `, { replacements: { runId } });
  if (requestRows[0] !== undefined) {
    return {
      topic_id: requestRows[0].topic_id,
      user_id: requestRows[0].user_id,
      expert_id: requestRows[0].expert_id,
    };
  }
  const error = new Error(
    `[transcript-projection] 无法确定 requestContext.user_id（request_id=${runId} 在 messages / chat_requests 都查不到），`
    + "拒绝写 messages 行（该列 NOT NULL + FK）",
  );
  error.code = "ERR_PROJECTION_CONTEXT_UNRESOLVED";
  throw error;
}

/** 写入口（唯一）：按对账结果补齐/修复投影。**幂等**：第二次跑写 0 行。 */
async function applyProjectionWrites({ sequelize, runId, requestContext, reconciliation }) {
  const canonicalRows = await loadCanonicalRows({ sequelize, runId });
  const projection = await loadProjectionRows({ sequelize, runId });
  const expected = deriveProjectedRows({ canonicalRows, runId, requestContext });
  const written = { agent_rounds: 0, messages: 0, chat_tool_calls: 0, pruned_messages: 0 };

  await sequelize.transaction(async (tx) => {
    // 1. agent_rounds：只补缺（INSERT IGNORE，dedup_key 唯一键兜底幂等）；不改既有行。
    const existingByKey = new Map(projection.allRoundRows.map((row) => [row.dedupKey, row]));
    const idByKey = new Map(existingByKey.size > 0
      ? [...existingByKey].map(([key, row]) => [key, row.id])
      : []);
    for (const [dedupKey, expectedRow] of expected.agentRounds) {
      if (idByKey.has(dedupKey)) continue;
      const id = `round_${Utils.newID(16)}`;
      const result = await sequelize.query(`
        INSERT IGNORE INTO agent_rounds
          (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
           folded, folded_range, record_json, ts, created_at)
        VALUES
          (:id, :runId, :roundNo, :dedupKey, :stopReason, :usage, NULL,
           :folded, :foldedRange, :recordJson, :ts, :now)
      `, {
        transaction: tx,
        replacements: {
          id,
          runId,
          roundNo: expectedRow.roundNo,
          dedupKey,
          stopReason: expectedRow.stopReason,
          usage: expectedRow.usage === null || expectedRow.usage === undefined
            ? null : JSON.stringify(expectedRow.usage),
          folded: expectedRow.folded ? 1 : 0,
          foldedRange: expectedRow.foldedRange === null || expectedRow.foldedRange === undefined
            ? null : JSON.stringify(expectedRow.foldedRange),
          recordJson: JSON.stringify(expectedRow.recordSnapshot),
          ts: expectedRow.ts ?? new Date().toISOString(),
          now: new Date(),
        },
      });
      written.agent_rounds += affectedRowsOf(result);
      idByKey.set(dedupKey, id);
    }

    // 2. messages：按 (round_id, sequence_no) 唯一键幂等 upsert（内容不一致则修复）。
    //    **不动宿主增强的 reasoning**：终稿单写会把 reasoning 换成整个 run 的累积推理，
    //    盲目回写成 canonical 那一段会毁掉现网展示值。
    const actualMessageByKey = new Map();
    const dedupKeyByRoundId = new Map(projection.allRoundRows.map((row) => [row.id, row.dedupKey]));
    for (const row of projection.messages) {
      if (row.roundId === null || row.roundId === undefined) continue;
      const owner = dedupKeyByRoundId.get(row.roundId);
      if (owner === undefined) continue;
      actualMessageByKey.set(`${owner}::${row.sequenceNo}`, row);
    }
    for (const expectedRow of expected.messages) {
      const roundId = idByKey.get(expectedRow.ownerDedupKey);
      if (roundId === undefined) continue;
      const actual = actualMessageByKey.get(`${expectedRow.ownerDedupKey}::${expectedRow.sequenceNo}`);
      if (actual !== undefined
        && actual.role === expectedRow.role
        && (actual.metaJson ?? null) === (expectedRow.metaJson ?? null)
        && isHostEnrichedReasoning({
          expectedContent: expectedRow.content,
          expectedReasoning: expectedRow.reasoningContent,
          actualContent: actual.content,
          actualReasoning: actual.reasoningContent,
        })) {
        continue; // 宿主增强行：不是缺陷，也不是重建目标
      }
      const result = await sequelize.query(`
        INSERT INTO messages
          (id, request_id, topic_id, user_id, expert_id, role, content,
           reasoning_content, round_id, sequence_no, created_at, meta_json)
        VALUES
          (:id, :requestId, :topicId, :userId, :expertId, :role, :content,
           :reasoningContent, :roundId, :sequenceNo, :createdAt, :metaJson)
        ON DUPLICATE KEY UPDATE
          role = VALUES(role),
          content = VALUES(content),
          reasoning_content = VALUES(reasoning_content),
          meta_json = VALUES(meta_json)
      `, {
        transaction: tx,
        replacements: {
          id: Utils.newID(20),
          requestId: runId,
          topicId: requestContext?.topic_id ?? null,
          userId: requestContext?.user_id ?? null,
          expertId: requestContext?.expert_id ?? null,
          role: expectedRow.role,
          content: expectedRow.content,
          reasoningContent: expectedRow.reasoningContent,
          roundId,
          sequenceNo: expectedRow.sequenceNo,
          createdAt: new Date(),
          metaJson: expectedRow.metaJson,
        },
      });
      written.messages += affectedRowsOf(result);
    }

    // 3. chat_tool_calls：按 tool_use_id 主键幂等 upsert（round_id 钉在 tool_use 那一行）。
    for (const expectedRow of expected.toolCalls.values()) {
      const roundId = idByKey.get(expectedRow.ownerDedupKey);
      if (roundId === undefined) continue;
      const result = await sequelize.query(`
        INSERT INTO chat_tool_calls
          (tool_use_id, request_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at)
        VALUES
          (:toolUseId, :runId, :roundId, :name, :inputJson, :resultJson, :isError, :duration, :now)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          input_json = VALUES(input_json),
          result_json = VALUES(result_json),
          is_error = VALUES(is_error),
          duration_ms = COALESCE(VALUES(duration_ms), duration_ms)
      `, {
        transaction: tx,
        replacements: {
          toolUseId: expectedRow.toolUseId,
          runId,
          roundId,
          name: expectedRow.name,
          inputJson: expectedRow.input === null || expectedRow.input === undefined
            ? null : JSON.stringify(expectedRow.input),
          resultJson: expectedRow.resultPresent ? JSON.stringify(expectedRow.result ?? null) : null,
          isError: expectedRow.isError ? 1 : 0,
          duration: expectedRow.durationMs,
          now: new Date(),
        },
      });
      written.chat_tool_calls += affectedRowsOf(result);
    }

    // 4. 剪掉「未被吸附」的 messages 行：round_id 指向本请求投影行、canonical 无对应消息。
    const expectedKeys = new Set(expected.messages.map((row) => `${row.ownerDedupKey}::${row.sequenceNo}`));
    for (const row of projection.messages) {
      if (row.roundId === null || row.roundId === undefined) continue; // 宿主行不动
      const ownerDedupKey = dedupKeyByRoundId.get(row.roundId);
      if (ownerDedupKey === undefined) continue;
      if (expectedKeys.has(`${ownerDedupKey}::${row.sequenceNo}`)) continue;
      const result = await sequelize.query(
        "DELETE FROM messages WHERE id = :id",
        { transaction: tx, replacements: { id: row.id } },
      );
      written.pruned_messages += affectedRowsOf(result);
    }
  });

  return written;
}

/**
 * **唯一 projector 入口**：对账 →（可选）重建。
 *
 * @param {{
 *   sequelize: import("sequelize").Sequelize,
 *   runId: string,
 *   database?: string,
 *   apply?: boolean,
 *   requestContext?: object,
 * }} params
 * @returns {Promise<object>} `{runId, apply, diffsBefore, written, diffsAfter, stats}`
 */
export async function projectRequest({ sequelize, runId, database, apply = false, requestContext = {} }) {
  assertProjectionApplyAllowed({ database, apply });
  const before = await reconcileRequest({ sequelize, runId, requestContext });
  if (!apply) {
    return {
      runId,
      apply: false,
      diffsBefore: before.diffs,
      written: null,
      diffsAfter: null,
      stats: before.stats,
    };
  }
  const resolvedContext = await resolveProjectionRequestContext({ sequelize, runId, requestContext });
  const written = await applyProjectionWrites({
    sequelize, runId, requestContext: resolvedContext, reconciliation: before,
  });
  const after = await reconcileRequest({ sequelize, runId, requestContext });
  return {
    runId,
    apply: true,
    diffsBefore: before.diffs,
    written,
    diffsAfter: after.diffs,
    stats: after.stats,
  };
}

// ==================== 存量漂移回填写入口（#1227 阶段 3 切片 C2b） ====================
//
// ⚠ 放在文件末尾是刻意的：`transcript-projection-reconcile.test.mjs` 有一条静态不变量
// 「`async function applyProjectionWrites` 之前的代码段不得出现写 SQL」。两个回填写入口
// 与它并列放在写区，dry-run 代码段（取行 / 推导 / 对账 / 计划）仍然一行写 SQL 都没有。

/**
 * `--fix-is-error` 的**唯一写入口**：只改 A 格（canonical 真 & 列 0 → 1）。
 *
 * 双保险：
 * 1. JS 侧只挑 `direction === "A"`（C 格 = 列真 & canonical 非真，**永不进入**）；
 * 2. SQL 侧再夹 `is_error = b'0'`，保证「列已经是 1 的行绝不会被翻回 0」，
 *    并发下也不会覆盖别人的写入。
 *
 * @returns {Promise<{written: number, applied: object[]}>}
 */
export async function applyToolErrorBackfill({ sequelize, rows }) {
  let written = 0;
  const applied = [];
  for (const row of rows) {
    if (row.direction !== "A") continue;
    const result = await sequelize.query(`
      UPDATE chat_tool_calls
         SET is_error = b'1'
       WHERE request_id = :runId AND tool_use_id = :toolUseId AND is_error = b'0'
    `, { replacements: { runId: row.runId, toolUseId: row.toolUseId } });
    const affected = affectedRowsOf(result);
    written += affected;
    applied.push({ runId: row.runId, toolUseId: row.toolUseId, affected });
  }
  return { written, applied };
}

/**
 * `--rewrite-record-json` 的**唯一写入口**：把计划里的 `record_json` 换成快照。
 *
 * 幂等：只写 `record_json <> :recordJson` 的行（MySQL 对 JSON 列按规范化值比较），
 * 因此第二次跑计划本身就是空的，写 0 行。
 *
 * 只改 `record_json` 一列：`kind` / `seq` / `part_of` 是 VIRTUAL 生成列，自动重算。
 */
export async function applyRecordJsonRewrites({ sequelize, plans }) {
  let written = 0;
  const applied = [];
  for (const plan of plans) {
    const recordJson = JSON.stringify(plan.newRecord);
    const result = await sequelize.query(`
      UPDATE agent_rounds
         SET record_json = :recordJson
       WHERE request_id = :runId AND dedup_key = :dedupKey AND record_json <> :recordJson
    `, { replacements: { runId: plan.runId, dedupKey: plan.dedupKey, recordJson } });
    const affected = affectedRowsOf(result);
    written += affected;
    applied.push({ runId: plan.runId, dedupKey: plan.dedupKey, affected });
  }
  return { written, applied };
}
