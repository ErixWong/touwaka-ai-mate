/**
 * issue #1246 —— **回放回滚备份**：把「人工 `mariadb < xxx.rollback.sql`」变成
 * 「以**受影响行数**为准的脚本」（默认真写，`--dry-run` 才只读）
 *
 * 为什么必须写这个脚本（三条实证事实，见 `docs/design/topics/transcript-rollback-drill.md`）
 *   1. **退出码 0 绝不等于回滚成功**：`mariadb` 客户端在 `ERROR 1366` 之后**继续跑后面的语句**，
 *      C2d 那份 SQL 缺 `SET NAMES utf8mb4` 就演出过「静默部分回滚」——退出码、日志结尾都正常。
 *   2. **匹配 0 行的 `UPDATE` 也是成功**（`rc=0`、无输出、无警告）。所以「跑完了」这个观感
 *      与「真的写回去了」之间没有任何联系，唯一的硬证据是**受影响行数**。
 *   3. `mariadb` 客户端默认 `character_set_client = utf8mb3` ⇒ 4 字节字符（emoji / PNG 字节）
 *      的那一行会被 `ERROR 1366` 拒掉。本脚本走驱动参数化，**不经过任何客户端字符集**，
 *      但仍然**强制核对**产物 `.sql` 首行是 `SET NAMES utf8mb4;`——那是给"人拿 SQL 手工回放"
 *      留的唯一正确入口，被人动过就要当场拒绝。
 *
 * 为什么**不解析** `.rollback.sql` 去执行
 *   `UPDATE ... SET content = '... ; ...'` 里的字符串值可能含 `;` / 引号 / 换行 / 反斜杠，
 *   靠切分迟早出事。回放的**值**只从 `<表>.json` 的 `rows` + `columns` 取，用**参数化**
 *   `UPDATE <表> SET <列>=? ... WHERE <主键>=?` 发出去；`.sql` 只用来做**交叉核对**
 *   （`UPDATE` 条数 == `.json` 的 `row_count`、首行 == `SET NAMES utf8mb4;`）。
 *
 * 用法
 *   node scripts/replay-transcript-backup.mjs --backup-dir /docker/touwaka-backups/xxx-261102 \
 *        --expect-database touwaka_drill_261102 --dry-run          # 只读预演
 *   node scripts/replay-transcript-backup.mjs --backup-dir <dir> --expect-database <db>   # 真回放
 *   node scripts/replay-transcript-backup.mjs --expect-database <db> --json               # 最新一份备份
 *
 * 契约（逐条都是可判定的）
 *   - `--expect-database <库名>` **必填**：连上后先 `SELECT DATABASE()`，不一致就 **abort 且零写**
 *     （防止把生产的备份打进演练库，或反过来）。另外清单里的 `database` 也必须等于实际库。
 *   - `--backup-dir <目录>`：省略时取备份根下**最新**一个含 `backup-manifest.json` 的目录。
 *   - 产物交叉核对（任一不过即 abort，零写）：`.sql` 的 `UPDATE` 条数 == `.json` 的 `row_count`
 *     == 清单的 `update_count`；`.sql` 首行 == `SET NAMES utf8mb4;`；`sha256_of_rows_json`
 *     与 `rows` 自洽；每行都有主键且主键不重复；`columns` 覆盖每行的全部键。
 *   - **每条语句核对受影响行数**：`affectedRows` 累计必须 == `row_count`；任何一行
 *     `affectedRows === 0` 都**单独点名**（表名 + 主键值）并判失败。
 *   - 生成列口径：`.json` 的 `columns` 里本来就没有生成列（生成侧按
 *     `information_schema.COLUMNS.EXTRA` 排除了），脚本**不许自己往 `SET` 里补列**——
 *     补了也不一定报错：默认 `sql_mode` 下写 VIRTUAL 列是 `ERROR 1906`，
 *     但 `SET SESSION sql_mode=''` 下 `rc=0` 只有 warning、值被**静默忽略**。所以只能靠
 *     "列集合恰好等于产物里的列集合"这条结构判据，不能拿数据库报错当兜底。
 *   - 失败文案必须可操作：不同错误码 + 明确处置 + **本次已写 N 行**（回放中途失败时，
 *     人需要知道写了一半多少行）。
 *
 * 为什么连接必须开 `CLIENT_FOUND_ROWS`（`dialectOptions.flags = "+FOUND_ROWS"`）
 *   Sequelize 的 MySQL 方言在 `connection-manager.js` 里硬写 `flags: "-FOUND_ROWS"`，于是
 *   `affectedRows` 是**变更行数**而不是**匹配行数**：把一行写成它已有的值 → `affectedRows = 0`
 *   （实测：`Rows matched: 1  Changed: 0`）。而整表备份回放里"本来就一致的行"是绝大多数，
 *   按变更行数判定会把每一次正常回放都判成失败。开了 `FOUND_ROWS` 之后实测
 *   `affectedRows = 1 / 0` 分别对应「行在 / 行不在」，`0` 才有唯一含义 ⇒ 这条闸门才成立。
 *   本脚本仍不单独依赖它：写之前先按主键集合做一次存在性 `SELECT`，两者交叉。
 *
 * 连哪个库（与 scripts/verify-transcript-projection.mjs 同约定）
 *   必须给 `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`；非测试库（白名单只有
 *   `llm_kit_test`）还要 `ALLOW_NON_TEST_DB=1` 显式确认，否则被 `tests/helpers/test-db-guard.mjs`
 *   拦下。`--expect-database` 是**第二道**锁：两道都过才写。
 *
 * 退出码：0 = 每一行都按受影响行数核对通过；1 = 任何失败（用法 / 产物 / 库名 / 行数）。
 *
 * 注意：stdout 是报告，**不要接 `| head`**（管道提前关闭 = SIGPIPE 杀进程，本仓踩过）。
 */

import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

