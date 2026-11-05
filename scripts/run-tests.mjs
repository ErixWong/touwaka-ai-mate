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
 * issue #1280（计数与 rc 的真实性）追加的约束：
 *   6. **两种 reporter 都认**：TAP（`# tests N` / `not ok N - 名字`，Node 22 默认）与
 *      spec（`ℹ tests N` / `✖ 名字`，Node 24 默认）都能解析——选双解析而不是强制
 *      `--test-reporter=tap`，理由见「输出解析」小节；
 *   7. **「一条都没读到」必须判红**：解析到 0 个用例 / 汇总缺项 / 汇总自相矛盾 /
 *      用例数比实跑文件数还少 / fail>0 却没有失败明细，任何一条都非零退出。
 *      `0` 永远不许读成「全绿」；截断的输出判「没读到」，**不补默认值 0**。
 *
 * 用法：
 *   node scripts/run-tests.mjs                     # 等价 npm run test:all / npm test
 *   node scripts/run-tests.mjs --list              # 只打印发现/隔离/实跑清单，不跑
 *   node scripts/run-tests.mjs --verify-quarantine # 把隔离项真跑一遍，报「哪些已经能过」
 *   node scripts/run-tests.mjs --include-quarantine# 连隔离项一起跑（诊断用，不作闸）
 *   node scripts/run-tests.mjs --no-lock           # 跳过跨进程互斥锁（诊断用）
 *
 * 退出码：0 = 通过（且计数真的读到了）；1 = 有失败 / 计数不可信（见约束 7）；2 = 用法/环境错误。
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
 * 实测（issue #1253 第 1 阶段，别被 `# skipped 0` 骗了）：这条 pattern **不是惰性的**——
 * 它把 7 个用例整条从运行里摘掉（`test:llm-kit` 535 → 528 例），而 `# skipped` 仍报 0：
 * node 的 `--test-skip-pattern` 是**过滤**不是 skip，被摘掉的用例在 TAP 里完全不留痕。
 * 摘掉的 7 条里 6 条现在会红（run snapshot / run-state 六条），1 条会过
 * （`run snapshot/run-state 写失败向上抛出`）。这是本单**继承**的既有口径，
 * 第 2 阶段要不要动它由 Eric 定；本阶段一条未改。
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

// ---------------------------------------------------------------------------
// 输出解析（issue #1280：两种 reporter 都要认）
// ---------------------------------------------------------------------------
//
// 由来：`node --test` 的**默认 reporter 随版本变了**。Node 22 默认 TAP
// （`# tests 682` / `not ok 3 - 名字`），Node 24 默认 spec（`ℹ tests 682` / `✖ 名字 (1.2ms)`）。
// 老解析器只认 TAP，于是在 Node 24 上**一个用例都没读到**，`summary` 全 0 而 rc=0
// ——`npm test` 报「用例 0」还判通过（issue #1280 的形态：计数假、rc 也假）。
//
// 选型（为什么双解析，而不是强制 `--test-reporter=tap`）：
//   1. 强制 tap 会让**生产路径**与默认 reporter 脱钩：本仓 dev 手跑 `node --test` 看到的是
//      spec，闸里看到的却是 tap，两边形状不同反而更容易再漂；
//   2. 双解析让「spec 解析」成为 Node 24 上**真正被每次 npm test 走到的路径**，
//      不是只有单测喂样本才碰的死代码；
//   3. 不依赖 reporter 旗标名（`--test-reporter` 的可用值随版本增删过），少一个可漂的假设。
//
// 计数语义（判据 2 的根）：`null` = **没读到**，`0` = 真读到 0。二者绝不互相顶替——
// 截断的输出必须判「没读到」，不许补默认值 0。

const SUMMARY_KEYS = ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'];
/** 判定「这次跑出来的数字能不能当结论」时**必须**读到的三个计数器。 */
const GATE_SUMMARY_KEYS = ['tests', 'pass', 'fail'];

