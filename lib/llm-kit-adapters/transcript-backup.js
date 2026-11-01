/**
 * issue #1246 —— 批量写脚本的**写前备份前置闸**（"先落备份，再发第一条写语句"）
 *
 * 为什么需要这一层（两条实证缺陷，见 `docs/design/topics/transcript-rollback-drill.md`）：
 *   1. **备份靠人自觉**：C2c 事故里 worker 先写了 29 行生产数据才想起备份。自觉不是机制。
 *   2. **回滚 SQL 不可直接回放**：旧备份的 `*.rollback.sql` 首行没有 `SET NAMES utf8mb4`，
 *      `mariadb` 客户端默认 `character_set_client = utf8mb3`，含 4 字节字符（emoji / PNG 字节）
 *      的那一行被 `ERROR 1366` 拒掉，而客户端**报错后继续跑后面的语句** ⇒ 静默部分回滚。
 *      所以本模块：① 生成侧首行写 `SET NAMES utf8mb4;`；② 校验侧**不只看退出码**，
 *      校验 `UPDATE` 条数 == 备份行数 == 表内实际行数。
 *
 * 三条设计判据（都写成了可判定的格子，不是散文）：
 *   - **顺序**：`runWithPreWriteBackup()` 是唯一的写入口包装——备份落盘 + 回读校验通过之后才
 *     调用写回调。写回调里连"备份文件是否已在盘上"都能当场 `stat` 到（用例钉住）。
 *   - **范围 = 整张受影响表**（不是"计划要写的那些行"）：需要备份恰恰意味着写侧可能有 bug，
 *     可能写坏不在计划内的行。所以 `SELECT *` 全表，`plan_rows` 只作为**信息**记录，不参与裁剪。
 *   - **列范围 = 整行**：`*.json` 存逐行原值（含主键），`*.rollback.sql` 每行一条
 *     `UPDATE <表> SET <全部可还原列> WHERE <主键>`。生成列（`agent_rounds.kind/seq/part_of`
 *     这类 VIRTUAL 列）由 `information_schema.COLUMNS.EXTRA` 识别并排除——写它会报错。
 *     不做"只备份计划列"的裁剪：那等于把"写侧有 bug"这件事提前假设成"写侧只会改这一列"。
 *
 * 失败语义：任何一步不过 ⇒ 抛 {@link BackupError}（带 `code`，可操作文案），
 * **写回调一次都不会被调用** ⇒ 零生产写；调用方（脚本）据此 exit 非零。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 备份根目录（该目录已 `eric:eric 755`，可直接写）。 */
export const BACKUP_ROOT = "/docker/touwaka-backups";

/**
 * 备份根覆盖（**只走环境变量，不加 CLI 参数**）。
 *
 * 为什么不加 `--backup-root`：`parseArgs()` 的返回值被既有用例逐格 deepEqual 钉住
 * （`tests/llm-kit-adapters/transcript-projection-reconcile.test.mjs`「CLI 参数解析与闸门判据」），
 * 加一个键就要改那条老断言——本单的纪律是"既有断言一行都不许动"，所以覆盖入口放在环境变量里。
 */
export const BACKUP_ROOT_ENV_VAR = "TOUWAKA_BACKUP_ROOT";

/** 解析备份根：环境变量优先（演练/测试），否则 {@link BACKUP_ROOT}。 */
export function resolveBackupRoot({ env = process.env } = {}) {
  const override = env?.[BACKUP_ROOT_ENV_VAR];
  return typeof override === "string" && override.trim() !== "" ? override.trim() : BACKUP_ROOT;
}

/** 回滚 SQL 的**首行**（`mariadb` 默认 utf8mb3 ⇒ 不写这行会静默部分回滚）。 */
export const ROLLBACK_SQL_FIRST_LINE = "SET NAMES utf8mb4;";

/** 备份产物里的 issue 标记（便于事后溯源"这份是谁落的"）。 */
export const BACKUP_ISSUE = "#1246";

/**
 * 单个文件系统操作的上限（毫秒）。**备份不可用时必须在有限步内退出**：
 * 超过这个时间就当作"备份目录不可用"，抛 {@link BACKUP_ERROR_CODES.DIR_UNWRITABLE}。
 *
 * 为什么需要它（演练实证）：`fs.promises.mkdir(dir, { recursive: true })` 在 `/proc/...`
 * 这类虚拟文件系统上**会一直转下去**（Node 内部实现，不返回也不抛），进程 100% CPU 空转、
 * 既没有退出码也没有任何输出——"备份失败"退化成了"进程挂死"。所以：
 *   ① 目录创建**不再用 `recursive: true`**（改成逐级非递归 mkdir，见 {@link ensureBackupDirectory}）；
 *   ② 每个 fs 操作再套一层 deadline，异步挂住也必须有限步退出。
 */
export const BACKUP_FS_TIMEOUT_MS = 60_000;

/** 逐级创建目录的层数上限（路径深度有限，再兜一层"有限步"）。 */
export const MAX_BACKUP_DIR_DEPTH = 32;