const {
  BACKUP_TABLE_SPECS,
  ROLLBACK_SQL_FIRST_LINE,
  hashRows,
  resolveBackupRoot,
} = await import("../lib/llm-kit-adapters/transcript-backup.js");
const { assertTestDatabase, ALLOW_ENV_VAR } = await import("../tests/helpers/test-db-guard.mjs");

/** 回放失败的错误码（每个码一条可操作处置，用例逐码断言）。 */
export const REPLAY_ERROR_CODES = Object.freeze({
  /** 用法错误（缺 `--expect-database` / 未知参数 / 备份目录不存在） */
  USAGE: "ERR_REPLAY_USAGE",
  /** 备份目录不存在 / 里面没有 `backup-manifest.json` */
  BACKUP_DIR_NOT_FOUND: "ERR_REPLAY_BACKUP_DIR_NOT_FOUND",
  /** 清单不可解析 / 缺 `tables` */
  MANIFEST_UNREADABLE: "ERR_REPLAY_MANIFEST_UNREADABLE",
  /** 产物缺字段（`rows` / `columns` / `column_types` / `primary_key` / 行里缺列 / 非法标识符） */
  ARTIFACT_MISSING_FIELD: "ERR_REPLAY_ARTIFACT_MISSING_FIELD",
  /** `sha256_of_rows_json` 与 `rows` 不自洽（文件被改过） */
  ARTIFACT_HASH_MISMATCH: "ERR_REPLAY_ARTIFACT_HASH_MISMATCH",
  /** 行数不自洽（`.sql` 的 UPDATE 条数 / `.json` 的 row_count / 清单的 update_count 三者不等） */
  ARTIFACT_ROW_COUNT_MISMATCH: "ERR_REPLAY_ARTIFACT_ROW_COUNT_MISMATCH",
  /** `.sql` 首行不是 `SET NAMES utf8mb4;`（缺这行会在 utf8mb3 客户端上静默部分回滚） */
  ARTIFACT_SET_NAMES_MISSING: "ERR_REPLAY_ARTIFACT_SET_NAMES_MISSING",
  /** 主键缺失 / 主键重复（无法唯一定位要回滚的那一行） */
  ARTIFACT_PRIMARY_KEY_MISSING: "ERR_REPLAY_ARTIFACT_PRIMARY_KEY_MISSING",
  /** `SELECT DATABASE()` 与 `--expect-database` 不一致（**零写**） */
  DATABASE_MISMATCH: "ERR_REPLAY_DATABASE_MISMATCH",
  /** 清单里记录的备份库与实际库不一致（备份来自别的库 ⇒ 不许回放） */
  MANIFEST_DATABASE_MISMATCH: "ERR_REPLAY_MANIFEST_DATABASE_MISMATCH",
  /** 备份里有、表里没有的主键（"匹配 0 行"的真身） */
  ROW_NOT_FOUND: "ERR_REPLAY_ROW_NOT_FOUND",
  /** 行在、但 `affectedRows === 0`（`CLIENT_FOUND_ROWS` 没生效 ⇒ 这条闸门失去含义） */
  ZERO_AFFECTED_ROWS: "ERR_REPLAY_ZERO_AFFECTED_ROWS",
  /** 累计受影响行数 != 备份行数（含"一条语句匹配到多行"：主键口径错了） */
  AFFECTED_ROWS_MISMATCH: "ERR_REPLAY_AFFECTED_ROWS_MISMATCH",
  /** 连接 / 建连接失败 */
  CONNECTION: "ERR_REPLAY_CONNECTION",
});

export class ReplayError extends Error {
  constructor(code, message, { table = null, path: p = null, writtenRows = 0, details = null } = {}) {
    super(message);
    this.name = "ReplayError";
    this.code = code;
    this.table = table;
    this.path = p;
    /** **本次已写 N 行**：回放中途失败时人最需要的那个数字。 */
    this.writtenRows = writtenRows;
    this.details = details ?? null;
  }
}

/** 合法的标识符（表名 / 列名）：只允许字母数字下划线 `$`。产物里的名字要拼进 SQL，必须 fail-closed。 */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_$]+$/;

/** 存在性预检的分块大小（`IN (...)` 的占位符个数）。 */
export const PRIMARY_KEY_PROBE_CHUNK = 500;

/** 报告里最多逐条列多少个主键（其余折叠成计数，避免 2671 行刷屏）。 */
export const MAX_NAMED_PRIMARY_KEYS = 20;

/** 默认 fs 操作（可注入：用例不碰真盘也能跑）。 */
export const defaultReplayFsOps = Object.freeze({
  readFile: (p, encoding) => readFile(p, encoding),
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  stat: (p) => stat(p),
});

export function parseArgs(argv) {
  const options = {
    backupDir: null,
    expectDatabase: null,
    dryRun: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--backup-dir") options.backupDir = String(next());
    else if (arg === "--expect-database") options.expectDatabase = String(next());
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new ReplayError(REPLAY_ERROR_CODES.USAGE, `未知参数：${arg}（--help 看用法）`);
  }
  if (!options.help) {
    if (typeof options.expectDatabase !== "string" || options.expectDatabase.trim() === "") {
      throw new ReplayError(
        REPLAY_ERROR_CODES.USAGE,
        "必须给 --expect-database <库名>（连上后拿 SELECT DATABASE() 与它比对，不一致就零写 abort）。"
        + "这个参数没有默认值：默认值会让「打错库」重新变成沉默的事故。",
      );
    }
    options.expectDatabase = options.expectDatabase.trim();
  }
  return options;
}

/**
 * 备份根下**最新**一个含 `backup-manifest.json` 的目录（`--backup-dir` 省略时的默认）。
 *
 * 只按目录名 + mtime 排序，不做"猜哪份是好的"：选错了也只是回放到不该回放的状态，
 * 而脚本的产物校验 + 库名闸门会先把明显不对的情况挡住。
 */
