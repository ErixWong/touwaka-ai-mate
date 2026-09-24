# Touwaka 数据模型

本文档登记 touwaka 主库（`touwaka_mate`，MariaDB/InnoDB，utf8mb4）中
由应用代码直接维护的横切数据表与 ID 前缀约定。各平台专属表（文档平台等）
见 `docs/design/doc-platform/data-model.md` 等专题文档；全量表结构以
`scripts/upgrade-database.js` 增量迁移与 `models/` 生成物为准。

## 表登记

### 1. `note_record`

对应模型：`models/note_record.js`（sequelize-auto 生成物，禁止手改）

引入：issue #1132 决策 3 修订（Phase 3 阶段三）。erix NoteRecord 的
持久化存储，替代阶段二的 Redis 方案（Lua CAS + PXAT）。

作用：

- 存储 erix `NoteRecord` 完整 JSON（`record` 列，LONGTEXT）
- `scope_ref` + `note_key` 唯一键定位一条笔记（CAS 更新/删除的版本锚点）
- `expires_at`（BIGINT，毫秒时间戳）为 TTL 唯一权威；read/list 不续期，
  命中过期行时惰性 DELETE

关键字段：

| 字段 | 说明 |
|------|------|
| `id` | 行 ID，`nr_` 前缀 + `Utils.newID(20)` |
| `scope` | 固定 `'run'`（erix 协议），默认由 DDL 填充 |
| `scope_ref` | 稳定 scopeRef，`buildNotesScopeRef(user_id, expert_id)` 派生（`notes-v1:<sha256-24>`），禁用 request_id/run_id |
| `note_key` | 笔记 key（如 `wm_<ts>_<rand>`） |
| `record` | 完整 NoteRecord JSON（erix 协议字段 camelCase；touwaka 扩展字段如 `record_version`/`legacy_metadata` 为 snake_case） |
| `record_version` | CAS 版本，`Utils.newID(20)` 随机串；UPDATE/DELETE 带版本条件，影响行数=0 → `notes_cas_conflict` |
| `expires_at` | 过期时间（ms），取自 `record.expires_at`（adapter/facade 统一注入）；`NULL` 表示不过期 |
| `created_at` / `updated_at` | 应用侧写入的毫秒时间戳 |

索引：`PRIMARY KEY (id)`，`UNIQUE KEY uk_scope_ref_key (scope_ref, note_key)`，
`KEY idx_expires_at (expires_at)`。

访问入口：`lib/notes/db-note-record-store.js`（raw SQL，经 `lib/db.js` 的
`query/getOne/insert/execute`）；不写 Sequelize 模型 API。

## ID 前缀登记

| 前缀 | 用途 | 生成位置 |
|------|------|----------|
| `nr_` | `note_record.id`（Notes NoteRecord 行 ID） | `lib/notes/db-note-record-store.js`（`nr_` + `Utils.newID(20)`） |
| `wm_` | Notes 笔记 key（工作记忆临时笔记，宿主 facade 写入） | `lib/psyche/psyche-manager.js`（`wm_<ts>_<random>`） |
| `msg_` | 消息 ID（流式响应首 delta 的 message_id） | `lib/chat-service.js`（`msg_` + `Utils.newID(10)`） |
| `notes-v1:` | Notes scopeRef 命名空间（非表 ID，登记以避免前缀碰撞） | `lib/notes/notes-policy.js`（`buildNotesScopeRef`） |

未加前缀的表 ID 默认使用 `Utils.newID(20)`（20 字符随机/时间混编）。
