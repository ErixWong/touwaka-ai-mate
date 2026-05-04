# V1 阶段多语言支持设计

## 一、设计目标

基于用户明确需求：
- **UI 界面**：支持中文和英文切换
- **专家内容**：保持中文（专家 Prompt、描述等）
- **AI 回复**：由 LLM 自动响应用户语言，无需前端干预

## 二、技术选型

### 2.1 推荐方案：Vue I18n + @aivue/chatbot 内置多语言

**理由**：
1. @aivue/chatbot 内置多语言支持，但中文仍在开发中（Coming Soon）
2. Vue I18n 是 Vue 生态标准，功能完善
3. 两者结合可以完整覆盖所有 UI 文本

### 2.2 替代方案：纯 @aivue/chatbot

如果 @aivue/chatbot 正式发布中文支持，可以简化架构：
- 直接使用 `:language-texts` 属性配置中文
- 其他 UI 元素（话题列表、调试面板等）单独处理

## 三、实现方案

### 3.1 项目结构

```
src/
├── i18n/
│   ├── index.ts              # i18n 初始化
│   ├── locales/
│   │   ├── zh-CN.ts          # 中文
│   │   ├── en-US.ts          # 英文
│   │   └── types.ts          # 类型定义
│   └── utils.ts              # 工具函数
├── components/
│   └── LanguageSwitcher.vue  # 语言切换组件
└── stores/
    └── user.ts               # 用户偏好存储
```

### 3.2 Vue I18n 配置

```typescript
// src/i18n/index.ts
import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN';
import enUS from './locales/en-US';

// 从 localStorage 或用户配置读取默认语言
const getDefaultLocale = (): string => {
  // 优先级：URL参数 > 用户设置 > 浏览器语言 > 默认中文
  const urlParams = new URLSearchParams(window.location.search);
  const urlLang = urlParams.get('lang');
  if (urlLang && ['zh-CN', 'en-US'].includes(urlLang)) {
    return urlLang;
  }
  
  const savedLang = localStorage.getItem('user_language');
  if (savedLang && ['zh-CN', 'en-US'].includes(savedLang)) {
    return savedLang;
  }
  
  const browserLang = navigator.language;
  if (browserLang.startsWith('zh')) {
    return 'zh-CN';
  }
  if (browserLang.startsWith('en')) {
    return 'en-US';
  }
  
  return 'zh-CN'; // 默认中文
};

export const i18n = createI18n({
  legacy: false,
  locale: getDefaultLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
  // 数字、日期格式化
  numberFormats: {
    'zh-CN': {
      currency: {
        style: 'currency',
        currency: 'CNY',
      },
    },
    'en-US': {
      currency: {
        style: 'currency',
        currency: 'USD',
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
    },
  },
});

// 语言切换函数
export const setLocale = async (locale: string): Promise<void> => {
  i18n.global.locale.value = locale;
  localStorage.setItem('user_language', locale);
  
  // 更新 HTML lang 属性
  document.documentElement.setAttribute('lang', locale);
  
  // 同步到用户配置（如果已登录）
  await saveUserPreference('language', locale);
};
```

### 3.3 语言文件

```typescript
// src/i18n/locales/zh-CN.ts
export default {
  // 通用
  common: {
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    create: '创建',
    search: '搜索',
    loading: '加载中...',
    error: '错误',
    success: '成功',
    retry: '重试',
    close: '关闭',
    back: '返回',
    next: '下一步',
    previous: '上一步',
  },
  
  // 导航
  nav: {
    home: '首页',
    chat: '对话',
    topics: '话题',
    settings: '设置',
    profile: '个人中心',
    logout: '退出登录',
  },
  
  // 聊天页面
  chat: {
    title: 'AI 助手',
    placeholder: '请输入消息...',
    send: '发送',
    thinking: '正在思考...',
    emptyState: '开始一段新的对话吧',
    scrollToBottom: '滚动到底部',
    newTopic: '新建话题',
    switchTopic: '切换话题',
    deleteTopic: '删除话题',
    deleteTopicConfirm: '确定要删除这个话题吗？',
    noMoreHistory: '没有更多历史消息了',
    loadMore: '加载更多',
  },
  
  // 调试面板
  debug: {
    title: '调试信息',
    tokenCount: 'Token 消耗',
    promptTokens: 'Prompt Tokens',
    completionTokens: 'Completion Tokens',
    totalTokens: '总 Token 数',
    cost: '预估费用',
    responseTime: '响应时间',
    model: '使用模型',
    temperature: '温度参数',
    showDebug: '显示调试信息',
    hideDebug: '隐藏调试信息',
  },
  
  // 话题列表
  topic: {
    title: '话题列表',
    empty: '暂无话题',
    createNew: '创建新话题',
    rename: '重命名',
    delete: '删除',
    lastUpdated: '最后更新',
  },
  
  // 模型选择
  model: {
    title: '选择模型',
    default: '默认模型',
    custom: '自定义模型',
    noModels: '暂无可用模型',
    provider: '提供商',
  },
  
  // 错误提示
  error: {
    networkError: '网络连接错误',
    timeoutError: '请求超时',
    rateLimitError: '请求过于频繁',
    tokenExpired: '登录已过期',
    modelUnavailable: '模型不可用',
    contentTooLong: '内容过长',
    serverError: '服务器错误',
    unknownError: '未知错误',
  },
  
  // 设置页面
  settings: {
    title: '设置',
    language: '语言设置',
    theme: '主题设置',
    apiKey: 'API 密钥',
    notifications: '通知设置',
  },
};
```