/**
 * 默认 fs 操作（可注入：用例要模拟"目录挂死/永远不返回"这类真实环境故障，
 * 又不能在测试里真的挂死。与本仓 `tests/helpers/test-db-guard.mjs` 的注入风格一致）。
 */
export const defaultFsOps = Object.freeze({
  stat: (path) => stat(path),
  mkdir: (path) => mkdir(path),
  rename: (from, to) => rename(from, to),
  writeFile: (path, data, encoding) => writeFile(path, data, encoding),
  readFile: (path, encoding) => readFile(path, encoding),
});

/** 备份失败的错误码（每个码对应一条**可操作**的处置建议，用例逐码断言）。 */
export const BACKUP_ERROR_CODES = Object.freeze({
  /** 备份目录建不出来 / 不可写（权限、只读挂载、路径被文件占位） */
  DIR_UNWRITABLE: "ERR_BACKUP_DIR_UNWRITABLE",
  /** 磁盘写满 / 配额超限 */
  DISK_FULL: "ERR_BACKUP_DISK_FULL",
  /** 读表失败（连不上、表不存在、权限） */
  DUMP_FAILED: "ERR_BACKUP_DUMP_FAILED",
  /** 落盘后的回读校验不过（JSON 不可解析 / 行数不符 / UPDATE 条数不符 / 首行缺失） */
  VERIFY_FAILED: "ERR_BACKUP_VERIFY_FAILED",
  /** 遇到无法安全转成 SQL 字面量的值（fail-closed，绝不"猜一个"） */
  UNSUPPORTED_VALUE: "ERR_BACKUP_UNSUPPORTED_VALUE",
  /** 声明要写却算不出任何受影响表（fail-closed） */
  NO_TABLES: "ERR_BACKUP_NO_TABLES",
});

export class BackupError extends Error {
  constructor(code, message, { table = null, path = null, problems = null, cause = null } = {}) {
    super(message);
    this.name = "BackupError";
    this.code = code;
    this.table = table;
    this.path = path;
    this.problems = problems ?? null;
    if (cause) this.cause = cause;
  }
}

/**
 * 每张表的**主键**与写入口（备份清单只按这里的规格走，未登记的表一律 fail-closed）。
 *
 * `chat_tool_calls` 的主键是 `tool_use_id`（不是 `id`）：回滚 SQL 的 `WHERE` 用它，
 * 不是"所有表都 WHERE id"——照抄 `WHERE id` 会在该表上直接报 Unknown column。
 */
export const BACKUP_TABLE_SPECS = Object.freeze({
  agent_transcript_rounds: { primaryKey: "id", label: "canonical 引擎账本" },
  messages: { primaryKey: "id", label: "宿主消息行" },
  agent_rounds: { primaryKey: "id", label: "投影轮行" },
  chat_tool_calls: { primaryKey: "tool_use_id", label: "工具调用行" },
});

/**
 * 写面 → 受影响表（**按脚本实际会写哪张表决定备份清单**）。
 *
 * 关键取舍：`canonicalCleanup` 只写 `agent_transcript_rounds`，`reasoningRewrite` 只写
 * `messages`，`recordJsonRewrite` 只写 `agent_rounds`；`--apply`（投影重建）会
 * INSERT/UPDATE `agent_rounds` + `messages` + `chat_tool_calls` 并 DELETE 未被吸附的 messages。
 * 没被任何开关碰到的表不进清单（例如 `ai_model` 之类含 provider key 的表**永不**进清单）。
 */
export const WRITE_SURFACES = Object.freeze({
  canonicalCleanup: Object.freeze(["agent_transcript_rounds"]),
  reasoningRewrite: Object.freeze(["messages"]),
  recordJsonRewrite: Object.freeze(["agent_rounds"]),
  projectionApply: Object.freeze(["agent_rounds", "messages", "chat_tool_calls"]),
});

/** 数值类（直接内联，不加引号）；其余一律按字符串字面量转义。 */
const NUMERIC_DATA_TYPES = new Set([
  "tinyint", "smallint", "mediumint", "int", "integer", "bigint",
  "decimal", "numeric", "float", "double", "real", "year",
]);

/** 日期时间类（值在 dump 时已被规范成 `YYYY-MM-DD HH:MM:SS.mmm`）。 */
const TEMPORAL_DATA_TYPES = new Set(["date", "datetime", "timestamp", "time"]);

/**
 * 写面清单（纯函数，不连库）。
 *
 * 输出顺序**固定**（按 {@link WRITE_SURFACES} 的声明顺序），不随开关书写顺序漂移，
 * 这样报告与测试都不依赖调用方的参数顺序。
 *
 * @param {{apply?: boolean, fixIsError?: boolean, fixFolded?: boolean, fixReasoning?: boolean, rewriteRecordJson?: boolean}} flags
 * @returns {Array<{table: string, reasons: string[]}>}
 */