const TAP_SUMMARY_RE = /^# (tests|pass|fail|skipped|cancelled|todo) (\d+)$/;
/** spec reporter 的汇总行：`ℹ tests 682`（U+2139 + 空格）。 */
const SPEC_SUMMARY_RE = /^\u2139 (tests|pass|fail|skipped|cancelled|todo) (\d+)$/;
const SPEC_FAILING_HEADER_RE = /^✖ failing tests:\s*$/;
const SPEC_FAILURE_LOCATION_RE = /^test at (.+?):(\d+):(\d+)$/;
const SPEC_FAILURE_NAME_RE = /^✖ (.*?)(?: \(\d+(?:\.\d+)?ms\))?$/;

function emptySummary() {
  const summary = {};
  for (const key of SUMMARY_KEYS) summary[key] = null;
  return summary;
}

/**
 * 把 `location` / `test at` 的路径归一到「仓库相对路径」：两种方言都带 `:行:列` 尾巴，
 * 去掉才能和磁盘发现的文件清单对上（`filesWithoutTrace` 就靠这个字符串包含关系）。
 */
function normalizeLocation(path) {
  const bare = path.replace(/:\d+:\d+$/, '');
  return bare.startsWith(ROOT) ? relative(ROOT, bare).split(sep).join('/') : bare;
}

