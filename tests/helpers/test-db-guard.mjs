/**
 * 测试库硬断言守卫（issue #1167）
 *
 * 背景：契约测试会在真实业务表上做破坏性操作（`sync()` / 曾经的 `sync({ force: true })`、
 * `DELETE`、`DROP`）。只要凭据文件（`~/.config/mcp/creds/touwaka-test-db.json`）被换成生产库
 * （或被复制一份指错库），跑一次测试就会在生产库上重建/删表，直接损坏线上数据。
 *
 * 本模块提供**建立连接之前**必须调用的硬断言：
 *   1. 目标库名必须命中白名单（默认且仅默认 `llm_kit_test`）；
 *   2. 不命中 → 直接抛 `NonTestDatabaseError` 终止，**绝不静默继续**；
 *   3. 唯一逃生门是显式设 `ALLOW_NON_TEST_DB=1`，且放行时必须打印 warn（不静默）。
 *
 * 设计约束（刻意为之）：
 *   - 白名单只能由调用方显式传参覆盖（用于单测自身），**不读任何环境变量放宽**，
 *     避免"为了让测试变绿"随手 export 一个变量就把生产库放进白名单。
 *   - 所有导出都是纯函数/可注入依赖（`env` / `warn` / `Database`），因此可在
 *     不连任何数据库的前提下被单测断言（见 tests/helpers/test-db-guard.test.mjs）。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** 默认且唯一默认放行的测试库名（大小写不敏感比较） */
export const DEFAULT_ALLOWED_DATABASES = Object.freeze(["llm_kit_test"]);

/** 显式确认逃生门的环境变量名 */
export const ALLOW_ENV_VAR = "ALLOW_NON_TEST_DB";

/** 凭据文件路径覆盖（仅用于测试守卫本身；默认仍是真实凭据文件） */
export const CREDS_PATH_ENV_VAR = "TOUWAKA_TEST_DB_CREDS";

/** 默认真实凭据文件（600，不入库） */
export const DEFAULT_CREDS_PATH = join(homedir(), ".config", "mcp", "creds", "touwaka-test-db.json");

export class NonTestDatabaseError extends Error {
  constructor(message, { database = "", allowedDatabases = [] } = {}) {
    super(message);
    this.name = "NonTestDatabaseError";
    this.code = "ERR_NON_TEST_DATABASE";
    this.database = database;
    this.allowedDatabases = [...allowedDatabases];
  }
}

function defaultWarn(message) {
  console.warn(message);
}

function normalizeDatabaseName(raw) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/^`+/, "").replace(/`+$/, "").trim();
}

function normalizeAllowed(allowedDatabases) {
  const list = Array.isArray(allowedDatabases) && allowedDatabases.length > 0
    ? allowedDatabases
    : DEFAULT_ALLOWED_DATABASES;
  return list.map((name) => normalizeDatabaseName(name)).filter(Boolean);
}

/**
 * 硬断言：目标库必须是测试库。**必须在建立任何连接之前调用**。
 *
 * @param {string} database 凭据里的目标库名
 * @param {object} [options]
 * @param {Record<string,string>} [options.env] 环境变量（默认 process.env）
 * @param {string[]} [options.allowedDatabases] 白名单（默认 DEFAULT_ALLOWED_DATABASES）
 * @param {(msg: string) => void} [options.warn] 放行非测试库时的告警出口（默认 console.warn）
 * @returns {{database: string, isTestDatabase: boolean, allowed: boolean, warned: boolean, warning: string|null}}
 * @throws {NonTestDatabaseError} 目标库不在白名单且未显式 ALLOW_NON_TEST_DB=1
 */
