/**
 * Mermaid 图表渲染工具
 * 用于在聊天消息中渲染 Mermaid 图表
 */

import mermaid from 'mermaid'

// 初始化标志
let isInitialized = false

/**
 * 初始化 Mermaid 配置
 */
const initMermaid = () => {
  if (isInitialized) return
  
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: 'inherit',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
    },
    sequence: {
      useMaxWidth: true,
      diagramMarginX: 8,
      diagramMarginY: 8,
      actorMargin: 32,
      width: 120,
      height: 48,
      boxMargin: 8,
      boxTextMargin: 8,
      noteMargin: 8,
    },
    gantt: {
      useMaxWidth: true,
      leftPadding: 48,
      gridLineStartPadding: 24,
      barHeight: 16,
      barGap: 4,
      topPadding: 24,
    },
    class: {
      useMaxWidth: true,
    },
    state: {
      useMaxWidth: true,
    },
    pie: {
      useMaxWidth: true,
    },
  })
  
  isInitialized = true
}

/**
 * 生成唯一的图表 ID
 */
let diagramCounter = 0
const generateDiagramId = (): string => {
  diagramCounter++
  return `mermaid-diagram-${Date.now()}-${diagramCounter}`
}

/**
 * 渲染单个 Mermaid 图表
 * @param code Mermaid 代码
 * @returns 渲染后的 SVG HTML 字符串
 */
export const renderMermaidDiagram = async (code: string): Promise<string> => {
  initMermaid()
  
  try {
    const id = generateDiagramId()
    const { svg } = await mermaid.render(id, code)
    return svg
  } catch (error) {
    console.error('Mermaid rendering error:', error)
    // 返回错误提示，而不是抛出异常
    return `<div class="mermaid-error">
      <span class="mermaid-error-icon">⚠️</span>
      <span class="mermaid-error-text">图表渲染失败</span>
      <pre class="mermaid-error-code">${escapeHtml(code)}</pre>
    </div>`
  }
}

/**
 * 检测并渲染 HTML 中所有的 Mermaid 代码块
 * 将 <pre><code class="language-mermaid">...</code></pre> 转换为渲染后的 SVG
 * 
 * @param html 包含 Mermaid 代码块的 HTML 字符串
 * @returns 渲染后的 HTML 字符串（Promise）
 */
export const renderMermaidInHtml = async (html: string): Promise<string> => {
  // 匹配 <pre><code class="language-mermaid">...</code></pre> 或 <pre><code class="lang-mermaid">...</code></pre>
  const mermaidRegex = /<pre><code\s+class="(?:language-|lang-)?mermaid"[^>]*>([\s\S]*?)<\/code><\/pre>/gi
  
  const matches = [...html.matchAll(mermaidRegex)]
  
  if (matches.length === 0) {
    return html
  }
  
  // 并行渲染所有图表
  const replacements = await Promise.all(
    matches.map(async (match) => {
      const fullMatch = match[0]
      const code = decodeHtml(match[1] ?? '')
      const rendered = await renderMermaidDiagram(code)
      return { fullMatch, rendered }
    })
  )
  
  // 替换所有匹配项
  let result = html
  for (const { fullMatch, rendered } of replacements) {
    result = result.replace(fullMatch, `<div class="mermaid-container">${rendered}</div>`)
  }
  
  return result
}

/**
 * 解码 HTML 实体
 */
const decodeHtml = (html: string): string => {
  const txt = document.createElement('textarea')
  txt.innerHTML = html
  return txt.value
}

/**
 * 转义 HTML 特殊字符
 */
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;')
}

export default {
  renderMermaidDiagram,
  renderMermaidInHtml,
}
