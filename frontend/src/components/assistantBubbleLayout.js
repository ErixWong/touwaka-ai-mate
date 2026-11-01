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
 * #1237 切片 C（审计 D2）：判“有没有工具”的口径是**解析后至少一个工具调用**，不是
 * `Boolean(message.tool_calls)`。后者把 `"[]"`（非空字符串 ⇒ 真）翻成“有工具”，于是本该
 * `hidden` 的空行留下一条空紧凑行——正是本切片要修的自伤兜底。解析口径与
 * `useToolDataParser.parseToolCallsToArray` 一致（数组 / JSON 字符串 / 单个对象；空数组或
 * 非法 JSON ⇒ 无工具）。`options.hasToolCalls === true` 保留为显式覆盖。
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
 * `tool_calls` 里到底有几个工具调用（D2 的权威判据）。
 *
 * 口径与 `frontend/src/composables/useToolDataParser.ts#parseToolCallsToArray` 一致：
 * 数组 ⇒ 元素个数；JSON 字符串 ⇒ 解析后再判；单个对象 ⇒ 1 个；`null`/`undefined`/空串/
 * 空数组/非法 JSON ⇒ 0。**不看“字符串非空”**——`"[]"` 是空工具集，不是“有工具”。
 *
 * @param {unknown} value
 * @returns {number}
 */
export function countToolCalls(value) {
  if (value === null || value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    try {
      return countToolCalls(JSON.parse(trimmed));
    } catch {
      return 0;
    }
  }
  if (typeof value === 'object') return 1;
  return 0;
}

/**
 * 判定一条消息的渲染形态。
 *
 * @param {object} message 消息对象（snake_case：`role` / `content` / `reasoning_content` /
 *   `run_reasoning_content` / `tool_calls` / `status`）
 * @param {object} [options]
 * @param {boolean} [options.hasToolCalls] 显式覆盖：外部已解析出“有工具”（`=== true` 才算）
 * @returns {'bubble'|'compact'|'hidden'}
 */
export function resolveAssistantLayout(message, options = {}) {
  if (!message || message.role !== 'assistant') return ASSISTANT_LAYOUT.BUBBLE;

  const status = typeof message.status === 'string' ? message.status : 'completed';
  if (TRANSIENT_STATUSES.has(status)) return ASSISTANT_LAYOUT.BUBBLE;

  const hasBody = hasVisibleText(message.content);
  if (hasBody) return ASSISTANT_LAYOUT.BUBBLE;

  // D2：判据 = **解析后至少一个工具调用**（`options.hasToolCalls === true` 保留为显式覆盖）。
  // 旧的 `|| Boolean(message.tool_calls)` 把 `"[]"` 当成“有工具” ⇒ 本该 hidden 的空行留了下来。
  const hasTools = options.hasToolCalls === true || countToolCalls(message.tool_calls) > 0;
  const hasReasoning = hasVisibleText(message.reasoning_content)
    || hasVisibleText(message.run_reasoning_content);

  if (hasTools || hasReasoning) return ASSISTANT_LAYOUT.COMPACT;
  return ASSISTANT_LAYOUT.HIDDEN;
}
