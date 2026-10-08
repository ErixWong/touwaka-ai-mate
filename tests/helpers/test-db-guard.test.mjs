/**
 * tests/helpers/test-db-guard.mjs 的断言测试（issue #1167）
 *
 * 覆盖三条硬要求：
 *   ① 目标库 = llm_kit_test → 放行；
 *   ② 目标库 = touwaka_mate（生产）→ **在建连接之前**就抛错终止（假凭据 + 假 Database 探针，绝不连生产）；
 *   ③ 显式 ALLOW_NON_TEST_DB=1 → 放行且必须产生 warn 记录（不静默）。
 *
 * 本文件自己**不连任何数据库**（凭据一律指向临时假文件、连接一律用注入的假 Database），
 * 因此在没有凭据、没有 MariaDB 的机器上也必须全绿。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertTestDatabase,
  loadTestDbCreds,
  openTestDatabase,
  resolveCredsPath,
  DEFAULT_ALLOWED_DATABASES,
  ALLOW_ENV_VAR,
  CREDS_PATH_ENV_VAR,
  NonTestDatabaseError,
} from "./test-db-guard.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONTRACT_TEST = join(REPO_ROOT, "tests", "llm-kit-adapters", "model-config-provider.contract.test.mjs");

const tmpDir = mkdtempSync(join(tmpdir(), "touwaka-db-guard-"));
after(() => rmSync(tmpDir, { recursive: true, force: true }));

function writeFakeCreds(name, overrides) {
  const path = join(tmpDir, name);
  writeFileSync(
    path,
    JSON.stringify({ host: "127.0.0.1", port: 1, user: "guard_probe", password: "guard_probe", database: "llm_kit_test", ...overrides }),
    "utf8",
  );
  return path;
}

// 假凭据：库名是真的生产库名，但 host/port 是本机不存在的端口，且用假 Database 探针 —— 双保险，绝不碰生产库
const CREDS_TEST_DB = writeFakeCreds("creds-llm-kit-test.json", { database: "llm_kit_test" });
const CREDS_PROD_DB = writeFakeCreds("creds-touwaka-mate.json", { database: "touwaka_mate" });
const CREDS_EMPTY_DB = writeFakeCreds("creds-empty-db.json", { database: "  " });

/** 连接探针：记录"是否真的建过连接"，用来证明断言发生在建连接之前 */
function createProbe() {
  const probe = { constructed: 0, connected: 0, configs: [] };
  probe.Database = class FakeDatabase {
    constructor(config) {
      probe.constructed += 1;
      probe.configs.push(config);
    }
    async connect() {
      probe.connected += 1;
    }
  };
  return probe;
}

test("① 目标库是 llm_kit_test：放行，且不产生 warn", () => {
  const warnings = [];
  const result = assertTestDatabase("llm_kit_test", { env: {}, warn: (m) => warnings.push(m) });
  assert.equal(result.isTestDatabase, true);
  assert.equal(result.allowed, true);
  assert.equal(result.warned, false);
  assert.deepEqual(warnings, []);

  const creds = loadTestDbCreds({ credsPath: CREDS_TEST_DB, env: {} });
  assert.equal(creds.database, "llm_kit_test");
});

test("① 白名单默认只有 llm_kit_test（禁止为了测试变绿而放宽）", () => {
  assert.deepEqual([...DEFAULT_ALLOWED_DATABASES], ["llm_kit_test"]);
});

test("② 目标库是 touwaka_mate：assertTestDatabase 抛错并说清原因/逃生门", () => {
  assert.throws(
    () => assertTestDatabase("touwaka_mate", { env: {}, warn: () => {} }),
    (error) => {
      assert.ok(error instanceof NonTestDatabaseError, "必须是 NonTestDatabaseError");
      assert.equal(error.code, "ERR_NON_TEST_DATABASE");
      assert.match(error.message, /拒绝在非测试库上执行破坏性测试/);
      assert.match(error.message, /touwaka_mate/, "错误信息必须写清实际库名");
      assert.match(error.message, new RegExp(ALLOW_ENV_VAR), "错误信息必须写清如何显式确认");
      return true;
    },
  );

  // 库名拿不到（空串）同样拒绝，不静默继续
  assert.throws(() => assertTestDatabase("", { env: {}, warn: () => {} }), NonTestDatabaseError);
  assert.throws(() => assertTestDatabase(undefined, { env: {}, warn: () => {} }), NonTestDatabaseError);
});

test("② 目标库是 touwaka_mate：loadTestDbCreds 在建连接之前就抛错", () => {
  assert.throws(() => loadTestDbCreds({ credsPath: CREDS_PROD_DB, env: {}, warn: () => {} }), NonTestDatabaseError);
});