export async function resolveLatestBackupDirectory({ root = resolveBackupRoot(), fsOps = defaultReplayFsOps } = {}) {
  let entries = [];
  try {
    entries = await fsOps.readdir(root);
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.BACKUP_DIR_NOT_FOUND,
      `读不到备份根目录 ${root}（${error?.code ?? error?.message}）。`
      + "处置：用 --backup-dir 显式指定备份目录，或确认 TOUWAKA_BACKUP_ROOT / 默认根目录可读",
      { path: root },
    );
  }
  const candidates = [];
  for (const entry of entries) {
    const name = typeof entry === "string" ? entry : entry?.name;
    const isDirectory = typeof entry === "string" ? true : entry?.isDirectory?.() === true;
    if (!name || !isDirectory) continue;
    const directory = path.join(root, name);
    try {
      const stats = await fsOps.stat(path.join(directory, "backup-manifest.json"));
      candidates.push({ directory, mtimeMs: stats.mtimeMs ?? 0 });
    } catch {
      // 没有清单的目录不是备份目录（旧演练目录 `drill-*` 就是这种）。
    }
  }
  if (candidates.length === 0) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.BACKUP_DIR_NOT_FOUND,
      `备份根 ${root} 下没有任何含 backup-manifest.json 的目录。`
      + "处置：用 --backup-dir 显式指定备份目录（备份是写前闸落的，不在这里现造）",
      { path: root },
    );
  }
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.directory.localeCompare(left.directory));
  return candidates[0].directory;
}

function requireStringField(payload, field, { table, path: filePath, what }) {
  const value = payload?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] ${what} 缺字段 ${field}（或不是非空字符串）：${filePath}（table=${table}）。`
      + "处置：这份备份不完整/被改过 ⇒ 不允许回放，请回到生成侧重新备份",
      { table, path: filePath },
    );
  }
  return value;
}

function requireArrayField(payload, field, { table, path: filePath, what }) {
  const value = payload?.[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] ${what} 的 ${field} 不是非空数组：${filePath}（table=${table}）。`
      + "处置：备份不完整 ⇒ 拒绝回放",
      { table, path: filePath },
    );
  }
  return value;
}

/**
 * 读入并**逐项核对**一份备份（纯文件操作，不连库）。
 *
 * 这里刻意把"结构自洽"与"内容自洽"分开报不同错误码：`sha256` 不过说明文件被改过，
 * 行数不过说明产物之间不一致（`.sql` 与 `.json` 不是同一次生成），两者处置不同。
 *
 * @returns {Promise<{directory: string, manifestPath: string, manifest: object, database: string,
 *   tables: Array<{table: string, primaryKey: string, columns: string[], setColumns: string[],
 *   columnTypes: object, rows: object[], rowCount: number, sqlUpdateCount: number,
 *   manifestUpdateCount: number, jsonPath: string, sqlPath: string, sha256: string}>}>}
 */
export async function loadBackupBundle({ directory, fsOps = defaultReplayFsOps }) {
  if (typeof directory !== "string" || directory.trim() === "") {
    throw new ReplayError(REPLAY_ERROR_CODES.USAGE, "[replay] loadBackupBundle 需要 --backup-dir 目录");
  }
  const manifestPath = path.join(directory, "backup-manifest.json");
  let manifestText = null;
  try {
    manifestText = await fsOps.readFile(manifestPath, "utf8");
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.BACKUP_DIR_NOT_FOUND,
      `[replay] 读不到备份清单 ${manifestPath}（${error?.code ?? error?.message}）。`
      + "处置：确认 --backup-dir 指向写前闸真正落盘的那个目录",
      { path: manifestPath },
    );
  }
  let manifest = null;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.MANIFEST_UNREADABLE,
      `[replay] 备份清单不可解析（${error.message}）：${manifestPath}。处置：清单被截断/改过 ⇒ 拒绝回放`,
      { path: manifestPath },
    );
  }
  if (!Array.isArray(manifest?.tables) || manifest.tables.length === 0) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.MANIFEST_UNREADABLE,
      `[replay] 备份清单里没有 tables（${manifestPath}）——无法知道要回放哪几张表。处置：拒绝回放`,
      { path: manifestPath },
    );
  }
  const database = typeof manifest.database === "string" ? manifest.database.trim() : "";
  if (database === "") {
    throw new ReplayError(
      REPLAY_ERROR_CODES.MANIFEST_UNREADABLE,
      `[replay] 备份清单缺 database 字段（${manifestPath}）——无法核对"这份备份来自哪个库"。处置：拒绝回放`,
      { path: manifestPath },
    );
  }

  const tables = [];
  for (const entry of manifest.tables) {
    tables.push(await loadTableArtifact({ entry, directory, manifest, fsOps }));
  }
  return { directory, manifestPath, manifest, database, tables };
}