export function assertTestDatabase(database, options = {}) {
  const { env = process.env, warn = defaultWarn } = options;
  const allowed = normalizeAllowed(options.allowedDatabases);
  const target = normalizeDatabaseName(database);
  const whitelistText = allowed.join(", ");

  if (!target) {
    throw new NonTestDatabaseError(
      [
        "[test-db-guard] 拒绝在非测试库上执行破坏性测试：拿不到目标库名" +
          `（收到 ${JSON.stringify(database) ?? "undefined"}），无法确认它不是生产库。`,
        `  测试库白名单：${whitelistText}`,
        `  确认后果后如需强行放行：export ${ALLOW_ENV_VAR}=1（放行时会打印 warn，不会静默继续）。`,
      ].join("\n"),
      { database: target, allowedDatabases: allowed },
    );
  }

  if (allowed.some((name) => name.toLowerCase() === target.toLowerCase())) {
    return { database: target, isTestDatabase: true, allowed: true, warned: false, warning: null };
  }

  if (env[ALLOW_ENV_VAR] === "1") {
    const warning =
      `[test-db-guard] WARN: ${ALLOW_ENV_VAR}=1 已显式放行非测试库 "${target}"` +
      `（白名单：${whitelistText}）。破坏性测试将真实作用于该库，请自行确认它不是生产库。`;
    warn(warning);
    return { database: target, isTestDatabase: false, allowed: true, warned: true, warning };
  }

  throw new NonTestDatabaseError(
    [
      `[test-db-guard] 拒绝在非测试库上执行破坏性测试：目标库 "${target}" 不在测试库白名单内。`,
      `  白名单：${whitelistText}`,
      `  实际目标库：${target}`,
      "  原因：契约测试会对真实业务表做破坏性操作（建表/删行/DROP/重建），" +
        "指到生产库会直接损坏线上数据。",
      `  如需显式确认后果并强行放行：export ${ALLOW_ENV_VAR}=1（放行时会打印 warn，不会静默继续）。`,
    ].join("\n"),
    { database: target, allowedDatabases: allowed },
  );
}

/** 解析凭据文件路径（允许用 TOUWAKA_TEST_DB_CREDS 覆盖，便于测试守卫本身） */
export function resolveCredsPath(env = process.env) {
  const override = typeof env?.[CREDS_PATH_ENV_VAR] === "string" ? env[CREDS_PATH_ENV_VAR].trim() : "";
  return override || DEFAULT_CREDS_PATH;
}

/**
 * 读取凭据并在**建连接之前**执行硬断言。
 *
 * @returns {object|null} 凭据对象；凭据文件不存在时返回 null（调用方按"缺凭据 → skip"处理）
 * @throws {NonTestDatabaseError} 目标库不是测试库且未 ALLOW_NON_TEST_DB=1
 */
export function loadTestDbCreds(options = {}) {
  const {
    credsPath = resolveCredsPath(options.env),
    env = process.env,
    allowedDatabases = DEFAULT_ALLOWED_DATABASES,
    warn = defaultWarn,
  } = options;

  let raw;
  try {
    raw = readFileSync(credsPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`[test-db-guard] 凭据文件读取失败 ${credsPath}: ${error.message}`, { cause: error });
  }

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[test-db-guard] 凭据文件不是合法 JSON ${credsPath}: ${error.message}`, { cause: error });
  }

  // 关键：断言先于任何 createConnection / new Sequelize / connect()
  assertTestDatabase(creds?.database, { env, allowedDatabases, warn });
  return creds;
}

/**
 * 凭据 → 守卫 → 才建连接的统一入口。
 *
 * @param {object} [options]
 * @param {new (config: object) => {connect: () => Promise<unknown>}} [options.Database]
 *        可注入的 Database 构造器（单测用它证明"守卫抛错时连接根本没被创建"）
 * @returns {Promise<{creds: object, db: object, credsPath: string}|null>} null = 无凭据（skip）
 */
export async function openTestDatabase(options = {}) {
  const { credsPath = resolveCredsPath(options.env), env = process.env } = options;
  const creds = loadTestDbCreds({ ...options, credsPath, env });
  if (!creds) return null;

  const DatabaseCtor = options.Database ?? (await import("../../lib/db.js")).default;
  const db = new DatabaseCtor({
    database: creds.database,
    user: creds.user,
    password: creds.password,
    host: creds.host,
    port: creds.port,
  });
  await db.connect();
  return { creds, db, credsPath };
}
