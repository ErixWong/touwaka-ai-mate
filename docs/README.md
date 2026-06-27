# Touwaka Mate v2 文档总览

本目录存放项目开发、设计、数据库和任务留痕文档。当前整理原则是：优先以仓库现有实现为准，再用索引文档提供稳定入口。

## 文档结构

```text
docs/
├── README.md                           # 本文件，docs 总入口
├── SOUL.md                             # 项目协作风格与常用入口
├── CONTRIBUTING.md                     # 协作说明
├── function-calling-best-practices.md  # Function calling 经验总结
├── images/                             # 文档图片资源
├── apps/                               # App 模块当前架构与历史文档入口
├── database/                           # 数据库与查询规范
├── development/                        # 开发规范、API、模块手册
├── design/                             # 架构与设计文档
├── tasks/                              # 任务留痕与审查归档
└── tracking/                           # 跟踪记录
```

## 推荐阅读顺序

1. [SOUL.md](./SOUL.md)
2. [development/README.md](./development/README.md)
3. [development/coding-standards.md](./development/coding-standards.md)
4. [development/code-review-checklist.md](./development/code-review-checklist.md)
5. 当前任务对应的 `docs/tasks/active/...`

## 开发入口

| 文档 | 说明 |
|------|------|
| [development/README.md](./development/README.md) | 开发手册总入口 |
| [development/quick-start.md](./development/quick-start.md) | 环境配置、启动方式、基础目录 |
| [development/coding-standards.md](./development/coding-standards.md) | snake_case、统一响应、数据库与 AI 调用红线 |
| [development/code-review-checklist.md](./development/code-review-checklist.md) | 提交前最少检查项 |
| [development/llm-call-standards.md](./development/llm-call-standards.md) | AI Provider 调用统一规范 |
| [development/ai-architecture-guidelines.md](./development/ai-architecture-guidelines.md) | AI / LLM 架构约束与设计建议 |
| [development/core-modules.md](./development/core-modules.md) | 核心模块说明 |
| [development/api-reference.md](./development/api-reference.md) | API 概览与约定 |
| [development/skill-development-guide.md](./development/skill-development-guide.md) | Skill 开发说明 |
| [development/xlsx-skill-formula-handling.md](./development/xlsx-skill-formula-handling.md) | Excel 公式处理专项说明 |

## App 与平台入口

| 文档 | 说明 |
|------|------|
| [apps/README.md](./apps/README.md) | App 文档统一入口 |
| [apps/current-architecture.md](./apps/current-architecture.md) | 当前 app 平台实现边界 |
| [apps/app-generation-guide.md](./apps/app-generation-guide.md) | app 安装、运行、tick、前端装配说明 |
| [apps/historical/README.md](./apps/historical/README.md) | 历史方案入口，仅作背景参考 |

## 设计入口

| 文档 | 说明 |
|------|------|
| [design/README.md](./design/README.md) | 设计文档总索引 |
| [design/information-architecture.md](./design/information-architecture.md) | 文档信息架构与目录放置规则 |
| [design/core/phase1/README.md](./design/core/phase1/README.md) | Phase 1 / Mind Core |
| [design/core/phase2/README.md](./design/core/phase2/README.md) | Phase 2 / Task Layer 与右侧面板 |
| [design/doc-platform/README.md](./design/doc-platform/README.md) | 文档平台当前实现 |

## 数据库与任务入口

| 文档 | 说明 |
|------|------|
| [database/README.md](./database/README.md) | 数据库文档入口 |
| [database/api-query-design.md](./database/api-query-design.md) | 查询 API 设计规范 |
| [tasks/README.md](./tasks/README.md) | 任务体系入口 |
| [tasks/active/](./tasks/active/) | 进行中的任务留痕 |
| [tasks/archived/](./tasks/archived/) | 已归档任务 |
| [tracking/README.md](./tracking/README.md) | 历史跟踪目录说明 |

## 当前事实摘要

| 维度 | 当前实现 |
|------|----------|
| 前端 | Vue 3 + TypeScript + Vite + Pinia |
| 后端 | Node.js + Koa + Sequelize |
| 数据库 | MariaDB / MySQL 协议 |
| AI 能力层 | `LLMClient` / `InternalLLMService` / `EmbeddingClient` / `ASRClient` / `TTSClient` |
| App 平台 | manifest 安装 + runtime 装配 + `AppClock` tick 调度 |

## 说明

- `docs/design/` 当前主要保留 `core/`、`doc-platform/`、`topics/`、`drafts/`、`archive/` 等设计与历史材料结构；App 平台现行实现文档已收敛到 `docs/apps/`。
- `docs/design/information-architecture.md` 定义了 `docs/design/` 的放置规则与目录边界。
- `docs/tasks/` 是当前主要使用中的任务留痕体系；`docs/tracking/` 当前仅保留为低活跃历史结构。
- 若文档描述与代码冲突，以可验证仓库事实为准，并在对应任务中补充修正记录。

---

*最后更新: 2026-06-20*
