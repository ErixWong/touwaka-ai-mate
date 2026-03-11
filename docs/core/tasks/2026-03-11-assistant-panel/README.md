# 助理系统前端设计

> **任务编号**: #91
> **创建时间**: 2026-03-11
> **关联**: #67 助理系统设计, #88 Assistant Summon 输入结构优化

---

## 1. 设计理念

### 核心定位

```
专家是主角，助理是专家调度的执行单元
```

**助理不是用户直接使用的主角色，而是 Expert 的外援。**

### 为什么放在专家页

1. **用户主要和 Expert 对话** - 助理不是独立入口
2. **Assistant 是 Expert 的外援** - 由专家决定何时委托
3. **委托完成后回到专家** - 结果注入专家对话

如果做成独立页面，用户会困惑：
- 我到底是先找专家，还是先找助理？
- 助理和专家是什么关系？
- 助理是不是也能单独接用户？

---

## 2. UI 设计

### 2.1 位置：专家页右侧面板

新增「助理」Tab，与现有 Tab 并列：

```
┌─────────────────────────────────────────────────────┐
│ 专家页                                              │
├─────────────────────┬───────────────────────────────┤
│                     │  [专家] [话题] [任务] [助理] [调试] │
│    主聊天区          ├───────────────────────────────┤
│                     │                               │
│  用户: 帮我看看     │   助理面板                    │
│  这张合同...        │                               │
│                     │   ┌─────────────────────────┐ │
│  专家: 我来调用     │   │ 可用助理列表            │ │
│  视觉助理...        │   │ ├─ 视觉助理  ✅ 可用    │ │
│                     │   │ ├─ OCR助理  ✅ 可用    │ │
│  ───────────────    │   │ └─ 编程助理  ✅ 可用    │ │
│                     │   └─────────────────────────┘ │
│  [视觉助理已完成]   │                               │
│  已提取合同关键条款 │   ┌─────────────────────────┐ │
│                     │   │ 当前委托列表            │ │
│                     │   │ ├─ 视觉助理  处理中 3s  │ │
│                     │   │ └─ OCR助理   ✅ 已完成  │ │
│                     │   └─────────────────────────┘ │
└─────────────────────┴───────────────────────────────┘
```

### 2.2 面板内容分 3 块

#### ① 可用助理列表

显示所有 `is_active = true` 的助理：

| 字段 | 说明 |
|------|------|
| 名称 | `assistants.name` |
| 图标 | `assistants.icon` |
| 状态 | 可用/不可用 |
| 执行模式 | `direct` / `llm` / `hybrid` |
| 默认模型 | 关联的 `model_id` |

#### ② 当前委托列表

显示当前专家最近发起的 `assistant_requests`：

| 字段 | 说明 |
|------|------|
| 助理类型 | `assistant_type` |
| 状态 | `pending` / `running` / `completed` / `failed` |
| 任务描述 | `input.task` |
| 创建时间 | `created_at` |
| 已运行时间 | 实时计算 |
| 操作 | 查看详情 |

#### ③ 委托详情

点击某个 request 后展开：

| 字段 | 说明 |
|------|------|
| request_id | 委托ID |
| task | 任务描述 |
| background | 任务背景 |
| input 摘要 | 输入数据预览 |
| 最终结果 | `result` |
| 消息时间线 | `assistant_messages` |

---

## 3. 典型使用场景

### 场景：法律专家调用视觉助理分析合同图片

#### Step 1: 用户进入专家页

用户在左侧聊天区对法律专家说：

> 帮我看看这张租赁合同截图，有哪些风险？

用户上传了一张合同图片。

#### Step 2: Expert 判断需要外援

法律专家识别到：
- 自己擅长法律分析
- 但图片内容需要先 OCR / 视觉识别

于是 Expert 调用：

```javascript
assistant_summon({
  type: "vision",
  task: "识别图片中的合同关键条款",
  background: "这是用户上传的租赁合同扫描件",
  input: { image_url: "..." },
  expected_output: { focus: ["租期", "违约责任", "付款方式"] }
})
```

#### Step 3: 右侧助理 Tab 出现新委托

右侧助理面板新增一张卡片：

```
┌─────────────────────────────┐
│ 👁 视觉助理                  │
│ 状态: 🔄 处理中              │
│ 已运行: 3 秒                 │
│ 任务: 识别图片中的合同关键条款 │
└─────────────────────────────┘
```

用户仍在专家页，不需要跳走。

#### Step 4: 助理执行完成

视觉助理完成后：
- `assistant_requests.status` → `completed`
- `assistant_messages` 写入 `final` 消息
- 系统消息回注到专家对话

主聊天区出现：

```
───────────────────────────────
[视觉助理已完成] 已提取合同关键条款
───────────────────────────────
```

右侧助理 Tab 的卡片更新：

