# 技能目录面板产品设计分析

## 问题背景

### 当前痛点

1. **防逃逸工作繁琐**
   - 文件操作技能（`file-operations`）和代码执行技能（`user-code-executor`）需要严格的路径限制
   - 当前方案在 SKILL.md 中定义规则，后端代码实现校验
   - 每次添加新技能或修改规则都需要修改代码

2. **用户心智负担**
   - 用户不清楚当前技能能访问哪些目录
   - 报错信息不够直观（"路径被拒绝"等）

3. **管理复杂度**
   - 不同用户类型（普通用户/管理员）有不同的目录权限
   - 技能执行时的"工作目录"概念不够明确

### Tasks 的成功模式

Tasks 功能通过以下方式解决了类似问题：

1. **明确的边界**：每个任务有独立的工作空间目录
2. **可视化界面**：用户可以直观看到当前目录结构
3. **模式切换**：进入任务模式后，所有操作都在该任务目录下进行
4. **状态指示**：清晰显示当前所在位置

---

## 方案分析

### 方案一：独立 TabPage - SkillsDirectory ✅ 推荐

**设计思路**：在右侧面板添加新的 TabPage，专门用于技能目录管理。

```
┌─────────────────────────────────────────────────────────────┐
│  [专家] [话题] [任务] [技能目录] [助理]  [分屏 ▼]           │
├─────────────────────────────────────────────────────────────┤
│  当前技能目录                                                │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 📁 data/skills/file-operations                         ││
│  │   ├── index.js                                         ││
│  │   ├── SKILL.md                                         ││
│  │   └── ...                                              ││
│  └─────────────────────────────────────────────────────────┘│
│                                                              │
│  [切换目录] [新建目录] [刷新]                                │
└─────────────────────────────────────────────────────────────┘
```

**优点**：
- 独立空间，不影响现有功能
- 可以完整展示目录树和文件
- 便于扩展（如目录权限设置）

**缺点**：
- 增加 Tab 数量，可能显得拥挤
- 与 Tasks 功能有重叠感
- 用户需要在两个 Tab 之间切换

---

### 方案二：Tasks 下托管 - 任务处理 + 技能处理

**设计思路**：将 Tasks Tab 升级为"工作空间"概念，分为两个子模式。

```
┌─────────────────────────────────────────────────────────────┐
│  [专家] [话题] [工作空间] [助理]  [分屏 ▼]                  │
├─────────────────────────────────────────────────────────────┤
│  [任务处理] [技能目录]                                       │
├─────────────────────────────────────────────────────────────┤
│  （根据选中的子模式显示对应内容）                            │
│                                                              │
│  任务处理模式：显示任务列表和文件管理                        │
│  技能目录模式：显示技能目录结构和文件                        │
└─────────────────────────────────────────────────────────────┘
```

**优点**：
- 统一"工作空间"概念，逻辑清晰
- 减少 Tab 数量
- 两个子模式有相似的 UI 模式（目录浏览、文件预览）

**缺点**：
- 需要重构 TasksTab 组件
- 子模式切换增加交互层级

---

### 方案三：上下文感知 - 根据专家类型自动切换

**设计思路**：参考当前 skill-studio 的实现，根据专家类型自动显示相关 Tab。

```javascript
// 当前实现（RightPanel.vue）
if (is_skill_studio.value) {
  // 显示 expert, skills, debug
} else {
  // 显示 expert, topics, tasks, assistants, debug
}
```

**扩展方案**：
- 普通专家：显示"任务"Tab（当前行为）
- skill-studio 专家：显示"技能目录"Tab
- 其他特殊专家：可根据需要定制

**优点**：
- 无需用户手动切换
- 上下文相关，减少认知负担
- 复用现有架构

**缺点**：
- 不够灵活，用户无法自主选择
- 特殊专家类型需要硬编码

---

### 方案四：技能目录作为"虚拟任务"

**设计思路**：将技能目录视为一种特殊的"任务"，复用 Tasks 的所有功能。

