# 助理系统增强

> **创建时间**: 2026-03-13
> **关联任务**: #67 助理系统设计, #91 前端面板
> **状态**: ✅ 已完成
> **审计报告**: [CODE_REVIEW.md](./review.md)

## 新增功能

### 助理结果自动推送（2026-03-14 新增）

**功能描述**：助理任务完成后，自动将结果推送到 Expert 会话，无需轮询。

**工作流程**：

| 步骤 | 说明 |
|------|------|
| 1. Expert 发起委托 | 召唤助理，返回 request_id |
| 2. 助理执行 | 后台异步执行任务 |
| 3. 结果推送 | **助理通过 Internal API 自动将结果插入 Expert 会话** |
| 4. 用户查看 | 直接在对话中看到结果 |

**技术实现**：

- 新增 `notifyExpertResult()` 方法：任务完成后调用 Internal API
- 新增 `httpPost()` 辅助方法：HTTP 请求封装
- 调用 `/internal/messages/insert` 接口插入消息
- 设置 `trigger_expert: true` 触发专家响应

**代码改动**：

| 文件 | 改动 |
|------|------|
| `server/services/assistant-manager.js` | 新增通知逻辑 |
| `lib/tool-manager.js` | 移除 `assistant_status` tool |

**环境变量**：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `INTERNAL_API_BASE` | 内部 API 地址 | `http://localhost:3000` |
| `INTERNAL_API_KEY` | 内部 API 密钥 | - |

**效果**：Expert 召唤助理后，可以立即继续对话，助理结果会自动出现在对话中。

---

---

## 1. 需求背景

### 1.1 现状

当前助理系统的前端入口仅在**专家页右侧面板**，用户无法：
- 配置助理的默认模型、提示词
- 查看助理的详细信息和能力描述
- 管理助理的启用/禁用状态

### 1.2 目标

在设置页面新增「助理设置」Tab，放置在「专家设置」后面，让管理员可以：

1. **查看助理列表** - 所有可用助理及其状态
2. **配置助理参数** - 模型选择、温度、最大输出等
3. **编辑提示词** - 自定义助理的系统提示词
4. **管理启用状态** - 启用/禁用助理

---

## 2. 位置设计

### 2.1 Tab 位置

```
设置页面 Tab 顺序：
[个人资料] [模型与提供商] [专家设置] [助理设置] [系统配置] [用户管理] [角色管理] [组织架构] [关于]
                                    ↑ 新增位置
```

### 2.2 权限要求

| 角色 | 权限 |
|------|------|
| 普通用户 | 只读，查看助理列表 |
| 管理员 | 完全访问，可编辑配置 |

---

## 3. UI 设计

### 3.1 页面布局

```
┌─────────────────────────────────────────────────────────────────────┐
│  设置 > 助理设置                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🔍 搜索助理...                                               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  📝 OCR 助理                                        [编辑]   │   │
│  │  ────────────────────────────────────────────────────────   │   │
│  │  状态: ✅ 已启用                                             │   │
│  │  执行模式: direct                                            │   │
│  │  描述: 识别图片中的文字内容，支持多种语言                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  🎨 画图助理                                        [编辑]   │   │
│  │  ────────────────────────────────────────────────────────   │   │
│  │  状态: ✅ 已启用                                             │   │
│  │  执行模式: direct                                            │   │
│  │  模型: dall-e-3                                              │   │
│  │  描述: 根据文字描述生成图片                                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  💻 编程助理                                        [编辑]   │   │
│  │  ────────────────────────────────────────────────────────   │   │
│  │  状态: ✅ 已启用                                             │   │
│  │  执行模式: llm                                               │   │
│  │  模型: claude-3-sonnet                                       │   │
│  │  描述: 分析代码、生成代码、调试问题                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 助理卡片详情

每个助理卡片显示：

| 字段 | 说明 |
|------|------|
| 图标 + 名称 | `icon` + `name` |
| 状态 | `is_active` 启用/禁用 |
| 执行模式 | `execution_mode`：direct / llm / hybrid |
| 关联模型 | `model_id`（仅 llm/hybrid 模式显示） |
| 能力描述 | `description` |

### 3.3 编辑弹窗

点击「编辑」按钮弹出编辑弹窗：

```
┌─────────────────────────────────────────────────────────────────────┐
│  编辑助理 - 编程助理                                         [关闭] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  基本信息                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  名称: [编程助理                                        ]    │   │
│  │  图标: [💻                                        ]          │   │
│  │  描述: [分析代码、生成代码、调试问题                      ]    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  执行配置                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  执行模式: [llm ▼]  (direct / llm / hybrid)                  │   │
│  │  关联模型: [claude-3-sonnet ▼]                               │   │
│  │  最大输出: [4096                                    ] tokens │   │
│  │  温度:    [0.70 ───────────●───────────────── 1.0]           │   │
│  │  超时时间: [120                                   ] 秒       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  提示词配置                                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │ 你是一个专业的编程助理，擅长分析代码、生成代码、     │   │   │
│  │  │ 调试问题。你会用简洁清晰的方式回答问题...           │   │   │
│  │  │                                                     │   │   │
│  │  │                                                     │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  高级配置                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  [✓] 允许使用技能                                           │   │
│  │  [✓] 启用此助理                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                                          [取消]  [保存]             │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.4 编辑字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| 名称 | 文本 | 助理显示名称 |
| 图标 | 文本 | emoji 或图标标识 |
| 描述 | 文本 | 能力描述 |
| 执行模式 | 下拉 | direct / llm / hybrid |
| 关联模型 | 下拉 | 选择 ai_models 表中的模型 |
| 最大输出 | 数字 | max_output_tokens |
| 温度 | 滑块 | temperature (0-2) |
| 超时时间 | 数字 | timeout (秒) |
| 提示词 | 多行文本 | prompt_template |
| 允许使用技能 | 开关 | can_use_skills |
| 启用状态 | 开关 | is_active |

