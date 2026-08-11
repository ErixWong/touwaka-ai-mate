/**
 * AgentLoop 历史压缩器（R19-1）
 *
 * 背景：AgentLoop 每轮把 assistant + tool 结果全量追加到 messages，无任何
 * 淘汰/压缩机制。长任务（如标准引用清洗）遇到模型"重复读取"打转时，上下文
 * 无上限增长，最终撑爆模型窗口（GB 11552 第三次清洗 12 分钟从 38k 涨到
 * 134k，撞穿 qwen3.6:35b 的 131072 窗口）。
 *
 * 方案：每轮调用 LLM 前估算消息 token 总量，超过预算时将"最早的历史轮次"
 * 折叠为一条统计摘要（工具调用统计），保留头部任务描述与最近 N 轮完整，
 * 让模型仍能看到最近状态、但不再背负全部历史原文。
 *
 * 约束：
 * - 折叠按"轮次"为单位（assistant + 其后的连续 tool 消息为一组），整组替换
 *   为摘要消息，避免残留孤儿 tool 消息导致 OpenAI 兼容 API 400。
 * - 头部 system/user 任务消息永不折叠。
 * - 摘要以 system 角色注入（位于保留头部之后），内容为工具调用统计。
 *
 * 配置（环境变量可覆盖）：
 * - CHAT_COMPACT_BUDGET_TOKENS：消息部分 token 预算（默认 80000）
 * - CHAT_COMPACT_KEEP_ROUNDS：保留最近完整轮数（默认 6）
 */

const DEFAULT_BUDGET_TOKENS = 80000;
const DEFAULT_KEEP_ROUNDS = 6;

function resolvePositiveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * 估算消息列表的 token 数。
 * 中文 ~0.7 token/字、英文/数字 ~0.25 token/字符，JSON 结构 overhead 取 5%。
 * 系数偏保守（宁高勿低），目的是防止超窗而不是精确计费。
 *
 * @param {Array} messages - LLM 消息数组
 * @returns {number} 估算 token 数
 */
export function estimateMessageTokens(messages) {
  let chars = 0;
  let jsonChars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
    }
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) {
        jsonChars += JSON.stringify(tc).length;
      }
    }
  }
  // 中文为主场景：1 字 ≈ 0.7 token；JSON 结构 ≈ 0.35 token/字符
  const textTokens = chars * 0.7;
  const jsonTokens = jsonChars * 0.35;
  return Math.ceil((textTokens + jsonTokens) * 1.05);
}

/**
 * 将消息数组按"轮次"分组。
 * 一轮 = 一条 assistant 消息 + 其后的连续 tool 消息。
 * 纯文本 assistant（无 tool_calls）也是独立一轮。
 * 返回 [{ assistant, tools }]，tools 为紧随其后的 tool 消息数组。
 *
 * @param {Array} messages - 完整消息数组
 * @returns {Array<{assistant: Object, tools: Array}>} 轮次数组（从旧到新）
 */
export function groupIntoRounds(messages) {
  const rounds = [];
  let current = null;

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      if (current) rounds.push(current);
      current = { assistant: msg, tools: [] };
    } else if (msg.role === 'tool' && current) {
      current.tools.push(msg);
    } else {
      // system / user：不是轮次内容
      if (current) {
        rounds.push(current);
        current = null;
      }
    }
  }
  if (current) rounds.push(current);
  return rounds;
}

/**
 * 把折叠的轮次生成一条统计摘要消息（system 角色）。
 *
 * @param {Array} rounds - 被折叠的轮次数组
 * @returns {Object} 摘要消息
 */
function buildSummaryMessage(rounds) {
  const toolCount = {};
  for (const r of rounds) {
    for (const t of r.tools) {
      const name = t.name || 'tool';
      toolCount[name] = (toolCount[name] || 0) + 1;
    }
    const tc = r.assistant.tool_calls;
    if (Array.isArray(tc)) {
      for (const call of tc) {
        const fn = call.function || {};
        const name = fn.name || 'tool';
        toolCount[name] = (toolCount[name] || 0) + 1;
      }
    }
  }
  const stats = Object.entries(toolCount)
    .map(([name, count]) => `${name}×${count}`)
    .join(', ');

  return {
    role: 'system',
    content:
      `[AgentLoop 上下文压缩] 以下早期工具执行详情已被折叠为统计摘要（控制上下文长度）：` +
      `共 ${rounds.length} 轮、${stats || '无工具调用'}。` +
      `如需重新查看某次执行的具体结果，可重新调用对应工具获取最新数据。`,
  };
}

/**
 * 若消息超过预算，压缩历史：保留头部（至第一条 user 消息）+ 最近 N 轮完整，
 * 中间轮次折叠为摘要。
 *
 * @param {Array} messages - 当前消息数组
 * @param {object} [opts]
 * @param {number} [opts.budgetTokens=80000] - 消息部分 token 预算
 * @param {number} [opts.keepRounds=6] - 保留最近完整轮数
 * @returns {{ messages: Array, compacted: boolean, foldedRounds: number, tokensBefore: number, tokensAfter: number }}
 */
export function compactHistory(messages, opts = {}) {
  const budgetTokens = opts.budgetTokens ?? resolvePositiveIntEnv('CHAT_COMPACT_BUDGET_TOKENS', DEFAULT_BUDGET_TOKENS);
  const keepRounds = opts.keepRounds ?? resolvePositiveIntEnv('CHAT_COMPACT_KEEP_ROUNDS', DEFAULT_KEEP_ROUNDS);

  const tokensBefore = estimateMessageTokens(messages);
  if (tokensBefore <= budgetTokens || messages.length <= 2) {
    return { messages, compacted: false, foldedRounds: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  // 定位头部边界：第一条 user 消息之后（含它）开始是可折叠区
  let headEnd = 0;
  for (let i = 0; i < messages.length; i++) {
    headEnd = i + 1;
    if (messages[i].role === 'user') break;
  }

  // 从头部边界处把剩余消息按轮次分组（组内保持顺序）
  const tailMessages = messages.slice(headEnd);
  const rounds = groupIntoRounds(tailMessages);

  if (rounds.length <= keepRounds) {
    // 轮次不够多，即使超预算也不折叠（避免破坏结构）
    return { messages, compacted: false, foldedRounds: 0, tokensBefore, tokensAfter: tokensBefore };
  }

  const keepRoundCount = Math.min(keepRounds, rounds.length);
  const folded = rounds.slice(0, rounds.length - keepRoundCount);
  const kept = rounds.slice(rounds.length - keepRoundCount);

  // 折叠区：先输出折叠摘要（system），再展开保留轮次
  const compactedTail = [];
  if (folded.length > 0) {
    compactedTail.push(buildSummaryMessage(folded));
  }
  for (const r of kept) {
    compactedTail.push(r.assistant);
    compactedTail.push(...r.tools);
  }

  const newMessages = [...messages.slice(0, headEnd), ...compactedTail];
  const tokensAfter = estimateMessageTokens(newMessages);

  return {
    messages: newMessages,
    compacted: true,
    foldedRounds: folded.length,
    tokensBefore,
    tokensAfter,
  };
}

/**
 * 便捷入口：压缩并返回新的 messages（供 AgentLoop 每轮调用前使用）。
 *
 * @param {Array} messages - 当前消息数组
 * @param {object} [opts] - 同 compactHistory
 * @returns {Array} 压缩后的消息数组
 */
export function compactHistoryIfNeeded(messages, opts = {}) {
  return compactHistory(messages, opts).messages;
}

export default { estimateMessageTokens, groupIntoRounds, compactHistory, compactHistoryIfNeeded };