```
任务列表：
┌─────────────────────────────────────────────────────────────┐
│  📁 任务：网站开发项目                      [进行中]        │
│  📁 任务：数据分析报告                      [已归档]        │
│  ─────────────────────────────────────────────────────────  │
│  🛠️ 技能目录：file-operations               [系统]         │
│  🛠️ 技能目录：user-code-executor            [系统]         │
└─────────────────────────────────────────────────────────────┘
```

**优点**：
- 完全复用现有代码，开发成本最低
- 统一的用户体验
- 技能目录可以享受任务的所有功能（文件预览、编辑等）

**缺点**：
- 概念混淆（任务 vs 技能目录）
- 需要区分"用户任务"和"系统目录"
- 可能影响任务列表的清晰度

---

## 状态管理架构设计

### 核心原则

1. **任务和技能独立管理**：`taskStore` 管理任务状态，`skillDirectoryStore` 管理技能目录状态
2. **互斥关系**：进入任务模式时清除技能模式，反之亦然
3. **自动运行时锁定**：如果任务在自动执行，路径不可修改（需要换专家）
4. **多窗口支持**：两个窗口可以分别操作 task 和 skill

### 状态设计

```typescript
// stores/skillDirectory.ts（新增）
interface SkillDirectoryState {
  // 当前选中的技能目录（用于显示信息）
  selectedSkill: {
    name: string           // 技能名称
    path: string           // 完整路径
    description?: string   // 描述
    tools?: string[]       // 工具列表
  } | null
  
  // 当前工作技能（用于限制文件操作路径）
  currentWorkingSkill: {
    name: string
    path: string           // 如 data/skills/file-operations
  } | null
  
  // 当前浏览路径
  currentBrowsePath: string
  
  // 技能目录列表
  skillDirectories: SkillDirectory[]
}

// stores/task.ts 保持不变
// currentTask, currentPath, isInTaskMode 等
```

### Tab 切换逻辑

```
用户切换 Tab                状态变化
─────────────────────────────────────────────────────
切换到 Tasks Tab           → 显示任务列表和任务文件
切换到 Skills Tab          → 显示技能目录树和技能信息
切换到其他 Tab             → 保持当前状态，但不影响文件操作
```

### 进入/退出技能模式

```typescript
// 进入技能模式（点击"设为当前工作目录"按钮）
const enterSkillMode = (skill: SkillDirectory) => {
  // 如果当前在任务模式，提示用户
  if (taskStore.currentTask) {
    toast.warning('请先退出当前任务')
    return
  }
  
  skillDirectoryStore.setCurrentWorkingSkill({
    name: skill.name,
    path: skill.path
  })
  
  // 更新 URL
  router.push({
    name: 'chat',
    params: { expertId: currentExpertId.value },
    query: { skill: skill.name }
  })
}

// 退出技能模式
const exitSkillMode = () => {
  skillDirectoryStore.clearCurrentWorkingSkill()
  
  // 清除 URL 中的 skill 参数
  router.push({
    name: 'chat',
    params: { expertId: currentExpertId.value }
  })
}
```

### URL 路由设计

#### 方案 A：Query 参数（推荐）

```
任务模式：/chat/:expertId/task/:taskId
技能模式：/chat/:expertId?skill=file-operations
         /chat/:expertId?skill=file-operations&path=subdir
```

**优点**：
- 不需要新增路由规则
- 技能目录浏览是"临时"状态，不需要持久化到 URL 路径
- 刷新页面后可以恢复技能目录状态

#### 方案 B：类似 task 的路由结构

```
任务模式：/chat/:expertId/task/:taskId
技能模式：/chat/:expertId/skill/:skillName
```

**优点**：
- URL 结构对称，语义清晰
- 支持浏览器前进/后退

**缺点**：
- 需要新增路由规则
- 技能目录可能不需要像任务那样"进入"的概念

### 推荐实现：Query 参数

