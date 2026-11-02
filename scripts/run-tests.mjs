#!/usr/bin/env node
/**
 * issue #1253 —— `npm test` 的真聚合入口
 *
 * 由来：`npm test` 长期是 `echo "Error: no test specified" && exit 1`，事实上的闸只有
 * `test:llm-kit` / `test:store-contract` 两个**手写文件名清单**的脚本。手维护清单的
 * 后果是每加一个测试就得记得改 package.json，忘了就静默漏跑——本单就是这么攒出
 * 28 个「存在但永不运行」的文件的。
 *
 * 本脚本的设计约束（issue #1253）：
 *   1. **文件清单从磁盘发现**，不接受任何手填清单：`tests/**\/*.test.{js,mjs}`；
 *   2. **缺环境变量大声失败**：DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME 缺任一个
 *      就打印缺哪几个并非零退出，绝不静默跳过（`test:llm-kit` 的 49 个文件里有一半
 *      要真连库，缺变量时「0 失败」是假绿）；
 *   3. **隔离是显式记账**：长期红的文件登记在 `tests/QUARANTINE.mjs`，本脚本把它们
 *      排除在实跑之外，但**逐条打印**（跑多少 / 隔离多少 / 失败明细），并另给
 *      `--verify-quarantine` 把隔离项真跑一遍，防止隔离名单只增不减；
 *   4. **串行**：沿用 `test:llm-kit` 的 `--test-concurrency=1`（共享 llm_kit_test 库，
 *      其中 `transcript-rounds-ddl.test.mjs` 会 DROP/重建两张新表，文件之间必须串行）；
 *   5. **已知 skip-pattern 原样继承**：`test:llm-kit` / `test:store-contract` 里的
 *      `--test-skip-pattern` 一条都不放宽，本脚本用**同一份字符串**（守卫格
 *      `tests/quarantine-manifest.test.mjs` 断言它与 package.json 逐字相等）。
 *
 * 用法：
 *   node scripts/run-tests.mjs                     # 等价 npm run test:all / npm test
 *   node scripts/run-tests.mjs --list              # 只打印发现/隔离/实跑清单，不跑
 *   node scripts/run-tests.mjs --verify-quarantine # 把隔离项真跑一遍，报「哪些已经能过」
 *   node scripts/run-tests.mjs --include-quarantine# 连隔离项一起跑（诊断用，不作闸）
 *   node scripts/run-tests.mjs --no-lock           # 跳过跨进程互斥锁（诊断用）
 *
 * 退出码：0 = 通过；1 = 有失败（或隔离项已转绿，见 --verify-quarantine）；2 = 用法/环境错误。
 */

import { spawnSync } from 'node:child_process';
import {
  readdirSync,
  statSync,
  existsSync,
  openSync,
  writeSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TESTS_DIR = join(ROOT, 'tests');
const QUARANTINE_PATH = join(TESTS_DIR, 'QUARANTINE.mjs');

/**
 * 已知 skip-pattern —— 与 `package.json` 的 `test:llm-kit` / `test:store-contract`
 * **逐字相同**（守卫格钉死）。含义：这批 run snapshot / run-state 用例要的存储面
 * 尚未落地，两个既有脚本早已显式跳过；聚合入口继承同一口径，既不放宽也不扩大。
 * 注意：实测当前匹配 **0** 个用例（`# skipped 0`），即这条 pattern 目前是惰性的，
 * 保留它是为了「一条都不许放宽」的等价性，而不是为了掩盖红。
 */
export const KNOWN_SKIP_PATTERN =
  'run snapshot 往返保真与 latest-only 覆盖语义$|run snapshot 未知 runId 返回 undefined$|run snapshot/run-state 多 runId 隔离$|新写入的 run-state 快照不包含终态 state$|run snapshot/run-state 写失败向上抛出$|run-state 快照保真且终态独立读取$|run-state 未知 runId 返回 undefined$';

/** 多数用例要真连库；缺了就是假绿，必须大声失败。 */
export const REQUIRED_ENV = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];

