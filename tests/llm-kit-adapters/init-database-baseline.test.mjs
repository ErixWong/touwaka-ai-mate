/**
 * issue #1179：空库路径的形状护栏（**纯静态，不连数据库**）
 *
 * 症状与根因（Eric 已证真）：`server/index.js` 的 `checkTablesExist()` 判据是"库里有没有
 * **任何**表"，两个分支**互斥** —— 空库 → **只**跑 `scripts/init-database.js` 就结束，
 * **有表才**走 `needsUpgrade()` / `upgrade()`。于是空库路径永远不跑增量迁移、缺口不自愈：
 * `agent_rounds` / `chat_tool_calls` 只写在 upgrade 里 ⇒ 新装库没有它们，而 #1156 Stage A
 * 已把 `agent_transcript_rounds` / `llm_kit_run_checkpoint` 放进 init
 * ⇒ 新装库是「有 canonical、没有投影两张」的畸形形态。
 *
 * 修法与护栏一一对应（A + B 都在 `scripts/init-database.js`）：
 *   A. 两张投影表进 init 基线，且与 upgrade 步骤**逐字段**一致
 *        → 断言 1 / 2 / 5 / 6
 *   B. init 收尾无条件再跑一遍 upgrade()
 *      → 断言 4（今后任何"只写进一侧"的迁移都不再漏）
 *   断言 3 是**集合覆盖 + 只许缩小的冻结清单**：upgrade 的每个建表目标表必须
 *   被 init 基线覆盖，否则必须在 `KNOWN_UPGRADE_ONLY_TABLES` 里显式登记理由。
 *
 * 本文件**刻意不连库**（无凭据的 CI 也一定真跑）。真库验证（临时库四表齐全、逐列逐索引
 * 与 dev 库 0 差异、二次 upgrade 全 Skipped、DROP 后无残留）写在 issue #1179 的执行报告里。
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// upgrade-database.js 在**模块加载时**就读 DB_CONFIG，因此必须先塞好占位值；
// 本文件一条 SQL 都不发，占位值不需要真实存在。
process.env.DB_USER ??= 'static-no-db';
process.env.DB_PASSWORD ??= 'static-no-db';
process.env.DB_NAME ??= 'static-no-db';

// logs/ 目录可能非本用户属主，屏蔽文件写入（与既有测试同一手法）。
import logger from '../../lib/logger.js';
for (const method of ['info', 'warn', 'error', 'debug']) {
  if (typeof logger[method] === 'function') logger[method] = () => {};
}

const { MIGRATIONS } = await import('../../scripts/upgrade-database.js');

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const INIT_SOURCE = readFileSync(`${REPO_ROOT}scripts/init-database.js`, 'utf-8');

/** #1179 的主角：两张投影表 + 两张 canonical，新装库必须四张齐全 */
const ERIX_TABLES = [
  'agent_rounds',
  'chat_tool_calls',
  'agent_transcript_rounds',
  'llm_kit_run_checkpoint',
];

/**
 * 历史缺口清单：**只在 upgrade 里建、不在 init 基线里**的目标表。
 *
 * #1179 之前这类缺口有 41 张（init 基线只覆盖 5/46）。本次只把 erix 两张搬进基线
 * —— 搬表要逐列比形状，其余 39 张不在 Eric 已批准的范围内，一律留给 init 收尾的
 * upgrade()（断言 4）兜住。清单**冻结且只许缩小**：新表只写进 upgrade 一侧就会让
 * 断言 3 变红，逼作者二选一（补进 init 基线 / 在清单里显式登记）。
 */
