/**
 * touwaka TranscriptStore v2（issue #1134，erix-agent 0.14.0 capability 分级）
 *
 * 三层拆行持久化：一个 erix RoundRecord 落三张表——
 * - agent_rounds：一行 = 一轮（round 元数据 + record_json 其余字段）
 * - messages：一行 = 一个 canonical message 的非工具内容（text→content、
 *   reasoning→reasoning_content、multimodal→content 现有 JSON 形态）
 * - chat_tool_calls：一行 = 一次工具调用全生命周期（tool_use INSERT、
 *   tool_result 后续 UPSERT，主键 tool_use_id）
 *
 * 只实现 erix-agent 0.14.0 的必需能力 {appendRound, load}；run-state/run snapshot
 * 等可选 capability 有意不实现。U1 replay / U2 partialPersistence 未启用；
 * persistence_capability_degraded 诊断事件为预期（仅未实现可选 capability 时每方法一条），
 * run 正常执行，仅不支持中途 crash resume。
 *
 * load() 重组保真：拆行前的 RoundRecord 与 load() 输出在
 * round/ts/messages（含 tool_use/tool_result 块位置）/folded/foldedPayload
 * 上等价（erix-agent 0.14.0 在同一轮内先执行工具再落盘 appendRound，tool_use 与
 * tool_result 同属 tool_use 发生轮）。
 *
 * 保真范围扩充（issue #1146，erix-agent 0.16.0 "Store fidelity requirements"）：
 * roundKey / meta / response 已移出 SUMMARY_FIELDS，随 record_json 原样往返，
 * 故 load() 输出额外在 roundKey、meta、response（含 response.content 的
 * reasoning/tool_use 块与 usage/stopReason）上与拆行前等价。
 *
 * 已知偏离（等 Eric 决策，见 issue #1146）：messages[].meta.source 仍未落库——
 * messages 表没有对应列，补列属红线 2.1（数据库字段需 Eric 同意），本 issue 不做。
 * 后果按上游契约：合成消息的分类回退到文本前缀启发式，注入的 judge 方向提示轮
 * 可能被当成真实用户消息，且 resume 后评委的 judge-control 排除规则失效
 * （当前文本启发式识别不出其【Judge 评审意见】前缀）。
 *
 * 代价说明：response 移出白名单后 record_json 会变大，其中 stopReason/usage 与
 * agent_rounds 的 stop_reason/`usage` 两列重复。两列**有意保留不删**（仍供
 * 查询与排查用），load() 改为 record_json 优先、仅在 record_json 缺 response 时
 * 才用列合成，故重复不影响往返保真。
 *
 * 实现说明：三张表走 sequelize 参数化 raw query，不依赖 models/init-models.js
 * 注册（agent_rounds/chat_tool_call 模型由 T1 生成但未挂进 init-models，
 * models/ 属 T1 禁手改范围）。
 */

import Utils from "../utils.js";

