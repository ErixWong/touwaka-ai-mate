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
 * 必需能力是 erix-agent 的 {appendRound, load}（0.14.0 #78 capability 分级）；
 * run-state/run snapshot 等可选 capability 有意不实现。U1 replay / U2 partialPersistence
 * 未启用；persistence_capability_degraded 诊断事件为预期（仅未实现可选 capability 时每方法一条），
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
 * 已知偏离已闭环（issue #1147，erix-agent 0.16.0 契约最后一处缺口）：
 * messages[].meta 现随新列 messages.meta_json（longtext NULL，DDL 已由 Eric 批准）
 * 原样往返——写侧 JSON.stringify、读侧 JSON.parse 后整对象挂回 message.meta，
 * **不做固定键白名单**，故未知键同样保真（契约 "including fields it does not
 * understand"）。meta.source 是引擎保留标记（judge 方向提示轮 = "judge-control"），
 * 宿主不得用它写自己的来源信息。闭环后 projectTranscriptForDisplay 对该类轮
 * 输出 meta.synthetic=true / source="judge-control"（#1146 里是 false），评委的
 * judge-control 排除规则也不再依赖文本前缀启发式。
 * 历史行（本列上线前写入）meta_json 为 NULL：读侧不回填、不报错，也不会挂出空
 * meta 对象；其 synthetic 分类回退上游文本前缀启发式（行为与 #1146 一致）。
 * 已知残留：纯 tool_use/tool_result 消息（无文本内容，按 D2-i 不落 messages 行）
 * 其 meta 无处存放，仍随拆行丢失。
 *
 * 代价说明：response 移出白名单后 record_json 会变大，其中 stopReason/usage 与
 * agent_rounds 的 stop_reason/`usage` 两列重复。两列**有意保留不删**（仍供
 * 查询与排查用），load() 改为 record_json 优先、仅在 record_json 缺 response 时
 * 才用列合成，故重复不影响往返保真。
 *
 * 实现说明：三张表走 sequelize 参数化 raw query，不依赖 models/init-models.js
 * 注册（agent_rounds/chat_tool_call 模型由 T1 生成但未挂进 init-models，
 * models/ 属 T1 禁手改范围）。
 *
 * 能力档位变化（issue #1150，erix-agent 0.17.0 成对可选快路径探针，上游 #157）：
 * 档位从「必需面 {appendRound, load} + 两条探针都不实现」改为**两条探针都实现**
 * （loadByDedupKey / loadMaxRound；成对语义：只实现一条 == 都没实现）。引擎
 * appendUserTurn 据此走点查快路径：先算 dedupKey → loadByDedupKey 命中即返回
 * （loadMaxRound 与 load 都不再调用）；未命中才 loadMaxRound 派生 round → appendRound。
 * **快路径全程不调用 store.load**，直接消掉原先在接收消息事务内的全量 load()。
 * 两条探针全走现成索引，零 DDL：dedup_key 走唯一键 uk_agent_rounds_dedup_key；
 * roundKey 兜底谓词用 JSON_UNQUOTE(JSON_EXTRACT(record_json,'$.roundKey'))，仅扫本会话
 * round 行，代价远小于全量 load，**不为此加列 / 加索引**；loadMaxRound 是
 * idx_agent_rounds_request 上的 MAX(round_no)。探针命中的记录与 load() 对同一轮的输出
 * **逐字段一致**（复用同一个装配函数 assembleRoundRecord，不另写简化装配）。
 * run snapshot / run-state 等其余可选 capability 仍有意不实现。
 *
 * 两条实现决定值得留意（均已在 lib/llm-kit-adapters/README.md 展开）：
 * 1. SQL 用 **OR 并集**（dedup_key 或 record_json.roundKey）只取候选；候选按
 *    `round_no DESC, id DESC` 取最近 N 行（N 默认 {@link DEFAULT_DEDUP_CANDIDATE_LIMIT}，
 *    issue #1166 加的资源上界），翻正后按 load() 的 round_no / id 顺序装配每条候选，
 *    再严格应用上游判据 `(record?.dedupKey ?? record?.roundKey) === dedupKey`。这样即使
 *    两字段冲突或 JSON null 与 SQL NULL 语义不同，探针仍与全量路径一致（窗口外的真
 *    命中按“未命中”处理）。上游对此的裁决见 erix-agent #171。
 * 2. **不发明字段**：写入方没给 dedupKey/ts/folded 时列仍补齐（NOT NULL 与历史行行为不变），
 *    但 record_json 里用内部键 __hostSynthesizedColumns 记下“该列值是宿主补的”，读侧据此
 *    不回填；若写入方也提供了同名字段，则封存并还原其原值。
 *    appendRound 同时容忍缺 ts（否则 NOT NULL 列会把可预期的 miss 变成驱动层报错）。
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

