# 设计文档索引

本目录汇总项目的架构设计、平台设计、专题设计、草稿与归档材料。当前结构不再以 `phase1/phase2/phase3` 作为最外层目录，而是收敛为更稳定的语义化模块：`core/`、`app-platform/`、`doc-platform/`、`topics/`、`drafts/`、`archive/`。

## 信息架构

| 文档 | 说明 |
|------|------|
| [information-architecture.md](./information-architecture.md) | `docs/design/` 的放置规则、目录边界与治理原则 |
| [core/README.md](./core/README.md) | 核心架构与基础设施设计入口 |
| [app-platform/README.md](./app-platform/README.md) | App 平台设计入口 |
| [doc-platform/README.md](./doc-platform/README.md) | 当前文档平台实现入口 |
| [topics/README.md](./topics/README.md) | 专题设计入口 |

## 当前目录分层

```text
design/
├── README.md                         # 本文件
├── information-architecture.md       # 目录治理规则
├── core/                             # 核心架构与基础设施设计
├── app-platform/                     # App 平台主线与平台治理设计
├── doc-platform/                     # 当前文档平台实现说明
├── topics/                           # 跨阶段专题设计
├── drafts/                           # 草稿与工作文档
├── archive/                          # 已归档设计
└── references-analysis-report.md     # 外部项目分析背景资料
```

## 主线设计入口

### Core

| 文档 | 说明 | 状态 |
|------|------|------|
| [core/README.md](./core/README.md) | Core 目录入口 | 总览 |
| [core/phase1/README.md](./core/phase1/README.md) | Phase 1 / Mind Core 总览 | 主线入口 |
| [core/phase2/README.md](./core/phase2/README.md) | Phase 2 / Task Layer 总览 | 主线入口 |
| [core/context-organization-architecture.md](./core/context-organization-architecture.md) | 上下文组织架构 | 横切核心设计 |
| [core/message-flow-analysis.md](./core/message-flow-analysis.md) | 消息流转分析 | 核心架构分析 |
| [core/resident-process-management-redesign.md](./core/resident-process-management-redesign.md) | 驻留进程管理重设计 | 核心基础设施 |
| [core/architecture-improvements.md](./core/architecture-improvements.md) | 架构改进建议 | 历史核心建议 |
| [core/improvement-suggestions.md](./core/improvement-suggestions.md) | 功能与架构改进建议 | 历史核心建议 |

### App Platform

| 文档 | 说明 | 状态 |
|------|------|------|
| [app-platform/README.md](./app-platform/README.md) | App Platform 目录入口 | 总览 |
| [app-platform/dev-readiness.md](./app-platform/dev-readiness.md) | App 平台开发就绪度审查 | 评估文档 |
| [app-platform/review.md](./app-platform/review.md) | App 平台设计审查 | 评审文档 |
| [app-platform/ADR-mini-app-retirement.md](./app-platform/ADR-mini-app-retirement.md) | Mini-app 退役 ADR | 架构决策 |

### Doc Platform

| 文档 | 说明 | 状态 |
|------|------|------|
| [doc-platform/README.md](./doc-platform/README.md) | `/api/docs` 与文档处理流水线实现入口 | 已实现 |
| [doc-platform/data-model.md](./doc-platform/data-model.md) | 当前数据模型 | 已实现 |
| [doc-platform/api.md](./doc-platform/api.md) | 当前接口摘要 | 已实现 |
| [doc-platform/processing-pipeline.md](./doc-platform/processing-pipeline.md) | 当前处理流水线 | 已实现 |

## 专题设计

专题总入口：[topics/README.md](./topics/README.md)

### Knowledge Base

| 文档 | 说明 |
|------|------|
| [topics/knowledge-base/kb-refactor-design.md](./topics/knowledge-base/kb-refactor-design.md) | 知识库结构重构设计 |
| [topics/knowledge-base/kb-recall-design.md](./topics/knowledge-base/kb-recall-design.md) | 知识库召回设计 |
| [topics/knowledge-base/knowledge-point-extraction-guide.md](./topics/knowledge-base/knowledge-point-extraction-guide.md) | 知识点提取指南 |