// issue #1146：roundKey / meta / response 已移出白名单，随 record_json 原样往返
// （erix-agent 0.16.0 禁止用字段白名单重建 RoundRecord）。
const SUMMARY_FIELDS = [
  "round",
  "dedupKey",
  "ts",
  "messages",
  "folded",
  "foldedRoundRange",
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

  if (content === null) {
    // 只有 reasoning 块（思考模型空文本轮）的 assistant 消息：messages.content 是
    // NOT NULL，写 null 会报 "Column 'content' cannot be null" → appendRound 抛
    // persistence_failed 终止整个 run（真机缺陷）。此处落空串满足约束且不改 DDL/
    // models；内容全空（既无文本也无 reasoning）才整行跳过。
    if (!reasoning) return null;
    content = "";
  }

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
      const dedupKey = record.dedupKey ?? `${runId}:round:${record.round}`;
      // 幂等复用 round_id：重复调用（persist 重试/dedup_key 撞车）时若
      // agent_rounds 已落（可能 messages 尚未落完），复用其 id 而不是生成新的
      // 孤儿 round_id；messages 拆行再靠 uk_messages_round_seq 逐行幂等跳过。
      const [existingRounds] = await sequelize.query(
        "SELECT id FROM agent_rounds WHERE dedup_key = :dedupKey LIMIT 1",
        { replacements: { dedupKey } },
      );
      const roundId = existingRounds[0]?.id ?? `round_${Utils.newID(16)}`;
      const createdAt = (() => {
        const parsed = new Date(record.ts);
        return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
      })();

      // 1. agent_rounds（dedup_key 唯一键 + INSERT IGNORE 幂等）
      // round 0 是 erix 的种子记录（resume-manager.js：初始上下文入档），其 messages
      // 是完整初始上下文而非本轮新增——下方跳过拆行，故 record_json 必须保留 messages
      // 全量，否则 load() 还原不出种子轮（ADR-002 档案完整性 / resume 的 taskBriefSource）。
      const isSeedRound = record.round === 0;
      const summaryFields = isSeedRound
        ? SUMMARY_FIELDS.filter((field) => field !== "messages")
        : SUMMARY_FIELDS;
      const recordSnapshot = Object.fromEntries(
        Object.entries(record).filter(([key]) => !summaryFields.includes(key)),
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
      // round 0 种子轮整轮跳过拆行：其 messages 是完整初始上下文（系统技能提示 +
      // 之前所有历史对话，见 erix resume-manager 种子写入），历史消息与工具调用
      // 早已在 messages/chat_tool_calls 里；照常拆行会让每跑一次 run 就多出一整套
      // 历史副本（前端重复显示 + 存储暴涨，真机缺陷）。
      if (!isSeedRound) {
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
          // uk_messages_round_seq 撞键时幂等跳过，保留首轮行（先写先赢）
          await sequelize.query(`
            INSERT INTO messages
              (id, request_id, topic_id, user_id, expert_id, role, content,
               reasoning_content, round_id, sequence_no, created_at)
            VALUES
              (:id, :requestId, :topicId, :userId, :expertId, :role, :content,
               :reasoningContent, :roundId, :sequenceNo, :createdAt)
            ON DUPLICATE KEY UPDATE id = id
          `, { replacements: row });
        }
      }
    },

    async load(runId) {
      // 同轮保序（issue #1146）：erix-agent 0.16.0 契约 "Load order" 要求同 round
      // 的记录保持持久化追加顺序（早追加的在前），且引擎 resume-manager 按 load()
      // 返回顺序直接重建状态、**不再二次排序**（也不按 dedupKey 命名空间修补）。
      // 只按 round_no 排序时，同轮多行（典型：appendUserTurn 有意复用 max round
      // 预写的用户行 vs 上一引擎轮）的先后就交给执行计划/主键扫描/filesort 巧合，
      // 契约明文禁止依赖此类巧合，故显式加二级键。
      // 二级键选 id：agent_rounds.id 由 Utils.newID 生成（`round_${Utils.newID(16)}`，
      // 时间戳前缀 + 同毫秒递增，且 SAFE_CHARS 按 ASCII 升序→字典序等价于生成序），
      // 单调且本身就是主键的一部分，符合契约“持久插入时间戳 + 唯一二级键（或主键一部分）”
      // 的可选项，零 DDL 即可稳定保序（无新增 append_seq 列）。
      const [rounds] = await sequelize.query(`
        SELECT id, request_id, round_no, dedup_key, stop_reason, \`usage\`,
               folded, folded_range, record_json, ts
        FROM agent_rounds
        WHERE request_id = :runId
        ORDER BY round_no ASC, id ASC
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
        // response 保真（issue #1146）：response 已移出 SUMMARY_FIELDS，新写的行在
        // record_json 里已有**完整** response（含 content）；列合成只有
        // stopReason/usage 两项，无条件覆盖会把完整的 response.content 擦掉。
        // 故改成 record_json 优先，仅当其中缺 response（本次升级前写入的历史行，
        // 其 record_json 由旧白名单剔掉了 response）时才用列合成兼容。
        if (record.response === undefined || record.response === null) {
          const response = {};
          if (round.stop_reason !== null && round.stop_reason !== undefined) {
            response.stopReason = round.stop_reason;
          }
          if (usage !== undefined) response.usage = usage;
          if (Object.keys(response).length > 0) record.response = response;
        }

        const roundMessages = messageRows[0].filter((row) => row.round_id === round.id);
        const roundTools = toolRows[0].filter((row) => row.round_id === round.id);
        // 无拆行行的轮（round 0 种子：appendRound 有意不拆行，messages 只存在于
        // record_json）：原样取回 record_json.messages，不做 tool_use/tool_result
        // 合成（种子里的历史块早已是完整 canonical 形态）。其余轮 record_json 不含
        // messages，照常按拆行重组。
        const recordJsonMessages = Array.isArray(record.messages) ? record.messages : null;
        const hasSplitRows = roundMessages.length > 0 || roundTools.length > 0;
        record.messages = recordJsonMessages !== null && !hasSplitRows
          ? recordJsonMessages
          : reconstructMessages(roundMessages, roundTools);
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
 *
 * 块顺序约定：canonical 消息块序为 [text..., tool_use..., reasoning]（文本 → 工具
 * 调用 → 思考）。拆行后 tool_use 归 chat_tool_calls、reasoning 归 reasoning_content
 * 列，块间相对位置不再可记录，load 只能按此约定还原（content 列 → text/multimodal
 * 块，chat_tool_calls → 追加 assistant 行尾 tool_use，reasoning_content 列 → 还原
 * reasoning 块）；非该约定的块序无法保真。touwaka 无 run snapshot capability，erix
 * 仅在 resume 时调用 load，实际不会触发顺序敏感路径。
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
