/**
 * touwaka TranscriptStore v2（issue #1134，erix-agent 0.12.0 capability 分级）
 *
 * 三层拆行持久化：一个 erix RoundRecord 落三张表——
 * - agent_rounds：一行 = 一轮（round 元数据 + record_json 其余字段）
 * - messages：一行 = 一个 canonical message 的非工具内容（text→content、
 *   reasoning→reasoning_content、multimodal→content 现有 JSON 形态）
 * - chat_tool_calls：一行 = 一次工具调用全生命周期（tool_use INSERT、
 *   tool_result 后续 UPSERT，主键 tool_use_id）
 *
 * 只实现 erix 0.12.0 的必需能力 {appendRound, load}；run-state/run snapshot
 * 等可选 capability 有意不实现（erix 每方法发一次 persistence_capability_degraded
 * 诊断，run 正常执行，仅不支持中途 crash resume）。
 *
 * load() 重组保真：拆行前的 RoundRecord 与 load() 输出在
 * round/ts/messages（含 tool_use/tool_result 块位置）/folded/foldedPayload
 * 上等价（erix 0.12.0 在同一轮内先执行工具再落盘 appendRound，tool_use 与
 * tool_result 同属 tool_use 发生轮）。
 *
 * 实现说明：三张表走 sequelize 参数化 raw query，不依赖 models/init-models.js
 * 注册（agent_rounds/chat_tool_call 模型由 T1 生成但未挂进 init-models，
 * models/ 属 T1 禁手改范围）。
 */

import Utils from "../utils.js";