/** TAP 方言：汇总 `# tests N` + 逐条 `not ok N - 名字`（含 location / error 明细）。 */
function parseTapDialect(lines) {
  const summary = emptySummary();
  const failures = [];
  let summaryIndex = -1;
  let current = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const count = TAP_SUMMARY_RE.exec(line);
    if (count) {
      summary[count[1]] = Number.parseInt(count[2], 10);
      summaryIndex = i;
      continue;
    }
    const notOk = /^not ok \d+ - (.*)$/.exec(line);
    if (notOk) {
      // TAP 会把名字开头的 `#` 转义成 `\#`（否则会被当成注释行）：还原一下，
      // 不然同一批失败在 TAP 与 spec 两个版本下名字不一样，逐名对账对不上。
      current = { name: notOk[1].replace(/\\#/g, '#'), file: null, error: null };
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
      current.file = normalizeLocation(location[1]);
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
  return { dialect: 'tap', sawSummary: summaryIndex >= 0, summaryIndex, summary, failures };
}

/**
 * spec 方言的失败明细。**只扫末尾 `✖ failing tests:` 段**：spec 在跑到失败时已经
 * 就地打过一次 `✖ 名字 (xms)`，段内会再打一次；只扫段内才不会把一条失败数成两条。
 */
function parseSpecFailures(lines) {
  const sectionStart = lines.findIndex((line) => SPEC_FAILING_HEADER_RE.test(line));
  if (sectionStart === -1) return [];
  const failures = [];
  let current = null;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const at = SPEC_FAILURE_LOCATION_RE.exec(line);
    if (at) {
      current = { name: null, file: normalizeLocation(at[1]), error: null };
      failures.push(current);
      continue;
    }
    if (!current) continue;
    if (current.name === null) {
      const head = SPEC_FAILURE_NAME_RE.exec(line);
      if (head) current.name = head[1];
      continue;
    }
    if (current.error !== null) continue;
    if (line.trim() === '') continue;
    if (/^\s{2,}\S/.test(line)) {
      current.error = line.trim().replace(/^['"]|['"]$/g, '');
    }
  }
  // 名字没读到就退回文件名（spec 对「整个文件 import 失败」就是这么打的）。
  for (const failure of failures) {
    if (failure.name === null) failure.name = failure.file ?? '(未命名失败)';
  }
  return failures;
}

/** spec 方言：汇总 `ℹ tests N` + 末尾失败段。 */
function parseSpecDialect(lines) {
  const summary = emptySummary();
  let summaryIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const count = SPEC_SUMMARY_RE.exec(lines[i]);
    if (!count) continue;
    summary[count[1]] = Number.parseInt(count[2], 10);
    summaryIndex = i;
  }
  const failures = parseSpecFailures(lines);
  return { dialect: 'spec', sawSummary: summaryIndex >= 0, summaryIndex, summary, failures };
}

/**
 * 解析 `node --test` 的输出：TAP 与 spec 两种方言都认（issue #1280）。
 *
 * 两套汇总块同时出现时以**更靠后**的为准：node 自己的汇总永远在输出末尾，靠前的
 * 只可能是用例自己打印的噪音（测试里 echo 一行 `# tests 3` 之类）。
 *
 * 返回的 `summary` 里 `null` 表示**没读到**（不是 0）；`missingCounters` 列出
 * 闸门必须读到的计数里缺了哪些。
 */
export function parseTestOutput(output) {
  const lines = String(output ?? '').split('\n');
  const tap = parseTapDialect(lines);
  const spec = parseSpecDialect(lines);

  let chosen = null;
  if (tap.sawSummary && spec.sawSummary) {
    chosen = spec.summaryIndex > tap.summaryIndex ? spec : tap;
  } else if (tap.sawSummary) {
    chosen = tap;
  } else if (spec.sawSummary) {
    chosen = spec;
  }

  if (!chosen) {
    return {
      dialect: null,
      sawSummary: false,
      summary: emptySummary(),
      failures: [],
      missingCounters: [...GATE_SUMMARY_KEYS],
    };
  }
  return {
    dialect: chosen.dialect,
    sawSummary: true,
    summary: chosen.summary,
    failures: chosen.failures,
    missingCounters: GATE_SUMMARY_KEYS.filter((key) => chosen.summary[key] === null),
  };
}

/**
 * 判「这次跑出来的数字能不能当结论」。**`0` 永远不许读成「全绿」**（issue #1280 的形态）。
 *
 * 任一条成立即判红（返回非空 reasons）：
 *   1. 没读到汇总（reporter 变了 / 输出被截断 / 进程被杀）；
 *   2. 汇总缺项（`tests` / `pass` / `fail` 有没读到的——缺项不补 0）；
 *   3. 解析到 0 个用例；
 *   4. 解析到的用例数比实跑文件数还少（每个文件至少贡献 1 条）；
 *   5. 汇总自相矛盾（tests ≠ pass+fail+skipped+cancelled+todo）；
 *   6. 汇总说 fail>0，却一条失败明细都没解析到；
 *   7. node --test 退出码非 0 / 被信号杀掉。
 */
export function assessRun({ status, signal = null, targets = [], parsed }) {
  const reasons = [];
  const { summary, failures, missingCounters, sawSummary } = parsed;

  if (!sawSummary) {
    reasons.push(
      '没读到汇总：输出里既没有 TAP 的 "# tests N" 也没有 spec 的 "ℹ tests N"' +
        '（reporter 换了 / 输出被截断 / 进程被杀）',
    );
  } else {
    if (missingCounters.length > 0) {
      reasons.push(`汇总缺项：没读到 ${missingCounters.join(' / ')}（缺项按「没读到」处理，绝不补 0）`);
    }
    if (summary.tests === 0) {
      reasons.push(`解析到 0 个用例（本次实跑 ${targets.length} 个文件）：0 永远不是「全绿」`);
    }
    if (summary.tests !== null && targets.length > 0 && summary.tests < targets.length) {
      reasons.push(
        `解析到的用例数（${summary.tests}）比实跑文件数（${targets.length}）还少：` +
          '每个文件至少贡献 1 条，少说明有文件根本没报数',
      );
    }
    const additive = ['pass', 'fail', 'skipped', 'cancelled', 'todo'].map((key) => summary[key]);
    if (summary.tests !== null && additive.every((value) => value !== null)) {
      const summed = additive.reduce((total, value) => total + value, 0);
      if (summed !== summary.tests) {
        reasons.push(
          `汇总自相矛盾：tests=${summary.tests}，但 pass+fail+skipped+cancelled+todo=${summed}`,
        );
      }
    }
    if (summary.fail !== null && summary.fail > 0 && failures.length === 0) {
      reasons.push(`汇总说 fail=${summary.fail}，却一条失败明细都没解析到（不许当通过）`);
    }
  }
  if (signal) reasons.push(`node --test 被信号 ${signal} 终止`);
  if (status !== 0) reasons.push(`node --test 退出码 ${status}`);

  return { ok: reasons.length === 0, reasons };
}

/**
 * 哪些实跑文件在输出里**查不到任何记录**（判红时用来点名「哪个文件没报数」）。
 *
 * 事实边界：node 的聚合 reporter（TAP / spec 都一样）只在**失败**或**脚本式文件**
 * （整个文件就是一条用例）时打出文件名，正常多用例文件不带文件名——所以这里能给的
 * 是「完全没留下痕迹的文件」，不是「每文件用例数」。拿不到就说拿不到，不编。
 */
export function filesWithoutTrace(output, targets) {
  const text = String(output ?? '');
  return targets.filter((file) => !text.includes(file));
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
  const parsed = parseTestOutput(combined);
  const { summary, failures } = parsed;
  const verdict = assessRun({ status: result.status, signal: result.signal, targets, parsed });
  const shown = (value) => (value === null ? '未读到' : String(value));

  console.log('');
  console.log(
    `[test:all] 汇总：文件 ${targets.length} 跑 / ${quarantine.length} 隔离 ｜ ` +
      `用例 ${shown(summary.tests)}（pass ${shown(summary.pass)} / fail ${shown(summary.fail)} / skipped ${shown(summary.skipped)}）` +
      ` ｜ 耗时 ${(elapsedMs / 1000).toFixed(1)}s`,
  );
  console.log(`[test:all] 输出方言：${parsed.dialect ?? '未识别（两种 reporter 的汇总都没读到）'}`);
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

  if (verdict.ok) {
    console.log('[test:all] 结果：通过（隔离项见上，不在本次实跑范围内）');
    return 0;
  }

  console.error(`[test:all] 结果：失败（${verdict.reasons.length} 条判定理由）：`);
  for (const reason of verdict.reasons) console.error(`  ✗ ${reason}`);
  // 只在「计数本身不可信」时才点名文件：普通用例失败时逐条列 78 个「无痕迹文件」
  // 只是噪音（聚合 reporter 本来就不打全绿文件名），失败明细已经在上面。
  const countingBroken =
    !parsed.sawSummary ||
    parsed.missingCounters.length > 0 ||
    summary.tests === null ||
    summary.tests === 0 ||
    summary.tests < targets.length;
  const untraced = countingBroken ? filesWithoutTrace(combined, targets) : [];
  if (untraced.length > 0) {
    console.error(`[test:all] 以下 ${untraced.length} 个实跑文件在输出里查不到任何记录（无法确认它们报过数）：`);
    for (const file of untraced.slice(0, 20)) console.error(`  ? ${file}`);
    if (untraced.length > 20) console.error(`  …还有 ${untraced.length - 20} 个（完整清单见日志：${logPath ?? '未落盘'}）`);
  }
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
    const parsed = parseTestOutput(combined);
    const { summary, failures } = parsed;
    // 「转绿」必须是**真读到**的绿：0 用例 / 汇总缺项一律不算过（issue #1280）。
    const green =
      result.status === 0 &&
      summary.fail === 0 &&
      failures.length === 0 &&
      summary.tests !== null &&
      summary.tests > 0 &&
      parsed.missingCounters.length === 0;
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
    const shown = (value) => (value === null ? '未读到' : String(value));
    console.log(
      `  ${mark} ${item.file}  rc=${result.status} tests=${shown(summary.tests)} fail=${shown(summary.fail)}`,
    );
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