test("② 目标库是 touwaka_mate：openTestDatabase 根本没创建连接（构造数=0）", async () => {
  const probe = createProbe();
  await assert.rejects(
    () => openTestDatabase({ credsPath: CREDS_PROD_DB, env: {}, warn: () => {}, Database: probe.Database }),
    NonTestDatabaseError,
  );
  assert.equal(probe.constructed, 0, "守卫必须在 new Database() 之前拦截");
  assert.equal(probe.connected, 0, "守卫必须在 connect() 之前拦截");
});

test("② 库名为空的凭据：同样在建连接之前拦截", async () => {
  const probe = createProbe();
  await assert.rejects(
    () => openTestDatabase({ credsPath: CREDS_EMPTY_DB, env: {}, warn: () => {}, Database: probe.Database }),
    NonTestDatabaseError,
  );
  assert.equal(probe.constructed, 0);
});

test("② 真实契约测试：凭据指向 touwaka_mate 时子进程在建连接前就被拦停", () => {
  // 假凭据（touwaka_mate + 127.0.0.1:1，本进程从不连它）跑真实契约测试文件：
  // 期望"非零退出 + 打印拒绝信息 + 完全没尝试建连接（无 ECONNREFUSED）"。
  // node:test 会给子进程设 NODE_TEST_CONTEXT，不删掉的话被 spawn 的 runner 会
  // 报"recursive run()"而直接跳过文件（变成假绿）。
  const childEnv = { ...process.env, [CREDS_PATH_ENV_VAR]: CREDS_PROD_DB };
  delete childEnv[ALLOW_ENV_VAR];
  delete childEnv.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ["--test", CONTRACT_TEST], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
    env: childEnv,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  assert.notEqual(run.status, 0, `守卫放行时契约测试会真的去连库并跑用例（exit=${run.status}）\n${output.slice(-2000)}`);
  assert.match(output, /拒绝在非测试库上执行破坏性测试/, "子进程必须打印守卫的拒绝信息");
  assert.match(output, /touwaka_mate/);
  assert.doesNotMatch(
    output,
    /ECONNREFUSED|EHOSTUNREACH|connect ETIMEDOUT/,
    "出现连接错误说明守卫没能拦在建连接之前",
  );
});

test(`③ ${ALLOW_ENV_VAR}=1：放行并产生 warn 记录（不静默）`, async () => {
  const warnings = [];
  const result = assertTestDatabase("touwaka_mate", { env: { [ALLOW_ENV_VAR]: "1" }, warn: (m) => warnings.push(m) });
  assert.equal(result.allowed, true);
  assert.equal(result.isTestDatabase, false);
  assert.equal(result.warned, true);
  assert.equal(warnings.length, 1, "显式放行必须打印恰好一条 warn");
  assert.match(warnings[0], /WARN/);
  assert.match(warnings[0], /touwaka_mate/);
  assert.match(warnings[0], new RegExp(ALLOW_ENV_VAR));

  const probe = createProbe();
  const ctx = await openTestDatabase({
    credsPath: CREDS_PROD_DB,
    env: { [ALLOW_ENV_VAR]: "1" },
    warn: (m) => warnings.push(m),
    Database: probe.Database,
  });
  assert.equal(ctx.creds.database, "touwaka_mate");
  assert.equal(probe.constructed, 1, "显式放行后才允许建连接");
  assert.equal(probe.connected, 1);
  assert.equal(warnings.length, 2, "openTestDatabase 路径也必须 warn");
});

test(`③ ${ALLOW_ENV_VAR} 只认 "1"：写成 0/true/yes 一律仍然拒绝`, () => {
  for (const value of ["0", "true", "yes", "", "1 "]) {
    assert.throws(
      () => assertTestDatabase("touwaka_mate", { env: { [ALLOW_ENV_VAR]: value }, warn: () => {} }),
      NonTestDatabaseError,
      `${ALLOW_ENV_VAR}=${JSON.stringify(value)} 不应该放行`,
    );
  }
});

test("凭据文件缺失 → 返回 null（保持缺凭据即 skip 的原行为）", () => {
  const missing = join(tmpDir, "not-exists.json");
  assert.equal(loadTestDbCreds({ credsPath: missing, env: {} }), null);
});

test(`${CREDS_PATH_ENV_VAR} 覆盖凭据路径（仅供守卫自测使用）`, () => {
  assert.equal(resolveCredsPath({ [CREDS_PATH_ENV_VAR]: CREDS_TEST_DB }), CREDS_TEST_DB);
  assert.equal(typeof resolveCredsPath({}), "string");
  assert.match(resolveCredsPath({}), /touwaka-test-db\.json$/);
});

test("守卫拒绝信息里的库名与实际一致（防复制粘贴错库时看不出来）", () => {
  const other = writeFakeCreds("creds-some-other.json", { database: "touwaka_mate_replica" });
  assert.throws(() => loadTestDbCreds({ credsPath: other, env: {}, warn: () => {} }), (error) => {
    assert.ok(error instanceof NonTestDatabaseError);
    assert.match(error.message, /touwaka_mate_replica/);
    return true;
  });
});