const SUMMARY_FIELDS = [
  "round",
  "roundKey",
  "dedupKey",
  "ts",
  "messages",
  "response",
  "folded",
  "foldedRoundRange",
  "meta",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonColumn(value) {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return JSON.parse(value);
  return value;
}

function jsonOrNull(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function contentBlocksOf(message) {
  if (Array.isArray(message?.content)) return message.content;
  if (typeof message?.content === "string") {
    return [{ type: "text", text: message.content }];
  }
  return [];
}

// 兼容现有 saveUserMessage 的 multimodal 存储形态：
// content = JSON.stringify({ type: 'multimodal', content: [...] })
function isMultimodalEnvelope(text) {
  if (typeof text !== "string" || !text.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) && parsed.type === "multimodal" && Array.isArray(parsed.content);
  } catch {
    return false;
  }
}

/**
 * 把一条 canonical message 的非工具内容映射为 messages 行字段（D2-i）。
 * 返回 null 表示整行无内容（纯 tool_use / tool_result 消息），不插行。
 */
function messageRowFor(message, sequenceNo, roundId, runId, requestContext, createdAt) {
  const textParts = [];
  const reasoningParts = [];
  let multimodalBlocks = null;

  for (const block of contentBlocksOf(message)) {
    if (!isRecord(block)) continue;
    if (block.type === "text") {
      textParts.push(String(block.text ?? ""));
    } else if (block.type === "reasoning") {
      reasoningParts.push(String(block.text ?? block.reasoning ?? ""));
    } else if (block.type === "image" || block.type === "multimodal") {
      multimodalBlocks = multimodalBlocks ?? [];
      if (block.type === "multimodal" && Array.isArray(block.content)) {
        multimodalBlocks.push(...block.content);
      } else {
        multimodalBlocks.push(block);
      }
    }
    // tool_use / tool_result 块不进 messages 行（进 chat_tool_calls）
  }

  const text = textParts.join("");
  const reasoning = reasoningParts.join("\n");

  let content = null;
  if (multimodalBlocks !== null) {
    content = text
      ? JSON.stringify({ type: "multimodal", content: [{ type: "text", text }, ...multimodalBlocks] })
      : JSON.stringify({ type: "multimodal", content: multimodalBlocks });
  } else if (text) {
    content = text;
  }

  if (content === null && !reasoning) return null;

  return {
    id: Utils.newID(20),
    requestId: runId,
    topicId: requestContext?.topic_id ?? null,
    userId: requestContext?.user_id ?? null,
    expertId: requestContext?.expert_id ?? null,
    role: message.role,
    content,
    reasoningContent: reasoning || null,
    roundId,
    sequenceNo,
    createdAt,
  };
}

/** messages 行还原为 canonical message（content 数组 + 尾部 reasoning 块）。 */
function canonicalFromRow(row) {
  const blocks = [];
  if (row.content) {
    if (isMultimodalEnvelope(row.content)) {
      blocks.push(...JSON.parse(row.content).content);
    } else {
      blocks.push({ type: "text", text: row.content });
    }
  }
  if (row.reasoning_content) {
    blocks.push({ type: "reasoning", text: row.reasoning_content });
  }
  if (blocks.length === 0) return null;
  return { role: row.role, content: blocks };
}

/**
 * Create a MariaDB-backed TranscriptStore（三层拆行，issue #1134）。
 *
 * @param {{
 *   db: {sequelize: import("sequelize").Sequelize},
 *   requestContext?: {request_id?: string, topic_id?: string, user_id: string, expert_id?: string},
 * }} options
 * @returns {{ appendRound: (runId:string, record:object) => Promise<void>, load: (runId:string) => Promise<object[]> }}
 */
export function createTouwakaTranscriptStore({ db, requestContext } = {}) {
  if (!db?.sequelize) throw new Error("[llm-kit-adapters] db 实例必填");

  const { sequelize } = db;

  return {
    async appendRound(runId, record) {
      if (!isRecord(record)) {
        throw new Error("[llm-kit-adapters] appendRound record 必须为对象");
      }
      const roundId = `round_${Utils.newID(16)}`;
      const dedupKey = record.dedupKey ?? `${runId}:round:${record.round}`;
      const createdAt = (() => {
        const parsed = new Date(record.ts);
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
      })();

      // 1. agent_rounds（dedup_key 唯一键 + INSERT IGNORE 幂等）
      const recordSnapshot = Object.fromEntries(
        Object.entries(record).filter(([key]) => !SUMMARY_FIELDS.includes(key)),
      );
      await sequelize.query(`
        INSERT IGNORE INTO agent_rounds
          (id, request_id, round_no, dedup_key, stop_reason, \`usage\`, latency_ms,
           folded, folded_range, record_json, ts, created_at)
        VALUES
          (:id, :runId, :roundNo, :dedupKey, :stopReason, :usage, NULL,
           :folded, :foldedRange, :recordJson, :ts, :now)
      `, {
        replacements: {
          id: roundId,
          runId,
          roundNo: record.round,
          dedupKey,
          stopReason: record.response?.stopReason ?? null,
          usage: jsonOrNull(record.response?.usage),
          folded: Boolean(record.folded ?? false),
          foldedRange: jsonOrNull(record.foldedRoundRange),
          recordJson: jsonOrNull(recordSnapshot),
          ts: record.ts,
          now: new Date(),
        },
      });

      // 2 + 3. record.messages 拆行：非工具内容 → messages；tool_use/tool_result → chat_tool_calls
      const messageRows = [];
      for (const [index, message] of (record.messages ?? []).entries()) {
        if (!isRecord(message)) continue;
        const row = messageRowFor(
          message, index, roundId, runId, requestContext, createdAt,
        );
        if (row) messageRows.push(row);

        for (const block of contentBlocksOf(message)) {
          if (!isRecord(block)) continue;
          if (block.type === "tool_use") {
            // 先写先赢：同 tool_use_id 重复到达不覆盖首轮数据
            await sequelize.query(`
              INSERT INTO chat_tool_calls
                (tool_use_id, request_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at)
              VALUES
                (:toolUseId, :runId, :roundId, :name, :inputJson, NULL, b'0', NULL, :now)
              ON DUPLICATE KEY UPDATE
                name = IF(name = '', VALUES(name), name),
                input_json = IF(input_json IS NULL, VALUES(input_json), input_json)
            `, {
              replacements: {
                toolUseId: String(block.id),
                runId,
                roundId,
                name: String(block.name ?? ""),
                inputJson: jsonOrNull(block.input),
                now: new Date(),
              },
            });
          } else if (block.type === "tool_result") {
            // 正身原样存 canonical content（JSON 序列化满足 json_valid CHECK）；
            // round_id 保持 tool_use 发生轮不动；容忍乱序先 INSERT 后 UPDATE。
            await sequelize.query(`
              INSERT INTO chat_tool_calls
                (tool_use_id, request_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at)
              VALUES
                (:toolUseId, :runId, :roundId, '', NULL, :resultJson, :isError, NULL, :now)
              ON DUPLICATE KEY UPDATE
                result_json = VALUES(result_json),
                is_error = VALUES(is_error)
            `, {
              replacements: {
                toolUseId: String(block.tool_use_id),
                runId,
                roundId,
                resultJson: JSON.stringify(block.content ?? null),
                isError: Boolean(block.is_error),
                now: new Date(),
              },
            });
          }
        }
      }
      for (const row of messageRows) {
        await sequelize.query(`
          INSERT INTO messages
            (id, request_id, topic_id, user_id, expert_id, role, content,
             reasoning_content, round_id, sequence_no, created_at)
          VALUES
            (:id, :requestId, :topicId, :userId, :expertId, :role, :content,
             :reasoningContent, :roundId, :sequenceNo, :createdAt)
        `, { replacements: row });
      }
    },

    async load(runId) {
      const [rounds] = await sequelize.query(`
        SELECT id, request_id, round_no, dedup_key, stop_reason, \`usage\`,
               folded, folded_range, record_json, ts
        FROM agent_rounds
        WHERE request_id = :runId
        ORDER BY round_no ASC
      `, { replacements: { runId } });
      if (rounds.length === 0) return [];

      const roundIds = rounds.map((row) => row.id);
      const [messageRows, toolRows] = await Promise.all([
        sequelize.query(`
          SELECT id, role, content, reasoning_content, round_id, sequence_no
          FROM messages
          WHERE round_id IN (:roundIds)
          ORDER BY round_id ASC, sequence_no ASC
        `, { replacements: { roundIds } }),
        sequelize.query(`
          SELECT tool_use_id, round_id, name, input_json, result_json, is_error, created_at
          FROM chat_tool_calls
          WHERE round_id IN (:roundIds)
          ORDER BY round_id ASC, created_at ASC, tool_use_id ASC
        `, { replacements: { roundIds } }),
      ]);

      return rounds.map((round) => {
        const record = parseJsonColumn(round.record_json) ?? {};
        record.round = round.round_no;
        record.ts = round.ts;
        record.dedupKey = round.dedup_key;
        record.folded = Boolean(round.folded);
        const foldedRange = parseJsonColumn(round.folded_range);
        if (foldedRange !== undefined) record.foldedRoundRange = foldedRange;
        const usage = parseJsonColumn(round.usage);
        const response = {};
        if (round.stop_reason !== null && round.stop_reason !== undefined) {
          response.stopReason = round.stop_reason;
        }
        if (usage !== undefined) response.usage = usage;
        if (Object.keys(response).length > 0) record.response = response;

        const roundMessages = messageRows[0].filter((row) => row.round_id === round.id);
        const roundTools = toolRows[0].filter((row) => row.round_id === round.id);
        record.messages = reconstructMessages(roundMessages, roundTools);
        return record;
      });
    },
  };
}

/**
 * 重组一轮的 canonical messages（load 保真的核心）。
 *
 * - messages 行按 sequence_no 还原 text/reasoning/multimodal 块；
 * - 本轮 chat_tool_calls 还原 tool_use 块：assistant 行存在则追加其 content 尾，
 *   否则合成纯 tool_use assistant 消息（erix 轮首形态 / 轮中用户文本后形态，
 *   按 sequence 空隙插入正确位置）；
 * - 有 result_json 的行还原独立 user tool_result 消息，紧随其后。
 */
function reconstructMessages(roundMessages, roundTools) {
  const base = [];
  for (const row of roundMessages) {
    const message = canonicalFromRow(row);
    if (message) base.push({ sequenceNo: row.sequence_no, message });
  }
  if (roundTools.length === 0) {
    return base.map((entry) => entry.message);
  }

  const toolUseBlocks = roundTools.map((row) => ({
    type: "tool_use",
    id: row.tool_use_id,
    name: row.name,
    ...(row.input_json ? { input: JSON.parse(row.input_json) } : {}),
  }));
  // erix 契约：一轮的全部 tool_result 合并为一个独立 user 消息（content 数组）
  const toolResultBlocks = roundTools
    .filter((row) => row.result_json !== null && row.result_json !== undefined)
    .map((row) => ({
      type: "tool_result",
      tool_use_id: row.tool_use_id,
      content: JSON.parse(row.result_json),
      ...(row.is_error ? { is_error: true } : {}),
    }));
  const toolResultMessages = toolResultBlocks.length > 0
    ? [{ role: "user", content: toolResultBlocks }]
    : [];

  const assistantIndex = base.reduce(
    (found, entry, index) => (entry.message.role === "assistant" ? index : found),
    -1,
  );

  if (assistantIndex >= 0) {
    // assistant 行在：tool_use 块追加其 content 尾，tool_result 消息紧随其后
    base[assistantIndex].message.content.push(...toolUseBlocks);
    base.splice(assistantIndex + 1, 0, ...toolResultMessages.map((message) => ({
      sequenceNo: null,
      message,
    })));
    return base.map((entry) => entry.message);
  }

  // 纯 tool_use assistant（无文本行）：合成 assistant 消息 + tool_result 消息。
  // 定位：最后一行 user 的 sequence_no 与行位有空隙（说明其后原本还有被跳过的
  // tool_result/hint 消息）则插到该行之前；否则追加轮尾（用户文本行之后 / 空轮）。
  const synthesized = [
    { sequenceNo: null, message: { role: "assistant", content: toolUseBlocks } },
    ...toolResultMessages.map((message) => ({ sequenceNo: null, message })),
  ];
  let insertAt = base.length;
  if (base.length > 0) {
    const last = base[base.length - 1];
    const hasGapBeforeLast = last.sequenceNo !== null
      && last.sequenceNo > base.length - 1;
    if (last.message.role === "user" && hasGapBeforeLast) {
      insertAt = base.length > 1 ? base.length - 1 : 0;
    }
  }
  base.splice(insertAt, 0, ...synthesized);
  return base.map((entry) => entry.message);
}