async function loadTableArtifact({ entry, directory, manifest, fsOps }) {
  const table = typeof entry?.table === "string" ? entry.table.trim() : "";
  if (!IDENTIFIER_PATTERN.test(table)) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] 清单里的表名非法或缺失：${JSON.stringify(entry?.table)}（${manifest?.directory ?? directory}）。`
      + "处置：清单被改过 ⇒ 拒绝回放",
      { table: table || null },
    );
  }
  const jsonPath = typeof entry.json_path === "string" && entry.json_path.trim() !== ""
    ? entry.json_path
    : path.join(directory, `${table}.json`);
  const sqlPath = typeof entry.sql_path === "string" && entry.sql_path.trim() !== ""
    ? entry.sql_path
    : path.join(directory, `${table}.rollback.sql`);

  let jsonText = null;
  try {
    jsonText = await fsOps.readFile(jsonPath, "utf8");
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.BACKUP_DIR_NOT_FOUND,
      `[replay] 读不到 ${table} 的逐行备份 ${jsonPath}（${error?.code ?? error?.message}）。处置：拒绝回放`,
      { table, path: jsonPath },
    );
  }
  let payload = null;
  try {
    payload = JSON.parse(jsonText);
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.MANIFEST_UNREADABLE,
      `[replay] ${table} 的逐行备份不可解析（${error.message}）：${jsonPath}。处置：拒绝回放`,
      { table, path: jsonPath },
    );
  }
  if (payload?.table !== table) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] ${jsonPath} 里的 table=${JSON.stringify(payload?.table)} 与清单里的 ${table} 不一致。`
      + "处置：产物被换过 ⇒ 拒绝回放",
      { table, path: jsonPath },
    );
  }
  const rows = requireArrayField(payload, "rows", { table, path: jsonPath, what: "逐行备份" });
  const columns = requireArrayField(payload, "columns", { table, path: jsonPath, what: "逐行备份" });
  const primaryKey = requireStringField(payload, "primary_key", { table, path: jsonPath, what: "逐行备份" });
  const columnTypes = payload?.column_types;
  if (!columnTypes || typeof columnTypes !== "object" || Array.isArray(columnTypes)) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] ${table} 的逐行备份缺 column_types（${jsonPath}）。处置：拒绝回放`,
      { table, path: jsonPath },
    );
  }
  const sha256 = requireStringField(payload, "sha256_of_rows_json", { table, path: jsonPath, what: "逐行备份" });
  if (typeof payload?.row_count !== "number") {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] ${table} 的逐行备份缺 row_count（${jsonPath}）。处置：拒绝回放`,
      { table, path: jsonPath },
    );
  }

  // 列名要拼进 SQL：只允许安全标识符（fail-closed，不做"转义一下就好"）。
  for (const column of [...columns, primaryKey]) {
    if (typeof column !== "string" || !IDENTIFIER_PATTERN.test(column)) {
      throw new ReplayError(
        REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
        `[replay] ${table} 的列名非法：${JSON.stringify(column)}（${jsonPath}）。`
        + "处置：产物被改过 ⇒ 拒绝回放",
        { table, path: jsonPath },
      );
    }
  }
  if (!columns.includes(primaryKey)) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_PRIMARY_KEY_MISSING,
      `[replay] ${table} 的 primary_key=${primaryKey} 不在 columns 里（${jsonPath}）——`
      + "WHERE 会指向一个备份里没有的列。处置：拒绝回放",
      { table, path: jsonPath },
    );
  }
  const setColumns = columns.filter((column) => column !== primaryKey);
  if (setColumns.length === 0) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] ${table} 除主键外没有任何列（${jsonPath}）——没有东西可回滚。处置：拒绝回放`,
      { table, path: jsonPath },
    );
  }

  // 结构自洽：row_count / sha256 / 每行主键 / 每行列齐备。
  if (payload.row_count !== rows.length) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH,
      `[replay] ${table} 的 row_count=${payload.row_count} 但 rows.length=${rows.length}（${jsonPath}）。`
      + "处置：产物被截断/拼接 ⇒ 拒绝回放",
      { table, path: jsonPath },
    );
  }
  const actualHash = hashRows(rows);
  if (actualHash !== sha256) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_HASH_MISMATCH,
      `[replay] ${table} 的 sha256_of_rows_json 与 rows 不自洽（记录 ${sha256.slice(0, 12)}…，实算 ${actualHash.slice(0, 12)}…）。`
      + "处置：文件被改过 ⇒ 拒绝回放（拿改过的备份回放 = 把库写成一个谁也没验证过的状态）",
      { table, path: jsonPath },
    );
  }
  const seen = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new ReplayError(
        REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
        `[replay] ${table} 第 ${index + 1} 行不是对象（${jsonPath}）。处置：拒绝回放`,
        { table, path: jsonPath },
      );
    }
    const keyValue = row[primaryKey];
    if (keyValue === null || keyValue === undefined) {
      throw new ReplayError(
        REPLAY_ERROR_CODES.ARTIFACT_PRIMARY_KEY_MISSING,
        `[replay] ${table} 第 ${index + 1} 行缺主键 ${primaryKey}（${jsonPath}）——无法唯一定位要回滚的那一行。`
        + "处置：拒绝回放",
        { table, path: jsonPath },
      );
    }
    const keyId = String(keyValue);
    if (seen.has(keyId)) {
      throw new ReplayError(
        REPLAY_ERROR_CODES.ARTIFACT_PRIMARY_KEY_MISSING,
        `[replay] ${table} 的主键 ${primaryKey}=${keyId} 在备份里出现了两次（第 ${index + 1} 行）——`
        + "按主键回放会有一条覆盖另一条，行数核对也就失去意义。处置：拒绝回放",
        { table, path: jsonPath },
      );
    }
    seen.add(keyId);
    for (const column of columns) {
      if (!Object.hasOwn(row, column)) {
        throw new ReplayError(
          REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
          `[replay] ${table} 第 ${index + 1} 行缺列 ${column}（${jsonPath}）——`
          + "缺列会被写成 NULL，等于把这一格数据抹掉。处置：拒绝回放",
          { table, path: jsonPath },
        );
      }
    }
  }

  // 交叉核对 `.sql`：条数 + 首行（不解析语句内容，只数条数与看首行）。
  let sqlText = null;
  try {
    sqlText = await fsOps.readFile(sqlPath, "utf8");
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.BACKUP_DIR_NOT_FOUND,
      `[replay] 读不到 ${table} 的回滚 SQL ${sqlPath}（${error?.code ?? error?.message}）。处置：拒绝回放`,
      { table, path: sqlPath },
    );
  }
  const sqlLines = sqlText.split("\n");
  if (sqlLines[0] !== ROLLBACK_SQL_FIRST_LINE) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_SET_NAMES_MISSING,
      `[replay] ${table} 的回滚 SQL 首行不是 ${JSON.stringify(ROLLBACK_SQL_FIRST_LINE)}，`
      + `实际 ${JSON.stringify(sqlLines[0] ?? "")}（${sqlPath}）。`
      + "缺这行会在 utf8mb3 客户端上 ERROR 1366 之后继续跑 ⇒ 静默部分回滚。处置：拒绝回放",
      { table, path: sqlPath },
    );
  }
  const sqlUpdateCount = sqlLines.filter((line) => line.startsWith("UPDATE ")).length;
  const manifestUpdateCount = typeof entry.update_count === "number" ? entry.update_count : null;
  const manifestRowCount = typeof entry.row_count === "number" ? entry.row_count : null;
  const mismatches = [];
  if (sqlUpdateCount !== rows.length) mismatches.push(`.sql 的 UPDATE ${sqlUpdateCount} 条 ≠ .json 的 ${rows.length} 行`);
  if (manifestUpdateCount !== null && manifestUpdateCount !== rows.length) {
    mismatches.push(`清单 update_count=${manifestUpdateCount} ≠ .json 的 ${rows.length} 行`);
  }
  if (manifestRowCount !== null && manifestRowCount !== rows.length) {
    mismatches.push(`清单 row_count=${manifestRowCount} ≠ .json 的 ${rows.length} 行`);
  }
  if (mismatches.length > 0) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_ROW_COUNT_MISMATCH,
      `[replay] ${table} 产物行数不自洽：${mismatches.join("；")}（${jsonPath} / ${sqlPath}）。`
      + "处置：说明产物被人动过或生成侧有 bug ⇒ 拒绝回放",
      { table, path: jsonPath },
    );
  }

  return {
    table,
    primaryKey,
    columns: [...columns],
    setColumns,
    columnTypes,
    rows,
    rowCount: rows.length,
    sqlUpdateCount,
    manifestUpdateCount,
    jsonPath,
    sqlPath,
    sha256,
  };
}

/** 参数化 `UPDATE` 的语句模板（列集合**只**来自产物，绝不自己补列）。 */
export function buildUpdateStatement({ table, setColumns, primaryKey }) {
  if (!IDENTIFIER_PATTERN.test(table) || !IDENTIFIER_PATTERN.test(primaryKey)) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] 表名/主键名非法：table=${JSON.stringify(table)} primaryKey=${JSON.stringify(primaryKey)}`,
      { table },
    );
  }
  for (const column of setColumns) {
    if (!IDENTIFIER_PATTERN.test(column)) {
      throw new ReplayError(
        REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
        `[replay] 列名非法：${JSON.stringify(column)}（table=${table}）`,
        { table },
      );
    }
  }
  const assignments = setColumns.map((column) => `\`${column}\` = ?`).join(", ");
  const statement = `UPDATE \`${table}\` SET ${assignments} WHERE \`${primaryKey}\` = ?`;
  // 自检（不是装饰）：`SET` 里出现的列必须**恰好**是产物给的列集合。
  // 生成列口径靠这条结构判据兜底——数据库不会替我们报错（sql_mode='' 时只是 warning）。
  const inStatement = statementColumns(statement);
  if (inStatement.length !== setColumns.length || inStatement.some((column, index) => column !== setColumns[index])) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.ARTIFACT_MISSING_FIELD,
      `[replay] ${table} 生成的 SET 列集合与产物列集合不一致：语句 ${inStatement.join(",")} / 产物 ${setColumns.join(",")}`,
      { table },
    );
  }
  return statement;
}

