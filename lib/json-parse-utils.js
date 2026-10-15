import logger from './logger.js';

/**
 * 字符串感知 + 转义感知的括号平衡扫描（#1216，替换贪婪正则 /\{[\s\S]*\}/ 与 /\[[\s\S]*\]/）。
 *
 * 贪婪正则以「第一个开括号 → 最后一个闭括号」为截取范围，隐含前提是
 * 「整段文本最后一个闭括号恰好是 JSON 的收尾」——模型尾话一带括号（`补充：字段
 * {next_action} 需要人工确认。`）或并列两段对象时该前提不成立，本可解析的输出被判作废。
 *
 * 本函数改为逐字符平衡扫描：
 * - 深度从 0 起，开括号 +1 / 闭括号 −1，**归零即停**（只取到平衡闭合处）；
 * - **跳过字符串字面量内部**的一切括号，并正确处理 `\"` 转义
 *   （`{"s":"} 不是结束"}`、`{"s":"含 \" 转义"}` 都不会被字符串内的括号截断）；
 * - 从第一个起点取出的子串若 `JSON.parse` 仍失败（如垃圾前缀 `{next_action}`），
 *   **继续向后找下一个起点**再试（由调用方逐个尝试候选）。
 *
 * 取舍（#1216 判清）：某起点在文本内**始终不闭合**（截断型未闭合 JSON，如
 * `{"a":1,"b":{"c":2}`）时，不再进入该 span 内部找「能闭合的内层碎片」——
 * 截断输出整体判失败，好过返回一段看着合法、实为残片的 JSON 让下游当成功消费
 * （反思链路尤其吃不下这种半截对象：session_meta 在 methodology 被截掉时会变成
 * 一条看不出来的假反思）。旧贪婪正则在这种形状上同样失败，所以这不是倒退。
 *
 * @param {string} text - 待扫描文本
 * @param {string} openChar - 开括号（'{' 或 '['）
 * @param {string} closeChar - 闭括号（'}' 或 ']'）
 * @returns {string[]} 「最外层且闭合」的候选子串，按出现顺序；调用方从前往后试解析
 */
function findBalancedCandidates(text, openChar, closeChar) {
  const candidates = [];
  let start = text.indexOf(openChar);
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === openChar) depth += 1;
      else if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    // 起点不闭合（截断型）：后面的起点都在这个未闭合 span 内部，全是残片，止步。
    if (end === -1) break;
    candidates.push(text.slice(start, end + 1));
    start = text.indexOf(openChar, end + 1);
  }
  return candidates;
}

export function parseJsonLikeContent(content, options = {}) {
  const { returnRawOnFail = true, logPrefix = '[JSONParse]' } = options;

  if (!content || typeof content !== 'string') {
    return returnRawOnFail ? { _parse_failed: true, _raw: content || '' } : null;
  }

  let cleaned = content.trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // 第三级降级：平衡提取（#1216）。候选按起点从前往后试：第一个能 JSON.parse 的赢，
    // 全失败才落回原贪婪正则的同款失败口径（_parse_failed 哨兵 / null），顺序与哨兵形状不变。
    const objectCandidates = findBalancedCandidates(cleaned, '{', '}');
    let lastObjectError = null;
    for (const candidate of objectCandidates) {
      try {
        return JSON.parse(candidate);
      } catch (e2) {
        lastObjectError = e2;
      }
    }
    if (lastObjectError && !returnRawOnFail) {
      logger.warn(`${logPrefix} Object extraction failed:`, lastObjectError.message);
    }

    const arrayCandidates = findBalancedCandidates(cleaned, '[', ']');
    let lastArrayError = null;
    for (const candidate of arrayCandidates) {
      try {
        return JSON.parse(candidate);
      } catch (e3) {
        lastArrayError = e3;
      }
    }
    if (lastArrayError && !returnRawOnFail) {
      logger.warn(`${logPrefix} Array extraction failed:`, lastArrayError.message);
    }

    if (!returnRawOnFail) {
      logger.warn(`${logPrefix} Failed, content length: ${cleaned.length}`);
    }

    return returnRawOnFail ? { _parse_failed: true, _raw: cleaned } : null;
  }
}