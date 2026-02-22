import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import enUS from './locales/en-US'

export type Locale = 'zh-CN' | 'en-US'

const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

// 从 localStorage 或浏览器语言获取默认语言
const getDefaultLocale = (): Locale => {
  // 优先级：URL参数 > localStorage > 浏览器语言 > 默认中文
  const urlParams = new URLSearchParams(window.location.search)
  const urlLang = urlParams.get('lang') as Locale
  if (urlLang && ['zh-CN', 'en-US'].includes(urlLang)) {
    return urlLang
  }

  const savedLang = localStorage.getItem('locale') as Locale
  if (savedLang && ['zh-CN', 'en-US'].includes(savedLang)) {
    return savedLang
  }

  const browserLang = navigator.language
  if (browserLang.startsWith('zh')) {
    return 'zh-CN'
  }
  if (browserLang.startsWith('en')) {
    return 'en-US'
  }

  return 'zh-CN'
}

export const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'zh-CN',
  messages,
  // 数字、日期格式化
  numberFormats: {
    'zh-CN': {
      currency: {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 2,
      },
      decimal: {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      },
    },
    'en-US': {
      currency: {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
      },
      decimal: {
        style: 'decimal',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      },
    },
  },
  datetimeFormats: {
    'zh-CN': {
      short: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      },
      long: {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      },
      time: {
        hour: 'numeric',
        minute: 'numeric',
      },
    },
    'en-US': {
      short: {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      },
      long: {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      },
      time: {
        hour: 'numeric',
        minute: 'numeric',
      },
    },
  },
})

// 设置语言
export const setLocale = (locale: Locale): void => {
  i18n.global.locale.value = locale
  localStorage.setItem('locale', locale)
  document.documentElement.setAttribute('lang', locale)
}

// 获取当前语言
export const getLocale = (): Locale => {
  return i18n.global.locale.value as Locale
}

// 切换语言
export const toggleLocale = (): void => {
  const current = getLocale()
  const next = current === 'zh-CN' ? 'en-US' : 'zh-CN'
  setLocale(next)
}

// @aivue/chatbot 语言配置映射
export const chatbotLanguageMap: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    title: 'AI 助手',
    placeholder: '请输入消息...',
    sendButton: '发送',
    copyButton: '复制',
    retryButton: '重试',
    typing: '正在思考...',
    error: '出错了，请重试',
    noMessages: '暂无消息，开始对话吧',
    connecting: '连接中...',
  },
  'en-US': {
    title: 'AI Assistant',
    placeholder: 'Type a message...',
    sendButton: 'Send',
    copyButton: 'Copy',
    retryButton: 'Retry',
    typing: 'Thinking...',
    error: 'An error occurred. Please try again.',
    noMessages: 'No messages yet. Start a conversation!',
    connecting: 'Connecting...',
  },
}

// 获取当前语言的 chatbot 配置
export const getChatbotLanguageTexts = () => {
  return chatbotLanguageMap[getLocale()]
}

// 默认导出 i18n 实例
export default i18n