/**
 * 从**本脚本自己生成的**语句里取回 `SET` 列顺序（给自检与用例用）。
 *
 * 注意：这不是"解析回滚 SQL 来执行"——被解析的是模板输出（`SET \`c\` = ?, ...`），
 * 产物 `.sql` 里的字符串值永远不会进这个函数。
 */
export function statementColumns(statement) {
  const match = /^\s*UPDATE\s+`[^`]+`\s+SET\s+(.+?)\s+WHERE\s+`[^`]+`\s*=\s*\?\s*$/s.exec(statement);
  if (!match) return [];
  return match[1].split(",").map((part) => {
    const column = /^\s*`([^`]+)`\s*=\s*\?$/.exec(part.trim());
    return column ? column[1] : "";
  });
}

/** 一行的参数数组（顺序与语句里的 `?` 一一对应）。 */
export function buildUpdateParams({ setColumns, primaryKey, row }) {
  return [...setColumns.map((column) => row[column]), row[primaryKey]];
}

/** 受影响行数（sequelize 的 mysql 方言：`[OkPacket, metadata]`）。 */
export function affectedRowsOf(result, metadata) {
  const candidate = result?.affectedRows ?? metadata?.affectedRows;
  const numeric = Number(candidate);
  return Number.isFinite(numeric) ? numeric : 0;
}

/** 主键集合存在性（分块 `IN (...)`；不猜、不逐行点查）。 */
export async function probeExistingPrimaryKeys({
  sequelize,
  table,
  primaryKey,
  keys,
  chunkSize = PRIMARY_KEY_PROBE_CHUNK,
}) {
  const existing = new Set();
  for (let offset = 0; offset < keys.length; offset += chunkSize) {
    const chunk = keys.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");
    const [rows] = await sequelize.query(
      `SELECT \`${primaryKey}\` AS pk FROM \`${table}\` WHERE \`${primaryKey}\` IN (${placeholders})`,
      { replacements: chunk },
    );
    for (const row of rows ?? []) existing.add(String(row?.pk ?? row?.PK ?? ""));
  }
  return existing;
}

/** `SELECT DATABASE()` 与 `--expect-database`（以及清单里的库）三方比对；不一致就抛（**零写**）。 */
export async function assertExpectedDatabase({ sequelize, expectDatabase, manifestDatabase = null }) {
  let rows = null;
  try {
    [rows] = await sequelize.query("SELECT DATABASE() AS db");
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.CONNECTION,
      `[replay] 拿不到 SELECT DATABASE() 的结果（${error.message}）——无法核对目标库 ⇒ 零写 abort`,
      { details: { cause: error.message } },
    );
  }
  const actual = String(rows?.[0]?.db ?? rows?.[0]?.DB ?? "");
  if (actual !== expectDatabase) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.DATABASE_MISMATCH,
      `[replay] 目标库不符：--expect-database=${expectDatabase}，实际 SELECT DATABASE()=${actual || "(空)"}。`
      + "**本次零写**。处置：核对 DB_NAME 与 --expect-database"
      + "（防「把生产的备份打进演练库」或反过来），确认无误后重跑",
      { details: { expected: expectDatabase, actual } },
    );
  }
  if (manifestDatabase !== null && manifestDatabase !== "" && manifestDatabase !== actual) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.MANIFEST_DATABASE_MISMATCH,
      `[replay] 这份备份是从 ${manifestDatabase} 落的，当前库是 ${actual}。`
      + "**本次零写**。处置：回放只能打回它自己的库（跨库回放会把一套陌生的行写进这个库），"
      + "请换 --backup-dir 或换库",
      { details: { manifest: manifestDatabase, actual } },
    );
  }
  return { expected: expectDatabase, actual, manifest: manifestDatabase };
}