---

## 4. 数据模型

### 4.1 assistants 表（已有）

| 字段 | 类型 | 说明 |
|------|------|------|
| `assistant_type` | VARCHAR(32) | 主键，助理类型标识 |
| `name` | VARCHAR(128) | 显示名称 |
| `icon` | VARCHAR(32) | 图标 |
| `description` | TEXT | 能力描述 |
| `model_id` | VARCHAR(32) | 关联模型 ID |
| `prompt_template` | TEXT | 系统提示词模板 |
| `max_tokens` | INT | 最大输出 tokens |
| `temperature` | DECIMAL(3,2) | 温度参数 |
| `estimated_time` | INT | 预估时间（配置值，用于召唤时提示用户） |
| `timeout` | INT | 超时时间（秒） |
| `execution_mode` | ENUM | direct / llm / hybrid |
| `can_use_skills` | BIT | 是否允许使用技能 |
| `is_active` | BIT | 是否启用 |

> **注意**: `estimated_time` 是一个**静态配置值**，由管理员设置，用于在召唤助理时告诉用户大概需要等多久。实际执行耗时存储在 `assistant_requests.latency_ms` 中。

### 4.2 前端类型（已有）

```typescript
// frontend/src/types/index.ts

export interface Assistant {
  assistant_type: string
  name: string
  icon?: string
  description?: string
  model_id?: string
  prompt_template?: string
  max_tokens: number
  temperature: number
  estimated_time: number
  timeout: number
  tool_name?: string
  tool_description?: string
  tool_parameters?: string
  can_use_skills: boolean
  execution_mode: AssistantExecutionMode
  is_active: boolean
}
```

---

## 5. API 设计

### 5.1 已有 API

| API | 方法 | 说明 |
|-----|------|------|
| `/api/assistants` | GET | 获取助理列表 |

### 5.2 需要新增的 API

| API | 方法 | 说明 |
|-----|------|------|
| `/api/assistants/:type` | GET | 获取单个助理详情 |
| `/api/assistants/:type` | PUT | 更新助理配置 |

### 5.3 API 详情

#### GET /api/assistants/:type

获取单个助理的完整配置信息。

**响应**:
```json
{
  "code": 0,
  "data": {
    "assistant_type": "coding",
    "name": "编程助理",
    "icon": "💻",
    "description": "分析代码、生成代码、调试问题",
    "model_id": "claude-3-sonnet",
    "prompt_template": "你是一个专业的编程助理...",
    "max_tokens": 4096,
    "temperature": 0.70,
    "estimated_time": 60,
    "timeout": 120,
    "execution_mode": "llm",
    "can_use_skills": true,
    "is_active": true
  }
}
```

#### PUT /api/assistants/:type

更新助理配置（仅管理员可调用）。

**请求**:
```json
{
  "name": "编程助理",
  "icon": "💻",
  "description": "分析代码、生成代码、调试问题",
  "model_id": "claude-3-sonnet",
  "prompt_template": "你是一个专业的编程助理...",
  "max_tokens": 4096,
  "temperature": 0.70,
  "estimated_time": 60,
  "timeout": 120,
  "can_use_skills": true,
  "is_active": true
}
```

**响应**:
```json
{
  "code": 0,
  "data": {
    "assistant_type": "coding",
    "name": "编程助理",
    ...
  },
  "message": "更新成功"
}
```

---

## 6. 前端实现

### 6.1 文件结构

