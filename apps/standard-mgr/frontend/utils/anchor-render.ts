/**
 * 锚点渲染工具（全局唯一实现）
 *
 * 职责：将副本中的 <anchor+id> 标记转换为 HTML span 元素，
 * 供正文渲染、右侧面板、tooltip 等共用。
 *
 * 审计要求：<anchor+id> 转换逻辑只许写一份，禁止各组件自写正则。
 */

/** 锚点标签正则 */
export const ANCHOR_TAG_RE = /<anchor\+([^>]+)>/g

/** 锚点状态 → CSS class 映射 */
export const ANCHOR_STATUS_CLASS: Record<string, string> = {
  valid: 'anchor-valid',
  suspected: 'anchor-suspected',
  gap: 'anchor-gap',
  invalid: 'anchor-invalid',
}

/**
 * 将带 <anchor+id> 标记的文本转换为安全的 HTML span
 *
 * @param text 含锚点标记的原文
 * @param anchorStatusMap anchorId → status 的映射（用于着色）
 * @returns HTML 字符串，锚点替换为 <span class="ref-anchor" data-anchor-id="...">
 */
export function renderAnchoredText(
  text: string,
  anchorStatusMap: Map<string, string> = new Map(),
): string {
  if (!text) return ''

  // 转义 HTML 特殊字符（锚点标记本身不含 HTML 实体，先转义再还原）
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // 将已转义的 &lt;anchor+id&gt; 还原为可渲染的 span
  return escaped.replace(
    /&lt;anchor\+([^&]+)&gt;/g,
    (_match, anchorId: string) => {
      const status = anchorStatusMap.get(anchorId) || ''
      const statusClass = ANCHOR_STATUS_CLASS[status] || ''
      return `<span class="ref-anchor ${statusClass}" data-anchor-id="${anchorId}" data-anchor-status="${status}">📌</span>`
    },
  )
}

/**
 * 从文本中提取所有锚点 ID 列表
 */
export function extractAnchorIds(text: string): string[] {
  if (!text) return []
  const ids: string[] = []
  let match: RegExpExecArray | null
  // 需要重置 lastIndex 或每次新建 regex
  const re = new RegExp(ANCHOR_TAG_RE.source, 'g')
  while ((match = re.exec(text)) !== null) {
    ids.push(match[1]!)
  }
  return ids
}

/**
 * 解析锚点标签，返回每个标签在文本中的位置
 */
export function parseAnchorPositions(
  text: string,
): Array<{ id: string; start: number; end: number }> {
  const positions: Array<{ id: string; start: number; end: number }> = []
  const re = new RegExp(ANCHOR_TAG_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    positions.push({
      id: match[1]!,
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return positions
}
