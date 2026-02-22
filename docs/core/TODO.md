# 项目待办事项

> 最后更新：2026-02-22

## 待开始

### 0. 工具调用可视化面板 + SearXNG 搜索技能

**状态：** ⏳ 待开始

**描述：** 在右侧面板添加"工具调用"Tab，展示 LLM 的工具调用历史和结果。同时实现一个基于 SearXNG 的搜索技能作为示例。

**核心功能：**
1. **工具调用 Tab（ToolsTab）**：右侧面板新 Tab，展示当前对话的工具调用历史
2. **SearXNG 搜索技能**：基于 SearXNG 的隐私搜索技能，作为复杂工具的示例

**UI 设计：**
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

### 0.1 后端改造

#### 1. 增强工具调用事件数据

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

#### 2. 添加结果摘要格式化

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

### 0.2 前端改造

#### 1. 新增 ToolsTab 组件

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

#### 2. 更新 panel store

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

#### 3. 更新 ChatView 处理 SSE 事件

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

### 0.3 SearXNG 搜索技能实现

#### 目录结构

```
skills/
└── searxng/
    ├── skill.md          # 技能说明（给 LLM 看）
    ├── index.js          # 技能实现
    └── package.json      # 依赖（可选）
```

#### skill.md

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

#### index.js

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

### 0.4 数据库更新

无需数据库改动，工具调用数据存储在 `messages.tool_calls` 字段中。

---

### 0.5 国际化

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

### 待办清单

**后端：**
- [ ] `lib/chat-service.js`: 增强 `tool_call` SSE 事件，传递完整参数
- [ ] `lib/chat-service.js`: 增强 `tool_results` SSE 事件，传递格式化摘要
- [ ] `lib/tool-manager.js`: 添加 `formatResultSummary()` 方法

**前端：**
- [ ] `stores/panel.ts`: 添加 `TabId = 'tools'`
- [ ] `stores/panel.ts`: 添加 `toolCalls` 状态和相关 actions
- [ ] `components/panel/ToolsTab.vue`: 创建工具调用展示组件
- [ ] `components/panel/RightPanel.vue`: 集成 ToolsTab
- [ ] `views/ChatView.vue`: 处理 `tool_call` 和 `tool_results` 事件
- [ ] `types/index.ts`: 添加 `ToolCall` 和 `ToolResult` 类型

**技能：**
- [ ] `skills/searxng/skill.md`: 创建技能说明
- [ ] `skills/searxng/index.js`: 实现搜索功能
- [ ] 测试 SearXNG 技能

**国际化：**
- [ ] `zh-CN.ts`: 添加工具调用相关翻译
- [ ] `en-US.ts`: 添加工具调用相关翻译

---

### 技术要点

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

---

### 1. 反思心智模板配置化

**状态：** ⏳ 待开始

**描述：** 将反思心智（ReflectiveMind）的硬编码模板改为可配置，允许在专家配置界面中自定义反思维度、权重和输出格式。

**方案：**
- 在 `experts` 表添加 `reflection_template` TEXT 字段
- 支持变量替换：`{{core_values}}`, `{{behavioral_guidelines}}`, `{{taboos}}`, `{{emotional_tone}}`
- 如果字段为空，使用默认模板

**默认模板内容：**
```text
你是角色的"反思心智"，负责根据角色的 Soul 进行自我反思和评价。

## 角色核心价值观
{{core_values}}

## 角色行为准则
{{behavioral_guidelines}}

## 角色禁忌
{{taboos}}

## 角色情感基调
{{emotional_tone}}

## 评分维度与权重
1. 价值观一致性 (valueAlignment): 30% - 言行是否符合核心价值观
2. 行为准则 (behaviorAdherence): 25% - 是否遵循行为准则
3. 禁忌检查 (tabooCheck): 25% - 是否触犯禁忌
4. 情感适当性 (emotionalTone): 20% - 情感表达是否符合情感基调

## 你的任务
根据以上信息，对角色的回复进行自我评价：
1. 按四个维度评分（1-10分）
2. 计算综合得分（加权平均）
3. 给出下一轮的具体建议
4. 用第一人称写内心独白（真实想法和感受）

请严格返回以下 JSON 格式：
{
  "selfEvaluation": {
    "score": 1-10,
    "breakdown": {
      "valueAlignment": 1-10,
      "behaviorAdherence": 1-10,
      "tabooCheck": 1-10,
      "emotionalTone": 1-10
    },
    "reason": "评分理由"
  },
  "nextRoundAdvice": "下一轮的具体建议",
  "monologue": "内心独白（第一人称）"
}
```

