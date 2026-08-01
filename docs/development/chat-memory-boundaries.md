# Chat Memory Boundaries

> Last updated: 2026-08-01

本文记录当前聊天、Topic、历史压缩与 Psyche 的边界事实，避免继续沿用旧的 `topic_id IS NULL` 归档模型。

## 当前事实

- 在线聊天会获取或创建 active Topic。
- user / tool / assistant 消息保存时会绑定当前 `topic_id`。
- `topic_id = null` 只表示旧数据兼容、无话题上下文或特殊内部路径，不再表示“未归档”。
- Topic 当前是产品侧 conversation segment，用于会话分段、展示、召回和归档状态管理。
- 上下文组织策略当前有 `full` / `simple` / `minimal` 三种。
- Psyche 是 `minimal` 策略的历史消息压缩/工作记忆机制，由反思链路更新并可替代原始 Messages 注入上下文。
- Psyche 不等同于 Topic 摘要，也不是 Topic 的归档状态。

## 禁止假设

- 禁止把 `topic_id IS NULL` 当作待压缩消息集合的唯一来源。
- 禁止把 `topic_id NOT NULL` 当作已压缩或已归档。
- 禁止在未确认数据库方案前新增或重写历史压缩产物的字段语义。

## 后续架构方向

Topic / 普通历史摘要 / Psyche 应明确边界：

- `Topic`：用户可理解的在线 conversation segment。
- `普通历史摘要`：如果后续新增或保留 Memory Summary 命名，应作为非 Psyche 策略的历史压缩产物，记录 source message range、生成模型、版本和触发来源。
- `Psyche`：`context_strategy = minimal` 的历史压缩类型，使用反思 LLM 更新工作记忆，并按 token 上限压缩自身。

普通历史摘要是否需要独立落库仍未确认。涉及新增表、字段、索引或迁移脚本前，必须先获得 Eric 明确确认。

## 当前实现建议

- 修复注释和文档时，以“在线绑定 active Topic”为当前事实。
- 压缩器继续保留兼容逻辑，但不要新增依赖 `topic_id IS NULL` 的主链路。
- 如果需要重新设计压缩入口，先输出数据/API 方案，再进入数据库迁移流程。
