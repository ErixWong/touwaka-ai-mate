# DATETIME 时区契约（issue #1282）

本文是**所有写 DATETIME 列的地方**都必须遵守的口径约定。一句话版本：

> **DATETIME 列里存的是「UTC 挂钟」，进程 `TZ` 不参与。**
> 裸 SQL（`sequelize.query` + `replacements`）写时间一律先过 `lib/db-datetime.js#toDbDatetime()`。

---

## 1. 为什么需要这条契约

`messages.created_at` 曾经有**两条 Sequelize 序列化通道，口径不同**：

| 通道 | 代码形状 | 落库值 | 结论 |
|---|---|---|---|
| 模型写入 | `this.Message.create({ …, created_at: new Date() })` | **UTC 挂钟** | 正确 |
| 裸 SQL + replacements | `sequelize.query("INSERT … :at", { replacements: { at: new Date() } })` | **进程本地挂钟** | 错 |

进程 `TZ=UTC` 时两条通道**恰好重合**，所以问题一直没露头；进程 `TZ≠UTC` 时同一轮里
「模型写的 user 行」与「裸 SQL 写的 assistant 行」会差整整 8 小时，跨角色按
`created_at` 排序即错乱（最新一轮被排到更早的位置、时间标签由「未来的时间」算出来）。

### 机制（实测，不是推断）

本仓 `lib/db.js` 建 `new Sequelize(...)` 时没有覆盖 `timezone`，Sequelize v6 默认
`sequelize.options.timezone = '+00:00'`：

- **模型写入**走 `DataTypes.DATE#_stringify`，`_applyTimezone` 用的是
  `options.timezone='+00:00'`，产出的字面量是
  `2026-11-03 14:49:49.940 +00:00`（**UTC 挂钟** + 冗余偏移后缀）。
  MariaDB 存 DATETIME 时会**忽略偏移后缀**（实测 11.7.2：
  `cast('2026-11-03 22:22:10.000 +08:00' as datetime(3))` → `2026-11-03 22:22:10.000`），
  所以最终落库的是「字面量里那段挂钟」——它本来就是 UTC，因此正确。
- **裸 SQL + replacements** 走 `SqlString.escape(Date)` 的 **local 默认口径**，
  产出的字面量是本地挂钟，且**毫秒被截成 `.000`**。

所以「模型写入正确」不是因为它做了时区换算，而是因为**它的字面量本身就是 UTC**；
裸 SQL 通道拿不到这个 timezone，只能按进程本地时区格式化。

### 现网取证（issue #1282 现场；本表于 2026-11-03T14:59Z 在 dev 库 `touwaka_mate` 上**重新实测**）

DB 侧取值（`cast(... as char)` 看挂钟、`unix_timestamp()` 看真实 epoch，绕开客户端时区解释）。
被测实例是宿主上 `TZ=Asia/Shanghai` 起的 master 代码（`TZ=+8`），MariaDB 11.7.2 `time_zone=SYSTEM`=UTC：

| 行（同一会话，同一进程写的） | 库里挂钟 | `unix_timestamp()` | 与真实时刻 |
|---|---|---|---|
| user「用一句话说一句你好，不要调用工具」 | `2026-11-03 14:21:49.695` | 1793715709.695 | **准** |
| user「还是用一句话回答：1+1 等于几？不…」 | `2026-11-03 14:24:39.474` | 1793715879.474 | 准 |
| user「请用一句话回答：太阳系最大的行星是哪…」 | `2026-11-03 14:26:50.155` | 1793716010.155 | 准 |
| assistant「你好！😊」 | `2026-11-03 22:22:10.000` | 1793744530.000 | **+28800 秒** |
| assistant「1+1 等于 2。」 | `2026-11-03 22:25:04.000` | 1793744704.000 | +28800 秒 |
| assistant「您好，我收到的这条消息大部分内容被截…」 | `2026-11-03 22:27:22.000` | 1793744842.000 | +28800 秒 |
| user「【Judge 评审意见】任务要求一句…」 | `2026-11-03 22:27:25.000` | 1793744845.000 | +28800 秒 |
| assistant「太阳系最大的行星是木星。」 | `2026-11-03 22:27:35.000` | 1793744855.000 | +28800 秒 |