```
frontend/src/
├── components/settings/
│   └── AssistantSettingsTab.vue    # 新增：助理设置 Tab 组件
├── views/
│   └── SettingsView.vue            # 修改：添加 Tab 入口
├── stores/
│   └── assistant.ts                # 已有：添加更新方法
└── api/
    └── services.ts                 # 已有：添加 API 调用
```

### 6.2 组件设计

#### AssistantSettingsTab.vue

```vue
<template>
  <div class="assistant-settings-tab">
    <!-- 搜索栏 -->
    <div class="search-bar">
      <input v-model="searchQuery" type="text" placeholder="搜索助理..." />
    </div>

    <!-- 助理列表 -->
    <div class="assistant-list">
      <div
        v-for="assistant in filteredAssistants"
        :key="assistant.assistant_type"
        class="assistant-card"
      >
        <div class="assistant-header">
          <span class="assistant-icon">{{ assistant.icon }}</span>
          <span class="assistant-name">{{ assistant.name }}</span>
          <button class="btn-edit" @click="openEditDialog(assistant)">
            {{ $t('common.edit') }}
          </button>
        </div>

        <div class="assistant-body">
          <div class="info-row">
            <span class="label">{{ $t('assistant.status') }}:</span>
            <span class="value" :class="{ active: assistant.is_active }">
              {{ assistant.is_active ? $t('assistant.enabled') : $t('assistant.disabled') }}
            </span>
          </div>
          <div class="info-row">
            <span class="label">{{ $t('assistant.executionMode') }}:</span>
            <span class="value">{{ assistant.execution_mode }}</span>
          </div>
          <div v-if="assistant.model_id" class="info-row">
            <span class="label">{{ $t('assistant.model') }}:</span>
            <span class="value">{{ getModelName(assistant.model_id) }}</span>
          </div>
          <div class="description">{{ assistant.description }}</div>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <AssistantEditDialog
      v-if="showEditDialog"
      :assistant="editingAssistant"
      :models="availableModels"
      @close="closeEditDialog"
      @save="handleSave"
    />
  </div>
</template>
```

### 6.3 修改 SettingsView.vue

在 tabs 数组中添加助理设置：

```typescript
const tabs = computed(() => [
  { key: 'profile', label: t('settings.profile') },
  { key: 'model', label: t('settings.modelAndProvider') },
  { key: 'expert', label: t('settings.expertSettings') },
  { key: 'assistant', label: t('settings.assistantSettings') },  // 新增
  { key: 'system', label: t('settings.systemConfig'), adminOnly: true },
  { key: 'user', label: t('settings.userManagement') },
  { key: 'role', label: t('settings.roleManagement') },
  { key: 'organization', label: t('settings.organizationManagement') },
  { key: 'about', label: t('settings.about') },
])
```

添加助理设置 Section：

```vue
<!-- 助理设置 -->
<div v-if="activeTab === 'assistant'" class="settings-section assistant-section">
  <AssistantSettingsTab />
</div>
```

---

## 7. 国际化

### 7.1 中文（zh-CN）

```typescript
settings: {
  // ... 已有
  assistantSettings: '助理设置',
}

assistant: {
  // ... 已有
  executionMode: '执行模式',
  model: '关联模型',
  enabled: '已启用',
  disabled: '已禁用',
  promptTemplate: '提示词模板',
  maxTokens: '最大输出',
  temperature: '温度',
  timeout: '超时时间',
  canUseSkills: '允许使用技能',
}
```

### 7.2 英文（en-US）

```typescript
settings: {
  // ... existing
  assistantSettings: 'Assistant Settings',
}

assistant: {
  // ... existing
  executionMode: 'Execution Mode',
  model: 'Model',
  enabled: 'Enabled',
  disabled: 'Disabled',
  promptTemplate: 'Prompt Template',
  maxTokens: 'Max Output',
  temperature: 'Temperature',
  timeout: 'Timeout',
  canUseSkills: 'Can Use Skills',
}
```

---

## 8. 实施计划

| 步骤 | 任务 | 预计时间 |
|:----:|------|----------|
| 1 | 后端新增 GET/PUT `/api/assistants/:type` API | 1h |
| 2 | 前端新增 `AssistantSettingsTab.vue` 组件 | 2h |
| 3 | 前端新增 `AssistantEditDialog.vue` 弹窗组件 | 2h |
| 4 | 修改 `SettingsView.vue` 添加 Tab 入口 | 0.5h |
| 5 | 添加国际化文本 | 0.5h |
| 6 | 测试验证 | 1h |

**总计：约 7h**

---

## 9. 后续扩展

1. **助理工具配置** - 可视化配置助理可调用的工具
2. **助理统计面板** - 调用频率、成功率、平均耗时
3. **助理模板** - 预设助理配置模板，快速创建
4. **助理克隆** - 基于现有助理创建新助理

---

*创建时间: 2026-03-13*