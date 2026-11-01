/**
 * #1237 切片 B —— **整段思考的读侧拼接（唯一实现）**
 *
 * 背景（切片 A 已锁死的等式，见 `lib/llm-kit-adapters/README.md`「`--fix-reasoning`」）：
 *
 * ```
 * 各轮 messages.reasoning_content（按 agent_rounds.round_no ASC, messages.sequence_no ASC，无分隔 join）
 *   === 旧实现的 fullReasoningContent（agent-loop 的跨轮累积串）
 * ```
 *
 * 写侧现在**按轮存**（终稿 UPDATE 不再用累积串覆盖末轮行），所以“整段思考”只能**读时拼接**。
 * 本模块就是那条拼接的**唯一实现**：三个历史查询口（`queryMessagesByRequest` / `listWithBefore` /
 * `listSince`）与流式 `complete` 事件都调它，谁也不许自己再写一份 join。
 *
 * 三条纪律：
 *   1. **`NULL` 不是空串**：`reasoning_content IS NULL` 表示“本轮没有思考”，不产生任何字符
 *      （与 `transcript-store.js` legacy 装配、前端 `v-if="message.reasoning_content"` 同口径）。
 *   2. **不猜**：一个请求若**没有**轮绑定行（`round_id IS NULL` 的 legacy/兜底 INSERT 形状），
 *      只在“该请求只有一条 assistant 行”时用它自己那一份（否则 `null`，不拿 created_at 顺序
 *      去发明第四条排序规则）。
 *   3. **只挂在终稿行**：字段是可选字段，只出现在该请求的**最后一条** assistant 行上；
 *      分页窗口切掉了终稿行时，本页一行都不挂（不把“部分轮”的拼接冒充成整段）。
 */

/** 整段思考正文字段（可选字段，只有终稿行有） */
export const RUN_REASONING_FIELD = 'run_reasoning_content';
/** 参与拼接的轮数（终稿行上的伴随字段，供 UI 显示“共 N 轮”） */
export const RUN_REASONING_ROUNDS_FIELD = 'run_reasoning_rounds';

const hasText = (value) => typeof value === 'string' && value.length > 0;

/**
 * 按请求聚合“整段思考”。
 *
 * @param {object} params
 * @param {object} params.sequelize Sequelize 实例（`db.sequelize`）
 * @param {Array<string>} params.requestIds 需要聚合的 request_id（自动去重、忽略空值）
 * @returns {Promise<Map<string, {text: string|null, rounds: number, finalMessageId: string|null}>>}
 */
export async function loadRunReasoningByRequest({ sequelize, requestIds }) {
  const ids = [...new Set((requestIds || []).filter((id) => typeof id === 'string' && id.length > 0))];
  const result = new Map();
  if (ids.length === 0) return result;

  // 轮绑定行：轮序 + 行序是**唯一**排序口径（切片 A 的等式逐字用它，别改成 created_at）。
  const [roundRows] = await sequelize.query(
    `SELECT m.request_id AS request_id,
            m.id AS message_id,
            m.reasoning_content AS reasoning_content,
            r.round_no AS round_no,
            m.sequence_no AS sequence_no
       FROM messages AS m
       JOIN agent_rounds AS r ON r.id = m.round_id
      WHERE m.request_id IN (:requestIds)
        AND m.role = 'assistant'
      ORDER BY m.request_id ASC, r.round_no ASC, m.sequence_no ASC, m.id ASC`,
    { replacements: { requestIds: ids } },
  );

  const rowsByRequest = new Map();
  for (const row of roundRows) {
    const list = rowsByRequest.get(row.request_id);
    if (list) list.push(row);
    else rowsByRequest.set(row.request_id, [row]);
  }

  for (const [requestId, rows] of rowsByRequest) {
    const texts = rows.map((row) => row.reasoning_content).filter(hasText);
    result.set(requestId, {
      text: texts.length > 0 ? texts.join('') : null,
      rounds: texts.length,
      finalMessageId: rows.length > 0 ? rows[rows.length - 1].message_id : null,
    });
  }

  // 兜底：没有轮绑定行的请求（legacy / 无 canonical 行的 INSERT 形状）。
  const missing = ids.filter((id) => !rowsByRequest.has(id));
  if (missing.length > 0) {
    const [legacyRows] = await sequelize.query(
      `SELECT request_id AS request_id, id AS message_id, reasoning_content AS reasoning_content
         FROM messages
        WHERE request_id IN (:requestIds)
          AND role = 'assistant'
          AND round_id IS NULL
        ORDER BY request_id ASC, created_at ASC, id ASC`,
      { replacements: { requestIds: missing } },
    );
    const legacyByRequest = new Map();
    for (const row of legacyRows) {
      const list = legacyByRequest.get(row.request_id);
      if (list) list.push(row);
      else legacyByRequest.set(row.request_id, [row]);
    }
    for (const [requestId, rows] of legacyByRequest) {
      // 只有“唯一一条 assistant 行”才敢把它自己的思考当整段（多行时没有轮序可依 ⇒ 不猜）。
      const single = rows.length === 1 ? rows[0] : null;
      const text = single && hasText(single.reasoning_content) ? single.reasoning_content : null;
      result.set(requestId, {
        text,
        rounds: text === null ? 0 : 1,
        finalMessageId: rows[rows.length - 1]?.message_id ?? null,
      });
    }
  }

  return result;
}

/**
 * 把整段思考挂到**终稿行**上（就地修改并返回 `rows`）。
 *
 * @param {object} params
 * @param {object} params.sequelize
 * @param {Array<object>} params.rows 历史接口的裸行（snake_case，含 `id` / `request_id` / `role`）
 * @returns {Promise<Array<object>>}
 */
export async function attachRunReasoningContent({ sequelize, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  const requestIds = rows
    .filter((row) => row && row.role === 'assistant' && typeof row.request_id === 'string')
    .map((row) => row.request_id);
  if (requestIds.length === 0) return rows;

  const byRequest = await loadRunReasoningByRequest({ sequelize, requestIds });

  for (const row of rows) {
    if (!row || row.role !== 'assistant') continue;
    const info = byRequest.get(row.request_id);
    if (!info || info.text === null) continue;
    if (info.finalMessageId !== row.id) continue;
    row[RUN_REASONING_FIELD] = info.text;
    row[RUN_REASONING_ROUNDS_FIELD] = info.rounds;
  }

  return rows;
}