const KNOWN_UPGRADE_ONLY_TABLES = [
  'app_action_logs',
  'app_clock_registry',
  'app_contract_mgr_compares',
  'app_contract_mgr_records',
  'app_contract_mgr_v2_rows',
  'app_doc_bindings',
  'app_enterprise',
  'app_invoice_mgr_items',
  'app_invoice_mgr_records',
  'app_invoice_mgr_rows',
  'app_row_handlers',
  'app_standard',
  'app_standard_anchored_section',
  'app_standard_ref_anchor',
  'app_state',
  'app_tick_log',
  'app_tick_run',
  'attachment_token',
  'attachments',
  'chat_requests',
  'doc_compare_items',
  'doc_compare_runs',
  'doc_document_tags',
  'doc_ocr_images',
  'doc_ocr_results',
  'doc_process_runs',
  'doc_tags',
  'document_chunks',
  'document_collections',
  'document_outlines',
  'document_revisions',
  'documents',
  'mcp_credentials',
  'mcp_servers',
  'mcp_tools_cache',
  'mcp_user_credentials',
  'mini_app_files',
  'mini_app_role_access',
  'mini_app_rows',
  'mini_apps',
  'note_record',
];

/**
 * 两侧都建、但 DDL 已经漂了的历史表（逐字段比对时显式豁免）。
 * 唯一已知漂移：`user_skill_parameters.skill_id` —— init 是 VARCHAR(32)，
 * upgrade 是 VARCHAR(64)（dev 库实测 varchar(64)）。属 #1179 范围外的存量漂移，
 * 已写进执行报告，不在本单动 DDL。清单同样**只许缩小**。
 */
const KNOWN_BOTH_SIDES_DRIFT_TABLES = ['user_skill_parameters'];

/** 归一化：折叠空白、去掉 CREATE 头（与 tests/llm-kit-adapters/transcript-rounds-ddl.test.mjs 同一手法） */
function normalizeCreateTable(sql) {
  return sql
    .replace(/^\s*CREATE TABLE\s+(?:IF NOT EXISTS\s+)?/i, '')
    .replace(/\s+/g, ' ')
    .replace(/,\s*\)/g, ')')
    .trim();
}

/** 按括号配平从源码里截出某张表的 CREATE TABLE 全文 */
function extractCreateTable(source, table, where) {
  const start = source.search(
    new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?\`?${table}\`?\\s*\\(`, 'i'),
  );
  assert.ok(start >= 0, `${where} 里缺少 ${table} 的 CREATE TABLE`);
  const open = source.indexOf('(', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${where} 里 ${table} 的 CREATE TABLE 括号不闭合`);
}

/** init 基线：表名 → 归一化 DDL（TABLES 数组里的模板字符串） */
function collectInitBaseline() {
  const tables = new Map();
  for (const match of INIT_SOURCE.matchAll(/CREATE TABLE\s+IF NOT EXISTS\s+`?(\w+)`?/gi)) {
    const table = match[1];
    tables.set(
      table,
      normalizeCreateTable(extractCreateTable(INIT_SOURCE, table, 'scripts/init-database.js')),
    );
  }
  return tables;
}

/** upgrade 的全部建表动作：{ step, table, ddl }；DDL 从步骤自己的函数体里截，不做全文件搜索 */
function collectUpgradeCreateSteps() {
  const steps = [];
  for (const migration of MIGRATIONS) {
    const body = migration.migrate.toString();
    for (const match of body.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?`?(\w+)`?/gi)) {
      steps.push({
        step: migration.name,
        table: match[1],
        ddl: normalizeCreateTable(extractCreateTable(body, match[1], `upgrade 步骤「${migration.name}」`)),
      });
    }
  }
  return steps;
}

const initBaseline = collectInitBaseline();
const upgradeCreateSteps = collectUpgradeCreateSteps();

// ==================== 0. 采集器自证（否则后面的断言可能空转） ====================

test('采集器自证：init 基线与 upgrade 建表步骤都真的采到了（不是空集合）', () => {
  assert.ok(initBaseline.size >= 34, `init 基线只采到 ${initBaseline.size} 张表，解析肯定漏了`);
  assert.ok(
    upgradeCreateSteps.length >= 46,
    `upgrade 建表动作只采到 ${upgradeCreateSteps.length} 条，解析肯定漏了`,
  );
  assert.deepEqual(
    new Set(upgradeCreateSteps.map((row) => row.step)),
    new Set(
      MIGRATIONS.filter((m) => /CREATE TABLE/i.test(m.migrate.toString())).map((m) => m.name),
    ),
    '每个含 CREATE TABLE 的 upgrade 步骤都必须被采集到，少一条就是护栏有洞',
  );
});

// ==================== 1+2. erix 四张表必须同时在 init 基线里（#1179 的直接症状） ====================

test('erix 四张表全在 init 建库基线里，且每张恰好定义一次', () => {
  for (const table of ERIX_TABLES) {
    assert.ok(
      initBaseline.has(table),
      `scripts/init-database.js 缺 ${table}：空库只跑 init ⇒ 新装库永远没有这张表（#1179 复发）`,
    );
    const count = (
      INIT_SOURCE.match(
        new RegExp(`CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?\`?${table}\`?\\s*\\(`, 'gi'),
      ) ?? []
    ).length;
    assert.equal(count, 1, `init-database.js 里 ${table} 应恰好出现一次，实际 ${count}`);
  }
});

