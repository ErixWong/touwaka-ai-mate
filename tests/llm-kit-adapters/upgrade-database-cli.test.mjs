import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DB_USER ??= "test";
process.env.DB_PASSWORD ??= "test";
process.env.DB_NAME ??= "test";

const { parseUpgradeOptions, runMigrationSteps } = await import(
  "../../scripts/upgrade-database.js"
);

const WRITE_STATEMENT = /^(?:ALTER|CREATE|UPDATE|INSERT|DROP)\b/i;

function fakeConnection() {
  const statements = [];
  return {
    statements,
    async execute(sql) {
      statements.push(sql.trim());
      return [[], []];
    },
  };
}

function fakeMigration(name, { checked, migrated } = {}) {
  return {
    name,
    async check(connection) {
      checked?.push(name);
      await connection.execute("SELECT 1");
      return false;
    },
    async migrate(connection) {
      migrated?.push(name);
      await connection.execute("ALTER TABLE sample ADD COLUMN value INT");
    },
  };
}

test("--dry-run checks pending migrations without executing writes", async () => {
  const connection = fakeConnection();
  const migrations = [fakeMigration("add test column")];
  const options = parseUpgradeOptions(["--dry-run"]);

  const results = await runMigrationSteps(connection, { ...options, migrations });

  assert.deepEqual(results.pending, ["add test column"]);
  assert.deepEqual(results.applied, []);
  assert.equal(
    connection.statements.some(statement => WRITE_STATEMENT.test(statement)),
    false,
    "dry-run must never execute a DDL/DML statement",
  );
});

test("--step matches one case-insensitive name substring and skips the other two", async () => {
  const checked = [];
  const migrated = [];
  const connection = fakeConnection();
  const migrations = [
    fakeMigration("first migration", { checked, migrated }),
    fakeMigration("Target migration", { checked, migrated }),
    fakeMigration("last migration", { checked, migrated }),
  ];
  const options = parseUpgradeOptions(["--step", "tArGeT"]);

  const results = await runMigrationSteps(connection, { ...options, migrations });

  assert.deepEqual(checked, ["Target migration"]);
  assert.deepEqual(migrated, ["Target migration"]);
  assert.deepEqual(results.applied, ["Target migration"]);
  assert.deepEqual(results.skipped, ["first migration", "last migration"]);
});

test("--step with --dry-run checks only the match and neither writes nor applies", async () => {
  const checked = [];
  const migrated = [];
  const connection = fakeConnection();
  const migrations = [
    fakeMigration("first migration", { checked, migrated }),
    fakeMigration("Target migration", { checked, migrated }),
    fakeMigration("last migration", { checked, migrated }),
  ];
  const options = parseUpgradeOptions(["--step", "target", "--dry-run"]);

  const results = await runMigrationSteps(connection, { ...options, migrations });

  assert.deepEqual(checked, ["Target migration"]);
  assert.deepEqual(migrated, []);
  assert.deepEqual(results.pending, ["Target migration"]);
  assert.deepEqual(results.applied, []);
  assert.deepEqual(results.skipped, ["first migration", "last migration"]);
  assert.equal(
    connection.statements.some(statement => WRITE_STATEMENT.test(statement)),
    false,
    "combined dry-run must never execute a DDL/DML statement",
  );
});
