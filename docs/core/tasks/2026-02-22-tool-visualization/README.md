# 工具调用可视化面板 + SearXNG 搜索技能

**状态：** 🔄 进行中
**创建日期：** 2026-02-22
**最后更新：** 2026-02-23

## 描述

在右侧面板添加"工具调用"Tab，展示 LLM 的工具调用历史和结果。同时实现一个基于 SearXNG 的搜索技能作为示例。

## 核心功能

1. **工具调用 Tab（ToolsTab）**：右侧面板新 Tab，展示当前对话的工具调用历史
2. **SearXNG 搜索技能**：基于 SearXNG 的隐私搜索技能，作为复杂工具的示例

## UI 设计

```
┌─────────────────────────────────────┐
│ [💬 Topics] [🔧 Tools] [🐛 Debug]   │  <- 新增 Tools Tab
├─────────────────────────────────────┤
│ 🔍 searxng_search                   │  <- 最新调用（展开）
│ ├─ 输入参数                         │
│ │  query: "今日天气"                │
│ │  engines: ["google", "bing"]      │
│ │  category: "general"              │
│ ├─ 输出结果                         │
│ │  ✓ 找到 15 条结果 (1.2s)          │
│ │  [展开详情...]                     │
│ └─ 时间戳: 16:30:45                 │
├─────────────────────────────────────┤
│ 📄 read_lines (已折叠)              │  <- 历史调用（折叠）
│ └─ ✓ 成功 (0.05s)                   │
├─────────────────────────────────────┤
│ 📁 list_files (已折叠)              │
│ └─ ✓ 成功 (0.02s)                   │
└─────────────────────────────────────┘
```

---

## 0.1 后端改造

### 1. 增强工具调用事件数据

**文件：** `lib/chat-service.js`

**改动：** 在 `tool_call` 和 `tool_results` SSE 事件中传递更详细的信息

```javascript
// 当前实现（简化版）
onDelta?.({ type: 'tool_call', toolCalls });

// 改进后（完整版）
onDelta?.({
  type: 'tool_call',
  toolCalls: toolCalls.map(call => ({
    id: call.id,
    name: call.function?.name,
    arguments: JSON.parse(call.function?.arguments || '{}'),
    timestamp: Date.now(),
  }))
});

// tool_results 事件增强
onDelta?.({
  type: 'tool_results',
  results: toolResults.map(r => ({
    toolCallId: r.toolCallId,
    toolName: r.toolName,
    success: r.success,
    duration: r.duration,
    // 根据工具类型格式化输出
    summary: formatResultSummary(r),
    // 完整数据（可折叠展开）
    data: r.data,
    error: r.error,
  }))
});
```

### 2. 添加结果摘要格式化

**文件：** `lib/tool-manager.js`

**新增方法：** `formatResultSummary(result)`

```javascript
/**
 * 格式化工具结果摘要（用于 UI 展示）
 */
formatResultSummary(result) {
  const { toolName, success, data, error } = result;
  
  if (!success) {
    return { status: 'error', message: error };
  }
  
  // 根据工具类型生成摘要
  switch (toolName) {
    case 'searxng_search':
      return {
        status: 'success',
        summary: `找到 ${data?.results?.length || 0} 条结果`,
        icon: '🔍',
      };
    case 'read_lines':
      return {
        status: 'success',
        summary: `读取 ${data?.returnedLines || 0} 行`,
        icon: '📄',
      };
    case 'list_files':
      return {
        status: 'success',
        summary: `${data?.files?.length || 0} 个文件/目录`,
        icon: '📁',
      };
    // ... 其他工具
    default:
      return {
        status: 'success',
        summary: '执行成功',
        icon: '✓',
      };
  }
}
```

---

## 0.2 前端改造

### 1. 新增 ToolsTab 组件

**文件：** `frontend/src/components/panel/ToolsTab.vue`