**待办：**
- [ ] 数据库添加 `reflection_template` 字段
- [ ] 修改 `ReflectiveMind` 支持模板配置
- [ ] 前端专家编辑界面添加配置入口

**相关代码：**
- [`lib/reflective-mind.js:109-153`](../../lib/reflective-mind.js:109) - 当前硬编码位置

---

### 3. Skill 管理系统

**状态：** 🔄 进行中

**描述：** 实现技能管理系统，支持多种来源安装、AI解析、工具清单生成。

**核心理念：**
- 技能来源：URL / 上传ZIP / 本地目录（不需要技能市场界面）
- AI解析：注册时调用便宜AI（DeepSeek/通义）分析技能
  - 安全检查（检测恶意代码）
  - 提取工具清单（存入 skill_tools 表）
  - 生成结构化元数据
- 技能维护：通过对话维修、升级技能

**数据库：**
- `skills` 表：技能元数据 + 安全评分
- `skill_tools` 表：工具清单（AI生成）

**已完成：**
- [x] 数据库模型：更新 `skills` 表模型
- [x] 数据库模型：创建 `skill_tools` 表模型
- [x] 后端：技能CRUD API（`skill.controller.js`）
- [x] 后端：技能路由（`skill.routes.js`）
- [x] 后端：ZIP上传安装（使用 adm-zip）
- [x] 后端：本地目录安装
- [x] 前端：技能管理页面（`SkillsView.vue`）
- [x] 前端：技能状态管理（`skill.ts` store）
- [x] 前端：路由配置和导航入口
- [x] 国际化：中英文翻译

**待办：**
- [ ] 数据库迁移：执行下方迁移脚本
- [ ] 后端：URL下载安装功能
- [ ] 后端：AI分析服务（调用便宜AI解析技能）
- [ ] 测试：完整功能测试
- [x] AI基础能力：`read` / `write` / `execute` / `http_get` / `http_post`
  - 已创建 `skills/builtin/` 内置技能
  - 实现 7 类 18 个工具：读取、写入、编辑、搜索、管理、压缩、执行、网络

