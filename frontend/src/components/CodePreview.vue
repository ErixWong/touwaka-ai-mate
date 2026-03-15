<template>
  <div class="code-preview-container">
    <VCodeBlock
      :code="code"
      :lang="normalizedLanguage"
      :theme="false"
      :copyButton="showCopyButton"
      :maxHeight="maxHeight"
      highlightjs
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
// @ts-ignore - VCodeBlock 没有完整的类型导出
import VCodeBlock from '@wdns/vue-code-block'
// 导入 highlight.js 样式 - 使用 github 主题作为亮色，github-dark 作为暗色
import 'highlight.js/styles/github.css'

/**
 * CodePreview 组件
 * 基于 @wdns/vue-code-block 的代码预览组件
 * 支持语法高亮、行号显示、主题切换
 */

interface Props {
  /** 代码内容 */
  code: string
  /** 编程语言（文件扩展名或语言名称） */
  language?: string
  /** 是否显示复制按钮 */
  showCopyButton?: boolean
  /** 最大高度 */
  maxHeight?: string
  /** 主题：auto 跟随系统，light 亮色，dark 暗色 */
  theme?: 'auto' | 'light' | 'dark'
}

const props = withDefaults(defineProps<Props>(), {
  code: '',
  language: 'plaintext',
  showCopyButton: true,
  maxHeight: '100%',
  theme: 'auto',
})

/**
 * 文件扩展名到语言名的映射
 */
const languageMap: Record<string, string> = {
  // JavaScript 系列
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  mjs: 'javascript',
  cjs: 'javascript',

  // 样式
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',

  // HTML/模板
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'svg',

  // 数据格式
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',

  // 后端语言
  py: 'python',
  python: 'python',
  java: 'java',
  php: 'php',
  go: 'go',
  rs: 'rust',
  rust: 'rust',
  rb: 'ruby',
  ruby: 'ruby',
  cs: 'csharp',
  csharp: 'csharp',

  // C/C++
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',

  // 脚本
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  powershell: 'powershell',
  bat: 'batch',
  cmd: 'batch',

  // 数据库
  sql: 'sql',

  // 配置
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  ini: 'ini',
  env: 'plaintext',

  // 其他
  md: 'markdown',
  markdown: 'markdown',
  txt: 'plaintext',
  log: 'plaintext',
}

/**
 * 标准化语言名称
 * 将文件扩展名转换为支持的语言名
 */
const normalizedLanguage = computed(() => {
  const lang = props.language.toLowerCase()

  // 直接匹配
  if (languageMap[lang]) {
    return languageMap[lang]
  }

  // 尝试匹配已知语言
  return lang
})

/**
 * 检测系统主题偏好
 */
const prefersDark = computed(() => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
})

/**
 * 解析实际使用的主题
 */
const resolvedTheme = computed(() => {
  if (props.theme === 'auto') {
    return prefersDark.value ? 'dark' : 'light'
  }
  return props.theme
})
</script>

<style scoped>
.code-preview-container {
  width: 100%;
  height: 100%;
  overflow: auto;
}

/* 覆盖默认样式以适配我们的主题 */
.code-preview-container :deep(.v-code-block) {
  margin: 0;
  border-radius: 0;
}

.code-preview-container :deep(.v-code-block pre) {
  margin: 0;
  padding: 16px;
  background: var(--code-bg, #f5f5f5);
}

.code-preview-container :deep(.v-code-block code) {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
}

/* 暗色主题 */
.code-preview-container :deep(.v-code-block.dark pre) {
  background: var(--code-bg-dark, #1e1e1e);
  color: #d4d4d4;
}

/* 行号样式 */
.code-preview-container :deep(.line-number) {
  color: var(--text-hint, #999);
  user-select: none;
}

/* 复制按钮样式 */
.code-preview-container :deep(.copy-button) {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px 8px;
  background: var(--primary-color, #2196f3);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
}

.code-preview-container:hover :deep(.copy-button) {
  opacity: 1;
}

.code-preview-container :deep(.copy-button:hover) {
  background: var(--primary-hover, #1976d2);
}
</style>