# 开发手册

本手册是 `docs/development/` 的统一入口，聚焦当前仓库已经落地的开发规范、核心模块、接口约定与专项说明。

## 优先阅读

1. [编码规范](./coding-standards.md)
2. [代码审查清单](./code-review-checklist.md)
3. [AI Provider 调用规范](./llm-call-standards.md)
4. 当前任务对应的 `docs/tasks/active/...`

## 文档索引

### 基础开发

| 文档 | 说明 |
|------|------|
| [快速开始](./quick-start.md) | 环境配置、启动命令、目录结构 |
| [编码规范](./coding-standards.md) | snake_case、统一响应、数据库与 AI 调用约束 |
| [代码审查清单](./code-review-checklist.md) | 提交前自查项与常见风险检查 |
| [API 参考](./api-reference.md) | API 概览、约定、错误码 |
| [核心模块](./core-modules.md) | 核心库、服务层、能力分层说明 |
| [前端组件](./frontend-components.md) | 前端公共组件与界面约定 |

### AI / Skill 专项

| 文档 | 说明 |
|------|------|
| [AI 调用规范](./llm-call-standards.md) | `LLMClient` / `InternalLLMService` / `EmbeddingClient` 等统一入口规则 |
| [AI 架构方针](./ai-architecture-guidelines.md) | AI / LLM 架构原则与演进建议 |
| [Chat 记忆边界](./chat-memory-boundaries.md) | Topic、Memory Summary、Psyche 的当前职责与后续边界 |
| [Skill 开发指南](./skill-development-guide.md) | Skill 结构、实现方式、接入流程 |
| [XLSX 公式处理](./xlsx-skill-formula-handling.md) | Excel 公式读取与计算处理说明 |

### App 平台

| 文档 | 说明 |
|------|------|
| [App 模块文档](../apps/README.md) | App 文档统一入口 |
| [App 当前架构](../apps/current-architecture.md) | 平台边界、app 边界、状态机职责 |
| [App 生成指导手册](../apps/app-generation-guide.md) | manifest、安装链路、tick、前端装配 |
| [历史 App 设计](../apps/historical/app-platform-design.md) | 历史平台统一状态机方案，仅供参考 |

### 数据库与设计

| 文档 | 说明 |
|------|------|
| [数据库手册](../database/README.md) | 数据库概览与脚本入口 |
| [查询 API 设计](../database/api-query-design.md) | 复杂查询参数与分页约定 |
| [设计文档索引](../design/README.md) | 所有设计文档总入口 |
| [Phase 1](../design/phase1/README.md) | Mind Core |
| [Phase 2](../design/phase2/README.md) | Task Layer / Right Panel |
| [Phase 3](../design/phase3/README.md) | App 平台设计 |

## 当前实现摘要

| 层级 | 当前实现 |
|------|----------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia |
| 后端 | Node.js + Koa + `@koa/router` |
| 数据层 | Sequelize + `mysql2` |
| 流式能力 | SSE |
| AI 能力层 | `LLMClient`、`InternalLLMService`、`EmbeddingClient`、`ASRClient`、`TTSClient` |
| App Runtime | `app-market.service.js` + `app-runtime-loader.js` + `app-clock.js` |

## 关键模块速查

| 模块 | 文件 | 职责 |
|------|------|------|
| ChatService | `lib/chat-service.js` | 对话入口与主流程控制 |
| LLMClient | `lib/llm-client.js` | 统一 LLM chat 调用 |
| InternalLLMService | `lib/internal-llm-service.js` | 内部服务层调用封装 |
| EmbeddingClient | `lib/embedding-client.js` | 向量嵌入能力统一入口 |
| ASRClient | `lib/asr-client.js` | 语音识别能力入口 |
| TTSClient | `lib/tts-client.js` | 语音合成能力入口 |
| MemorySystem | `lib/memory-system.js` | 记忆、召回、上下文拼装 |
| ReflectiveMind | `lib/reflective-mind.js` | 反思心智实现 |
| SkillLoader | `lib/skill-loader.js` | Skill 加载与解析 |
| SkillRunner | `lib/skill-runner.js` | Skill 执行 |
| ToolManager | `lib/tool-manager.js` | 工具调用调度 |
| AppClock | `lib/app-clock.js` | app tick 调度 |
| AppRuntimeLoader | `lib/app-runtime-loader.js` | app runtime 动态装载 |

## 相关入口

- [项目 README](../../README.md)
- [项目协作入口](../SOUL.md)
- [任务留痕目录](../tasks/active/)

---

*最后更新: 2026-06-20*