```vue
<template>
  <div class="tools-tab">
    <div v-if="toolCalls.length === 0" class="empty-state">
      <p>{{ $t('panel.noToolCalls') }}</p>
    </div>
    
    <div v-else class="tool-calls-list">
      <div
        v-for="(call, index) in toolCalls"
        :key="call.id"
        class="tool-call-item"
        :class="{ expanded: expandedId === call.id }"
      >
        <!-- 折叠状态：摘要行 -->
        <div class="call-header" @click="toggleExpand(call.id)">
          <span class="tool-icon">{{ getToolIcon(call.name) }}</span>
          <span class="tool-name">{{ call.name }}</span>
          <span class="tool-status" :class="call.success ? 'success' : 'error'">
            {{ call.success ? '✓' : '✗' }}
          </span>
          <span class="tool-duration">{{ call.duration }}ms</span>
          <span class="expand-icon">{{ expandedId === call.id ? '▼' : '▶' }}</span>
        </div>
        
        <!-- 展开状态：详细信息 -->
        <div v-if="expandedId === call.id" class="call-details">
          <!-- 输入参数 -->
          <div class="detail-section">
            <div class="section-label">{{ $t('panel.inputParams') }}</div>
            <pre class="code-block">{{ JSON.stringify(call.arguments, null, 2) }}</pre>
          </div>
          
          <!-- 输出结果 -->
          <div class="detail-section">
            <div class="section-label">{{ $t('panel.outputResult') }}</div>
            <div v-if="call.success" class="result-content">
              <!-- 特殊渲染：搜索结果 -->
              <template v-if="call.name === 'searxng_search'">
                <SearchResults :results="call.data?.results" />
              </template>
              <!-- 默认渲染：JSON -->
              <template v-else>
                <pre class="code-block">{{ JSON.stringify(call.data, null, 2) }}</pre>
              </template>
            </div>
            <div v-else class="error-content">
              {{ call.error }}
            </div>
          </div>
          
          <!-- 时间戳 -->
          <div class="call-timestamp">
            {{ formatTime(call.timestamp) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
```

### 2. 更新 panel store

**文件：** `frontend/src/stores/panel.ts`

```typescript
export type TabId = 'topics' | 'tools' | 'debug'  // 新增 'tools'

// 新增 toolCalls 状态
const toolCalls = ref<ToolCall[]>([])

// 添加工具调用
const addToolCall = (call: ToolCall) => {
  toolCalls.value.unshift(call)  // 新的放前面
  // 保留最近 50 条
  if (toolCalls.value.length > 50) {
    toolCalls.value = toolCalls.value.slice(0, 50)
  }
}

// 更新工具调用结果
const updateToolResult = (toolCallId: string, result: ToolResult) => {
  const index = toolCalls.value.findIndex(c => c.id === toolCallId)
  if (index !== -1) {
    toolCalls.value[index] = { ...toolCalls.value[index], ...result }
  }
}

// 清空工具调用（切换对话时）
const clearToolCalls = () => {
  toolCalls.value = []
}
```

### 3. 更新 ChatView 处理 SSE 事件

**文件：** `frontend/src/views/ChatView.vue`

```typescript
// 处理工具调用事件
eventSource.value.addEventListener('tool_call', (event) => {
  const data = JSON.parse(event.data)
  
  // 添加到 panel store
  data.toolCalls.forEach(call => {
    panelStore.addToolCall({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      timestamp: call.timestamp,
      status: 'pending',
    })
  })
})

// 处理工具执行结果事件
eventSource.value.addEventListener('tool_results', (event) => {
  const data = JSON.parse(event.data)
  
  // 更新 panel store
  data.results.forEach(result => {
    panelStore.updateToolResult(result.toolCallId, {
      success: result.success,
      duration: result.duration,
      data: result.data,
      error: result.error,
      status: 'completed',
    })
  })
})
```

---

## 0.3 SearXNG 搜索技能实现

### 目录结构