// ==================== 3. 集合覆盖：upgrade 建表目标表 ⊆ init 基线 ∪ 冻结清单 ====================

test('upgrade 每个建表目标表都被 init 基线覆盖（缺口只能等于冻结的历史清单）', () => {
  const uncovered = upgradeCreateSteps.filter((row) => !initBaseline.has(row.table));
  const gap = [...new Set(uncovered.map((row) => row.table))].sort();

  assert.deepEqual(
    gap,
    [...KNOWN_UPGRADE_ONLY_TABLES].sort(),
    'upgrade 建表目标表与 init 基线的差集变了：\n'
      + JSON.stringify(
        {
          gap,
          onlyInGapList: [...KNOWN_UPGRADE_ONLY_TABLES].sort().filter((t) => !gap.includes(t)),
          notInEither: gap.filter((t) => !KNOWN_UPGRADE_ONLY_TABLES.includes(t)),
          uncoveredSteps: uncovered.map((r) => `${r.table} <- ${r.step}`),
        },
        null,
        2,
      )
      + '\n新表请同时补进 scripts/init-database.js 基线（首选），或在 KNOWN_UPGRADE_ONLY_TABLES 里写明理由',
  );

  // erix 四张表绝不允许出现在"只写一侧"的清单里 —— 那正是 #1179 的复发形态
  assert.deepEqual(
    gap.filter((table) => ERIX_TABLES.includes(table)),
    [],
    'erix 表只在 upgrade 一侧，#1179 会复发',
  );
  // 冻结清单只许缩小：erix 表也不许被塞进漂移豁免清单
  assert.deepEqual(
    KNOWN_BOTH_SIDES_DRIFT_TABLES.filter((table) => ERIX_TABLES.includes(table)),
    [],
    'erix 表被写进了"两侧 DDL 已漂"的豁免清单，等于放弃 #1179 的逐列一致要求',
  );
});

// ==================== 4. init 收尾必须再跑一遍 upgrade()（B 项护栏） ====================

