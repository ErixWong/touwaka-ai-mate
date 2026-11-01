/**
 * #1237 切片 B（c）—— **assistant 行的渲染规则（唯一实现）**
 *
 * 缺陷：erix 路径下“每轮一行”，纯工具轮 / 纯思考轮的 `messages.content` 是空串。
 * 旧渲染对**每一行**都输出完整气泡（头像 + 灰底 + padding）⇒ 界面上出现一串**空气泡**
 * （生产实测该主题 12 个：内容为空、只有一个折叠的思考块）。
 *
 * 规则（正文空/非空 × 思考空/非空 × 有无工具 八格，见 `tests/assistant-bubble-layout.test.mjs`）：
 *
 * | content | reasoning | 工具 | 渲染 |
 * |---|---|---|---|
 * | 非空 | 任意 | 任意 | `bubble`（完整气泡） |
 * | 空 | 非空 | 有 | `compact`（紧凑行：思考条 + 工具卡，无头像/无气泡底） |
 * | 空 | 非空 | 无 | `compact`（紧凑行：只有思考条） |
 * | 空 | 空 | 有 | `compact`（紧凑行：只有工具卡） |
 * | 空 | 空 | 无 | `hidden`（不渲染：该行没有任何可看内容） |
 *
 * 例外（永远 `bubble`）：`streaming` / `sending`（要显示打字指示器）、`error` / `timeout`
 * （要显示错误文案与重试按钮）——这几态即使正文为空也必须给用户一个可交互的落点。
 *
 * 为什么是纯函数：前端没有单测框架，把它抽成 `.js` 纯函数就能用 `node --test` 逐格钉住，
 * 不必为了“验证八格”去造八个真库请求。
 */

/** 渲染形态 */
export const ASSISTANT_LAYOUT = Object.freeze({
  BUBBLE: 'bubble',
  COMPACT: 'compact',
  HIDDEN: 'hidden',
});

const TRANSIENT_STATUSES = new Set(['streaming', 'sending', 'error', 'timeout']);

const hasVisibleText = (value) => typeof value === 'string' && value.trim().length > 0;

/**
 * 判定一条消息的渲染形态。
 *
 * @param {object} message 消息对象（snake_case：`role` / `content` / `reasoning_content` /
 *   `run_reasoning_content` / `tool_calls` / `status`）
 * @param {object} [options]
 * @param {boolean} [options.hasToolCalls] 外部解析出的工具卡数量 > 0（覆盖 `message.tool_calls`）
 * @returns {'bubble'|'compact'|'hidden'}
 */
export function resolveAssistantLayout(message, options = {}) {
  if (!message || message.role !== 'assistant') return ASSISTANT_LAYOUT.BUBBLE;

  const status = typeof message.status === 'string' ? message.status : 'completed';
  if (TRANSIENT_STATUSES.has(status)) return ASSISTANT_LAYOUT.BUBBLE;

  const hasBody = hasVisibleText(message.content);
  if (hasBody) return ASSISTANT_LAYOUT.BUBBLE;

  const hasTools = options.hasToolCalls === true || Boolean(message.tool_calls);
  const hasReasoning = hasVisibleText(message.reasoning_content)
    || hasVisibleText(message.run_reasoning_content);

  if (hasTools || hasReasoning) return ASSISTANT_LAYOUT.COMPACT;
  return ASSISTANT_LAYOUT.HIDDEN;
}