**数据库迁移脚本：**
```sql
-- =============================================
-- Skills 表迁移（逐条执行，忽略已存在的列）
-- =============================================

-- 添加 version 字段
ALTER TABLE skills ADD COLUMN version VARCHAR(32);

-- 添加 author 字段
ALTER TABLE skills ADD COLUMN author VARCHAR(128);

-- 添加 tags 字段
ALTER TABLE skills ADD COLUMN tags JSON;

-- 添加 source_url 字段
ALTER TABLE skills ADD COLUMN source_url VARCHAR(512);

-- 添加 security_score 字段
ALTER TABLE skills ADD COLUMN security_score INT DEFAULT 100;

-- 添加 security_warnings 字段
ALTER TABLE skills ADD COLUMN security_warnings JSON;

-- =============================================
-- 创建 skill_tools 表（主键使用字符串类型）
-- =============================================
CREATE TABLE skill_tools (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  skill_id VARCHAR(64) NOT NULL,
  name VARCHAR(64) NOT NULL,
  description TEXT,
  type ENUM('http', 'script', 'builtin') DEFAULT 'http',
  `usage` TEXT,
  command VARCHAR(512),
  endpoint VARCHAR(512),
  method VARCHAR(16),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY idx_skill_name (skill_id, name),
  INDEX idx_skill_id (skill_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

> **注意：** 
> - `usage` 是 MySQL 保留字，必须用反引号包裹
> - 如果字段已存在会报错，可以忽略
> - 主键 `id` 使用 VARCHAR(32) 字符串类型，与项目其他表一致

**相关文档：**
- [技能管理系统设计方案 v2.0](../design/v2/skill-market-design.md)

---

## 已完成

### 1. SSE 连接自动重连机制

**状态：** ✅ 已完成

**描述：** 解决后端重启后前端无法连接的问题，实现 SSE 连接断开自动重连和 API 健康检查。

**实现内容：**
- **SSE 自动重连**：连接断开后每 3 秒自动重试，最多 10 次
- **健康检查**：每 5 秒检测后端可用性
- **智能等待**：发送消息时如后端不可用，自动等待后端恢复（最多 30 秒）
- **状态提示**：UI 显示连接状态和重连进度

**相关文件：**
- [`frontend/src/views/ChatView.vue`](../../frontend/src/views/ChatView.vue) - SSE 连接管理和重连逻辑
- [`frontend/src/composables/useNetworkStatus.ts`](../../frontend/src/composables/useNetworkStatus.ts) - 网络状态检测 composable
- [`frontend/src/i18n/locales/zh-CN.ts`](../../frontend/src/i18n/locales/zh-CN.ts) - 中文翻译
- [`frontend/src/i18n/locales/en-US.ts`](../../frontend/src/i18n/locales/en-US.ts) - 英文翻译

---

## 进行中

### 2. 对话窗口右侧多功能 Panel

**状态：** ✅ 基础功能已完成

**描述：** 在对话页面右侧实现一个固定显示的面板容器，采用 Tab 页形式组织多个功能模块。

**Tab 页：**
1. ~~**Docs Tab**~~ - ❌ 已移除（简化设计）
2. **Topics Tab** - ✅ 历史话题列表（已完成）
3. **Debug Tab** - ✅ 调试信息（已完成）

**已完成：**
- [x] 实现 `RightPanel.vue` 容器组件
- [x] 迁移 `DebugPanel.vue` 到 `DebugTab.vue`
- [x] 实现 `TopicsTab.vue` 组件
- [x] 实现通用分页组件 `Pagination.vue`
- [x] 创建 `panel.ts` 状态管理
- [x] 更新 `types/index.ts` 添加分页类型
- [x] 更新国际化文件（zh-CN, en-US）
- [x] 修改 `ChatView.vue` 集成右侧面板
- [x] 后端 Topics 分页 API 实现（`topic.controller.js`）
- [x] Topic 消息计数和标题自动更新功能
- [x] 移除 Docs Tab（简化设计）

**待办：**
- [ ] Topics Tab 支持加载更多/无限滚动
- [ ] Debug Tab 显示更多调试信息（如 token 统计）

**相关文档：**
- [右侧面板设计方案 v2](../design/v2/right-panel-design.md)
- [API 查询设计规范](../guides/database/api-query-design.md)

---

## 文档索引

### 数据库手册
| 文档 | 描述 |
|------|------|
| [README.md](../guides/database/README.md) | 数据库概览与快速开始 |
| [api-query-design.md](../guides/database/api-query-design.md) | 复杂查询 API 规范 |
| [orm-analysis.md](../guides/database/orm-analysis.md) | ORM 选型分析 |

### 设计文档
| 文档 | 描述 |
|------|------|
| [right-panel-design.md](../design/v2/right-panel-design.md) | 右侧面板容器设计 |
| [task-layer-design.md](../design/v2/task-layer-design.md) | 任务层设计 |
| [api-design.md](../design/v1/api-design.md) | API 设计文档 (v1) |
| [ui-design-draft.md](../design/v1/ui-design-draft.md) | UI 设计草稿 (v1) |
| [i18n-design.md](../design/v1/i18n-design.md) | 国际化设计 (v1) |

---

*使用说明：状态图标含义*
- 🔄 进行中
- ⏳ 待开始  
- ✅ 已完成
- ❌ 已取消
