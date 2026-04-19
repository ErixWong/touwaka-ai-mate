# 开发手册

本手册涵盖 Touwaka Mate v2 的开发规范、核心模块和 API 参考。

## 文档索引

### 开发指南
| 文档 | 说明 |
|------|------|
| [快速开始](./quick-start.md) | 环境配置、启动命令、目录结构 |
| [编码规范](./coding-standards.md) | snake_case 铁律、命名规范、响应格式 |
| [核心模块](./core-modules.md) | ChatService、LLMClient、MemorySystem、认证中间件 |
| [前端组件](./frontend-components.md) | 右侧面板、通用分页 |
| [API 参考](./api-reference.md) | 端点列表、环境变量、错误码 |

### 任务详情
| 文档 | 说明 |
|------|------|
| [expert-avatar.md](../../core/tasks/expert-avatar.md) | 专家头像功能（Base64 存储） |
| [expert-llm-params.md](../../core/tasks/expert-llm-params.md) | 专家 LLM 参数配置化 |
| [skill-management.md](../../core/tasks/skill-management.md) | Skill 管理系统 |
| [right-panel.md](../../core/tasks/right-panel.md) | 右侧面板 |
| [tool-visualization.md](../../core/tasks/tool-visualization.md) | 工具调用可视化面板 |
| [context-compression.md](../../core/tasks/context-compression.md) | 上下文压缩重构 |
| [reflective-mind-template.md](../../core/tasks/reflective-mind-template.md) | 反思心智模板配置化 |

### 数据库手册
| 文档 | 描述 |
|------|------|
| [README.md](../database/README.md) | 数据库概览与快速开始 |
| [api-query-design.md](../database/api-query-design.md) | 复杂查询 API 规范 |
| [orm-analysis.md](../database/orm-analysis.md) | ORM 选型分析 |

### 设计文档
| 文档 | 描述 |
|------|------|
| [context-compression-design.md](../../design/parse2/context-compression-design.md) | ⭐ 上下文压缩设计 |
| [llm-call-scenarios.md](../../design/parse1/llm-call-scenarios.md) | LLM 调用场景分析 |
| [background-task-scheduler-design.md](../../design/parse2/background-task-scheduler-design.md) | 后台任务调度器设计 |
| [right-panel-design.md](../../design/parse2/right-panel-design.md) | 右侧面板容器设计 |
| [task-layer-design.md](../../design/parse2/task-layer-design.md) | 任务层设计 |
| [sandbox-architecture.md](../../design/parse2/sandbox-architecture.md) | 沙箱架构设计 |
| [app-platform-design.md](../../design/parse3/app-platform-design.md) | ⭐ App 平台设计（多维表格 + AI） |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Pinia + Vite |
| 后端 | Node.js + Koa + @koa/router |
| 数据库 | MySQL 8.0+ |
| 认证 | JWT 双 Token |
| 流式 | SSE |

---

## 架构

```
Frontend (Vue 3) ←→ API Server (Koa) ←→ Service Layer ←→ MySQL
```

核心服务：`ChatService` → `ExpertChatService` → `LLMClient`/`MemorySystem`/`ReflectiveMind`

---

## 核心模块概览

### 后端核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| ChatService | `lib/chat-service.js` | 对话流程控制 |
| ExpertChatService | `lib/expert-chat-service.js` | 专家对话服务 |
| LLMClient | `lib/llm-client.js` | LLM API 调用封装 |
| MemorySystem | `lib/memory-system.js` | 记忆管理、上下文压缩 |
| ReflectiveMind | `lib/reflective-mind.js` | 反思心智实现 |
| SkillLoader | `lib/skill-loader.js` | 技能加载、解析 SKILL.md |
| SkillRunner | `lib/skill-runner.js` | 技能执行（JS/Python） |
| ToolManager | `lib/tool-manager.js` | 工具调用管理 |

### 前端核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| RightPanel | `components/panel/RightPanel.vue` | 右侧面板容器 |
| TopicsTab | `components/panel/TopicsTab.vue` | 话题列表 |
| DebugTab | `components/panel/DebugTab.vue` | 调试信息 |
| Pagination | `components/Pagination.vue` | 通用分页组件 |

---

## Git 工作流

详见 [SOUL.md - Git 工作流](../../core/SOUL.md#git-工作流-)

### 快速参考

| 操作 | 命令 |
|------|------|
| 创建分支 | `git checkout -b {type}/{描述}` |
| 提交 | `git commit -m "{type}: 描述"` |
| 推送 | `git push -u origin {分支名}` |
| 创建 PR | 访问 GitHub，关联 Issue |

### 分支类型

- `feature` - 新功能
- `fix` - Bug 修复
- `refactor` - 代码重构
- `docs` - 文档更新

---

## 相关资源

- [项目 README](../../../README.md) - 项目概览与快速开始
- [Parse 2 设计总览](../../design/parse2/README.md) - Parse 2 架构设计索引
- [项目待办事项](../../core/TODO.md) - 当前任务状态
- [已完成任务归档](../../archive/todo-archive-2026-03.md) - 历史完成记录
- [经验教训](../../design/lessons-learned.md) - 常见问题和解决方案
- [Git 工作流](../../core/SOUL.md#git-工作流-) - 分支策略和 PR 规范

---

*最后更新: 2026-03-07*
