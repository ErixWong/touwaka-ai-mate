/**
 * DATETIME 列写入的唯一口径（issue #1282）
 *
 * ── 病 ────────────────────────────────────────────────────────────────────────
 * Sequelize 有两条把 JS 时间写进 DATETIME 列的通道，**口径不同**：
 *   1. 模型写入 `Model.create({ created_at: new Date() })`：Sequelize 的 DATE serializer
 *      按 UTC 格式化，落库是 **UTC 挂钟**（正确）；
 *   2. 裸 SQL + replacements `sequelize.query(sql, { replacements: { at: new Date() } })`：
 *      值经 `SqlString.escape(Date)` 按**进程本地时区**格式化，落库是 **进程本地挂钟**（错）。
 * 进程 `TZ=UTC` 时两条通道恰好重合（生产容器 `TZ` 未设 ⇒ UTC，属于巧合而非保障）；
 * 进程 `TZ≠UTC` 时同一轮里模型写的行与裸 SQL 写的行差整整 8 小时（实测 28800 秒，
 * 见 `docs/development/datetime-timezone-contract.md`）。
 *
 * ── 契约 ──────────────────────────────────────────────────────────────────────
 * DATETIME 列一律写 **UTC 挂钟**，且**与进程 TZ 无关**。所有「裸 SQL 把 JS 时间当参数
 * 写进 DATETIME 列」的写点都必须先过本函数，把值转成 `YYYY-MM-DD HH:mm:ss.SSS` 的
 * UTC 字符串再交给 replacements。**禁止各处内联 `toISOString().replace(...)` 自造第二套格式**。
 *
 * 模型 `create` / `update` 路径不用本函数（Sequelize 自己就是 UTC 口径，改反而会双重转换）。
 *
 * @module lib/db-datetime
 */

/** `YYYY-MM-DD HH:mm:ss.SSS`（DATETIME 字面量，MySQL / MariaDB 都能直接解析） */
function pad(value, width = 2) {
  return String(value).padStart(width, "0");
}

function formatUtc(date) {
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.` +
    `${pad(date.getUTCMilliseconds(), 3)}`
  );
}

function invalidDateError(value) {
  const error = new TypeError(
    `[db-datetime] 无法把 ${Object.prototype.toString.call(value)} 转成 DATETIME：` +
      `${String(value)}（有效 Date / 有限 number / string / null / undefined 之外一律拒绝）`,
  );
  error.code = "ERR_INVALID_DB_DATETIME";
  return error;
}

/**
 * 把 JS 时间转成 DATETIME 列的 UTC 挂钟字面量。
 *
 * 输入 / 输出约定（**刻意**只认这几种，不做隐式猜测）：
 *   - `null` / `undefined` → 原样返回（列可空时写 NULL，不发明值）；
 *   - `Date` → `YYYY-MM-DD HH:mm:ss.SSS` 的 **UTC** 挂钟；`Invalid Date` 抛
 *     `ERR_INVALID_DB_DATETIME`（宁可炸，也不要把 `'Invalid Date'` 写进库）；
 *   - `number` → 按 **epoch 毫秒**（与 `Date.now()` 同单位）解释，再按上面格式化；
 *     `NaN` / `Infinity` 抛错。不做「秒 / 毫秒」嗅探：单位靠调用方保证；
 *   - `string` → **原样透传**。理由：调用方给字符串时，它已经是「要落库的那个字面值」
 *     （例如 `agent_rounds.ts` 这类 VARCHAR 列，或调用方显式构造的挂钟串）。这里若再
 *     解析一遍，`'2026-11-03 22:21:49'` 会被 `new Date()` 按**进程本地时区**解释、
 *     再按 UTC 输出，反而凭空挪 8 小时——正是本单要消灭的那类口径漂移。字符串的
 *     UTC 语义由调用方负责，helper 不重新解释；
 *   - 其它类型（boolean / object / bigint …）→ 抛 `ERR_INVALID_DB_DATETIME`。
 *     静默 `String(value)` 会把 `true` 变成 `'true'` 塞进 DATETIME，属于不可见数据损坏。
 *
 * @param {Date|number|string|null|undefined} value
 * @returns {string|null|undefined} UTC 挂钟字面量（`YYYY-MM-DD HH:mm:ss.SSS`）
 * @throws {TypeError} 值不可转换（`code === "ERR_INVALID_DB_DATETIME"`）
 */
export function toDbDatetime(value) {
  if (value === null || value === undefined) return value;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw invalidDateError(value);
    return formatUtc(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidDateError(value);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw invalidDateError(value);
    return formatUtc(date);
  }

  if (typeof value === "string") return value;

  throw invalidDateError(value);
}

export default toDbDatetime;