export function planBackupTables({
  apply = false,
  fixIsError = false,
  fixFolded = false,
  fixReasoning = false,
  rewriteRecordJson = false,
} = {}) {
  const wanted = new Set();
  if (apply) wanted.add("projectionApply");
  if (fixIsError || fixFolded) wanted.add("canonicalCleanup");
  if (fixReasoning) wanted.add("reasoningRewrite");
  if (rewriteRecordJson) wanted.add("recordJsonRewrite");
  const byTable = new Map();
  for (const [surface, tables] of Object.entries(WRITE_SURFACES)) {
    if (!wanted.has(surface)) continue;
    for (const table of tables) {
      if (!byTable.has(table)) byTable.set(table, []);
      byTable.get(table).push(surface);
    }
  }
  return [...byTable].map(([table, reasons]) => ({ table, reasons }));
}

/** 备份目录名：`<脚本名>-<YYMMDD>`（固定形态，操作者不用猜路径）。 */
export function backupDirectoryName({ scriptName, now = new Date() }) {
  if (typeof scriptName !== "string" || scriptName.trim() === "") {
    throw new BackupError(BACKUP_ERROR_CODES.DIR_UNWRITABLE, "[backup] 备份目录名需要脚本名（不能为空）");
  }
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${scriptName}-${yy}${mm}${dd}`;
}

/** 备份目录绝对路径：`<root>/<脚本名>-<YYMMDD>`。 */
export function resolveBackupDirectory({ scriptName, now = new Date(), root = BACKUP_ROOT }) {
  return join(root, backupDirectoryName({ scriptName, now }));
}

/** 单表产物文件名（`*.json` 逐行原值 / `*.rollback.sql` 逐行回滚）。 */
export function backupArtifactPaths({ directory, table }) {
  return {
    json: join(directory, `${table}.json`),
    sql: join(directory, `${table}.rollback.sql`),
  };
}

/**
 * 时间列的 SQL 投影（**时区安全**的唯一实现方式）。
 *
 * 为什么不用「读成 `Date` 再格式化」：Sequelize 的 MySQL 方言默认 `timezone: "+00:00"`，
 * mysql2 会把 `DATETIME` 的墙钟当 UTC 解析成 `Date`；再用本地 getter 格式化就会得到
 * `墙钟 + 本地偏移` 的串（CST 下是 +8h）。本单第一版就是这么写的，演练里立刻被自己的
 * 回滚 SQL 抓到：回滚把 `messages.created_at` 的最大值写到了**未来**（`2026-11-02 06:41`
 * 比克隆时点晚 8 小时）。所以时间列一律交给服务端 `DATE_FORMAT` 渲染成墙钟字符串，
 * 备份与回放都不经过任何时区解释。
 */
export const TEMPORAL_SQL_FORMATS = Object.freeze({
  datetime: "%Y-%m-%d %H:%i:%s.%f",
  timestamp: "%Y-%m-%d %H:%i:%s.%f",
  date: "%Y-%m-%d",
  time: "%H:%i:%s.%f",
});

/** 单列的 SELECT 投影：时间列走 `DATE_FORMAT`，其余原样。 */
export function sqlColumnProjection(column, dataType) {
  const format = TEMPORAL_SQL_FORMATS[dataType];
  if (format === undefined) return `\`${column}\``;
  return `DATE_FORMAT(\`${column}\`, '${format}') AS \`${column}\``;
}

/**
 * 单元格规范化：把驱动返回的原生值收敛成 JSON 可存、且能**无歧义**再渲染成 SQL 的形态。
 *
 * 不做 `JSON.stringify(Date)` 那种默认序列化：那会把 `datetime` 变成 ISO 串、把 `Buffer`
 * 变成 `{"type":"Buffer","data":[...]}`，回放时既分不清类型也无法生成正确字面量。
 */
export function normalizeCellValue(value, dataType) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buffer = Buffer.from(value);
    if (dataType === "bit") {
      if (buffer.length === 0) return 0;
      return buffer[0] & 1;
    }
    return buffer.toString("hex");
  }
  if (value instanceof Date) {
    // 走到这里说明时间列没走 `DATE_FORMAT` 投影 ⇒ 时区口径不明，宁可停也不生成会偏移的回滚 SQL。
    throw new BackupError(
      BACKUP_ERROR_CODES.UNSUPPORTED_VALUE,
      `[backup] 时间列返回了 Date 而不是墙钟字符串（${value.toISOString()}）：`
      + "说明列类型没被识别成 datetime/timestamp（DATE_FORMAT 投影没生效）——"
      + "按 Date 猜时区会生成**偏移 8 小时**的回滚 SQL，故 fail-closed 拒绝备份",
    );
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new BackupError(
        BACKUP_ERROR_CODES.UNSUPPORTED_VALUE,
        `[backup] 列值不是有限数字（${String(value)}），拒绝生成无法回放的回滚 SQL`,
      );
    }
    return value;
  }
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new BackupError(
    BACKUP_ERROR_CODES.UNSUPPORTED_VALUE,
    `[backup] 无法备份的列值类型：${Object.prototype.toString.call(value)}（fail-closed，不猜）`,
  );
}