**落在「未来 >1h」的正好 5 行**（4 条 assistant + 1 条 Judge 轮的 user），全部是 2026-11-03 那晚
`TZ=+8` 跑出来的测试行。注意第 7 行：**裸 SQL 通道不只写 assistant 行**——Judge 轮那条 user 行
也是同一个错口径，所以「按 role 分」是错的心智模型，按**写入通道**分才对。

对账锚点：DB 侧 `unix_timestamp()`（无参）就是真实 epoch；MariaDB 容器 `TZ` 未设 ⇒
`time_zone=SYSTEM`=UTC，所以上表的 epoch 差是**真差**，不是客户端显示问题。

### 同一时刻的 A/B 复现（测试库 `llm_kit_test`，宿主 `TZ=Asia/Shanghai`，固定时刻 `1793717389940`）

| 写法 | 库里挂钟 | `unix_timestamp(created_at)` | 偏差 |
|---|---|---|---|
| 模型 `Message.create({ created_at: new Date(epoch) })` | `2026-11-03 14:49:49.940` | 1793717389.940 | 准 |
| 裸 SQL `replacements: { at: new Date(epoch) }` | `2026-11-03 22:49:49.000` | 1793746189.000 | **+28800 秒**，且毫秒丢成 `.000` |

---

## 2. 契约

1. **DATETIME 列一律写 UTC 挂钟，且与进程 `TZ` 无关。**
2. **裸 SQL 写时间必须先过 helper**：

   ```js
   import { toDbDatetime } from "../db-datetime.js";

   await sequelize.query(
     "INSERT INTO messages (id, created_at) VALUES (:id, :createdAt)",
     { replacements: { id, createdAt: toDbDatetime(new Date()) } },
   );
   ```

   `toDbDatetime()` 的行为（详见该文件头注释）：

   | 输入 | 输出 |
   |---|---|
   | `null` / `undefined` | 原样返回（写 NULL，不发明值） |
   | `Date` | `YYYY-MM-DD HH:mm:ss.SSS` 的 **UTC** 挂钟 |
   | `number` | 按 **epoch 毫秒**解释，同上 |
   | `string` | **原样透传**（调用方给的字面值已是目标口径，helper 不重新解释，否则会凭空挪时区） |
   | 其它 / `Invalid Date` | 抛 `ERR_INVALID_DB_DATETIME`（宁可炸，也不静默写坏数据） |

3. **禁止各处内联自造格式**：`toISOString().replace('T', ' ').replace('Z', '')` 这类
   一行流散落在各处就是下一份口径漂移的温床——要么用 helper，要么写明理由。
4. **模型 `create` / `update` 路径不要改**：Sequelize 已经是 UTC 口径（见 §1 机制），
   再包一层 helper 反而会双重转换。
5. **不做历史数据回填**：口径修正只保证**新写入**正确；库里的历史行按原样保留。

---

## 3. 已改的写点（issue #1282）

| 文件 | 列 | 说明 |
|---|---|---|
| `lib/llm-kit-adapters/transcript-store.js` | `agent_transcript_rounds.created_at` / `updated_at` | canonical 写入（`insertCanonicalRound`） |
| 同上 | `agent_rounds.created_at` | `appendRound` 轮行 |
| 同上 | `chat_tool_calls.created_at` | tool_use / tool_result 两处 upsert |
| 同上 | `messages.created_at` | `projectMessageRow()` 保持纯函数返回 `Date`，只在落库那一步换口径 |
| `lib/llm-kit-adapters/transcript-projection.js` | `agent_rounds.created_at`、`messages.created_at`、`chat_tool_calls.created_at` | 投影修复写入口 `applyProjectionWrites()` |
| `lib/document-embedding-service.js` | `document_chunks.embedded_at` / `updated_at` | 5 处 `db.execute` 的 `UPDATE` |
| `server/routes/task.routes.js` | `task_token.expires_at` | 2 处 `INSERT` + 1 处**比较值**（同一条 `SqlString.escape(Date)` 通道，比较值也必须同口径） |