test('init 收尾无条件再跑一遍 upgrade()：谁先谁后不再影响终态，且失败不静默', () => {
  assert.match(
    INIT_SOURCE,
    /import\(\s*['"]\.\/upgrade-database\.js['"]\s*\)/,
    'init-database.js 必须引入同目录的 upgrade-database.js（#1179 的 B 项）',
  );
  assert.match(
    INIT_SOURCE,
    /await upgrade\(\s*\[\]\s*\)/,
    'init 必须显式调用 upgrade([])：空参数，避免把 init 自己的 argv 当成 --dry-run / --step',
  );
  // 顺序：必须排在建表与种子数据之后，否则列/索引步骤会打在缺失的表上
  assert.ok(
    INIT_SOURCE.indexOf('await upgrade([])') > INIT_SOURCE.indexOf('Creating tables (idempotent)'),
    'upgrade() 必须排在建表之后',
  );
  assert.ok(
    INIT_SOURCE.indexOf('await upgrade([])') > INIT_SOURCE.indexOf('system_settings initialized'),
    'upgrade() 必须排在初始数据写入之后（部分迁移步骤依赖种子数据）',
  );
  // 失败不许静默：必须有 failed 的显式处理路径
  assert.match(
    INIT_SOURCE,
    /upgradeResults\??\.failed\.length\s*>\s*0/,
    'init 必须检查 upgrade 的 failed 并让它可见，不许谎报"建库成功"',
  );
});

// ==================== 5. 双侧一致：init 基线与 upgrade 步骤逐字段相等 ====================

test('两侧都建的表，init 基线与 upgrade 步骤逐字段一致（erix 四张零豁免）', () => {
  const drift = [];
  for (const { step, table, ddl } of upgradeCreateSteps) {
    if (!initBaseline.has(table)) continue; // 只在一侧的表由断言 3 管
    if (initBaseline.get(table) === ddl) continue;
    drift.push({ table, step, init: initBaseline.get(table), upgrade: ddl });
  }

  const driftedTables = [...new Set(drift.map((row) => row.table))].sort();
  assert.deepEqual(
    driftedTables,
    [...KNOWN_BOTH_SIDES_DRIFT_TABLES].sort(),
    `两侧 DDL 漂移的表集合变了：${JSON.stringify(driftedTables)}\n${JSON.stringify(drift, null, 2)}`,
  );

  // erix 四张单独再钉一次：第 3 条可能因为"两侧都缺"而空过去，这里要求两侧都在且逐字段相等
  for (const table of ERIX_TABLES) {
    const row = upgradeCreateSteps.find((item) => item.table === table);
    assert.ok(row, `upgrade 里没有 ${table} 的建表步骤，无法与 init 基线互相印证`);
    assert.equal(initBaseline.get(table), row.ddl, `${table} 双侧 DDL 不一致：\ninit=${initBaseline.get(table)}\nupgrade=${row.ddl}`);
  }
});

// ==================== 6. AGENTS.md 红线：搬进基线时不许夹带语义变化 ====================

test('补进 init 基线的两张投影表守红线：无 TINYINT、布尔是 BIT(1)、时间列应用侧写入', () => {
  for (const table of ['agent_rounds', 'chat_tool_calls']) {
    const ddl = initBaseline.get(table);
    assert.ok(ddl, `${table} 不在 init 基线里`);
    assert.doesNotMatch(ddl, /\bTINYINT\b/i, `${table} 出现 TINYINT，违反 AGENTS.md §2.1`);
    assert.doesNotMatch(
      ddl,
      /(DEFAULT|ON UPDATE)\s+CURRENT_TIMESTAMP/i,
      `${table} 的时间列必须应用侧写入`,
    );
    for (const col of ddl.matchAll(/`?(\w+)`?\s+BIT\((\d+)\)/gi)) {
      assert.equal(col[2], '1', `${table}.${col[1]} 布尔列必须是 BIT(1)`);
    }
  }

  // 索引形状逐条钉住：投影面 dedup_key 是 UNIQUE，其余都是普通 KEY
  const rounds = initBaseline.get('agent_rounds');
  assert.match(rounds, /PRIMARY KEY \(id\)/);
  assert.match(rounds, /UNIQUE KEY uk_agent_rounds_dedup_key \(dedup_key\)/);
  assert.match(rounds, /KEY idx_agent_rounds_request \(request_id\)/);
  const calls = initBaseline.get('chat_tool_calls');
  assert.match(calls, /PRIMARY KEY \(tool_use_id\)/);
  assert.match(calls, /KEY idx_chat_tool_calls_request \(request_id\)/);
  assert.match(calls, /KEY idx_chat_tool_calls_name \(name\)/);
  assert.match(calls, /KEY idx_chat_tool_calls_is_error \(is_error\)/);
  // canonical 侧形状（#1156 决策①）没被这次搬运带偏
  assert.match(initBaseline.get('agent_transcript_rounds'), /UNIQUE KEY uk_atr_dedup_key \(dedup_key\)/);
  assert.match(initBaseline.get('agent_transcript_rounds'), /KEY idx_atr_request_round \(request_id, round_no\)/);
});