```typescript
// 路由配置保持不变
{
  path: 'chat/:expertId',
  name: 'chat',
  component: () => import('@/views/ChatView.vue'),
},
{
  path: 'chat/:expertId/task/:taskId',
  name: 'chat-with-task',
  component: () => import('@/views/ChatView.vue'),
},

// ChatView.vue 中监听 query 参数
const route = useRoute()
const skillName = computed(() => route.query.skill as string | undefined)
const skillPath = computed(() => route.query.path as string | undefined)

// 切换到技能目录时更新 URL
const navigateToSkill = (skillName: string, subPath?: string) => {
  const query: Record<string, string> = { skill: skillName }
  if (subPath) query.path = subPath
  router.push({ name: 'chat', params: { expertId }, query })
}
```

### 自动运行时的锁定机制

```typescript
// 当任务处于自动运行状态时
if (taskStore.currentTask?.status === 'autonomous') {
  // 禁止切换到 Skills Tab
  // 或者显示提示："当前任务正在自动运行，如需操作技能目录请切换专家"
}
```

### 多窗口场景

```
窗口 1：/chat/expert-1/task/task-123    → 操作任务文件
窗口 2：/chat/expert-1?skill=file-ops   → 浏览技能目录

两个窗口独立运行，互不影响
```

---

## 技能目录面板结构设计

### 面板布局

**左右并排布局（3:1 比例）**：

```
┌─────────────────────────────────────────────────────────────┐
│  [专家] [话题] [任务] [技能目录] [助理]  [分屏 ▼]           │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────┬─────────────────────┐│
│  │ 📂 技能目录树                     │ 📋 技能信息         ││
│  ├───────────────────────────────────┤                     ││
│  │ 📁 data/skills/                   │ 名称：file-ops      ││
│  │   ├── 📁 file-operations/         │ 描述：文件读写...   ││
│  │   │     ├── index.js              │                     ││
│  │   │     └── SKILL.md              │ 工具：read_file,    ││
│  │   ├── 📁 kb-search/               │   write_file...     ││
│  │   └── 📁 user-code-executor/      │                     ││
│  │                                   │ 状态：✅ 已注册     ││
│  │                                   │                     ││
│  │                                   │ [设为工作目录]      ││
│  └───────────────────────────────────┴─────────────────────┘│
└─────────────────────────────────────────────────────────────┘
         ↑ 75%                              ↑ 25%
```

#### 分屏比例选项

在右上角"分屏"下拉菜单中增加 3:1 比例选项：

**当前实现**（[`panel.ts`](frontend/src/stores/panel.ts:7)）：
```typescript
export type SplitMode = 'default' | '5:5' | '3:2'
```

**扩展后**：
```typescript
export type SplitMode = 'default' | '5:5' | '3:2' | '3:1'

const SPLIT_CONFIG: Record<SplitMode, number> = {
  'default': 30,   // 默认 30%
  '5:5': 50,       // 各 50%
  '3:2': 40,       // 聊天 60%，面板 40%
  '3:1': 25,       // 聊天 75%，面板 25%（适合技能目录面板）
}
```

| 比例 | 面板占比 | 说明 |
|------|---------|------|
| default | 30% | 默认 |
| 5:5 | 50% | 左右各 50% |
| 3:2 | 40% | 聊天 60%，面板 40% |
| 3:1 | 25% | 聊天 75%，面板 25%（适合技能目录面板） |

### 面板分为两块

#### 1. 目录树区域

- 显示 `data/skills/` 下的所有技能目录
- 支持展开/折叠
- 点击目录可查看技能详情
- 支持文件预览（类似 Tasks 的文件预览）

#### 2. 技能信息区域

显示选中技能的详细信息：

| 字段 | 说明 |
|------|------|
| 名称 | 技能目录名（如 `file-operations`） |
| 描述 | 从 SKILL.md 提取的描述 |
| 工具列表 | 该技能提供的工具函数 |
| 注册状态 | 是否已注册、已分配给哪些专家 |
| 操作按钮 | "设为当前工作目录" |

### 当前技能状态设计

```typescript
// stores/skillDirectory.ts（新增）
interface SkillDirectoryState {
  // 当前选中的技能目录（用于显示信息）
  selectedSkill: {
    name: string           // 技能名称
    path: string           // 完整路径
    description?: string   // 描述
    tools?: string[]       // 工具列表
  } | null
  
  // 当前工作目录（用于限制文件操作路径）
  currentWorkingSkill: {
    name: string
    path: string           // 如 data/skills/file-operations
  } | null
  
  // 当前浏览路径（复用 taskStore.currentBrowsePath 的概念）
  currentBrowsePath: string
}
```

