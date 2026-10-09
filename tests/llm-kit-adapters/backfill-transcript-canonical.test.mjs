import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

const { openTestDatabase, assertTestDatabase, DEFAULT_CREDS_PATH } = await import("../helpers/test-db-guard.mjs");
const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const db = dbCtx?.db ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const { createTouwakaTranscriptStore, CANONICAL_TABLE } = await import(
  "../../lib/llm-kit-adapters/transcript-store.js"
);

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT_PATH = path.join(ROOT, "scripts/backfill-transcript-canonical.js");
const REQUEST_ID = `run-backfill-env-${randomUUID()}`;
const DEDUP_KEY = `${REQUEST_ID}:round:1`;

async function countCanonicalRows() {
  const [rows] = await db.sequelize.query(
    `SELECT COUNT(*) AS n FROM \`${CANONICAL_TABLE}\` WHERE request_id = :requestId`,
    { replacements: { requestId: REQUEST_ID } },
  );
  return Number(rows[0].n);
}

async function cleanupFixture() {
  if (!db || !creds) return;
  assertTestDatabase(creds.database, { env: process.env });
  for (const table of ["messages", "chat_tool_calls", "agent_rounds", CANONICAL_TABLE]) {
    await db.sequelize.query(
      `DELETE FROM \`${table}\` WHERE request_id = :requestId`,
      { replacements: { requestId: REQUEST_ID } },
    );
  }
}

