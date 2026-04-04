# 环境变量架构重设计

## 问题分析

### 当前设计的问题

用户反馈：**"我配置什么路径都可以啊？你这个搞得是不是有点瞎来？"**

当前设计确实反直觉：

| 环境变量 | 用途 | 使用者 | 默认值 |
|---------|------|--------|--------|
| `DATA_BASE_PATH` | 技能的基础路径 | 技能（fs、docx等） | `/app/data` |
| `WORKSPACE_ROOT` | 后端API的工作空间路径 | 后端Controller | `./data/work` |

**问题**：
1. 两个环境变量独立设置，用户需要同时配置两个才能保证一致性
2. 默认值不一致：`DATA_BASE_PATH=/app/data` vs `WORKSPACE_ROOT=./data/work`
3. 用户只想配置一个路径，系统却要求理解两个变量的关系

### 目录性质分析

| 目录 | 性质 | 持久化需求 | 来源 |
|------|------|-----------|------|
| `data/skills/` | 系统级 | **不需要**（随版本更新） | Git 代码控制 |
| `data/work/` | 用户级 | **需要**（用户数据） | 运行时生成 |
| `data/kb-images/` | 用户级 | **需要**（知识库图片） | 运行时生成 |

**关键洞察**：
- `skills` 目录目前还在 Git 代码控制里，发布时会一起发布
- 用户需要持久化的只有 `work` 和 `kb-images` 目录
- 每次升级容器，`skills` 目录会更新（覆盖用户可能安装的技能）

**未来愿景**（用户提到）：
- skills 应该有独立的项目
- 用户通过专门的 skill 管理界面浏览和安装
- 类似插件市场的模式

**当前务实方案**：
- skills 目录：随容器更新（不需要持久化）
- work 目录：用户数据（需要持久化）

### 代码中的路径生成逻辑

```javascript
// lib/chat-service.js:1169
const AI_BASE_PATH = 'work';  // 硬编码！不是环境变量！

// lib/chat-service.js:1179
fullWorkspacePath: path.join(AI_BASE_PATH, task.workspace_path),  // 如 "work/user123/task456"

// data/skills/fs/index.js:27-29
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)  // /app/data + work/user123/task456
  : path.join(DATA_BASE_PATH, 'work', USER_ID);
```

**关键发现**：`WORKING_DIRECTORY` 是相对路径（如 `work/user123/task456`），它会被拼接到 `DATA_BASE_PATH` 后面。

## 设计原则

### 用户视角的期望

> "我只想告诉系统：我的工作目录在哪里。系统应该自动处理所有路径。"

### 目录性质分析（更新）

| 目录 | 性质 | 持久化需求 | 来源 |
|------|------|-----------|------|
| `data/skills/` | 系统级 | **不需要**（随版本更新） | Git 代码控制 |
| `data/work/` | 用户级 | **需要**（用户数据） | 运行时生成 |
| `data/kb-images/` | 用户级 | **需要**（知识库图片） | 运行时生成 |

**关键洞察**：
- `skills` 目录目前还在 Git 代码控制里，发布时会一起发布
- 用户需要持久化的只有 `work` 和 `kb-images` 目录
- 每次升级容器，`skills` 目录会更新（覆盖用户可能安装的技能）

**未来愿景**（用户提到）：
- skills 应该有独立的项目
- 用户通过专门的 skill 管理界面浏览和安装
- 类似插件市场的模式

## 务实方案：分离持久化路径

### 核心思想

考虑到 `skills` 和 `work` 目录的性质不同：
- `skills`：随容器更新，不需要持久化
- `work`：用户数据，需要持久化

**方案**：用户只需映射 `work` 目录，`skills` 目录保持容器内。

### 环境变量设计

| 环境变量 | 用途 | 默认值 | 是否需要配置 |
|---------|------|--------|-------------|
| `DATA_BASE_PATH` | 技能的基础路径（包含 skills） | `/app/data` | **不需要** |
| `WORKSPACE_ROOT` | 工作目录路径（需要持久化） | `/app/data/work` | **可选** |