### 与任务模式的关系

| 特性 | 任务模式 | 技能模式 |
|------|---------|---------|
| 状态存储 | `taskStore.currentTask` | `skillDirectoryStore.currentWorkingSkill` |
| 路径限制 | 任务工作空间目录 | 技能目录 |
| URL 路由 | `/chat/:expertId/task/:taskId` | `/chat/:expertId?skill=xxx` |
| 互斥关系 | 不能同时处于两种模式 | 不能同时处于两种模式 |

---

## 对话窗口顶部标记设计

### 当前实现（任务模式）

在 [`ChatView.vue`](frontend/src/views/ChatView.vue:27-40) 中，任务模式通过 `task-mode-tag` 组件显示：

```vue
<span
  class="task-mode-tag"
  :class="{ 'in-task': taskStore.currentTask, 'no-task': !taskStore.currentTask }"
  @click="taskStore.currentTask && handleExitTaskMode()"
  :title="taskStore.currentTask ? $t('chat.exitTaskMode') : $t('chat.selectDirectory')"
>
  <template v-if="taskStore.currentTask">
    📁 {{ taskStore.currentTask.title }}
    <span class="exit-icon">✕</span>
  </template>
  <template v-else>
    ⚠️ {{ $t('chat.noDirectory') }}
  </template>
</span>
```

### 扩展设计：技能模式标记

#### 状态判断逻辑

```typescript
// 从 Store 获取状态
const taskStore = useTaskStore()
const skillDirectoryStore = useSkillDirectoryStore()

// 三种状态
type WorkspaceMode = 'task' | 'skill' | 'none'

const workspaceMode = computed(() => {
  // 任务优先：如果当前在任务模式
  if (taskStore.currentTask) return 'task'
  
  // 技能模式：已设置当前工作技能
  if (skillDirectoryStore.currentWorkingSkill) return 'skill'
  
  return 'none'
})

// 当前技能名称（用于显示）
const currentSkillDisplayName = computed(() => {
  return skillDirectoryStore.currentWorkingSkill?.name || null
})
```

> **设计说明**：
> - 技能模式需要 `currentWorkingSkill` 状态，用于限制文件操作路径
> - 与任务模式类似，技能模式也有"工作目录"概念
> - URL query 参数 `?skill=xxx` 用于页面刷新后恢复状态

#### UI 展示方案

```
┌──────────────────────────────────────────────────────────────────────┐
│  🤖 专家名称  [模型标签]  📁 任务名称 ✕                              │  ← 任务模式
├──────────────────────────────────────────────────────────────────────┤
```

```
┌──────────────────────────────────────────────────────────────────────┐
│  🤖 专家名称  [模型标签]  🛠️ file-operations ✕                      │  ← 技能模式
├──────────────────────────────────────────────────────────────────────┤
```

```
┌──────────────────────────────────────────────────────────────────────┐
│  🤖 专家名称  [模型标签]  ⚠️ 未选择目录                              │  ← 无模式
├──────────────────────────────────────────────────────────────────────┤
```

#### 代码实现

```vue
<span
  class="workspace-mode-tag"
  :class="{
    'in-task': workspaceMode === 'task',
    'in-skill': workspaceMode === 'skill',
    'no-workspace': workspaceMode === 'none'
  }"
  :title="workspaceModeTitle"
>
  <!-- 任务模式 -->
  <template v-if="workspaceMode === 'task'">
    📁 {{ taskStore.currentTask?.title }}
  </template>
  
  <!-- 技能模式 -->
  <template v-else-if="workspaceMode === 'skill'">
    🛠️ {{ skillDirectoryStore.currentWorkingSkill?.name }}
  </template>
  
  <!-- 无工作空间 -->
  <template v-else>
    ⚠️ {{ $t('chat.noDirectory') }}
  </template>
</span>
```

