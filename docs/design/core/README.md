# Core 设计入口

本目录收录系统核心架构与基础设施设计，是 `docs/design/` 中最接近系统主线演进的部分。

## 目录定位

- `core/` 用于承载系统内核、任务层、上下文组织、消息流、驻留进程治理等核心设计。
- 原来的 `phase1/`、`phase2/` 已收敛到本目录下，继续作为阶段子目录保留。
- 若某设计直接影响系统主流程、主运行时或基础设施，而不是单独业务专题，应优先放在本目录。

## 推荐阅读顺序

1. [phase1/README.md](./phase1/README.md)
2. [phase2/README.md](./phase2/README.md)
3. [mind-context-management.md](./mind-context-management.md)
4. [context-organization-architecture.md](./context-organization-architecture.md)
5. [message-flow-analysis.md](./message-flow-analysis.md)
6. [resident-process-management-redesign.md](./resident-process-management-redesign.md)

## 文档索引

### 阶段主线

| 文档 | 说明 |
|------|------|
| [phase1/README.md](./phase1/README.md) | Mind Core 阶段总览 |
| [phase2/README.md](./phase2/README.md) | Task Layer / Right Panel 阶段总览 |

### 横切核心设计

| 文档 | 说明 |
|------|------|
| [mind-context-management.md](./mind-context-management.md) | Psyche 上下文管理机制 |
| [context-organization-architecture.md](./context-organization-architecture.md) | 上下文组织与编排架构 |
| [message-flow-analysis.md](./message-flow-analysis.md) | 系统消息流转分析 |
| [chat-request-lifecycle.md](./chat-request-lifecycle.md) | 聊天请求生命周期管理（runtime 状态机 / stop 语义 / 轮级恢复 / 前端终态收口） |
| [resident-process-management-redesign.md](./resident-process-management-redesign.md) | 驻留进程管理重设计 |
| [architecture-improvements.md](./architecture-improvements.md) | 架构改进建议 |
| [improvement-suggestions.md](./improvement-suggestions.md) | 核心功能与架构改进建议 |

## 放置规则

- 主线阶段设计：放 `phase1/` 或 `phase2/`
- 跨阶段但仍属于系统核心基础设施的设计：直接放 `core/`
- 若已经更像独立业务专题，应转入 `../topics/`

---

*最后更新: 2026-07-19*
