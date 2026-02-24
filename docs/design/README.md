# 设计文档索引

本目录包含 Touwaka Mate v2 的所有设计文档，按版本和类型组织。

## 目录结构

```
design/
├── README.md                   # 本文件
├── v1/                         # v1 设计文档（Mind Core）
├── v2/                         # v2 设计文档（Task Layer）
├── archive/                    # 已废弃的设计文档
├── improvement-suggestions.md  # 功能改进建议
├── architecture-improvements.md # 架构改进建议
└── references-analysis-report.md # 外部项目分析
```

## 快速导航

### v1 设计文档 - Mind Core

[v1/README.md](./v1/README.md) - v1 架构总览

| 文档 | 说明 |
|------|------|
| [foundation-requirements.md](./v1/foundation-requirements.md) | 基础需求定义 |
| [api-design.md](./v1/api-design.md) | API 设计 |
| [ui-design-draft.md](./v1/ui-design-draft.md) | UI 设计草案 |
| [error-state-design.md](./v1/error-state-design.md) | 错误状态设计 |
| [i18n-design.md](./v1/i18n-design.md) | 多语言设计 |
| [skill-loading-design.md](./v1/skill-loading-design.md) | 技能加载设计 |
| [llm-call-scenarios.md](./v1/llm-call-scenarios.md) | LLM 调用场景 |
| [chat-component-comparison.md](./v1/chat-component-comparison.md) | 聊天组件对比 |

### v2 设计文档 - Task Layer

[v2/README.md](./v2/README.md) - v2 设计总览

| 文档 | 说明 | 状态 |
|------|------|------|
| [task-layer-design.md](./v2/task-layer-design.md) | Task Layer 核心设计 | 已采纳 |
| [right-panel-design.md](./v2/right-panel-design.md) | 右侧多功能面板设计 | 已采纳 |
| [context-compression-design.md](./v2/context-compression-design.md) | 上下文压缩设计 | 已采纳 |
| [skill-configuration-design.md](./v2/skill-configuration-design.md) | 技能配置化设计 | 进行中 |
| [skill-market-design.md](./v2/skill-market-design.md) | 技能市场设计 | 草稿 |
| [background-task-scheduler-design.md](./v2/background-task-scheduler-design.md) | 后台任务调度器 | 草稿 |
| [code-review-2026-02-21.md](./v2/code-review-2026-02-21.md) | 代码审查记录 | - |

### 评审报告

| 文档 | 说明 |
|------|------|
| [architecture-analysis-report.md](./v1/architecture-analysis-report.md) | 架构分析报告 |
| [code-review-report.md](./v1/code-review-report.md) | v1 代码审查 |
| [design-review-report.md](./v1/design-review-report.md) | v1 设计评审 |
| [vulnerability-fixes-summary.md](./v1/vulnerability-fixes-summary.md) | 安全修复总结 |

### 参考资料

| 文档 | 说明 |
|------|------|
| [improvement-suggestions.md](./improvement-suggestions.md) | 功能改进建议（基于外部项目分析） |
| [architecture-improvements.md](./architecture-improvements.md) | 架构改进建议（安全、高可用、监控） |
| [references-analysis-report.md](./references-analysis-report.md) | 外部项目（Claw 系列）分析 |

### 归档文档

[archive/](./archive/) - 已废弃/已处理的历史文档

| 文档 | 说明 |
|------|------|
| [readme-old.md](./archive/readme-old.md) | 旧版文档结构说明 |
| [documentation-audit-report.md](./archive/documentation-audit-report.md) | 文档审查报告（已完成） |

---

## 状态标记约定

- **草稿**：方案探索中，可能随时推翻重写
- **已采纳**：设计已通过评审，允许按文档实现
- **已实现**：主要功能已按设计落地
- **已废弃**：仅保留历史参考

---

*最后更新: 2026-02-24*