```typescript
// src/i18n/locales/en-US.ts
export default {
  // Common
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    retry: 'Retry',
    close: 'Close',
    back: 'Back',
    next: 'Next',
    previous: 'Previous',
  },
  
  // Navigation
  nav: {
    home: 'Home',
    chat: 'Chat',
    topics: 'Topics',
    settings: 'Settings',
    profile: 'Profile',
    logout: 'Logout',
  },
  
  // Chat page
  chat: {
    title: 'AI Assistant',
    placeholder: 'Type a message...',
    send: 'Send',
    thinking: 'Thinking...',
    emptyState: 'Start a new conversation',
    scrollToBottom: 'Scroll to bottom',
    newTopic: 'New Topic',
    switchTopic: 'Switch Topic',
    deleteTopic: 'Delete Topic',
    deleteTopicConfirm: 'Are you sure you want to delete this topic?',
    noMoreHistory: 'No more history messages',
    loadMore: 'Load More',
  },
  
  // Debug panel
  debug: {
    title: 'Debug Info',
    tokenCount: 'Token Usage',
    promptTokens: 'Prompt Tokens',
    completionTokens: 'Completion Tokens',
    totalTokens: 'Total Tokens',
    cost: 'Estimated Cost',
    responseTime: 'Response Time',
    model: 'Model',
    temperature: 'Temperature',
    showDebug: 'Show Debug Info',
    hideDebug: 'Hide Debug Info',
  },
  
  // Topic list
  topic: {
    title: 'Topics',
    empty: 'No topics yet',
    createNew: 'Create New Topic',
    rename: 'Rename',
    delete: 'Delete',
    lastUpdated: 'Last Updated',
  },
  
  // Model selection
  model: {
    title: 'Select Model',
    default: 'Default Model',
    custom: 'Custom Model',
    noModels: 'No models available',
    provider: 'Provider',
  },
  
  // Error messages
  error: {
    networkError: 'Network connection error',
    timeoutError: 'Request timeout',
    rateLimitError: 'Too many requests',
    tokenExpired: 'Session expired',
    modelUnavailable: 'Model unavailable',
    contentTooLong: 'Content too long',
    serverError: 'Server error',
    unknownError: 'Unknown error',
  },
  
  // Settings
  settings: {
    title: 'Settings',
    language: 'Language',
    theme: 'Theme',
    apiKey: 'API Key',
    notifications: 'Notifications',
  },
};
```

### 3.4 语言切换组件

```vue
<!-- src/components/LanguageSwitcher.vue -->
<template>
  <Dropdown>
    <template #trigger>
      <Button type="text">
        <Icon :name="currentLanguageIcon" />
        {{ currentLanguageLabel }}
      </Button>
    </template>
    <DropdownMenu>
      <DropdownItem 
        v-for="lang in languages" 
        :key="lang.code"
        :active="currentLocale === lang.code"
        @click="changeLanguage(lang.code)"
      >
        <Icon :name="lang.icon" />
        {{ lang.label }}
      </DropdownItem>
    </DropdownMenu>
  </Dropdown>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { setLocale } from '@/i18n';

const { locale } = useI18n();

const languages = [
  { code: 'zh-CN', label: '简体中文', icon: 'flag-cn' },
  { code: 'en-US', label: 'English', icon: 'flag-us' },
];

const currentLocale = computed(() => locale.value);

const currentLanguageLabel = computed(() => {
  const lang = languages.find(l => l.code === currentLocale.value);
  return lang?.label || '简体中文';
});

const currentLanguageIcon = computed(() => {
  const lang = languages.find(l => l.code === currentLocale.value);
  return lang?.icon || 'flag-cn';
});

const changeLanguage = async (code: string): Promise<void> => {
  await setLocale(code);
  // 重新加载 @aivue/chatbot 的语言配置
  updateChatbotLanguage(code);
};
</script>
```

### 3.5 @aivue/chatbot 多语言集成