**关键改变**：`WORKSPACE_ROOT` 默认值改为与 `DATA_BASE_PATH` 一致！

### 用户配置方式

**方式 1：最简配置（推荐）**

只映射 work 目录，不配置任何环境变量：

```yaml
# docker-compose.yml
volumes:
  - ./work:/app/data/work    # 只映射 work 目录
# 不需要配置任何环境变量！
```

**方式 2：自定义路径**

如果用户想把 work 目录放在其他位置：

```yaml
environment:
  WORKSPACE_ROOT: /custom/work    # 自定义路径
volumes:
  - ./work:/custom/work
```

### 代码修改

**修改默认值一致性**：

```javascript
// server/controllers/task.controller.js
// 旧代码
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

// 新代码：默认值与 DATA_BASE_PATH 一致
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || '/app/data';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(DATA_BASE_PATH, 'work');
```

**修改所有使用 WORKSPACE_ROOT 的文件**：
- `server/controllers/task.controller.js`
- `server/routes/task.routes.js`
- `server/routes/task-static.routes.js`
- `lib/chat-service.js`

### 为什么不统一成一个变量？

**因为 skills 和 work 的性质不同**：

| 场景 | DATA_BASE_PATH | WORKSPACE_ROOT |
|------|----------------|----------------|
| 默认（容器内） | `/app/data` | `/app/data/work` |
| 用户只持久化 work | `/app/data`（不变） | `/app/data/work`（映射到容器外） |
| 用户自定义 work 路径 | `/app/data`（不变） | `/custom/work`（自定义） |

如果统一成一个变量 `DATA_BASE_PATH`：
- 用户设置 `DATA_BASE_PATH=/custom/data`
- skills 目录也会变成 `/custom/data/skills`
- 但 skills 应该随容器更新，不应该持久化！

**所以两个变量应该独立，但默认值要一致**。

### Docker Compose 配置示例

**推荐配置**（只持久化 work）：

```yaml
services:
  app:
    environment:
      DATA_BASE_PATH: /app/data    # 默认值，可不配置
    volumes:
      - ./work:/app/data/work      # 只映射 work 目录
```

**完整持久化配置**（包括 kb-images）：

```yaml
services:
  app:
    volumes:
      - ./work:/app/data/work
      - ./kb-images:/app/data/kb-images
```

### 用户方案：整个 DATA_BASE_PATH 挂到容器外

**用户配置**：

```yaml
# docker-compose.yml
environment:
  DATA_BASE_PATH: /app/data    # 默认值，可不配置
volumes:
  - ./data:/app/data           # 整个 data 目录挂到容器外
```

**结果**：
- `/app/data/skills` → `./data/skills`（持久化）
- `/app/data/work` → `./data/work`（持久化）
- `/app/data/kb-images` → `./data/kb-images`（持久化）

**优点**：
1. 配置最简单，只需一个 volume 映射
2. 所有数据都在一个目录下，便于管理
3. 不需要配置 `WORKSPACE_ROOT`

**注意事项**：
- `skills` 目录会被持久化，升级容器时不会自动更新
- 用户需要手动管理 skills 目录（或接受这个代价）

**这个方案完全可行！** 关键是代码要支持：

```javascript
// WORKSPACE_ROOT 默认值必须基于 DATA_BASE_PATH 派生
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || '/app/data';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.join(DATA_BASE_PATH, 'work');
```

### 总结

| 方案 | 用户配置 | 适用场景 |
|------|---------|---------|
| 整个 data 挂载 | `- ./data:/app/data` | 最简单，接受 skills 持久化 |
| 只挂载 work | `- ./work:/app/data/work` | skills 随容器更新，work 持久化 |
| 自定义路径 | `WORKSPACE_ROOT=/custom/work` | work 在自定义位置 |

**核心改变**：
1. `WORKSPACE_ROOT` 默认值改为基于 `DATA_BASE_PATH` 派生
2. 用户可以自由选择挂载方式，系统自动适应