// 宿主合成字段标记在 record_json 里的内部键（issue #1150）；写入方同名字段会被封存，
// 并在读侧恢复原值，避免私有键吞掉合法字段。
const HOST_SYNTHESIZED_FIELDS_KEY = "__hostSynthesizedColumns";

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

function durationMsOrNull(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
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
    // issue #1147：message.meta 原样 JSON 落库（含引擎保留键 source 与宿主未知键），
    // 无 meta 时写 NULL。不做键过滤、也不要求必须是对象——上游契约禁止按白名单
    // 重建 message，任何已定义的 meta 值都必须能原样回来。
    metaJson: message.meta === undefined || message.meta === null
      ? null
      : JSON.stringify(message.meta),
  };
}

/**
 * meta_json 列还原为 message.meta（issue #1147）。
 * 解析结果整值原样返回，不做键白名单；NULL / 空串 / JSON null / 解析失败视为
 * 无 meta（返回 undefined），故历史行既不报错也不会挂出空 meta 对象。
 */
function parseMetaColumn(value) {
  if (value === null || value === undefined || value === "") return undefined;
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    return undefined;
  }
  return parsed === null ? undefined : parsed;
}

/** messages 行还原为 canonical message（content 数组 + 尾部 reasoning 块 + meta）。 */
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
  const meta = parseMetaColumn(row.meta_json);
  return meta === undefined
    ? { role: row.role, content: blocks }
    : { role: row.role, content: blocks, meta };
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
      // 上游契约把 ts 归入 RoundRecord 必需字段，但 fixture / 第三方写入方并不总是给
      // （官方 transcriptStoreContract 的 “同轮保序” / roundKey 兑底记录就没带）。
      // agent_rounds.ts 是 NOT NULL，直接把 undefined 交给替换参数会装出驱动层的
      // "Named replacement :ts has no entry"，而非可读错误；与 createdAt 一样退到 now。
      const tsValue = typeof record.ts === "string" && record.ts !== ""
        ? record.ts
        : createdAt.toISOString();
      // 字段发明防止（issue #1150）：上面三个字段本来不存在于传入的 record 里，
      // 但列是 NOT NULL / load() 会回填，于是 load() 会“发明”写入方没给的字段，
      // 破坏 “拆行前 RoundRecord ≡ load() 输出” 的逐字段等价（官方契约对整 record
      // 做 deepStrictEqual，多一个 folded:false 就挂）。dedupKey 与 ts 的 nullish 条件一致；
      // 列值仍可补，但读回时还原写入方显式提供的 null。record_json 标记列值由宿主合成。
      const hostSynthesizedFields = [
        ...(record.dedupKey === undefined || record.dedupKey === null ? ["dedupKey"] : []),
        ...(record.ts === undefined || record.ts === null ? ["ts"] : []),
        ...(record.folded === undefined ? ["folded"] : []),
      ];

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
      const hasOriginalHostKey = Object.hasOwn(recordSnapshot, HOST_SYNTHESIZED_FIELDS_KEY);
      if (hostSynthesizedFields.length > 0 || hasOriginalHostKey) {
        recordSnapshot[HOST_SYNTHESIZED_FIELDS_KEY] = makeHostSynthesizedMarker(
          record,
          hostSynthesizedFields,
          hasOriginalHostKey,
        );
      }
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
          ts: tsValue,
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
              // erix-agent 将本次执行耗时作为 tool_result.duration 提供。
              await sequelize.query(`
                INSERT INTO chat_tool_calls
                  (tool_use_id, request_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at)
                VALUES
                  (:toolUseId, :runId, :roundId, '', NULL, :resultJson, :isError, :duration, :now)
                ON DUPLICATE KEY UPDATE
                  result_json = VALUES(result_json),
                  is_error = VALUES(is_error),
                  duration_ms = COALESCE(VALUES(duration_ms), duration_ms)
              `, {
                replacements: {
                  toolUseId: String(block.tool_use_id),
                  runId,
                  roundId,
                  resultJson: JSON.stringify(block.content ?? null),
                  isError: Boolean(block.is_error),
                  duration: durationMsOrNull(block.duration),
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
               reasoning_content, round_id, sequence_no, created_at, meta_json)
            VALUES
              (:id, :requestId, :topicId, :userId, :expertId, :role, :content,
               :reasoningContent, :roundId, :sequenceNo, :createdAt, :metaJson)
            ON DUPLICATE KEY UPDATE id = id
          `, { replacements: row });
        }
      }
    },

    async load(runId) {
      const [rounds] = await sequelize.query(ROUND_COLUMNS_SQL + `
        WHERE request_id = :runId
        ORDER BY round_no ASC, id ASC
      `, { replacements: { runId } });
      if (rounds.length === 0) return [];

      const roundIds = rounds.map((row) => row.id);
      const [messageRows, toolRows] = await Promise.all([
        sequelize.query(`
          SELECT id, role, content, reasoning_content, round_id, sequence_no, meta_json
          FROM messages
          WHERE round_id IN (:roundIds)
          ORDER BY round_id ASC, sequence_no ASC
        `, { replacements: { roundIds } }),
        sequelize.query(`
          SELECT tool_use_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at
          FROM chat_tool_calls
          WHERE round_id IN (:roundIds)
          ORDER BY round_id ASC, created_at ASC, tool_use_id ASC
        `, { replacements: { roundIds } }),
      ]);

      // 同轮保序（issue #1146）：erix-agent 0.16.0 契约 "Load order" 要求同 round
      // 的记录保持持久化追加顺序（早追加的在前），且引擎 resume-manager 按 load()
      // 返回顺序直接重建状态、**不再二次排序**（也不按 dedupKey 命名空间修补）。
      // 只按 round_no 排序时，同轮多行（典型：appendUserTurn 有意复用 max round
      // 预写的用户行 vs 上一引擎轮）的先后就交给执行计划 / 主键扫描 / filesort 巧合，
      // 契约明文禁止依赖此类巧合，故显式加二级键 id（Utils.newID 时间戳前缀、单调，
      // 且本身就是主键一部分），零 DDL 稳定保序。
      return rounds.map((round) => assembleRoundRecord(
        round,
        messageRows[0].filter((row) => row.round_id === round.id),
        toolRows[0].filter((row) => row.round_id === round.id),
      ));
    },

    /**
     * 成对可选快路径探针之一（issue #1150 / erix-agent 0.17.0 / 上游 #157）。
     *
     * 谓词严格等于全量路径对 load() 结果施加的判据：
     * `(record?.dedupKey ?? record?.roundKey) === dedupKey`。SQL OR 仅用于取候选，不能
     * 决定命中（dedupKey 与 roundKey 可能冲突）；按 load() 顺序装配后在 JS 逐条应用同一
     * 判据。dedup_key 主支路可用唯一键，roundKey 候选支路扫描本会话 round 行（#1146 起
     * roundKey 只存在于 record_json），不新增列 / 索引。
     *
     * 候选上界（issue #1166）：SQL 取候选按 `round_no DESC, id DESC` 取最近 N 行（默认
     * {@link DEFAULT_DEDUP_CANDIDATE_LIMIT}，可用环境变量覆盖），取回后**仍走原 JS 判据**。
     * 上面那个 OR 的 roundKey 支路谓词在 record_json 上，无索引可用，原本代价是
     * 「本会话全量 round 行 + 每条一次 assembleRoundRecord + 子行 IN(...)」；在 #1166 之前
     * 专家级 max_tool_rounds 无服务端校验（巨大值可直接落库），会话轮数能远超约定上限，
     * 于是写事务内的这个快路径探针会把候选集扫成线性于会话长度的集合——探针存在的本意
     * （消掉写事务内全量 load()）当场失效。上界只限“取多少候选”，不改判据。
     *
     * 为什么不能 `LIMIT 1`：OR 取出的候选里允许有“伪候选”——典型是 appendUserTurn 预写的
     * 同轮行 / roundKey 与别人 dedupKey 碰撞的行，它们的 dedupKey 已定义且 != 探针键，按
     * 上游 `??` 判据必须 miss；真正的命中行完全可能在更早的 round。`LIMIT 1` 只留最新
     * 那一条候选，一旦它是伪候选就把真命中截掉了（快路径 miss → 引擎回退写新行 →
     * 幂等失效、用户轮重复落盘）。取最近 N 条后按 load() 顺序装配，与全量路径同序。
     *
     * 超出窗口时的语义（行为契约，勿改）：真命中落在窗口外时探针返回与今天完全一致的
     * “未命中”结果 `null`（不抛错、不放宽判据）；引擎据此回退到 appendRound 分支。
     * 默认窗口远高于 max_tool_rounds 的 1–50 约定上限（见常量注释），正常运行不会越界。
     *
     * @returns {Promise<object|null>} 命中返回**完整**存储记录（与 load() 对同一轮的
     *   输出逐字段一致，复用 assembleRoundRecord）；未命中返回 null（不抛错）。
     */
    async loadByDedupKey(runId, dedupKey) {
      // 入参守卫：引擎传进来的永远是字符串，但 undefined 会被 sequelize 当成「替换参数缺位」
      // 抛驱动层错误（而不是「未命中」），把可预期的 miss 变成看不懂的 store bug。
      if (typeof runId !== "string" || runId === "") return null;
      if (typeof dedupKey !== "string" || dedupKey === "") return null;
      // OR 仅构造候选集；实际谓词必须在 assembleRoundRecord() 后按上游 ?? 语义判断。
      // JSON 路径是字面量常量，外部值全部走 replacements；候选数上界见上方注释。
      // 取的是最近 N 条候选，因此倒序取回后必须翻正，装配与判据才与 load() 同序。
      const candidateLimit = resolveDedupCandidateLimit();
      const [recentCandidates] = await sequelize.query(ROUND_COLUMNS_SQL + `
        WHERE request_id = :runId
          AND (dedup_key = :dedupKey
               OR JSON_UNQUOTE(JSON_EXTRACT(record_json, '$.roundKey')) = :dedupKey)
        ORDER BY round_no DESC, id DESC
        LIMIT :candidateLimit
      `, { replacements: { runId, dedupKey, candidateLimit } });
      const rounds = recentCandidates.slice().reverse();
      if (rounds.length === 0) return null;

      // 批量取候选轮的子行，与 load() 使用相同排序；按候选顺序逐条装配并执行完整路径判据。
      const roundIds = rounds.map((round) => round.id);
      const [messageRows, toolRows] = await Promise.all([
        sequelize.query(`
          SELECT id, role, content, reasoning_content, round_id, sequence_no, meta_json
          FROM messages
          WHERE round_id IN (:roundIds)
          ORDER BY round_id ASC, sequence_no ASC
        `, { replacements: { roundIds } }),
        sequelize.query(`
          SELECT tool_use_id, round_id, name, input_json, result_json, is_error, duration_ms, created_at
          FROM chat_tool_calls
          WHERE round_id IN (:roundIds)
          ORDER BY round_id ASC, created_at ASC, tool_use_id ASC
        `, { replacements: { roundIds } }),
      ]);
      for (const round of rounds) {
        const record = assembleRoundRecord(
          round,
          messageRows[0].filter((row) => row.round_id === round.id),
          toolRows[0].filter((row) => row.round_id === round.id),
        );
        if ((record?.dedupKey ?? record?.roundKey) === dedupKey) return record;
      }
      return null;
    },

    /**
     * 成对可选快路径探针之二（issue #1150）：等价于对 load() 结果取
     * `Math.max(0, …Number.isSafeInteger(record.round) ? record.round : 0…)`。
     * 本 store 的 round_no 是 `INT NOT NULL`，故就是 idx_agent_rounds_request 上的 MAX。
     *
     * @returns {Promise<number|null>} 该会话的最大 round；**空存储返回 null**
     *   （引擎据此派生 round 0，与全量路径 Math.max(0) 的空 store 行为一致）。
     */
    async loadMaxRound(runId) {
      if (typeof runId !== "string" || runId === "") return null;
      const [rows] = await sequelize.query(`
        SELECT MAX(round_no) AS max_round
        FROM agent_rounds
        WHERE request_id = :runId
      `, { replacements: { runId } });
      const maxRound = normalizeMaxRound(rows[0]?.max_round);
      // MAX() 零行时返回 NULL；有效值由 normalizeMaxRound 夹到契约要求的非负范围。
      if (!Number.isSafeInteger(maxRound)) return null;
      return maxRound;
    },
  };
}

// load() 与 loadByDedupKey() 共用同一份 agent_rounds 列集合：两条路径必须读到完全
// 相同的列，否则装配结果不可能逐字段一致（issue #1150 差异对等）。
const ROUND_COLUMNS_SQL = `
  SELECT id, request_id, round_no, dedup_key, stop_reason, \`usage\`,
         folded, folded_range, record_json, ts
  FROM agent_rounds
`;

/**
 * loadByDedupKey 候选集上界的默认值（issue #1166）。
 *
 * 取 200：远高于 max_tool_rounds 的约定上限 50（写入侧现已硬校验），同时给下面这些
 * “同会话多行”留充余量：种子轮、引擎每轮一行、appendUserTurn 预写的同轮行、
 * 折叠轮。它限的是“探针一次能取回多少候选”，不是会话轮数上限；真命中落在窗口外
 * 时探针当作未命中（语义见 loadByDedupKey 注释）。200 行候选 = 子行 IN(...) 的最坏
 * 入参也是 200，仍然是常量级开销。
 */
export const DEFAULT_DEDUP_CANDIDATE_LIMIT = 200;

/** 候选上界的环境变量覆盖名（运维取值非正整数时静默退回默认值，不抛错）。 */
export const DEDUP_CANDIDATE_LIMIT_ENV = "LLM_KIT_DEDUP_CANDIDATE_LIMIT";

/**
 * 每次调用重新解析，便于测试不重启进程就能改窗口；也避免模块加载时机不同导致
 * 环境变量没生效。
 *
 * @returns {number} 正整数候选上限
 */
export function resolveDedupCandidateLimit() {
  const raw = process.env[DEDUP_CANDIDATE_LIMIT_ENV];
  if (raw === undefined || raw === "") return DEFAULT_DEDUP_CANDIDATE_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_DEDUP_CANDIDATE_LIMIT;
}

/**
 * loadMaxRound 返回值归一（issue #1150）：只接受安全整数，否则一律当作
 * 「无可用的最大轮」返回 null；非空的安全整数夹到 0 或以上。
 *
 * 本表 round_no 是 `INT NOT NULL`，正常路径下 mysql2 直接回 JS number；仍保留
 * 数字字符串兼容（DECIMAL/BIGINT 类列 mysql2 会回字符串，此时直返会触引擎
 * TypeError），以及非安全整数（脏值 / NaN / Infinity / 1.5）→ null，与全量路径
 * 忽略非法 round、对合法 round 结果执行 Math.max(0, …) 一致。
 */
function normalizeMaxRound(value) {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "string" && /^\s*-?\d+\s*$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(numeric) ? Math.max(0, numeric) : null;
}

function makeHostSynthesizedMarker(record, fields, hasOriginalHostKey) {
  return {
    version: 1,
    fields,
    originalHostKey: {
      present: hasOriginalHostKey,
      ...(hasOriginalHostKey ? { value: record[HOST_SYNTHESIZED_FIELDS_KEY] } : {}),
    },
    originalFields: Object.fromEntries(fields.map((field) => {
      const present = Object.hasOwn(record, field);
      return [field, { present, ...(present ? { value: record[field] } : {}) }];
    })),
  };
}

function isHostSynthesizedMarker(value) {
  return isRecord(value)
    && value.version === 1
    && Array.isArray(value.fields)
    && value.fields.every((field) => ["dedupKey", "ts", "folded"].includes(field))
    && isRecord(value.originalHostKey)
    && typeof value.originalHostKey.present === "boolean"
    && isRecord(value.originalFields);
}

function isLegacyHostSynthesizedFields(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((field) => ["dedupKey", "ts", "folded"].includes(field));
}

/**
 * 单轮装配（load 与 loadByDedupKey 共用的唯一实现，issue #1150）。
 *
 * 输入：一行 agent_rounds + 该轮的 messages 行（已按 sequence_no 排序）
 *      + 该轮的 chat_tool_calls 行（已按 created_at, tool_use_id 排序）。
 * 输出：与拆行前 RoundRecord 逐字段等价的记录（保真面见文件头声明）。
 */
function assembleRoundRecord(round, roundMessages, roundTools) {
  const record = parseJsonColumn(round.record_json) ?? {};
  // 只认新格式宿主标记（或旧版生成的字段名单）；其他同名值是写入方字段，必须原样保留。
  const rawHostMarker = record[HOST_SYNTHESIZED_FIELDS_KEY];
  const hostMarker = isHostSynthesizedMarker(rawHostMarker) ? rawHostMarker : null;
  const legacySynthesized = hostMarker === null && isLegacyHostSynthesizedFields(rawHostMarker)
    ? rawHostMarker
    : [];
  const synthesized = hostMarker?.fields ?? legacySynthesized;
  if (hostMarker !== null || legacySynthesized.length > 0) {
    delete record[HOST_SYNTHESIZED_FIELDS_KEY];
  }
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

  // 无拆行行的轮（round 0 种子：appendRound 有意不拆行，messages 只存在于
  // record_json）：原样取回 record_json.messages，不做 tool_use/tool_result
  // 合成（种子里的历史块早已是完整 canonical 形态）。其余轮 record_json 不含
  // messages，照常按拆行重组。
  const recordJsonMessages = Array.isArray(record.messages) ? record.messages : null;
  const hasSplitRows = roundMessages.length > 0 || roundTools.length > 0;
  record.messages = recordJsonMessages !== null && !hasSplitRows
    ? recordJsonMessages
    : reconstructMessages(roundMessages, roundTools);
  for (const field of ["dedupKey", "ts", "folded"]) {
    if (synthesized.includes(field)) {
      delete record[field];
      const original = hostMarker?.originalFields[field];
      if (original?.present) {
        record[field] = Object.hasOwn(original, "value") ? original.value : undefined;
      }
    }
  }
  if (hostMarker?.originalHostKey.present) {
    record[HOST_SYNTHESIZED_FIELDS_KEY] = Object.hasOwn(hostMarker.originalHostKey, "value")
      ? hostMarker.originalHostKey.value
      : undefined;
  }
  return record;
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
    .map((row) => {
      const duration = durationMsOrNull(row.duration_ms);
      return {
        type: "tool_result",
        tool_use_id: row.tool_use_id,
        content: JSON.parse(row.result_json),
        ...(row.is_error ? { is_error: true } : {}),
        ...(duration === null ? {} : { duration }),
      };
    });
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