```typescript
// @aivue/chatbot 语言配置映射
const chatbotLanguageMap: Record<string, LanguageTexts> = {
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
    totalMessages: '消息总数',
    newConversation: '新对话',
    saveConversation: '保存对话',
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
    totalMessages: 'Total Messages',
    newConversation: 'New Conversation',
    saveConversation: 'Save Conversation',
  },
};

// 更新聊天组件语言
function updateChatbotLanguage(locale: string): void {
  const texts = chatbotLanguageMap[locale] || chatbotLanguageMap['zh-CN'];
  chatbotConfig.languageTexts = texts;
}
```

## 四、后端错误消息多语言支持

### 4.1 设计原则

后端返回的错误码而非直接文本，前端根据语言环境显示对应文案。

### 4.2 错误码定义

```typescript
// 错误码枚举
enum ErrorCode {
  // 通用错误 (1000-1999)
  UNKNOWN_ERROR = 1000,
  INVALID_REQUEST = 1001,
  UNAUTHORIZED = 1002,
  FORBIDDEN = 1003,
  NOT_FOUND = 1004,
  
  // 认证错误 (2000-2999)
  TOKEN_EXPIRED = 2000,
  TOKEN_INVALID = 2001,
  TOKEN_REVOKED = 2002,
  
  // 业务错误 (3000-3999)
  MODEL_UNAVAILABLE = 3000,
  RATE_LIMIT_EXCEEDED = 3001,
  CONTENT_TOO_LONG = 3002,
  CONTENT_VIOLATION = 3003,
  QUOTA_EXCEEDED = 3004,
  
  // AI 提供商错误 (4000-4999)
  AI_PROVIDER_ERROR = 4000,
  AI_TIMEOUT = 4001,
  AI_RATE_LIMIT = 4002,
}

// 后端返回格式
interface ApiError {
  code: ErrorCode;
  message?: string;  // 可选的英文描述（用于调试）
  details?: Record<string, any>;
}
```

### 4.3 前端错误码映射

```typescript
// src/i18n/error-messages.ts
export const errorMessages: Record<string, Record<ErrorCode, string>> = {
  'zh-CN': {
    [ErrorCode.UNKNOWN_ERROR]: '发生未知错误',
    [ErrorCode.INVALID_REQUEST]: '请求参数错误',
    [ErrorCode.UNAUTHORIZED]: '请先登录',
    [ErrorCode.FORBIDDEN]: '您没有权限执行此操作',
    [ErrorCode.NOT_FOUND]: '请求的资源不存在',
    [ErrorCode.TOKEN_EXPIRED]: '登录已过期，请重新登录',
    [ErrorCode.TOKEN_INVALID]: '登录状态无效',
    [ErrorCode.TOKEN_REVOKED]: '登录已失效',
    [ErrorCode.MODEL_UNAVAILABLE]: '当前模型不可用',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: '请求过于频繁，请稍后再试',
    [ErrorCode.CONTENT_TOO_LONG]: '消息内容过长',
    [ErrorCode.CONTENT_VIOLATION]: '内容不符合规范',
    [ErrorCode.QUOTA_EXCEEDED]: 'API 额度已用完',
    [ErrorCode.AI_PROVIDER_ERROR]: 'AI 服务暂时不可用',
    [ErrorCode.AI_TIMEOUT]: 'AI 响应超时',
    [ErrorCode.AI_RATE_LIMIT]: 'AI 服务限流，请稍后再试',
  },
  'en-US': {
    [ErrorCode.UNKNOWN_ERROR]: 'An unknown error occurred',
    [ErrorCode.INVALID_REQUEST]: 'Invalid request parameters',
    [ErrorCode.UNAUTHORIZED]: 'Please sign in first',
    [ErrorCode.FORBIDDEN]: 'You do not have permission to perform this action',
    [ErrorCode.NOT_FOUND]: 'The requested resource was not found',
    [ErrorCode.TOKEN_EXPIRED]: 'Session expired, please sign in again',
    [ErrorCode.TOKEN_INVALID]: 'Invalid session',
    [ErrorCode.TOKEN_REVOKED]: 'Session has been revoked',
    [ErrorCode.MODEL_UNAVAILABLE]: 'The selected model is unavailable',
    [ErrorCode.RATE_LIMIT_EXCEEDED]: 'Too many requests, please try again later',
    [ErrorCode.CONTENT_TOO_LONG]: 'Message content is too long',
    [ErrorCode.CONTENT_VIOLATION]: 'Content violates usage policy',
    [ErrorCode.QUOTA_EXCEEDED]: 'API quota exceeded',
    [ErrorCode.AI_PROVIDER_ERROR]: 'AI service temporarily unavailable',
    [ErrorCode.AI_TIMEOUT]: 'AI response timeout',
    [ErrorCode.AI_RATE_LIMIT]: 'AI service rate limit exceeded, please try again later',
  },
};

// 获取错误消息
export function getErrorMessage(code: ErrorCode, locale: string): string {
  const messages = errorMessages[locale] || errorMessages['zh-CN'];
  return messages[code] || messages[ErrorCode.UNKNOWN_ERROR];
}
```

