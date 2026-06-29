# Drafts 草稿入口

本目录用于放置尚未稳定、仍在探索中的设计草稿和工作文档。

## 目录定位

- `drafts/` 中的内容默认不作为当前实现依据。
- 这里的文档可以包含尚未收敛的方案、对比分析、流程草图、命名探索和局部试验设计。
- 草稿成熟后，应转入 `../core/`、`../topics/`、`../../apps/`（若属于 App 平台现行实现手册）；不再有价值的内容应归档到 `../archive/`。

## 当前内容概览

### Chat / UI 草稿

| 文档 | 说明 | 当前判断 |
|------|------|----------|
| [chatview-message-flow-complete.md](./chatview-message-flow-complete.md) | ChatView 消息流完整草图 | 参考性强，待判断是否并入 `topics/chat/` |
| [chatview-optimization-plan.md](./chatview-optimization-plan.md) | ChatView 优化计划 | 仍具行动价值，可作为后续重构参考 |

### MCP / Framework 草稿

| 文档 | 说明 | 当前判断 |
|------|------|----------|
| [mcp-system-design.md](./mcp-system-design.md) | MCP 系统草案 | 可继续保留观察 |
| [framework-rethink.md](./framework-rethink.md) | 框架重想与方向性思考 | 偏探索，短期不建议并主线 |
| [document-intelligence-scenarios.md](./document-intelligence-scenarios.md) | 文档智能场景规划 | 属于未来扩展，不是当前文档平台实现 |

### Contract v2 草稿

| 文档组 | 说明 | 当前判断 |
|--------|------|----------|
| `contract-v2-*` | 合同管理 v2 的流程、结构、UI、存储、OCR、上传等草稿 | 建议后续集中评估，按价值并入 `topics/contract-mgr/` 或归档 |
| `contract-mgr-v2-design.md` | 合同管理 v2 总体草稿 | 倾向并入 `topics/contract-mgr/` 或作为其索引依据 |

## 使用规则

- 可以引用草稿作为背景材料，但不能直接把草稿当作现行规范。
- 若某草稿已经部分落地，更新时应补充“已实施/待实施/已放弃”的说明。
- 同主题草稿数量较多时，应优先考虑合并、并轨或归档，避免长期堆积。

## 后续治理建议

1. 优先评估 `contract-v2-*` 草稿是否需要并入 `topics/contract-mgr/`
2. 评估 `chatview-*` 文档是否值得升级为 `topics/chat/` 的稳定专题文档
3. 对明显失效的草稿补充归档结论，减少“看起来很多但没有去向”的问题
4. `document-intelligence-scenarios.md` 当前仍属于未来扩展规划，不应混同于现有 `/api/docs` 实现

---

*最后更新: 2026-06-20*