function namedKeys(keys) {
  if (keys.length === 0) return "（无）";
  const head = keys.slice(0, MAX_NAMED_PRIMARY_KEYS).join(", ");
  return keys.length > MAX_NAMED_PRIMARY_KEYS
    ? `${head} …（另有 ${keys.length - MAX_NAMED_PRIMARY_KEYS} 行，见报告 JSON）`
    : head;
}

/**
 * 回放（`dryRun` ⇒ 只读）。返回报告；失败抛 {@link ReplayError}（带 `writtenRows`）。
 *
 * 逐表流程：库名闸门（一次）→ 主键存在性预检 → 逐行参数化 `UPDATE` + 受影响行数核对。
 * 逐行判定：`affectedRows === 1` ⇒ matched（**匹配到了**；开了 `FOUND_ROWS` 之后 affectedRows 是
 * 「匹配行数」而不是「变更行数」，所以值没变的行也在这里）；`0` 且主键在预检集合里 ⇒ zero_affected
 * （= `CLIENT_FOUND_ROWS` 没生效，这条闸门失去含义，必须失败）；`0` 且不在 ⇒ not_found。
 */
export async function replayBundle({
  sequelize,
  bundle,
  expectDatabase,
  dryRun = false,
  chunkSize = PRIMARY_KEY_PROBE_CHUNK,
}) {
  const database = await assertExpectedDatabase({
    sequelize,
    expectDatabase,
    manifestDatabase: bundle.database,
  });

  const tables = [];
  let writtenRows = 0;
  for (const artifact of bundle.tables) {
    const statement = buildUpdateStatement({
      table: artifact.table,
      setColumns: artifact.setColumns,
      primaryKey: artifact.primaryKey,
    });
    const keys = artifact.rows.map((row) => row[artifact.primaryKey]);
    const existing = await probeExistingPrimaryKeys({
      sequelize,
      table: artifact.table,
      primaryKey: artifact.primaryKey,
      keys,
      chunkSize,
    });
    const missingBeforeWrite = keys.filter((key) => !existing.has(String(key)));

    const entry = {
      table: artifact.table,
      primary_key: artifact.primaryKey,
      row_count: artifact.rowCount,
      update_count: artifact.sqlUpdateCount,
      columns: artifact.columns,
      set_columns: artifact.setColumns,
      statement,
      would_update: artifact.rowCount - missingBeforeWrite.length,
      primary_keys_missing_before_write: missingBeforeWrite.map(String),
      // matched：语句匹配到的行数（= affectedRows，`FOUND_ROWS` 口径）。
      matched: 0,
      // changed_rows：**值真的变了**的行数（驱动从 OK 包的 `Rows matched: X Changed: Y` 里取的）。
      // 只作信息：整表回放里绝大多数行是「匹配但值一样」，它才是那个数字。
      changed_rows: 0,
      unchanged: 0,
      not_found: [],
      zero_affected: [],
      over_matched: [],
      affected_rows_sum: 0,
      written_rows: 0,
      ok: true,
    };

    if (dryRun) {
      // dry-run 不写，但**照样**判 ok：预演的意义就是把"真跑会失败"提前说出来。
      entry.ok = missingBeforeWrite.length === 0;
      tables.push(entry);
      continue;
    }

    for (const row of artifact.rows) {
      const keyId = String(row[artifact.primaryKey]);
      let result = null;
      let metadata = null;
      try {
        [result, metadata] = await sequelize.query(statement, {
          replacements: buildUpdateParams({
            setColumns: artifact.setColumns,
            primaryKey: artifact.primaryKey,
            row,
          }),
        });
      } catch (error) {
        // 中途炸掉：把"已经写了多少行"带出去（人需要知道库现在处在什么状态）。
        throw new ReplayError(
          REPLAY_ERROR_CODES.CONNECTION,
          `[replay] ${artifact.table} 主键 ${artifact.primaryKey}=${keyId} 的回放语句执行失败（${error.message}）。`
          + `本次已写 ${writtenRows + entry.written_rows} 行（表内 ${entry.written_rows} 行），`
          + "库处于**部分回滚**状态：修掉原因后用同一份备份重跑（回放是幂等的：写回原值）。",
          { table: artifact.table, writtenRows: writtenRows + entry.written_rows, details: { key: keyId } },
        );
      }
      const affected = affectedRowsOf(result, metadata);
      entry.affected_rows_sum += affected;
      entry.changed_rows += Number(result?.changedRows ?? 0) || 0;
      if (affected === 1) {
        entry.matched += 1;
        entry.written_rows += 1;
        writtenRows += 1;
      } else if (affected === 0) {
        if (existing.has(keyId)) entry.zero_affected.push(keyId);
        else entry.not_found.push(keyId);
      } else {
        entry.over_matched.push({ key: keyId, affected });
        entry.matched += 1;
        entry.written_rows += 1;
        writtenRows += 1;
      }
    }

    const accounted = entry.matched + entry.zero_affected.length + entry.not_found.length;
    entry.accounted_rows = accounted;
    // **唯一权威判据**：累计受影响行数必须等于备份行数。
    // 三个桶（not_found / zero_affected）只负责「点名到行」，不单独定成败——否则
    // 「一条语句匹配到多行」（sum 偏大）与「某行匹配 0 行」（sum 偏小）会各自成一套判据，
    // 而它们本来就是同一个不变量的两侧。
    entry.ok = entry.not_found.length === 0
      && entry.zero_affected.length === 0
      && entry.affected_rows_sum === entry.row_count;
    tables.push(entry);
  }

  const totalAffected = tables.reduce((sum, entry) => sum + entry.affected_rows_sum, 0);
  const totalRows = tables.reduce((sum, entry) => sum + entry.row_count, 0);
  const report = {
    issue: "#1246",
    mode: dryRun ? "dry-run" : "apply",
    generated_at: new Date().toISOString(),
    backup_dir: bundle.directory,
    manifest_path: bundle.manifestPath,
    database,
    row_count_total: totalRows,
    affected_rows_total: totalAffected,
    written_rows: writtenRows,
    tables,
    ok: tables.every((entry) => entry.ok),
  };

  // dry-run 不抛：报告本身就是结论（会被更新的行数 / 主键不存在的行数），退出码由 main 定。
  // 真写时任何一格不过都抛 —— 带 code 与「本次已写 N 行」。
  if (!report.ok && !dryRun) throw buildReportFailure({ report });
  return report;
}