function runBackfill(args, env) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function assertExit(result, expected, label) {
  assert.ifError(result.error);
  assert.equal(
    result.status,
    expected,
    `${label}: exit=${result.status}, signal=${result.signal}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.signal, null, `${label} must not be terminated by a signal`);
}

function assertTotals(report, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(report.totals[key], value, `report.totals.${key}`);
  }
}

async function readReport(reportPath) {
  return JSON.parse(await readFile(reportPath, "utf8"));
}

if (!dbCtx) {
  test("DB_* env 分支回填与幂等", { skip: `缺少凭据 ${CREDS_PATH}` }, () => {});
} else {
  after(async () => {
    try {
      await cleanupFixture();
    } finally {
      await db.close();
    }
  });

  test("DB_* 环境变量分支：dry-run、报告与重复回填幂等", async () => {
    assertTestDatabase(creds.database, { env: process.env });
    assert.equal(creds.database, "llm_kit_test", "测试不得连接非白名单数据库");

    const [tableRows] = await db.sequelize.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
          ('agent_rounds', 'messages', 'chat_tool_calls', :canonicalTable)`,
      { replacements: { canonicalTable: CANONICAL_TABLE } },
    );
    assert.equal(tableRows.length, 4, "回填测试要求数据库已迁移，不在测试中改动表结构");

    await cleanupFixture();
    const store = createTouwakaTranscriptStore({ db, requestContext: {} });
    const record = {
      round: 1,
      roundKey: `${REQUEST_ID}:round:1`,
      dedupKey: DEDUP_KEY,
      ts: "2026-10-09T03:00:00.000Z",
      messages: [],
      response: {
        content: [{ type: "text", text: "backfill env-path fixture" }],
        stopReason: "end_turn",
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
      folded: false,
      test_fixture: REQUEST_ID,
    };
    const reportDir = await mkdtemp(path.join(tmpdir(), "touwaka-backfill-canonical-"));

    try {
      await store.appendRound(REQUEST_ID, record);
      assert.equal(await countCanonicalRows(), 1, "fixture 应先有且仅有一条 canonical 行");

      const childEnv = {
        ...process.env,
        DB_HOST: "127.0.0.1",
        DB_PORT: "3306",
        DB_USER: creds.user,
        DB_PASSWORD: creds.password,
        DB_NAME: creds.database,
      };
      delete childEnv.ALLOW_NON_TEST_DB;
      assert.equal(childEnv.DB_NAME, "llm_kit_test");
      assert.equal(childEnv.ALLOW_NON_TEST_DB, undefined);

      const dryReportPath = path.join(reportDir, "dry-run.json");
      const dryRun = runBackfill(
        ["--dry-run", "--request-id", REQUEST_ID, "--report", dryReportPath],
        childEnv,
      );
      assertExit(dryRun, 0, "DB_* dry-run");
      assert.match(dryRun.stdout, /\[#1156 Stage B 回填\/比对\] 库=llm_kit_test 模式=dry-run/);
      assert.match(dryRun.stdout, /旧轮比对\s*:\s*1 轮/);
      assert.match(dryRun.stdout, /将要写入\s*:\s*1 轮（dry-run 不写）/);
      assert.match(dryRun.stdout, /实际写入\s*:\s*0 轮 \/ 已存在忽略 0 轮/);
      assert.match(dryRun.stdout, /一致\s*:\s*1 轮/);
      assert.match(dryRun.stdout, /不一致\s*:\s*0 轮/);
      assert.ok(dryRun.stdout.includes(dryReportPath), "stdout 摘要应给出报告路径");

      const dryReport = await readReport(dryReportPath);
      assert.equal(dryReport.database, "llm_kit_test");
      assert.equal(dryReport.mode, "dry-run");
      assert.equal(
        dryReport.connection_source,
        "DB_* 环境变量（127.0.0.1，ALLOW_NON_TEST_DB=未设）",
      );
      assertTotals(dryReport, {
        old_rounds_compared: 1,
        rounds_planned_to_write: 1,
        rounds_written: 0,
        rounds_ignored_existing: 0,
        rounds_matched: 1,
        rounds_mismatched: 0,
        rounds_missing_in_canonical: 0,
        canonical_rows_before: 1,
        canonical_rows_after: 1,
      });

      // Remove only this fixture's canonical row so the script exercises a real backfill.
      assertTestDatabase(creds.database, { env: childEnv });
      await db.sequelize.query(
        `DELETE FROM \`${CANONICAL_TABLE}\` WHERE request_id = :requestId`,
        { replacements: { requestId: REQUEST_ID } },
      );
      assert.equal(await countCanonicalRows(), 0);

      const writeReportPath = path.join(reportDir, "write.json");
      const write = runBackfill(
        ["--write", "--request-id", REQUEST_ID, "--report", writeReportPath],
        childEnv,
      );
      assertExit(write, 0, "DB_* first write");
      assert.match(write.stdout, /\[#1156 Stage B 回填\/比对\] 库=llm_kit_test 模式=write/);
      assert.match(write.stdout, /实际写入\s*:\s*1 轮 \/ 已存在忽略 0 轮/);
      assert.match(write.stdout, /一致\s*:\s*1 轮/);
      const writeReport = await readReport(writeReportPath);
      assert.equal(writeReport.mode, "write");
      assertTotals(writeReport, {
        old_rounds_compared: 1,
        rounds_planned_to_write: 0,
        rounds_written: 1,
        rounds_ignored_existing: 0,
        rounds_matched: 1,
        rounds_mismatched: 0,
        rounds_missing_in_canonical: 0,
        canonical_rows_before: 0,
        canonical_rows_after: 1,
      });

      const canonicalCountAfterFirstWrite = await countCanonicalRows();
      assert.equal(canonicalCountAfterFirstWrite, 1);

      const secondReportPath = path.join(reportDir, "second-write.json");
      const secondWrite = runBackfill(
        ["--write", "--request-id", REQUEST_ID, "--report", secondReportPath],
        childEnv,
      );
      assertExit(secondWrite, 0, "DB_* second write");
      assert.match(secondWrite.stdout, /实际写入\s*:\s*0 轮 \/ 已存在忽略 1 轮/);
      assert.match(secondWrite.stdout, /一致\s*:\s*1 轮/);
      const secondReport = await readReport(secondReportPath);
      assert.equal(secondReport.mode, "write");
      assertTotals(secondReport, {
        old_rounds_compared: 1,
        rounds_planned_to_write: 0,
        rounds_written: 0,
        rounds_ignored_existing: 1,
        rounds_matched: 1,
        rounds_mismatched: 0,
        rounds_missing_in_canonical: 0,
        canonical_rows_before: 1,
        canonical_rows_after: 1,
      });

      const canonicalCountAfterSecondWrite = await countCanonicalRows();
      assert.equal(
        canonicalCountAfterSecondWrite,
        canonicalCountAfterFirstWrite,
        "重复 --write 不得增加 canonical 行数",
      );
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  });
}
