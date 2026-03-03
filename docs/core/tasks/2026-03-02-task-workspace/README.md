# Task 工作空间管理

## 需求概述

实现 Task（任务）工作空间管理功能，允许用户创建任务并在隔离的工作空间中与专家协作。

## 核心概念

### Task（任务）
- 用户创建的工作单元，有独立的工作目录
- 一个 Task 可以和多个 Expert 对话（在不同会话中）
- 进入 Task 后，整个模式切换到"当前 Task"模式

### Workspace（工作空间）
- 即 Task 的工作目录，包含 input/output/temp/logs 等子目录
- 不单独使用"workspace"概念，统一用"当前 Task"表述

---

## 核心功能

### 1. 数据库表
- 创建 `tasks` 表，记录任务信息
- 扩展 `topics` 表，添加 `task_id` 字段关联任务
- **关系链**：`messages → topics → tasks`

### 2. 工作目录结构
```
./data/work/{userId}/{taskId}/
├── input/          # 用户上传的输入文件（只读/只写）
├── output/         # 专家生成的输出文件
├── temp/           # 临时文件（可清理）
├── logs/           # 执行日志
└── README.md       # 目录结构说明（自动生成）
```

### 3. 前端界面

#### Tasks Tab（右侧面板）
- 显示当前用户的 Task 列表
- 每个Task 显示：标题、状态、创建时间、文件数量
- **加号按钮**：创建新 Task
- **点击 Task**：进入该 Task 模式

#### Task 模式切换
- 进入 Task 后，顶部通栏显示"当前 Task: {title}"
- 退出 Task：回到 Task 清单页
- 切换 Task：选择不同的 Task 进入

### 4. 文件管理
- 文件上传：只允许上传到 `input/` 目录
- 文件下载：支持下载任意目录的文件
- 文件列表：显示当前 Task 的文件结构

### 5. 对话行为

#### 创建 Task
1. 用户点击 Tasks Tab 的加号按钮
2. **弹出对话框**，输入 Task 标题（必填）和描述（可选）
3. 系统创建 Task（使用 newID 生成 ID）和工作目录
4. 专家识别到新 Task 激活，询问用户需求

#### 进入 Task 后
1. 专家识别到 workspace 已激活
2. 通过交互询问用户需求
3. 创建新 Topic（自动关联当前 Task）
4. Topic 标题围绕 Task 内容生成

#### 多 Expert 对话
- 同一个 Task 可以和不同 Expert 对话
- 在不同会话/网页中，选择同一 Task 即可
- 通过 topics 表关联（topic 同时有 expert_id 和 task_id）

### 6. 技能上下文注入
- **不做作用域限制**：普通用户的技能作用域是自己用户目录下
- **上下文注入**：进入 Task 后，向 LLM 注入当前工作目录信息
- LLM 明确知道当前 Task 的工作目录，可以正确处理文件路径

---

## 技术设计

### 数据模型关系

```
┌─────────────┐           ┌─────────────┐     ┌─────────────┐
│    tasks    │<──────────│   topics    │<────│  messages   │
└─────────────┘  1:N      └─────────────┘     └─────────────┘
                                │
                                │ N:1
                                ▼
                          ┌─────────────┐
                          │   experts   │
                          └─────────────┘
```

- **Task**：工作空间，包含文件和多个对话主题
- **Topic**：对话主题，属于某个 Task（可选），关联某个 Expert
- **Message**：对话消息，属于某个 Topic

**关键点**：
- tasks 表不需要 expert_id 字段
- Task 与 Expert 的关系通过 topics 表体现

### 数据库设计

#### tasks 表（新增）
```sql
CREATE TABLE tasks (
  id VARCHAR(32) PRIMARY KEY,
  task_id VARCHAR(50) UNIQUE NOT NULL COMMENT '任务ID YYMMDD_xxx',
  title VARCHAR(200) NOT NULL COMMENT '任务标题',
  description TEXT COMMENT '任务描述',
  workspace_path VARCHAR(500) NOT NULL COMMENT '工作目录路径（相对路径）',
  status ENUM('active', 'archived', 'deleted') DEFAULT 'active',
  created_by VARCHAR(32) NOT NULL COMMENT '创建者 user_id',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_task_id (task_id),
  INDEX idx_user (created_by),
  INDEX idx_status (status)
);
```

#### topics 表扩展
```sql
-- 添加 task_id 字段
ALTER TABLE topics ADD COLUMN task_id VARCHAR(32) COMMENT '关联任务ID' AFTER expert_id;

-- 添加索引
ALTER TABLE topics ADD INDEX idx_task (task_id);

-- 添加外键约束
ALTER TABLE topics ADD CONSTRAINT fk_topic_task 
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
```

### API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/tasks/query | 复杂查询任务列表 |
| GET | /api/tasks | 获取任务列表 |
| POST | /api/tasks | 创建任务 |
| GET | /api/tasks/:id | 获取任务详情 |
| PUT | /api/tasks/:id | 更新任务 |
| DELETE | /api/tasks/:id | 删除任务（软删除） |
| GET | /api/tasks/:id/enter | 进入任务（获取工作空间状态） |
| GET | /api/tasks/:id/files | 获取文件列表 |
| POST | /api/tasks/:id/files | 上传文件（只能上传到 input/） |
| GET | /api/tasks/:id/files/download | 下载文件 |