`lib/chat-service.js:1023` / `:1324` 这类**模型 `create`** 写点按契约 §2.4 不动。

---

## 4. 生产 / 开发环境注意

- **生产容器 `TZ=UTC` 是巧合，不是保障。** 线上目前看不见这个 bug，只是因为容器里
  `TZ` 未设、`date` 输出 UTC，两条通道碰巧重合。**不要**把「生产没炸」当作「口径没问题」，
  更不要靠「让进程 TZ 保持 UTC」来兜底——口径正确性必须由代码保证。
- **宿主上跑 dev 请显式 `TZ=UTC`**：

  ```bash
  TZ=UTC npm run api
  ```

  否则你本机写进库的时间与生产不同口径，排查问题时会怀疑人生（issue #1282 就是这么撞出来的）。
- **DB 服务端也必须 UTC**：`@@global.time_zone = SYSTEM` 且容器 `TZ` 未设（=UTC）。
  自检一条 SQL：

  ```sql
  SELECT @@global.time_zone, @@session.time_zone, CAST(NOW() AS CHAR), UNIX_TIMESTAMP();
  ```

  若 DB 服务端不是 UTC，`NOW()` 默认值、`unix_timestamp()` 的解释都会跟着漂——
  那是另一个层面的问题（本契约只约束应用侧写入）。

---

## 5. 读侧口径（本契约不管，另案）

Sequelize 把 DATETIME 读回 JS `Date` 时按**进程本地时区**解释（`models/*` 里是
`DataTypes.DATE`，`mysql2` 默认 local 解析）。这件事**全表一致**，因此：

- **不影响排序**：所有行的解释偏移相同，相对顺序不变；
- **只影响展示换算**：前端拿到的是 epoch，展示时区由前端决定。

把它改成「读回也按 UTC 解释」是独立的一次口径调整（会动到 `models/` 生成物与全部读侧），
不在 #1282 范围内。

---

## 6. 回归防线

| 测试 | 覆盖 |
|---|---|
| `tests/db-datetime.test.mjs` | helper 值域契约；同一时刻在 `TZ=UTC` / `Asia/Shanghai` / `America/New_York` **子进程**里输出同一串（并反证三个时区的本地偏移/小时确实不同，防假绿） |
| `tests/db-datetime-utc.test.mjs` + `tests/helpers/datetime-utc-db-probe.mjs` | `spawnSync` 显式 `TZ=Asia/Shanghai` 起子进程，写「模型 create 行」与「`appendRound` 的 4 个裸 SQL 写点」，用 **DB 侧 `unix_timestamp()`** 回读，与发送时刻 epoch 误差 < 2 秒、两条通道互差 < 2 秒；自插自删 |

写测试时两条硬规矩（否则一定是假绿）：

1. **必须在子进程里设 `TZ`**：`spawnSync(process.execPath, [script], { env: { ...process.env, TZ } })`。
   在同一个进程里写 `process.env.TZ = '…'` 不会改变 `Date` 的本地偏移（Node 进程内缓存时区）。
2. **断言必须读 DB 侧**：`select unix_timestamp(created_at)` 与测试记录的发送时刻比。
   只断言「JS 里两个 `Date` 相等」时，同一套客户端时区解释会把误差一起挪掉，测不出来。

---

## 7. 相关

- issue：#1282（本单）、#1277（浏览器 e2e 中撞出来的上下文）
- 代码：`lib/db-datetime.js`（helper 唯一实现）
