# Notes 治理说明

本文记录 Touwaka Notes 的治理策略与产品决策。治理策略的代码单一来源是
`lib/notes/notes-policy.js`；本文用于说明当前约束和决策，不替代实现。

## 当前治理事实

- **TTL**：`NOTES_TTL_SECONDS` 是 Notes TTL 的唯一配置入口，统一注入到记录。
- **过期时间**：`note_record.expires_at`（BIGINT，毫秒）是 TTL 的权威值；
  `record.expires_at` 是同一 deadline 的镜像。读取和列表不续期。
- **稳定作用域**：`scopeRef` 由 `user_id` 与 `expert_id` 稳定派生，供跨请求工作记忆使用；
  禁止使用 `request_id`、`run_id` 等单次请求标识。
- **并发控制**：`record_version` 用于 CAS。版本冲突以 `notes_cas_conflict` 显式报告，
  不静默采用最后写入覆盖。
- **工具边界**：erix 内置 `note_take`、`note_read`、`note_list`、`note_forget`
  经 `ToolManager` 暴露与执行门控；仅在 minimal context 且 notes 启用时可用，
  执行时会再次检查门控，并要求上下文包含用户和专家标识。

## 凭据拦截决策

erix-agent 0.14.0 根据 issue #136 退役了 `note_take` 写入侧的凭据形状检测，
使写入与回读遵循一致契约；写入不再按 key 或 content 的形状拦截疑似凭据。

**Touwaka 决策：接受退役（方案 a，2026-10-04，Eric）。** Notes 是宿主自身的工作记忆：
作用域由 `user_id` 与 `expert_id` 稳定派生，TTL 由宿主统一注入，并由
`record_version` CAS 控制并发。写入和回读保持一致，是 erix 0.14.0 此项修复的目标；
本任务不在宿主侧补加凭据拦截。

若未来产品要求拦截，应在宿主工具调用层实现，例如 `ToolManager` 的 note 工具包装处
（`executeErixNotesTool()`），并由 Touwaka 自行维护凭据形状规则；不恢复引擎侧行为。

## 禁止假设

- 不要假设 erix 会拦截写入内容中的凭据。
- 不要在 `notes-policy.js` 之外散落 TTL 配置或重复的 Notes 治理校验逻辑；应复用该策略单一来源。
