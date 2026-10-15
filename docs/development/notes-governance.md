# Notes 治理说明

本文记录 Touwaka Notes 的治理策略与产品决策。治理策略的代码单一来源是
`lib/notes/notes-policy.js`；本文用于说明当前约束和决策，不替代实现。

## 当前治理事实

- **TTL**：`NOTES_TTL_SECONDS` 是 Notes TTL 的唯一配置入口，统一注入到记录。
- **过期时间**：`note_record.expires_at`（BIGINT，毫秒）是 TTL 的权威值；
  `record.expires_at` 是同一 deadline 的镜像。读取和列表不续期。
- **稳定作用域**：`scopeRef` 由 `user_id` 与 `expert_id` 稳定派生，供跨请求工作记忆使用；
  禁止使用 `request_id`、`run_id` 等单次请求标识。
- **并发控制**（issue #1203 裁决）：只剩 `note_record` 的 `uk_scope_ref_key` 唯一键。
  同 key 并发写 = **后写覆盖（LWW）**：存储层不再拿 `record_version` 做乐观锁，
  因此不存在版本冲突；`record_version` 列保留（DDL 不动）但只作写入指纹。
  并发创建竞态撞唯一键仍以 `notes_unique_key_conflict` 显式报告，不静默丢弃写入。
  读-改-写由调用方（LLM 与门面）自己负责：先读出来看看再改。
- **list 过滤**（issue #1210）：erix NotesStore 端口的 `filters`（`state` / `tag` /
  `source` / `minRelevance`）语义与 `limit` 一样落在 `notes-policy.js`
  （`normalizeListFilters` / `matchesListFilters`），端口出口先过滤后截断。
  非法值一律 `TypeError`（`filters.state: []` 的空数组既不是「全不过滤」也不是「静默清空」），
  不静默降级。上游把这两个 helper 放在 `src/store/notes-port.js` 且没有从包根导出，
  所以宿主自己实现同一份语义——改语义时两侧要一起对齐，别在 adapter 里再抄一份。
- **清理的两个口径**（issue #1210）：`DbNoteRecordStore.purge()` 的 `scanned` 是**行次**
  （宿主自有 API，#1205 起按行次钉着）；erix 端口 `purge` 的 `scanned` 是**扫描的 scope 数**。
  换算在 `ErixNotesStoreAdapter.purge`：它以 `withScopeCount: true` 要宿主在同一次清扫里
  顺带回报 `scope_count` 并只取该字段，宿主默认返回形状与语义一字不动。
  注意本宿主的保留期权威是**每行 `expires_at`**（不是上游的 scope 时钟）：
  scope 内某行到期就删该行，不整本豁免——上游套件里「刚写入 scope 豁免」那条过，
  是因为这些行的 deadline 还没到，不是因为我们实现了 scope 级豁免。

- **工具边界**：erix 内置 `note_take`、`note_read`、`note_list`、`note_forget`
  经 `ToolManager` 暴露与执行门控；仅在 minimal context 且 notes 启用时可用，
  执行时会再次检查门控，并要求上下文包含用户和专家标识。

## 凭据拦截决策

erix-agent 0.14.0 根据 issue #136 退役了 `note_take` 写入侧的凭据形状检测，
使写入与回读遵循一致契约；写入不再按 key 或 content 的形状拦截疑似凭据。

**Touwaka 决策：接受退役（方案 a，2026-10-04，Eric）。** Notes 是宿主自身的工作记忆：
作用域由 `user_id` 与 `expert_id` 稳定派生，TTL 由宿主统一注入，并发由 `note_record`
的唯一键 `uk_scope_ref_key` 兜底（同 key 并发写 = 后写覆盖 LWW；issue #1132 决策 3 里的
`record_version` CAS 已于 #1203/#1207 废除，该列保留但只写不判）。写入和回读保持一致，
是 erix 0.14.0 此项修复的目标；本任务不在宿主侧补加凭据拦截。

若未来产品要求拦截，应在宿主工具调用层实现，例如 `ToolManager` 的 note 工具包装处
（`executeErixNotesTool()`），并由 Touwaka 自行维护凭据形状规则；不恢复引擎侧行为。

## 禁止假设

- 不要假设 erix 会拦截写入内容中的凭据。
- 不要在 `notes-policy.js` 之外散落 TTL 配置或重复的 Notes 治理校验逻辑；应复用该策略单一来源。