## 五、URL 语言参数支持

### 5.1 语言参数处理

```typescript
// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router';
import { i18n, setLocale } from '@/i18n';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/:lang(zh-CN|en-US)?',
      component: Layout,
      children: [
        { path: '', component: Home },
        { path: 'chat', component: Chat },
        { path: 'settings', component: Settings },
      ],
    },
  ],
});

// 路由守卫处理语言参数
router.beforeEach(async (to, from, next) => {
  const lang = to.params.lang as string;
  
  if (lang && ['zh-CN', 'en-US'].includes(lang)) {
    if (i18n.global.locale.value !== lang) {
      await setLocale(lang);
    }
  }
  
  next();
});
```

### 5.2 语言切换时更新 URL

```typescript
// 切换语言时同步更新 URL
const changeLanguage = async (code: string): Promise<void> => {
  await setLocale(code);
  
  // 更新 URL，保留当前路径
  const currentPath = router.currentRoute.value.path;
  const newPath = currentPath.replace(/^\/(zh-CN|en-US)?/, `/${code}`);
  
  await router.replace(newPath);
};
```

## 六、用户偏好持久化

### 6.1 存储策略

| 优先级 | 存储位置 | 说明 |
|-------|---------|------|
| 1 | URL 参数 | `?lang=en-US`，优先级最高，用于分享链接 |
| 2 | 用户配置（数据库） | 登录用户的偏好设置 |
| 3 | localStorage | 未登录用户的临时存储 |
| 4 | 浏览器语言 | 首次访问时的默认语言 |
| 5 | 默认中文 | 兜底方案 |

### 6.2 实现代码

```typescript
// src/stores/user.ts
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { setLocale } from '@/i18n';

export const useUserStore = defineStore('user', () => {
  // State
  const language = ref<string>(localStorage.getItem('user_language') || 'zh-CN');
  
  // Actions
  const updateLanguage = async (lang: string): Promise<void> => {
    language.value = lang;
    
    // 1. 更新前端 i18n
    await setLocale(lang);
    
    // 2. 保存到 localStorage
    localStorage.setItem('user_language', lang);
    
    // 3. 如果已登录，同步到后端
    if (isLoggedIn.value) {
      await updateUserPreference({ language: lang });
    }
  };
  
  // 从后端加载用户偏好
  const loadUserPreferences = async (): Promise<void> => {
    if (!isLoggedIn.value) return;
    
    try {
      const prefs = await fetchUserPreferences();
      if (prefs.language && prefs.language !== language.value) {
        await updateLanguage(prefs.language);
      }
    } catch (error) {
      console.error('Failed to load user preferences:', error);
    }
  };
  
  return {
    language: computed(() => language.value),
    updateLanguage,
    loadUserPreferences,
  };
});
```

## 七、专家内容语言处理

### 7.1 设计原则

- **专家 Prompt**：存储为中文，不随 UI 语言变化
- **专家描述**：存储为中文，不随 UI 语言变化
- **UI 标签**：如 "角色类型"、"Prompt 模板" 等，随 UI 语言变化

### 7.2 数据结构

```typescript
// 专家数据结构
interface Expert {
  id: string;
  name: string;              // 中文名称（固定）
  description: string;       // 中文描述（固定）
  promptTemplate: string;    // 中文 Prompt（固定）
  roleType: 'system' | 'user';
  tags: string[];            // 中文标签（固定）
  // UI 展示时，标签、按钮等随语言变化
}

// 示例
const expert: Expert = {
  id: 'code-reviewer',
  name: '代码审查专家',
  description: '专门用于代码审查的 AI 专家',
  promptTemplate: '你是一位资深的代码审查专家...',
  roleType: 'system',
  tags: ['代码', '审查', '开发'],
};
```

## 八、总结

| 内容类型 | 语言策略 | 实现方式 |
|---------|---------|---------|
| **UI 界面** | 中英文切换 | Vue I18n + @aivue/chatbot |
| **后端错误** | 中英文切换 | 错误码映射 |
| **专家内容** | 固定中文 | 数据库存储中文 |
| **AI 回复** | 自动响应 | LLM 自动处理，前端不干预 |
| **用户消息** | 用户输入语言 | 原样存储和展示 |

**实施步骤**：
1. 集成 Vue I18n，配置中英文语言包
2. 配置 @aivue/chatbot 的语言文本
3. 实现语言切换组件
4. 定义后端错误码映射
5. 实现用户偏好持久化