```
┌─────────────────────────────┐
│ 👁 视觉助理                  │
│ 状态: ✅ 已完成              │
│ 耗时: 12 秒                  │
│ 任务: 识别图片中的合同关键条款 │
│ [查看详情]                   │
└─────────────────────────────┘
```

---

## 4. 实现计划

### 4.1 后端 API

已有 API（无需新增）：

| API | 说明 |
|-----|------|
| `GET /api/assistants` | 获取可用助理列表 |
| `GET /api/assistants/requests` | 获取委托列表 |
| `GET /api/assistants/requests/:id` | 获取委托详情 |
| `GET /api/assistants/requests/:id/messages` | 获取委托消息 |

需要新增的 API：

| API | 说明 |
|-----|------|
| `GET /api/assistants/requests?expert_id=xxx` | 按专家过滤委托列表 |

### 4.2 前端组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `AssistantPanel.vue` | 新建 | 助理面板主组件 |
| `AssistantList.vue` | 新建 | 可用助理列表 |
| `AssistantRequestList.vue` | 已有 | 委托列表（需适配） |
| `AssistantRequestCard.vue` | 已有 | 委托卡片（需适配） |
| `AssistantDetail.vue` | 新建 | 委托详情面板 |

### 4.3 状态管理

新增 Store：

```typescript
// frontend/src/stores/assistant.ts
export const useAssistantStore = defineStore('assistant', {
  state: () => ({
    assistants: [],           // 可用助理列表
    requests: [],             // 当前专家的委托列表
    activeRequest: null,      // 当前查看的委托
    pollingTimer: null,       // 轮询定时器
  }),
  actions: {
    async fetchAssistants() { ... },
    async fetchRequests(expertId) { ... },
    async fetchRequestDetail(requestId) { ... },
    startPolling(expertId) { ... },  // 自动刷新处理中的委托
    stopPolling() { ... },
  }
})
```

### 4.4 Tab 集成

修改专家页右侧面板，添加 Tab：

```vue
<!-- ExpertPanel.vue 或 ExpertSidebar.vue -->
<template>
  <div class="expert-sidebar">
    <div class="tabs">
      <button v-for="tab in tabs" :key="tab.key"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key">
        {{ tab.label }}
      </button>
    </div>

    <div class="tab-content">
      <ExpertInfo v-if="activeTab === 'expert'" />
      <TopicList v-if="activeTab === 'topic'" />
      <TaskList v-if="activeTab === 'task'" />
      <AssistantPanel v-if="activeTab === 'assistant'" />  <!-- 新增 -->
      <DebugPanel v-if="activeTab === 'debug'" />
    </div>
  </div>
</template>
```

---

## 5. 数据流

```
┌──────────────────────────────────────────────────────────────┐
│                        专家页                                 │
│  ┌────────────────────┐    ┌────────────────────────────┐   │
│  │                    │    │  助理 Tab                   │   │
│  │    主聊天区         │    │  ┌────────────────────────┐│   │
│  │                    │    │  │ GET /assistants        ││   │
│  │  Expert 调用        │    │  │ ┌─ 视觉助理            ││   │
│  │  assistant_summon  │    │  │ ├─ OCR助理             ││   │
│  │        │           │    │  │ └─ 编程助理            ││   │
│  │        ▼           │    │  └────────────────────────┘│   │
│  │  [委托已创建]       │    │                            │   │
│  │        │           │    │  GET /requests?expert_id=  │   │
│  │        ▼           │    │  ┌────────────────────────┐│   │
│  │  轮询 request 状态  │◄───┼──│ 视觉助理 🔄 处理中    ││   │
│  │        │           │    │  └────────────────────────┘│   │
│  │        ▼           │    │                            │   │
│  │  [助理已完成]       │    │  点击卡片                  │   │
│  │  显示结果          │    │  GET /requests/:id/messages│   │
│  │                    │    │  ┌────────────────────────┐│   │
│  │                    │    │  │ 消息时间线详情         ││   │
│  │                    │    │  └────────────────────────┘│   │
│  └────────────────────┘    └────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. 预计工作量

| 任务 | 时间 |
|------|------|
| Tab 集成与路由 | 1h |
| AssistantPanel 主组件 | 2h |
| 可用助理列表组件 | 1h |
| 委托列表适配 | 1h |
| 委托详情面板 | 2h |
| 状态管理 Store | 1h |
| 轮询与实时更新 | 1h |
| 样式与交互优化 | 1h |
| **总计** | **10h** |

---

## 7. 后续扩展

1. **手动召唤** - 用户手动点击助理卡片发起委托（非 Expert 自动调用）
2. **助理配置** - 管理员配置助理的模型、提示词等
3. **历史记录** - 查看专家的所有历史委托
4. **统计面板** - 助理调用频率、成功率、耗时统计