/** 把"哪一格不过"翻译成**不同错误码 + 可操作文案**（含本次已写 N 行）。 */
export function buildReportFailure({ report }) {
  const written = report.written_rows;
  const tail = `本次已写 ${written} 行（合计口径：受影响行数 ${report.affected_rows_total} / 备份 ${report.row_count_total} 行）。`;
  for (const entry of report.tables) {
    if (entry.not_found.length > 0) {
      return new ReplayError(
        REPLAY_ERROR_CODES.ROW_NOT_FOUND,
        `[replay] ${entry.table}：备份里有 ${entry.not_found.length} 行主键在表里**不存在**，`
        + `UPDATE 匹配 0 行（客户端会照样返回成功——这就是"退出码 0 ≠ 回滚成功"）。`
        + `主键 ${entry.primary_key}：${namedKeys(entry.not_found)}。`
        + `${tail}处置：确认库/表没被截断或指向了别的库；主键缺失的行不可能被回放补回来`,
        { table: entry.table, writtenRows: written, details: { not_found: entry.not_found } },
      );
    }
  }
  for (const entry of report.tables) {
    if (entry.zero_affected.length > 0) {
      return new ReplayError(
        REPLAY_ERROR_CODES.ZERO_AFFECTED_ROWS,
        `[replay] ${entry.table}：${entry.zero_affected.length} 行**行在、affectedRows 却是 0**`
        + `（主键 ${entry.primary_key}：${namedKeys(entry.zero_affected)}）。`
        + "说明连接没有开 CLIENT_FOUND_ROWS（Sequelize 的 MySQL 方言默认 `flags: \"-FOUND_ROWS\"`，"
        + "affectedRows 变成**变更行数**：把一行写成它已有的值就是 0）——此时 affectedRows 无法区分"
        + "「值没变」与「行不存在」，这条闸门失去含义。"
        + `${tail}处置：不要用退出码/affectedRows 判断回滚结果，先修连接的 foundRows 再重跑`,
        { table: entry.table, writtenRows: written, details: { zero_affected: entry.zero_affected } },
      );
    }
  }
  for (const entry of report.tables) {
    if (entry.over_matched.length > 0) {
      return new ReplayError(
        REPLAY_ERROR_CODES.AFFECTED_ROWS_MISMATCH,
        `[replay] ${entry.table}：有 ${entry.over_matched.length} 条语句匹配到**多行**`
        + `（${entry.over_matched.slice(0, MAX_NAMED_PRIMARY_KEYS).map((item) => `${item.key}→${item.affected}`).join(", ")}）——`
        + `主键口径 ${entry.primary_key} 不对（WHERE 命中了不止一行），累计受影响行数 ${entry.affected_rows_sum} ≠ 备份 ${entry.row_count} 行。`
        + `${tail}处置：停手核对主键定义；一条回滚语句改多行等于把别的行也写掉了`,
        { table: entry.table, writtenRows: written, details: { over_matched: entry.over_matched } },
      );
    }
  }
  const drifted = report.tables.find((entry) => entry.affected_rows_sum !== entry.row_count);
  if (drifted) {
    return new ReplayError(
      REPLAY_ERROR_CODES.AFFECTED_ROWS_MISMATCH,
      `[replay] ${drifted.table}：累计受影响行数 ${drifted.affected_rows_sum} ≠ 备份行数 ${drifted.row_count}`
      + `（matched=${drifted.matched} zero_affected=${drifted.zero_affected.length} not_found=${drifted.not_found.length}）。`
      + `${tail}处置：这个差值就是"静默部分回滚"的形状——不要相信退出码，按上表逐格排查`,
      { table: drifted.table, writtenRows: written },
    );
  }
  return new ReplayError(
    REPLAY_ERROR_CODES.AFFECTED_ROWS_MISMATCH,
    `[replay] 回放核对未通过（未归类）。${tail}`,
    { writtenRows: written },
  );
}