### Resident Processes

| 文档 | 说明 |
|------|------|
| [topics/resident-processes/resident-skill-design.md](./topics/resident-processes/resident-skill-design.md) | 驻留 Skill 设计 |
| [topics/resident-processes/remote-llm-redesign.md](./topics/resident-processes/remote-llm-redesign.md) | 远程 LLM 重构 |
| [topics/resident-processes/remote-llm-skill-design.md](./topics/resident-processes/remote-llm-skill-design.md) | 远程 LLM Skill 设计 |
| [topics/resident-processes/mcp-client-resident-design.md](./topics/resident-processes/mcp-client-resident-design.md) | MCP Client 驻留设计 |
| [topics/resident-processes/ssh-skill-tools-design.md](./topics/resident-processes/ssh-skill-tools-design.md) | SSH Skill / Tools 设计 |

### Chat / Context

| 文档 | 说明 |
|------|------|
| [topics/chat/chatwindow-comparison.md](./topics/chat/chatwindow-comparison.md) | ChatWindow 对比分析 |
| [topics/chat/issue-141-tool-context-design.md](./topics/chat/issue-141-tool-context-design.md) | 工具上下文更新设计 |
| [topics/chat/tool-context-optimization.md](./topics/chat/tool-context-optimization.md) | 工具上下文优化 |
| [topics/chat/file-preview-panel-design.md](./topics/chat/file-preview-panel-design.md) | 文件预览面板设计 |

### Skills / Execution

| 文档 | 说明 |
|------|------|
| [topics/skills/skill-directory-panel-analysis.md](./topics/skills/skill-directory-panel-analysis.md) | 技能目录面板分析 |
| [topics/skills/package-whitelist.md](./topics/skills/package-whitelist.md) | 包白名单策略 |
| [topics/skills/user-code-execution.md](./topics/skills/user-code-execution.md) | 用户代码执行设计 |

### Attachment / Contract

| 文档 | 说明 |
|------|------|
| [topics/attachment/attachment-service-design.md](./topics/attachment/attachment-service-design.md) | 通用附件服务设计 |
| [topics/contract-mgr/contract-v2-final-spec.md](./topics/contract-mgr/contract-v2-final-spec.md) | 合同管理 v2 最终规格 |
| [topics/contract-mgr/README.md](./topics/contract-mgr/README.md) | 合同管理专题总览 |

## 当前实现相关设计

| 文档 | 说明 |
|------|------|
| [../apps/README.md](../apps/README.md) | App 文档统一入口 |
| [../apps/current-architecture.md](../apps/current-architecture.md) | 当前 app 平台实现边界 |
| [../apps/app-generation-guide.md](../apps/app-generation-guide.md) | 当前 app 平台开发手册 |
| [../apps/historical/app-platform-design.md](../apps/historical/app-platform-design.md) | 历史方案，仅作背景参考 |

## 草稿与归档

| 文档/目录 | 说明 |
|-----------|------|
| [drafts/README.md](./drafts/README.md) | 草稿入口与后续治理建议 |
| [archive/README.md](./archive/README.md) | 归档入口与历史材料使用规则 |
| [references-analysis-report.md](./references-analysis-report.md) | 外部项目分析背景资料 |

## 状态说明

- 主线入口：当前阶段主线设计的总入口。
- 核心基础设施：仍与当前实现讨论强相关的横切设计。
- 专题设计：不属于单一阶段主线，但具有独立主题边界的设计文档。
- 草稿：设计仍在探索，不能直接视为当前实现。
- 历史参考：仅用于理解上下文或追溯演进，不代表现行规范。
- 目录放置规则：以 [information-architecture.md](./information-architecture.md) 为准。

---

*最后更新: 2026-06-20*