/** MySQL 字符串字面量转义（`SET NAMES utf8mb4` 之后按 utf8mb4 解释，不需要 `_utf8mb4` 前缀）。 */
export function quoteSqlString(text) {
  const escaped = String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\u001a/g, "\\Z")
    .replace(/'/g, "\\'");
  return `'${escaped}'`;
}

/** 单元格 → SQL 字面量（按 `information_schema` 的 `DATA_TYPE` 分流）。 */
export function sqlLiteralFor(value, dataType) {
  if (value === null || value === undefined) return "NULL";
  if (dataType === "bit") {
    const bit = Number(value);
    if (bit !== 0 && bit !== 1) {
      throw new BackupError(BACKUP_ERROR_CODES.UNSUPPORTED_VALUE, `[backup] bit 列值只能是 0/1，收到 ${String(value)}`);
    }
    return `b'${bit}'`;
  }
  if (NUMERIC_DATA_TYPES.has(dataType)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new BackupError(BACKUP_ERROR_CODES.UNSUPPORTED_VALUE, `[backup] 数值列收到非数字 ${String(value)}`);
    }
    return String(value);
  }
  if (TEMPORAL_DATA_TYPES.has(dataType)) return quoteSqlString(String(value));
  return quoteSqlString(String(value));
}

/**
 * 逐行回滚 SQL（纯函数）：首行固定 `SET NAMES utf8mb4;`，之后**每行一条** `UPDATE ... WHERE 主键`。
 *
 * 一条语句一行是刻意的：`grep -c '^UPDATE'` 就是行数校验，不需要解析 SQL 才能数条数。
 */