> **注意**：
> - 移除了 `@click` 事件和 `exit-icon`，标记仅用于状态展示
> - 技能名称从 `skillDirectoryStore.currentWorkingSkill` 获取

#### 样式扩展

```css
/* 技能模式样式 */
.workspace-mode-tag.in-skill {
  background: #9c27b0;  /* 紫色，区分于任务的蓝色 */
  color: white;
  cursor: pointer;
}

.workspace-mode-tag.in-skill:hover {
  background: #7b1fa2;
}
```

### 交互逻辑

| 当前状态 | 点击标记行为 |
|---------|------------|
| 任务模式 | 无操作（仅展示状态） |
| 技能模式 | 无操作（仅展示状态） |
| 无工作空间 | 无操作（仅展示状态） |

> **注意**：标记仅用于状态展示，不提供退出功能。退出任务/技能模式需通过右侧面板的操作按钮实现。

### 互斥关系

- **任务优先**：如果当前在任务模式，切换到技能 Tab 时提示"请先退出当前任务"
- **技能可切换**：在技能模式下可以自由切换到其他技能目录
- **独立状态**：任务和技能目录不能同时处于"工作模式"

---

## 技术实现要点

### 1. 目录权限控制

```javascript
// 技能目录的权限规则
const skillDirectoryPermissions = {
  // 管理员：可以访问所有技能目录
  admin: {
    baseDir: 'data/skills',
    writable: true,
    executable: true
  },
  // skill-studio 专家：可以访问指定技能目录
  skillStudio: {
    baseDir: 'data/skills',
    writable: false,  // 只读
    executable: false
  }
}
```

### 2. 文件操作路径限制

当用户设置了 `currentWorkingSkill` 后：

```typescript
// 后端：文件操作技能的路径校验
const validatePath = (requestedPath: string, workingSkill: { path: string }) => {
  const allowedBase = workingSkill.path  // 如 data/skills/file-operations
  
  if (!requestedPath.startsWith(allowedBase)) {
    throw new Error(`路径被限制在 ${allowedBase} 目录下`)
  }
}
```

### 3. 与技能执行的集成

当用户在技能目录 Tab 中设置了"当前工作目录"后：
- 文件操作技能的相对路径将基于该目录
- 代码执行技能的工作目录也将是该目录
- 后端校验时检查 `currentWorkingSkill.path` 作为允许的根目录

---

## 用户故事

### 故事 1：管理员调试技能

> 作为管理员，我需要在 skill-studio 专家对话中查看和调试技能代码，
> 我希望能在右侧面板直接浏览技能目录，查看文件内容，而不需要切换到文件管理器。

### 故事 2：设置工作目录

> 作为开发者，我需要让 AI 在特定目录下执行文件操作，
> 我希望能通过 UI 明确设置"当前工作目录"，而不是在对话中反复说明。

### 故事 3：权限可视化

> 作为普通用户，我想知道当前技能能访问哪些目录，
> 我希望 UI 能清晰显示可访问的目录范围，避免操作被拒绝。

---

## 实施建议

### Phase 1：基础功能（1-2 天）

1. 新增 SkillsDirectory Tab
2. 实现技能目录浏览功能
3. 仅对管理员和 skill-studio 专家显示

### Phase 2：URL 状态同步（1 天）

1. 实现 Query 参数路由
2. 支持刷新页面恢复状态
3. 多窗口独立状态

### Phase 3：权限可视化（1 天）

1. 显示目录权限信息
2. 区分可读/可写/可执行
3. 错误提示优化

---

## 总结

推荐采用**方案一（独立 TabPage）+ 技能目录 Store**：

1. **独立 TabPage**：技能目录有独立 Tab，分为目录树和技能信息两块
2. **新增 skillDirectoryStore**：管理 `currentWorkingSkill`，用于限制文件操作路径
3. **Query 参数路由**：`/chat/:expertId?skill=xxx&path=yyy`
4. **自动运行锁定**：任务自动运行时禁止切换
5. **多窗口支持**：每个窗口独立状态
6. **互斥关系**：任务模式和技能模式不能同时激活

✌Bazinga！亲爱的