/** 只认 `*.test.js` / `*.test.mjs`（与 issue #1253 的口径一致）。 */
const TEST_FILE_RE = /\.test\.(?:js|mjs)$/;

// ---------------------------------------------------------------------------
// 发现 / 清单
// ---------------------------------------------------------------------------

/** 从磁盘递归发现测试文件（返回仓库相对路径，POSIX 分隔符，字典序）。 */
export function discoverTestFiles(dir = TESTS_DIR, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverTestFiles(full, acc);
    } else if (entry.isFile() && TEST_FILE_RE.test(entry.name)) {
      acc.push(relative(ROOT, full).split(sep).join('/'));
    }
  }
  return acc.sort();
}

/** 读隔离清单并做**入口侧**校验（守卫格另有一份更细的断言）。 */
export async function loadQuarantine(path = QUARANTINE_PATH) {
  if (!existsSync(path)) {
    throw new Error(`隔离清单不存在：${path}`);
  }
  const mod = await import(pathToFileURL(path).href);
  const list = mod.default;
  if (!Array.isArray(list)) {
    throw new Error(`${path} 的默认导出必须是数组`);
  }
  const seen = new Set();
  const problems = [];
  for (const [index, item] of list.entries()) {
    const label = `QUARANTINE[${index}]`;
    if (!item || typeof item !== 'object') {
      problems.push(`${label} 不是对象`);
      continue;
    }
    for (const key of ['file', 'reason', 'issue', 'symptom']) {
      if (typeof item[key] !== 'string' || item[key].trim() === '') {
        problems.push(`${label}.${key} 必须是非空字符串`);
      }
    }
    if (typeof item.file === 'string') {
      if (seen.has(item.file)) problems.push(`${label}.file 重复：${item.file}`);
      seen.add(item.file);
      if (!existsSync(join(ROOT, item.file))) {
        problems.push(`${label}.file 在磁盘上不存在：${item.file}`);
      }
      if (!TEST_FILE_RE.test(item.file)) {
        problems.push(`${label}.file 不是 *.test.{js,mjs}：${item.file}`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`隔离清单不合法（tests/QUARANTINE.mjs）：\n  - ${problems.join('\n  - ')}`);
  }
  return list;
}

// ---------------------------------------------------------------------------
// 跨进程互斥锁
// ---------------------------------------------------------------------------

/**
 * 共享库互斥锁。由来（本单实测）：宿主上多个 worktree 会同时跑同一套 llm_kit_test
 * 契约测试，`transcript-rounds-ddl.test.mjs` 的 DROP/重建窗口一旦与别的进程重叠，
 * 对方就会撞 `Table 'llm_kit_test.agent_transcript_rounds' doesn't exist` 或
 * `Deadlock found when trying to get lock`——**同一份代码同一份库，两次跑结果不同**。
 * 锁按 (DB_HOST, DB_PORT, DB_NAME) 取，跨 worktree 共享；拿不到就等，等不到就报错。
 */
function lockPathFor(env) {
  const key = `${env.DB_HOST || 'localhost'}_${env.DB_PORT || '3306'}_${env.DB_NAME || 'unknown'}`
    .replace(/[^\w.-]/g, '_');
  return join(tmpdir(), `touwaka-test-all-${key}.lock`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(env, { timeoutMs = 30 * 60 * 1000 } = {}) {
  const path = lockPathFor(env);
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, `${process.pid}\n`);
      closeSync(fd);
      return { path, release: () => { try { unlinkSync(path); } catch { /* 已被清理 */ } } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // 陈旧锁：持有者进程已死，或锁文件超过 6 小时（进程号可能被复用）。
      let stale = false;
      try {
        const holder = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
        const ageMs = Date.now() - statSync(path).mtimeMs;
        stale = !pidAlive(holder) || ageMs > 6 * 60 * 60 * 1000;
        if (stale) unlinkSync(path);
      } catch {
        // 读到一半锁被释放：直接重试。
      }
      if (stale) continue;
      if (Date.now() > deadline) {
        throw new Error(`等待测试库互斥锁超时（${path}）：另一个 test:all 正在跑同一份库`);
      }
      if (!announced) {
        announced = true;
        console.log(`[test:all] 等待互斥锁 ${path}（另一个 test:all 正在跑同一份测试库）…`);
      }
      sleepSync(2000);
    }
  }
}

// ---------------------------------------------------------------------------
// 环境闸门
// ---------------------------------------------------------------------------

export function missingEnv(env = process.env, required = REQUIRED_ENV) {
  return required.filter((key) => typeof env[key] !== 'string' || env[key].trim() === '');
}

// ---------------------------------------------------------------------------
// 跑 / 解析
// ---------------------------------------------------------------------------

function nodeTestArgs(files, { skipPattern }) {
  const args = ['--test', '--test-concurrency=1'];
  if (skipPattern) args.push(`--test-skip-pattern=${skipPattern}`);
  return args.concat(files);
}

function runNodeTest(files, { skipPattern = KNOWN_SKIP_PATTERN } = {}) {
  const result = spawnSync(process.execPath, nodeTestArgs(files, { skipPattern }), {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    env: process.env,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    command: `${process.execPath} ${nodeTestArgs(files, { skipPattern }).join(' ')}`,
  };
}

/**
 * 抽「第一句真正的诊断」：TAP 的 `error: 'test failed'` 对 import 失败没有信息量，
 * 真因在它上面的 `# Error [ERR_MODULE_NOT_FOUND]: ...` 里（或脚本自己的 `❌ ...`）。
 */
export function firstDiagnosticLine(output) {
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('ok ') || line.startsWith('not ok ')) continue;
    if (/^# Subtest: /.test(line) || /^TAP version/.test(line) || /^# (tests|pass|fail|suites|skipped|cancelled|todo|duration_ms)\b/.test(line)) {
      continue;
    }
    const stripped = line.replace(/^#\s*/, '');
    if (/❌/.test(stripped)) return stripped;
    if (/^(?:[A-Za-z_$][\w$]*)?(?:Error|Exception)(?: \[[A-Z0-9_]+\])?: /.test(stripped)) return stripped;
    if (/^Cannot find (?:module|package) /.test(stripped)) return stripped;
  }
  return null;
}

/** 解析 TAP：汇总计数 + 逐条失败（名字 / 文件 / 首行报错）。 */
export function parseTap(output) {
  const lines = output.split('\n');
  const summary = { tests: 0, pass: 0, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
  const failures = [];
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const count = /^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/.exec(line);
    if (count) {
      summary[count[1]] = Number.parseInt(count[2], 10);
      continue;
    }
    const notOk = /^not ok \d+ - (.*)$/.exec(line);
    if (notOk) {
      current = { name: notOk[1], file: null, error: null };
      failures.push(current);
      continue;
    }
    if (/^ok \d+/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const location = /^\s+location: '(.*)'$/.exec(line);
    if (location && !current.file) {
      current.file = location[1].startsWith(ROOT)
        ? relative(ROOT, location[1]).split(sep).join('/')
        : location[1];
      continue;
    }
    const err = /^\s+error: (.*)$/.exec(line);
    if (err && !current.error) {
      if (err[1].trim() === '|-' || err[1].trim() === '>-' || err[1].trim() === '') {
        // 多行 error：取紧随其后的第一行正文。
        const next = (lines[i + 1] ?? '').trim();
        current.error = next.replace(/^error:\s*/, '') || null;
      } else {
        current.error = err[1].replace(/^['"]|['"]$/g, '');
      }
      continue;
    }
    if (!current.error) {
      const boom = /^(?:#\s*)?(?:Error|TypeError|RangeError|AssertionError)[^:]*: (.*)$/.exec(line.trim());
      if (boom) current.error = boom[1];
    }
  }
  return { summary, failures };
}

function writeLog(text) {
  const path = join(tmpdir(), `touwaka-test-all-${Date.now()}.log`);
  try {
    writeFileSync(path, text);
    return path;
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`[test:all] ${message}`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function printEnvHelp(missing) {
  console.error(`[test:all] 缺少环境变量：${missing.join(', ')}`);
  console.error('[test:all] 这些变量是硬前置：多数用例要真连库，缺了跑出来的「0 失败」是假绿。');
  console.error('[test:all] 宿主机连库口径（DB_PASSWORD 从容器里取，不要手抄）：');
  console.error(
    '  export DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=touwaka DB_NAME=touwaka_mate \\\n' +
      "    DB_PASSWORD=$(docker exec touwaka-mate env | grep '^DB_PASSWORD=' | cut -d= -f2-)",
  );
  console.error('[test:all] 缺哪个就补哪个——本入口不会替你跳过任何用例。');
}

async function main(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const known = new Set([
    '--list',
    '--verify-quarantine',
    '--include-quarantine',
    '--no-lock',
    '--help',
  ]);
  const unknown = [...flags].filter((flag) => !known.has(flag));
  if (unknown.length > 0) {
    fail(`未知参数：${unknown.join(' ')}（可用：${[...known].join(' ')}）`);
  }
  if (flags.has('--help')) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return 0;
  }

  const missing = missingEnv();
  if (missing.length > 0) {
    printEnvHelp(missing);
    return 2;
  }

  const discovered = discoverTestFiles();
  let quarantine;
  try {
    quarantine = await loadQuarantine();
  } catch (error) {
    console.error(`[test:all] ${error.message}`);
    return 2;
  }

  const quarantineFiles = quarantine.map((item) => item.file);
  const quarantined = new Set(quarantineFiles);
  const unknownQuarantined = quarantineFiles.filter((file) => !discovered.includes(file));
  if (unknownQuarantined.length > 0) {
    console.error(
      `[test:all] 隔离清单里的文件不在磁盘发现集合里（清单漂了）：${unknownQuarantined.join(', ')}`,
    );
    return 2;
  }
  const runnable = discovered.filter((file) => !quarantined.has(file));

  if (flags.has('--list')) {
    console.log(`[test:all] 发现 ${discovered.length} 个测试文件（磁盘扫描 tests/**/*.test.{js,mjs}）`);
    console.log(`[test:all] 隔离 ${quarantine.length} 个（tests/QUARANTINE.mjs）`);
    console.log(`[test:all] 实跑 ${runnable.length} 个`);
    console.log('\n实跑：');
    for (const file of runnable) console.log(`  + ${file}`);
    console.log('\n隔离：');
    for (const item of quarantine) console.log(`  - ${item.file}  [${item.issue}] ${item.symptom}`);
    return 0;
  }

  if (flags.has('--verify-quarantine')) {
    return verifyQuarantine(quarantine);
  }

  const targets = flags.has('--include-quarantine') ? discovered : runnable;

  console.log(`[test:all] 发现 ${discovered.length} 个测试文件（磁盘扫描 tests/**/*.test.{js,mjs}）`);
  console.log(`[test:all] 隔离 ${quarantine.length} 个（tests/QUARANTINE.mjs，逐条见下）`);
  console.log(`[test:all] 实跑 ${targets.length} 个文件（node --test --test-concurrency=1）`);
  if (quarantine.length > 0) {
    for (const item of quarantine) {
      console.log(`  - 隔离 ${item.file}  [${item.issue}] ${item.symptom}`);
    }
  }

  let lock = null;
  if (!flags.has('--no-lock')) {
    try {
      lock = acquireLock(process.env);
    } catch (error) {
      console.error(`[test:all] ${error.message}`);
      return 2;
    }
  }

  const started = Date.now();
  let result;
  try {
    result = runNodeTest(targets);
  } finally {
    if (lock) lock.release();
  }
  const elapsedMs = Date.now() - started;
  const combined = `${result.stdout}\n${result.stderr}`;
  const logPath = writeLog(combined);
  const { summary, failures } = parseTap(combined);

  console.log('');
  console.log(
    `[test:all] 汇总：文件 ${targets.length} 跑 / ${quarantine.length} 隔离 ｜ ` +
      `用例 ${summary.tests}（pass ${summary.pass} / fail ${summary.fail} / skipped ${summary.skipped}）` +
      ` ｜ 耗时 ${(elapsedMs / 1000).toFixed(1)}s`,
  );
  if (logPath) console.log(`[test:all] 完整日志：${logPath}`);

  if (failures.length > 0) {
    console.log(`[test:all] 失败明细（${failures.length} 条）：`);
    const diagnostic = firstDiagnosticLine(combined);
    for (const failure of failures) {
      const where = failure.file ? ` @ ${failure.file}` : '';
      const reason = failure.error && failure.error !== 'test failed'
        ? failure.error
        : diagnostic;
      const why = reason ? `  ← ${reason}` : '';
      console.log(`  ✗ ${failure.name}${where}${why}`);
    }
  }

  const ok = result.status === 0 && failures.length === 0;
  if (ok) {
    console.log('[test:all] 结果：通过（隔离项见上，不在本次实跑范围内）');
    return 0;
  }
  if (failures.length === 0) {
    console.error(`[test:all] 结果：失败（node --test 退出码 ${result.status}，但 TAP 未解析到失败条目，请读日志）`);
    return 1;
  }
  console.error(`[test:all] 结果：失败（${failures.length} 条，见上）`);
  return 1;
}

/** `--verify-quarantine`：把隔离项逐个真跑，报「哪些现在其实已经能过」（该解除隔离）。 */
function verifyQuarantine(quarantine) {
  console.log(`[test:all] --verify-quarantine：逐个真跑 ${quarantine.length} 个隔离文件（不作闸）`);
  const rows = [];
  for (const item of quarantine) {
    const started = Date.now();
    const result = runNodeTest([item.file], { skipPattern: null });
    const combined = `${result.stdout}\n${result.stderr}`;
    const { summary, failures } = parseTap(combined);
    const green = result.status === 0 && summary.fail === 0 && failures.length === 0;
    const diagnostic = firstDiagnosticLine(combined);
    const firstError = failures[0]?.error && failures[0].error !== 'test failed'
      ? failures[0].error
      : diagnostic;
    rows.push({
      file: item.file,
      green,
      status: result.status,
      summary,
      firstError,
      elapsedMs: Date.now() - started,
      log: writeLog(combined),
    });
    const mark = green ? '✅ 已能过（该解除隔离）' : '❌ 仍红';
    console.log(`  ${mark} ${item.file}  rc=${result.status} tests=${summary.tests} fail=${summary.fail}`);
    if (!green && failures[0]) {
      console.log(`      首条失败：${failures[0].name}`);
      if (firstError) console.log(`      报错首行：${firstError}`);
    }
  }

  const green = rows.filter((row) => row.green);
  console.log('');
  console.log(
    `[test:all] 隔离项复核：${rows.length} 个中 ${green.length} 个已能过 / ${rows.length - green.length} 个仍红`,
  );
  if (green.length > 0) {
    console.log('[test:all] 以下隔离项已转绿，应解除隔离（tests/QUARANTINE.mjs 删掉对应条目）：');
    for (const row of green) console.log(`  - ${row.file}`);
    return 1;
  }
  console.log('[test:all] 全部隔离项仍红：隔离名单没有虚胖');
  return 0;
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