```
data/skills/
└── searxng/
    ├── SKILL.md          # 技能说明（给 LLM 看）
    ├── index.js          # 技能实现
    └── package.json      # 依赖（可选）
```

### skill.md

```markdown
# SearXNG 搜索技能

提供隐私友好的网络搜索能力，基于 SearXNG 元搜索引擎。

## 可用工具

### searxng_search

搜索互联网信息。

**参数：**
- `query` (必填): 搜索关键词
- `engines` (可选): 搜索引擎列表，如 ["google", "bing", "duckduckgo"]
- `category` (可选): 搜索类别 "general"|"images"|"news"
- `pageno` (可选): 页码，默认 1

**返回：**
- `results`: 搜索结果数组，每项包含 title, url, snippet, engine
- `total`: 结果总数
- `duration`: 搜索耗时

## 使用示例

用户：帮我查一下今天的科技新闻
助手：[调用 searxng_search(query="今日科技新闻", category="news")]
```

### index.js

```javascript
/**
 * SearXNG 搜索技能
 * 提供隐私友好的网络搜索能力
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

// SearXNG 实例配置
const SEARXNG_INSTANCE = process.env.SEARXNG_URL || 'http://localhost:8888';
const SEARXNG_TIMEOUT = 15000;

export default {
  name: 'searxng',
  description: '基于 SearXNG 的隐私友好搜索引擎',
  version: '1.0.0',

  /**
   * 工具定义
   */
  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'searxng_search',
          description: '搜索互联网信息。支持多种搜索引擎和类别。返回相关网页、新闻或图片结果。',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '搜索关键词或问题'
              },
              engines: {
                type: 'array',
                items: { type: 'string' },
                description: '使用的搜索引擎列表，如 ["google", "bing", "duckduckgo"]',
                default: ['google', 'bing']
              },
              category: {
                type: 'string',
                enum: ['general', 'images', 'news'],
                description: '搜索类别',
                default: 'general'
              },
              pageno: {
                type: 'number',
                description: '页码，从 1 开始',
                default: 1
              },
              language: {
                type: 'string',
                description: '搜索语言，如 "zh-CN", "en-US"',
                default: 'zh-CN'
              }
            },
            required: ['query']
          }
        }
      }
    ];
  },

  /**
   * 执行工具
   */
  async execute(toolName, params, context) {
    switch (toolName) {
      case 'searxng_search':
        return await this.search(params);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  },

  /**
   * 执行搜索
   */
  async search(params) {
    const {
      query,
      engines = ['google', 'bing'],
      category = 'general',
      pageno = 1,
      language = 'zh-CN'
    } = params;

    if (!query) {
      return { success: false, error: 'query is required' };
    }

    const startTime = Date.now();

    try {
      // 构建搜索 URL
      const searchUrl = new URL('/search', SEARXNG_INSTANCE);
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('format', 'json');
      searchUrl.searchParams.set('engines', engines.join(','));
      searchUrl.searchParams.set('category', category);
      searchUrl.searchParams.set('pageno', String(pageno));
      searchUrl.searchParams.set('language', language);

      // 发送请求
      const result = await this.httpGet(searchUrl.toString());

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Search request failed',
        };
      }

      const data = JSON.parse(result.body);
      const duration = Date.now() - startTime;

      // 格式化结果
      const results = (data.results || []).map(item => ({
        title: item.title,
        url: item.url,
        snippet: item.content,
        engine: item.engine,
        publishedDate: item.publishedDate,
      }));

      return {
        success: true,
        data: {
          query,
          results,
          total: results.length,
          duration,
          engines: engines,
        },
        // 用于 UI 摘要
        summary: `找到 ${results.length} 条结果 (${(duration / 1000).toFixed(1)}s)`,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: error.message,
        duration,
      };
    }
  },

  /**
   * HTTP GET 请求
   */
  httpGet(url) {
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;

        const req = client.get(url, {
          timeout: SEARXNG_TIMEOUT,
          headers: {
            'User-Agent': 'TouwakaMate/1.0',
            'Accept': 'application/json',
          }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              success: res.statusCode === 200,
              statusCode: res.statusCode,
              body: data,
            });
          });
        });

        req.on('error', (error) => {
          resolve({ success: false, error: error.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Request timeout' });
        });
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }
};
```