/** 人类可读报告（stdout 用）。`--dry-run` 必须能看到「会被更新的行数 / 主键不存在的行数」。 */
export function formatReport(report) {
  const lines = [];
  lines.push("== 回放目标（#1246 回滚备份回放：以受影响行数为准，不看退出码）");
  lines.push(`  备份目录：${report.backup_dir}`);
  lines.push(`  清单：${report.manifest_path}`);
  lines.push(
    `  库：实际 SELECT DATABASE()=${report.database.actual}`
    + `    期望（--expect-database）=${report.database.expected}`
    + `    清单记录=${report.database.manifest ?? "-"}`,
  );
  lines.push(`  模式：${report.mode}${report.mode === "dry-run" ? "（只读；零写）" : "（真写；--dry-run 才是只读）"}`);
  lines.push("== 逐表核对");
  for (const entry of report.tables) {
    lines.push(
      `  ${entry.table}\t主键 ${entry.primary_key}\t备份 ${entry.row_count} 行 / 回滚 SQL ${entry.update_count} 条`
      + `\tSET ${entry.set_columns.length} 列\t受影响行数 ${entry.affected_rows_sum}`
      + `\t匹配 ${entry.matched}（值真变 ${entry.changed_rows}） / zero_affected ${entry.zero_affected.length} / not_found ${entry.not_found.length}`
      + `\t${entry.ok ? "✅" : "❌"}`,
    );
    lines.push(`    会被更新的行数：${entry.would_update}\t主键不存在的行数：${entry.primary_keys_missing_before_write.length}`);
    if (entry.primary_keys_missing_before_write.length > 0) {
      lines.push(`      缺主键（写前预检）：${namedKeys(entry.primary_keys_missing_before_write)}`);
    }
    if (entry.not_found.length > 0) {
      lines.push(`      回放时匹配 0 行：${namedKeys(entry.not_found)}`);
    }
    if (entry.zero_affected.length > 0) {
      lines.push(`      行在但 affectedRows=0：${namedKeys(entry.zero_affected)}`);
    }
    if (entry.over_matched.length > 0) {
      lines.push(`      匹配到多行：${entry.over_matched.map((item) => `${item.key}→${item.affected}`).join(", ")}`);
    }
  }
  lines.push("== 合计");
  lines.push(
    `  备份 ${report.row_count_total} 行\t受影响行数 ${report.affected_rows_total}\t本次已写 ${report.written_rows} 行`
    + `\t${report.ok ? "✅ 每一行都按受影响行数核对通过" : "❌ 有行没核对通过（见上）"}`,
  );
  if (report.mode === "dry-run") {
    lines.push("  dry-run：零写。去掉 --dry-run 才是真回放（语义与 verify-transcript-projection.mjs 一致）");
  }
  return lines.join("\n");
}

/** 失败 → 退出码映射（任何失败都是 1，绝不降级成 0）。 */
export function describeFailure(error) {
  const lines = [`[replay-transcript-backup] ${error?.message ?? error}`];
  if (error?.code) lines.push(`  code=${error.code}`);
  if (error?.table) lines.push(`  table=${error.table}`);
  if (typeof error?.writtenRows === "number") lines.push(`  本次已写 ${error.writtenRows} 行`);
  return { exitCode: 1, code: error?.code ?? null, message: lines.join("\n") };
}

/**
 * 建连接（`DB_*` 环境变量 + 测试库守卫）。
 *
 * `dialectOptions.flags = "+FOUND_ROWS"` 不是调优，是**语义前提**：Sequelize 默认
 * `-FOUND_ROWS` 会让 `affectedRows` 变成"变更行数"，于是"行在、值没变"也报 0，
 * 与"行不存在"完全无法区分（实测见文件头）。开了之后 `0` 只可能意味着"主键不存在"。
 */
export async function connectDatabase({ env = process.env } = {}) {
  const target = env.DB_NAME;
  if (typeof target !== "string" || target.trim() === "") {
    throw new ReplayError(
      REPLAY_ERROR_CODES.USAGE,
      "必须给 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME（与 scripts/verify-transcript-projection.mjs 同一套口径）。"
      + "本脚本不会自己猜一个库出来",
    );
  }
  assertTestDatabase(target, { env });
  const { Sequelize } = await import("sequelize");
  const sequelize = new Sequelize(target, env.DB_USER, env.DB_PASSWORD, {
    host: env.DB_HOST || "localhost",
    port: Number(env.DB_PORT || 3306),
    dialect: "mysql",
    logging: false,
    dialectOptions: { flags: "+FOUND_ROWS" },
  });
  try {
    await sequelize.authenticate();
  } catch (error) {
    throw new ReplayError(
      REPLAY_ERROR_CODES.CONNECTION,
      `[replay] 连不上 ${env.DB_HOST || "localhost"}:${env.DB_PORT || 3306}/${target}（${error.message}）`,
      { details: { cause: error.message } },
    );
  }
  return {
    sequelize,
    database: target,
    source: `DB_* 环境变量（${env.DB_HOST || "localhost"}，${ALLOW_ENV_VAR}=${env[ALLOW_ENV_VAR] ?? "未设"}）`,
  };
}

export async function main({ argv = process.argv.slice(2), env = process.env, fsOps = defaultReplayFsOps } = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(
      "用法：node scripts/replay-transcript-backup.mjs --expect-database <库名> "
      + "[--backup-dir <目录>] [--dry-run] [--json]\n"
      + "  --expect-database  必填；连上后拿 SELECT DATABASE() 与它比对，不一致 ⇒ 零写 abort\n"
      + "  --backup-dir       省略时取备份根下最新一个含 backup-manifest.json 的目录\n"
      + "  --dry-run          只读预演（打印会被更新的行数 / 主键不存在的行数）\n"
      + "  默认（不给 --dry-run）就是**真回放**",
    );
    return null;
  }
  const directory = options.backupDir ?? await resolveLatestBackupDirectory({ fsOps });
  const bundle = await loadBackupBundle({ directory, fsOps });
  console.log(`== 备份产物核对通过：${bundle.tables.map((table) => `${table.table} ${table.rowCount} 行`).join(" / ")}`);
  console.log(`  备份库：${bundle.database}    目录：${bundle.directory}`);

  const { sequelize, database } = await connectDatabase({ env });
  try {
    const report = await replayBundle({
      sequelize,
      bundle,
      expectDatabase: options.expectDatabase,
      dryRun: options.dryRun,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatReport(report));
    // 预演说"真跑会失败"也要非零退出：否则 CI/人都会把它当成绿灯。
    if (!report.ok) process.exitCode = 1;
    return report;
  } finally {
    // 失败也要关连接：连接池会 hold 住事件循环 ⇒ 进程"没有退出码"，那正是本单要消灭的形态。
    await sequelize.close().catch(() => {});
  }
}

// 只有**直接跑**本文件才执行 main（用例 import 拿工具函数时不能连带连库）。
const invokedDirectly = process.argv[1]
  && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    const failure = describeFailure(error);
    console.error(failure.message);
    process.exitCode = failure.exitCode;
  }
}