export function buildRollbackSql({
  table,
  spec,
  columns,
  columnTypes,
  rows,
  database,
  scriptName,
  generatedAt = new Date(),
}) {
  const primaryKey = spec.primaryKey;
  const assignments = columns.filter((column) => column !== primaryKey);
  const lines = [
    ROLLBACK_SQL_FIRST_LINE,
    `-- ${BACKUP_ISSUE} 写前备份回滚脚本（整表）：${table}`,
    `-- 库：${database}    脚本：${scriptName}    生成时刻：${generatedAt.toISOString()}`,
    `-- 行数：${rows.length}（整表 dump；本文件 UPDATE 条数 == 行数 == 表内实际行数）`,
    "-- 回放：mariadb --default-character-set=utf8mb4 < 本文件",
    "-- 回放后**必须**核对 affected rows == 行数（客户端报错后会继续跑后面的语句 ⇒ 只看退出码会漏掉静默部分回滚）",
  ];
  for (const row of rows) {
    const keyValue = row[primaryKey];
    if (keyValue === null || keyValue === undefined) {
      throw new BackupError(
        BACKUP_ERROR_CODES.VERIFY_FAILED,
        `[backup] ${table} 有行缺主键 ${primaryKey}，无法生成回滚语句（fail-closed）`,
        { table },
      );
    }
    const setClause = assignments
      .map((column) => `\`${column}\` = ${sqlLiteralFor(row[column], columnTypes[column])}`)
      .join(", ");
    lines.push(
      `UPDATE \`${table}\` SET ${setClause} WHERE \`${primaryKey}\` = `
      + `${sqlLiteralFor(keyValue, columnTypes[primaryKey])};`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** `rows` 的稳定 sha256（按 dump 顺序，不做排序——顺序本身就是"这一份"的一部分）。 */
export function hashRows(rows) {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** 逐行原值 JSON（纯函数）。 */
export function buildBackupJson({
  table,
  spec,
  columns,
  columnTypes,
  rows,
  totalRows,
  database,
  scriptName,
  planRows = null,
  generatedAt = new Date(),
}) {
  return {
    issue: BACKUP_ISSUE,
    purpose: "写前备份前置闸：真写之前的整表备份（#1246）",
    script: scriptName,
    database,
    table,
    table_label: spec.label ?? null,
    primary_key: spec.primaryKey,
    generated_at: generatedAt.toISOString(),
    // 整表口径：row_count 必须同时等于 rows.length 与表内实际行数。
    scope: "whole-table",
    plan_rows: planRows,
    row_count: rows.length,
    table_total_rows: totalRows,
    columns,
    column_types: columnTypes,
    sha256_of_rows_json: hashRows(rows),
    rows,
  };
}

/**
 * 回读校验（纯函数，输入是**从盘上读回来**的文本）：任一项不过即抛，附全部问题清单。
 *
 * 六格：① JSON 可解析 ② 行数 == 表内实际行数 ③ `row_count` 字段自洽
 *      ④ 首行 == `SET NAMES utf8mb4;` ⑤ `UPDATE` 条数 == 行数 ⑥ sha256 自洽。
 */
export function verifyBackupArtifacts({
  table,
  spec,
  jsonText,
  sqlText,
  actualRowCount,
  planRows = null,
}) {
  const problems = [];
  let payload = null;
  try {
    payload = JSON.parse(jsonText);
  } catch (error) {
    throw new BackupError(
      BACKUP_ERROR_CODES.VERIFY_FAILED,
      `[backup] ${table} 的 JSON 备份不可解析（${error.message}）——回读校验失败，禁止继续写`,
      { table, problems: [`json_parse: ${error.message}`] },
    );
  }
  if (payload?.table !== table) problems.push(`json_table: 期望 ${table}，实际 ${String(payload?.table)}`);
  const rows = Array.isArray(payload?.rows) ? payload.rows : null;
  if (rows === null) {
    problems.push("json_rows: rows 不是数组");
  } else {
    if (payload.row_count !== rows.length) {
      problems.push(`json_row_count: row_count=${String(payload.row_count)} 但 rows.length=${rows.length}`);
    }
    if (rows.length !== actualRowCount) {
      problems.push(`row_count_vs_table: 备份 ${rows.length} 行 ≠ 表内实际 ${actualRowCount} 行（dump 期间有并发写？）`);
    }
    if (payload.sha256_of_rows_json !== hashRows(rows)) {
      problems.push("json_sha256: sha256_of_rows_json 与 rows 不自洽（文件被改过？）");
    }
    const primaryKey = spec.primaryKey;
    const missingKey = rows.findIndex(
      (row) => row?.[primaryKey] === null || row?.[primaryKey] === undefined,
    );
    if (missingKey >= 0) problems.push(`json_primary_key: 第 ${missingKey + 1} 行缺主键 ${primaryKey}`);
  }
  const sqlLines = sqlText.split("\n");
  if (sqlLines[0] !== ROLLBACK_SQL_FIRST_LINE) {
    problems.push(
      `sql_first_line: 期望 ${JSON.stringify(ROLLBACK_SQL_FIRST_LINE)}，实际 ${JSON.stringify(sqlLines[0] ?? "")}`
      + "（缺这行会在 utf8mb3 客户端上静默部分回滚）",
    );
  }
  const updateCount = sqlLines.filter((line) => line.startsWith("UPDATE ")).length;
  if (rows !== null && updateCount !== rows.length) {
    problems.push(`sql_update_count: UPDATE ${updateCount} 条 ≠ 备份 ${rows.length} 行`);
  }
  if (problems.length > 0) {
    throw new BackupError(
      BACKUP_ERROR_CODES.VERIFY_FAILED,
      `[backup] ${table} 回读校验失败（${problems.length} 项）：${problems.join("；")}`
      + " —— 备份不可信 ⇒ 零写入，请先修好备份目录/连接再重跑",
      { table, problems },
    );
  }
  return {
    table,
    row_count: rows.length,
    update_count: updateCount,
    columns: payload.columns,
    primary_key: spec.primaryKey,
    sha256: payload.sha256_of_rows_json,
    plan_rows: payload.plan_rows ?? planRows,
  };
}

/**
 * 读表结构：列顺序 + `DATA_TYPE` + 是否生成列。
 *
 * 用 `information_schema` 而不是硬编码列名：生成列（`agent_rounds.kind/seq/part_of`）写进去
 * 会直接报错，靠硬编码清单迟早与 DDL 漂移。
 */
export async function loadTableSchema({ sequelize, database, table }) {
  let rows = null;
  try {
    [rows] = await sequelize.query(`
      SELECT COLUMN_NAME AS name, DATA_TYPE AS data_type, EXTRA AS extra
        FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = :database AND TABLE_NAME = :table
       ORDER BY ORDINAL_POSITION ASC
    `, { replacements: { database, table } });
  } catch (error) {
    throw new BackupError(
      BACKUP_ERROR_CODES.DUMP_FAILED,
      `[backup] 读不到 ${database}.${table} 的列结构（${error.message}）——无法生成可回滚 SQL，禁止继续写`,
      { table, cause: error },
    );
  }
  const columns = [];
  const columnTypes = {};
  const generated = [];
  for (const row of rows ?? []) {
    const name = row.name ?? row.COLUMN_NAME;
    const dataType = String(row.data_type ?? row.DATA_TYPE ?? "").toLowerCase();
    const extra = String(row.extra ?? row.EXTRA ?? "").toUpperCase();
    if (extra.includes("GENERATED")) {
      generated.push(name);
      continue;
    }
    columns.push(name);
    columnTypes[name] = dataType;
  }
  if (columns.length === 0) {
    throw new BackupError(
      BACKUP_ERROR_CODES.DUMP_FAILED,
      `[backup] ${database}.${table} 读不到任何列（表不存在 / 权限不足？）——禁止继续写`,
      { table },
    );
  }
  return { columns, columnTypes, generated };
}

/** 整表 dump（**全表**，不按计划行裁剪）+ 同时取 `COUNT(*)` 供行数校验。 */
export async function dumpTableRows({ sequelize, database, table }) {
  const spec = BACKUP_TABLE_SPECS[table];
  if (!spec) {
    throw new BackupError(
      BACKUP_ERROR_CODES.NO_TABLES,
      `[backup] 表 ${table} 不在备份清单规格里（fail-closed：未登记的表不允许真写）`,
      { table },
    );
  }
  const schema = await loadTableSchema({ sequelize, database, table });
  let rawRows = null;
  let countRows = null;
  const projection = schema.columns
    .map((column) => sqlColumnProjection(column, schema.columnTypes[column]))
    .join(", ");
  try {
    // 显式列投影（时间列走 DATE_FORMAT）+ `ORDER BY <主键>`：
    // 同一份数据两次备份必须得到同一份文件（sha256 可比、diff 可读、时区无关）。
    [rawRows] = await sequelize.query(
      `SELECT ${projection} FROM \`${table}\` ORDER BY \`${spec.primaryKey}\``,
    );
    [countRows] = await sequelize.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
  } catch (error) {
    throw new BackupError(
      BACKUP_ERROR_CODES.DUMP_FAILED,
      `[backup] 读 ${database}.${table} 失败（${error.message}）——备份不成立 ⇒ 零写入`,
      { table, cause: error },
    );
  }
  const totalRows = Number(countRows?.[0]?.total ?? countRows?.[0]?.TOTAL ?? 0);
  const rows = (rawRows ?? []).map((raw) => {
    const normalized = {};
    for (const column of schema.columns) {
      normalized[column] = normalizeCellValue(raw[column], schema.columnTypes[column]);
    }
    return normalized;
  });
  return {
    table,
    spec,
    columns: schema.columns,
    columnTypes: schema.columnTypes,
    generatedColumns: schema.generated,
    rows,
    totalRows,
  };
}

function mapFsError(error, { table, path }) {
  const code = error?.code ?? "";
  if (code === "ENOSPC" || code === "EDQUOT") {
    return new BackupError(
      BACKUP_ERROR_CODES.DISK_FULL,
      `[backup] 备份写盘时磁盘满/配额超限（${code}）：${path}（table=${table}）。`
      + "处置：清理 /docker 空间或换 --backup-root 后重跑；**本次零写入**",
      { table, path, cause: error },
    );
  }
  if (code === "ENOENT") {
    return new BackupError(
      BACKUP_ERROR_CODES.DIR_UNWRITABLE,
      `[backup] 备份目录的父级建不出来（ENOENT）：${path}（table=${table}）。`
      + "常见原因：父目录被删、或落在只读虚拟文件系统（/proc、/sys）上。"
      + "处置：把 TOUWAKA_BACKUP_ROOT 指到一个真实可写目录（默认 /docker/touwaka-backups）；**本次零写入**",
      { table, path, cause: error },
    );
  }
  if (code === "EACCES" || code === "EPERM" || code === "EROFS" || code === "ENOTDIR") {
    return new BackupError(
      BACKUP_ERROR_CODES.DIR_UNWRITABLE,
      `[backup] 备份目录不可写（${code}）：${path}（table=${table}）。`
      + `处置：sudo mkdir -p ${dirname(path)} && sudo chown eric:eric ${dirname(path)}（或换 --backup-root）；`
      + "**本次零写入**",
      { table, path, cause: error },
    );
  }
  return new BackupError(
    BACKUP_ERROR_CODES.DIR_UNWRITABLE,
    `[backup] 备份落盘失败（${code || error?.message}）：${path}（table=${table}）——**本次零写入**`,
    { table, path, cause: error },
  );
}

/**
 * 给一个 fs 操作套 deadline：异步挂住（NFS 卡死 / 虚拟文件系统）也必须有限步退出。
 *
 * 注：如果某个 fs 调用在事件循环里**同步**空转（Node 的 `mkdir recursive` 在 /proc 上就是），
 * 定时器也不会被调度——所以那条路径已经从根上删掉了（见 {@link ensureBackupDirectory}）。
 */
async function withFsDeadline(promise, { ms, table, path, action }) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new BackupError(
            BACKUP_ERROR_CODES.DIR_UNWRITABLE,
            `[backup] 备份${action}超过 ${ms}ms 没有返回（目录/挂载点疑似挂死）：${path}（table=${table}）。`
            + "处置：换一个本地可写目录（TOUWAKA_BACKUP_ROOT）后重跑；**本次零写入**",
            { table, path },
          ));
        }, ms);
        // 刻意**不** `unref()`：挂死的 fs 操作不会给事件循环任何活干，unref 掉定时器会让
        // 进程在"还没超时"时就静默退出（Node 会报 "event loop has already resolved"）。
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/**
 * 逐级创建备份目录（**不用 `mkdir({recursive:true})`**）。
 *
 * 为什么自己走：`recursive: true` 在 `/proc/...` 上会无限空转（演练里实测：进程 114% CPU、
 * socket 0 个、4 分钟不返回、没有退出码）。这里改成"stat 找到第一个已存在的祖先 → 从它往下
 * 逐级非递归 mkdir"，层数有上限（{@link MAX_BACKUP_DIR_DEPTH}），每步有 deadline。
 */
export async function ensureBackupDirectory(directory, {
  fsOps = defaultFsOps,
  fsTimeoutMs = BACKUP_FS_TIMEOUT_MS,
  maxDepth = MAX_BACKUP_DIR_DEPTH,
  table = null,
} = {}) {
  const missing = [];
  let current = directory;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    let stats = null;
    try {
      stats = await withFsDeadline(fsOps.stat(current), {
        ms: fsTimeoutMs, table, path: current, action: "目录探测（stat）",
      });
    } catch (error) {
      if (error instanceof BackupError) throw error;
      if (error?.code !== "ENOENT") throw mapFsError(error, { table, path: current });
    }
    if (stats !== null) {
      if (!stats.isDirectory()) {
        throw new BackupError(
          BACKUP_ERROR_CODES.DIR_UNWRITABLE,
          `[backup] 备份路径被非目录占位：${current}（table=${table}）。处置：换一个目录或删掉该文件；**本次零写入**`,
          { table, path: current },
        );
      }
      for (const target of missing.reverse()) {
        try {
          await withFsDeadline(fsOps.mkdir(target), {
            ms: fsTimeoutMs, table, path: target, action: "目录创建（mkdir）",
          });
        } catch (error) {
          if (error instanceof BackupError) throw error;
          if (error?.code !== "EEXIST") throw mapFsError(error, { table, path: target });
        }
      }
      return;
    }
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new BackupError(
    BACKUP_ERROR_CODES.DIR_UNWRITABLE,
    `[backup] 备份目录在 ${maxDepth} 层内找不到可创建的父目录：${directory}（table=${table}）`
    + "——有限步退出，**本次零写入**",
    { table, path: directory },
  );
}

/** 同名产物已存在时先改名归档（**永不覆盖**上一份备份：覆盖 = 把回滚能力换成了最新态）。 */
async function archiveExistingArtifact(path, now, { fsOps = defaultFsOps } = {}) {
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`
    + `${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}`
    + `${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  const dot = path.lastIndexOf(".");
  const archived = `${path.slice(0, dot)}.${stamp}${path.slice(dot)}`;
  await fsOps.rename(path, archived);
  return archived;
}

/**
 * 落盘 + 回读校验（单表）。返回该表的清单条目。
 *
 * 顺序刻意是「dump → 写 json → 写 sql → **从盘上读回来** → 校验」：
 * 校验的是盘上那份，不是内存里那份（内存里那份永远不会"读不出来"）。
 */
export async function backupSingleTable({
  sequelize,
  database,
  table,
  scriptName,
  directory,
  planRows = null,
  now = new Date(),
  logger = null,
  fsOps = defaultFsOps,
  fsTimeoutMs = BACKUP_FS_TIMEOUT_MS,
}) {
  const dump = await dumpTableRows({ sequelize, database, table });
  const paths = backupArtifactPaths({ directory, table });
  const jsonText = `${JSON.stringify(buildBackupJson({
    table,
    spec: dump.spec,
    columns: dump.columns,
    columnTypes: dump.columnTypes,
    rows: dump.rows,
    totalRows: dump.totalRows,
    database,
    scriptName,
    planRows,
    generatedAt: now,
  }), null, 2)}\n`;
  const sqlText = buildRollbackSql({
    table,
    spec: dump.spec,
    columns: dump.columns,
    columnTypes: dump.columnTypes,
    rows: dump.rows,
    database,
    scriptName,
    generatedAt: now,
  });

  // 有限步、非递归的目录创建（`mkdir({recursive:true})` 在 /proc 上会空转，见常量注释）。
  await ensureBackupDirectory(directory, { fsOps, fsTimeoutMs, table });
  for (const target of [paths.json, paths.sql]) {
    try {
      await withFsDeadline(
        archiveExistingArtifact(target, now, { fsOps }),
        { ms: fsTimeoutMs, table, path: target, action: "旧产物归档（rename）" },
      );
    } catch (error) {
      // ENOENT = 首次备份（目标文件还不存在），正常路径；其余是目录不可写。
      if (error instanceof BackupError) throw error;
      if (error?.code !== "ENOENT") throw mapFsError(error, { table, path: target });
    }
  }

  for (const [path, text] of [[paths.json, jsonText], [paths.sql, sqlText]]) {
    try {
      await withFsDeadline(fsOps.writeFile(path, text, "utf8"), {
        ms: fsTimeoutMs, table, path, action: "产物写盘（writeFile）",
      });
    } catch (error) {
      if (error instanceof BackupError) throw error;
      throw mapFsError(error, { table, path });
    }
  }

  // 回读校验：**盘上**的行数再查一次 `COUNT(*)`（dump 期间若有并发写，这里会当场发现）。
  let countRows = null;
  try {
    [countRows] = await sequelize.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
  } catch (error) {
    throw new BackupError(
      BACKUP_ERROR_CODES.DUMP_FAILED,
      `[backup] 备份后复核 ${table} 行数失败（${error.message}）——备份不可信 ⇒ 零写入`,
      { table, cause: error },
    );
  }
  const actualRowCount = Number(countRows?.[0]?.total ?? countRows?.[0]?.TOTAL ?? 0);
  let readBackJson = null;
  let readBackSql = null;
  try {
    readBackJson = await withFsDeadline(fsOps.readFile(paths.json, "utf8"), {
      ms: fsTimeoutMs, table, path: paths.json, action: "回读校验（readFile）",
    });
    readBackSql = await withFsDeadline(fsOps.readFile(paths.sql, "utf8"), {
      ms: fsTimeoutMs, table, path: paths.sql, action: "回读校验（readFile）",
    });
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw mapFsError(error, { table, path: paths.json });
  }
  const verified = verifyBackupArtifacts({
    table,
    spec: dump.spec,
    jsonText: readBackJson,
    sqlText: readBackSql,
    actualRowCount,
    planRows,
  });
  logger?.info?.(`[backup] ${table} 备份完成：${verified.row_count} 行 → ${paths.json}`);
  return {
    table,
    reasons: null,
    json_path: paths.json,
    sql_path: paths.sql,
    row_count: verified.row_count,
    update_count: verified.update_count,
    table_total_rows: dump.totalRows,
    plan_rows: planRows,
    columns: verified.columns,
    primary_key: verified.primary_key,
    sha256: verified.sha256,
    generated_columns_excluded: dump.generatedColumns,
    verified: true,
  };
}

/**
 * 整批备份（多表）：**任一张表失败就抛**（已落盘的表不回滚删除——留着比删掉安全，
 * 但调用方一次写都不会发）。
 *
 * @returns {Promise<{directory: string, script_name: string, database: string,
 *   generated_at: string, tables: object[], manifest_path: string}>}
 */
export async function backupTablesBeforeWrite({
  sequelize,
  database,
  tables,
  scriptName,
  planRowsByTable = {},
  root = BACKUP_ROOT,
  now = new Date(),
  logger = null,
  fsOps = defaultFsOps,
  fsTimeoutMs = BACKUP_FS_TIMEOUT_MS,
}) {
  if (!Array.isArray(tables) || tables.length === 0) {
    throw new BackupError(
      BACKUP_ERROR_CODES.NO_TABLES,
      "[backup] 声明要真写，却算不出任何受影响表——fail-closed，拒绝继续（这是脚本的 bug，不是数据问题）",
    );
  }
  const directory = resolveBackupDirectory({ scriptName, now, root });
  const entries = [];
  for (const entry of tables) {
    const table = typeof entry === "string" ? entry : entry.table;
    const reasons = typeof entry === "string" ? null : entry.reasons ?? null;
    const backed = await backupSingleTable({
      sequelize,
      database,
      table,
      scriptName,
      directory,
      planRows: planRowsByTable[table] ?? null,
      now,
      logger,
      fsOps,
      fsTimeoutMs,
    });
    entries.push({ ...backed, reasons });
  }
  const manifest = {
    issue: BACKUP_ISSUE,
    script: scriptName,
    database,
    generated_at: now.toISOString(),
    directory,
    scope: "whole-table",
    tables: entries,
  };
  const manifestPath = join(directory, "backup-manifest.json");
  try {
    await withFsDeadline(
      fsOps.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
      { ms: fsTimeoutMs, table: null, path: manifestPath, action: "清单写盘（writeFile）" },
    );
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw mapFsError(error, { table: null, path: manifestPath });
  }
  return { ...manifest, manifest_path: manifestPath };
}

/**
 * **写入口包装**：备份落盘并校验通过之后才调用 `writeFn`。
 *
 * 这是"顺序"的唯一实现点，也是用例钉住的那一格：假 sequelize 记录到的调用序列里，
 * 所有备份 SELECT 都排在第一条写 SQL 之前；`writeFn` 里能当场 `stat` 到备份文件。
 *
 * - `dryRun: true` ⇒ **不碰磁盘**（不建目录、不写文件），`writeFn(null)` 照旧调用
 *   （dry-run 的写分支本来就是空的，调用它是为了保持代码路径单一）。
 * - 备份失败 ⇒ 抛 {@link BackupError}，`writeFn` 一次都不调用 ⇒ 零写。
 * - `fsOps` / `fsTimeoutMs`：fs 操作注入 + 单步上限（默认 60s）。**备份不可用必须在有限步内
 *   退出**——目录挂死、虚拟文件系统空转都不许把进程拖成"没有退出码"。
 */
export async function runWithPreWriteBackup(params, writeFn) {
  const { dryRun = false } = params;
  if (dryRun) {
    const result = await writeFn(null);
    return { skipped: true, reason: "dry-run", backup: null, result };
  }
  const backup = await backupTablesBeforeWrite(params);
  const result = await writeFn(backup);
  return { skipped: false, reason: "backed-up", backup, result };
}