---

## 0.4 数据库更新

无需数据库改动，工具调用数据存储在 `messages.tool_calls` 字段中。

---

## 0.5 国际化

**文件：** `frontend/src/i18n/locales/zh-CN.ts`

```typescript
panel: {
  // ... 现有翻译
  tools: '工具调用',
  noToolCalls: '暂无工具调用',
  inputParams: '输入参数',
  outputResult: '输出结果',
  toolDuration: '耗时 {ms}ms',
  toolSuccess: '执行成功',
  toolFailed: '执行失败',
}
```

---

## 完成度分析（2026-02-23）

**总体完成度：约 20%**

| 模块 | 状态 | 完成度 |
|------|------|--------|
| 后端 SSE 事件 | ✅ 已完成 | 100% |
| 前端事件处理 | ⚠️ 部分完成 | 50% |
| Panel Store | ❌ 未开始 | 0% |
| ToolsTab 组件 | ❌ 未开始 | 0% |
| 类型定义 | ❌ 未开始 | 0% |
| SearXNG 技能 | ❌ 未开始 | 0% |
| 国际化 | ❌ 未开始 | 0% |

### 已完成项

- ✅ `lib/chat-service.js`: `tool_call` SSE 事件发送（第 199 行）
- ✅ `lib/chat-service.js`: `tool_results` SSE 事件发送（第 248 行）
- ✅ `views/ChatView.vue`: `tool_call` 事件监听（第 232-250 行）
- ✅ `views/ChatView.vue`: `tool_results` 事件监听（第 254-275 行）
  - 当前实现：在消息气泡中简单显示工具调用信息

---

## 待办清单

**后端：**
- [x] `lib/chat-service.js`: 增强 `tool_call` SSE 事件，传递完整参数
- [x] `lib/chat-service.js`: 增强 `tool_results` SSE 事件，传递格式化摘要
- [ ] `lib/tool-manager.js`: 添加 `formatResultSummary()` 方法

**前端：**
- [ ] `stores/panel.ts`: 添加 `TabId = 'tools'`
- [ ] `stores/panel.ts`: 添加 `toolCalls` 状态和相关 actions
- [ ] `components/panel/ToolsTab.vue`: 创建工具调用展示组件
- [ ] `components/panel/RightPanel.vue`: 集成 ToolsTab
- [x] `views/ChatView.vue`: 处理 `tool_call` 和 `tool_results` 事件（基础版）
- [ ] `views/ChatView.vue`: 将工具调用数据同步到 panel store
- [ ] `types/index.ts`: 添加 `ToolCall` 和 `ToolResult` 类型

**技能：**
- [ ] `data/skills/searxng/SKILL.md`: 创建技能说明
- [ ] `data/skills/searxng/index.js`: 实现搜索功能
- [ ] 测试 SearXNG 技能

**国际化：**
- [ ] `zh-CN.ts`: 添加工具调用相关翻译
- [ ] `en-US.ts`: 添加工具调用相关翻译

---

## 技术要点

1. **工具调用数据流**：
   ```
   LLM → tool_call event → ChatView → panelStore.addToolCall()
   ToolManager → tool_results event → ChatView → panelStore.updateToolResult()
   ```

2. **UI 状态管理**：
   - 最新调用自动展开
   - 历史调用默认折叠
   - 点击可切换展开/折叠

3. **特殊渲染**：
   - 搜索结果：卡片式展示（标题、摘要、来源）
   - 文件列表：树形展示
   - 代码内容：语法高亮
   - 其他：JSON 格式化