### Task ID 格式

使用 `newID()` 生成唯一标识符：

```
示例：abc123def456
```

- 12 位随机字符
- 作为目录名和业务标识

### 工作空间上下文注入

当用户进入 Task 后，需要在 LLM 对话中注入上下文：

```javascript
// 在 ChatService 中注入 Task 上下文
const taskContext = {
  currentTask: {
    id: task.task_id,
    title: task.title,
    description: task.description,
    workspacePath: task.workspace_path,
    absolutePath: path.resolve(WORKSPACE_ROOT, task.workspace_path),
  },
  directories: {
    input: 'input/',
    output: 'output/',
    temp: 'temp/',
    logs: 'logs/',
  },
};

// 系统提示词中添加
const taskPrompt = `
## 当前任务

你正在用户的任务工作空间中工作。

- 任务ID: ${taskContext.currentTask.id}
- 任务标题: ${taskContext.currentTask.title}
- 任务描述: ${taskContext.currentTask.description || '无'}
- 工作目录: ${taskContext.currentTask.absolutePath}

目录结构：
- input/ - 用户上传的输入文件
- output/ - 你生成的输出文件应放在这里
- temp/ - 临时文件
- logs/ - 执行日志

处理文件时，请使用相对路径（如 input/document.pdf）。
`;
```

### 前端状态管理

```typescript
// Task 状态
interface Task {
  id: string;
  task_id: string;
  title: string;
  description?: string;
  workspace_path: string;
  status: 'active' | 'archived' | 'deleted';
  created_by: string;
  created_at: string;
  updated_at: string;
}

// 当前 Task 状态（全局）
interface TaskState {
  currentTask: Task | null;
  isInTaskMode: boolean;
  files: FileInfo[];
}
```

### UI 交互流程

```
┌─────────────────────────────────────────────────────────────┐
│  顶部通栏                                                    │
│  [当前 Task: PDF分析报告] [退出]                             │  ← Task 模式时显示
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  专家对话区                    │  右侧面板                   │
│                               │  ┌─────────────────────────┐│
│  用户: 帮我分析这个PDF         │  │ Topics │ Tasks │ Debug ││
│  专家: 好的，请上传文件...     │  └─────────────────────────┘│
│                               │  ┌─────────────────────────┐│
│                               │  │ [+] 创建新 Task          ││
│                               │  ├─────────────────────────┤│
│                               │  │ 📁 PDF分析报告           ││
│                               │  │    250302_abc123        ││
│                               │  │    3 files              ││
│                               │  ├─────────────────────────┤│
│                               │  │ 📁 数据清洗任务          ││
│                               │  │    250301_xyz789        ││
│                               │  │    5 files              ││
│                               │  └─────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## 实现步骤

### Phase 1: 后端基础
1. [x] 创建数据库迁移脚本 `scripts/migrate-add-tasks.js`
2. [x] 创建 Task Controller `server/controllers/task.controller.js`
3. [x] 创建 Task Routes `server/routes/task.routes.js`
4. [x] 注册路由到主应用 `server/index.js`
5. [x] 添加 Task 模型到 Sequelize `models/task.js`
6. [x] 修改 Topic 创建逻辑，支持关联 Task

### Phase 2: 前端界面
1. [x] 创建 Tasks Tab 组件 `frontend/src/components/panel/TasksTab.vue`
2. [x] 实现任务列表展示
3. [x] 实现创建任务对话框
4. [x] 实现进入/退出 Task 模式
5. [ ] 顶部通栏显示当前 Task
6. [x] 实现文件上传/下载（只能上传到 input/）

### Phase 3: 对话集成
1. [x] 进入 Task 时设置当前 task 上下文
2. [x] 创建 Topic 时关联 task_id
3. [x] ChatService 注入 Task 上下文到系统提示词
4. [ ] 专家识别 Task 激活，主动询问需求

---

## 文件清单

| 文件 | 说明 |
|------|------|
| `scripts/migrate-add-tasks.js` | 数据库迁移脚本 |
| `server/controllers/task.controller.js` | 任务控制器 |
| `server/routes/task.routes.js` | 任务路由 |
| `models/task.js` | Task 模型（Sequelize 自动生成） |
| `frontend/src/components/panel/TasksTab.vue` | Tasks 标签页组件 |
| `frontend/src/stores/task.ts` | Task 状态管理 |
| `frontend/src/stores/panel.ts` | 面板状态管理（已添加 tasks Tab） |
| `frontend/src/components/panel/RightPanel.vue` | 右侧面板（已集成 Tasks Tab） |

---

## 验收标准

- [x] tasks 表创建完成
- [x] topics 表添加 task_id 字段
- [x] 任务创建 API（含目录结构自动生成）
- [x] 任务列表 API
- [x] 前端 Tasks Tab 实现（右侧面板 Tab）
- [x] 文件上传功能（只能上传到 input/）
- [x] 文件下载功能
- [x] 进入 Task 后 Topic 关联 task_id
- [x] Task 上下文注入到 LLM
- [ ] 顶部浮动 Task 指示器（聊天框顶部显示当前任务）
- [x] 退出/切换 Task 功能（在 Tasks 面板操作）

---

*创建时间: 2026-03-02*
*最后更新: 2026-03-02*
