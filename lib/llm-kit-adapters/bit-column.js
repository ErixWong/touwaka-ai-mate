/**
 * `BIT(1)` 列 → 布尔：**全仓唯一一份**转换实现（issue #1227 阶段 3 切片 C2c）。
 *
 * ── 为什么需要它 ───────────────────────────────────────────────────────────────
 * AGENTS.md §2.1 规定布尔列统一用 `BIT(1)`（禁 `TINYINT`）。但 mysql2 对 BIT 列默认返回
 * **`Buffer`**（`<Buffer 00>` / `<Buffer 01>`），而 JS 的真值判断在 Buffer 上全错：
 *
 * | 表达式 | `Buffer 00`（列=0） | `Buffer 01`（列=1） |
 * |---|---|---|
 * | `Boolean(v)` / `if (v)` / `v ? a : b` | **`true`** ← 恒真，正是本模块要消灭的缺陷 | `true` |
 * | `Number(v)` | `NaN` → 假 | `NaN` → 假 ← C1 消灭的缺陷（恒假） |
 * | `v === 1` / `v === true` | `false` | `false` ← 恒假 |
 * | `v.some(byte => byte !== 0)` | `false` ✅ | `true` ✅ |
 *
 * 两条错误读法都会造成**静默**的错误语义（假 `is_error` / 假 `folded` / 恒 `is_active`），
 * 且**只在某些连接上复现**：`lib/db.js` 的 `dialectOptions.typeCast` 会把 BIT(1) 提前转成
 * JS boolean，于是走 `lib/db.js` 连接（server、`openTestDatabase()`）时看不到缺陷；而
 * `scripts/*` 的 `DB_*` 直连（`new Sequelize(...)` 不带 typeCast，canonical 回填、
 * parity/verify 脚本都走它）拿到的是 Buffer，缺陷立刻显形。**读侧不许依赖连接级配置**
 * ——同一个 store 在不同连接上必须给出同一个结论，否则「读档等价」无从谈起。
 *
 * ── 语义（六格输入输出表见 tests/llm-kit-adapters/bit-column.test.mjs）────────────
 * - `Buffer`：**任一字节非 0 即为真**（`<Buffer 00>`→false，`<Buffer 01>`→true；
 *   BIT(1) 只会有这两态，按“任一字节”判是为了同时兼容 BIT(n>1) 被误读成 boolean 的场景）。
 * - `number`：`0`→false，其余→true。
 * - `boolean`：原样。
 * - `string`：`""` / `"0"` / `"\0"`（BIT 的 NUL 字节被驱动转成的字符串）→false，其余→true。
 * - `null` / `undefined`：→ **false**。
 *   **`null` 与 `0` 的区分**：本模块**不区分**，两者都归 false。对当前所有使用点这是
 *   **不敏感**的——`chat_tool_calls.is_error` 与 `agent_rounds.folded` 都是
 *   `BIT(1) NOT NULL DEFAULT b'0'`（见 `scripts/init-database.js`），列值只可能是 `b'0'`/`b'1'`，
 *   NULL 不可能出现；`null` 分支只是防御「连接/驱动换实现」的兜底。若将来给某个**可空**
 *   BIT 列做「NULL = 未知」的三态语义，**不能**复用本函数（要另写三态转换并在列注释里说明）。
 *
 * ── 单一实现（硬约束）──────────────────────────────────────────────────────────
 * C1 在 `transcript-projection.js` 里写过一份同名函数，C2c 把它**移到这里**，由
 * `transcript-projection.js`（re-export，保持既有 import 面不变）与
 * `transcript-store.js`（`reconstructMessages` / `assembleRoundRecord`）共用。
 * 全仓只允许这一份 `Buffer.isBuffer(...)` 型 BIT 转换实现——`grep -rn "bitToBoolean"` 的
 * 定义点只应是本文件。
 */

/**
 * `BIT(1)` 列值 → 布尔。
 *
 * @param {Buffer|Uint8Array|number|string|boolean|null|undefined} value mysql2/sequelize 返回的原始列值
 * @returns {boolean} 列语义上的真值
 */
export function bitToBoolean(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  // `Buffer` 是 `Uint8Array` 的子类；`Buffer.isBuffer` 不认别的 Uint8Array 实现（例如将来
  // 换驱动），故两种都按字节判，避免"换个驱动就静默恒真"。
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value.some((byte) => byte !== 0);
  }
  if (typeof value === "string") return value !== "" && value !== "0" && value !== "\0";
  return Boolean(value);
}
