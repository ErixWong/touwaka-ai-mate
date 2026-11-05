/**
 * issue #1280 —— 聚合入口的输出解析与「计数/rc 真实性」判据
 *
 * 症状（本单在 master `c3eab22` 上复现）：`node --test` 的**默认 reporter 随版本变了**。
 * Node 22 默认 TAP（`# tests 682`），Node 24 默认 spec（`ℹ tests 682`）。老解析器只认
 * TAP，于是 Node 24 下 `npm test` 报
 *
 *   [test:all] 汇总：文件 78 跑 / 9 隔离 ｜ 用例 0（pass 0 / fail 0 / skipped 0） ｜ 耗时 59.6s
 *   [test:all] 结果：通过
 *
 * ——真跑了 59 秒、一个用例都没读到，却判「通过」且 rc=0。计数假、rc 也假。
 *
 * 本文件钉住三条：
 *   ① 两种方言都能解析出**非零**计数（spec 样本必须解析出数字，不许 0）；
 *   ② 截断的输出必须判「没读到」（`null`），**不许补默认值 0**；
 *   ③ 0 用例 / 汇总缺项 / 自相矛盾 / 用例数少于文件数 / fail>0 无明细 —— 一律判红。
 *
 * 样本取自真机输出（Node 22.23.2 的 tap / Node 24.19.0 的 spec），另有两格**不喂固定
 * 文本**：直接 spawn 当前 node 的 `--test-reporter=spec|tap` 跑临时用例，证明样本形状
 * 与真实输出一致（防止「只把某一份样本读对了」）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseTestOutput, assessRun, filesWithoutTrace } from '../scripts/run-tests.mjs';

// ---------------------------------------------------------------------------
// 真机样本（trim 过，只删无关的 stack / 日志行，格式逐字保留）
// ---------------------------------------------------------------------------

/** Node 22 默认 reporter = TAP。 */
const TAP_SAMPLE = `TAP version 13
# Subtest: a passes one
ok 1 - a passes one
  ---
  duration_ms: 1.289292
  type: 'test'
  ...
# Subtest: b fails on purpose
not ok 2 - b fails on purpose
  ---
  duration_ms: 5.75823
  type: 'test'
  location: '/repo/tests/b.test.mjs:3:1'
  failureType: 'testCodeFailure'
  error: |-
    Expected values to be strictly equal:
    
    1 !== 2
    
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  ...
1..2
# tests 2
# suites 0
# pass 1
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 12.3
`;

/** Node 24 默认 reporter = spec（含末尾失败段）。 */
const SPEC_SAMPLE = `✔ a passes one (1.311168ms)
✔ a passes two (0.243459ms)
✖ b fails on purpose (2.658667ms)
✖ c.test.mjs (56.61205ms)
ℹ tests 4
ℹ suites 0
ℹ pass 2
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 256.403987

✖ failing tests:

test at tests/b.test.mjs:3:1
✖ b fails on purpose (2.658667ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  1 !== 2

test at tests/c.test.mjs:1:1
✖ c.test.mjs (56.61205ms)
  'test failed'
`;

/** 被截断的 spec：汇总块只打了一半（`tests` 读到了，`pass` / `fail` 没有）。 */
const TRUNCATED_SPEC_SAMPLE = `✔ a passes one (1.311168ms)
ℹ tests 682
`;

/** 被截断的 spec：连汇总都没打到（进程中途被杀 / 输出被裁）。 */
const TRUNCATED_EARLY_SAMPLE = `✔ a passes one (1.311168ms)
✔ a passes two (0.243459ms)
`;

/** spec 报「跑了 0 个用例」（0 不是全绿）。 */
const SPEC_ZERO_SAMPLE = `ℹ tests 0
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3.1
`;

/** TAP 报「跑了 0 个用例」。 */
const TAP_ZERO_SAMPLE = `TAP version 13
1..0
# tests 0
# suites 0
# pass 0
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2.4
`;

/** 汇总自相矛盾：tests=3 但分项加起来是 2。 */
const SPEC_INCONSISTENT_SAMPLE = `ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
`;

/** 汇总说 fail=1，但失败段整段丢了（被截断）。 */
const SPEC_FAIL_NO_DETAIL_SAMPLE = `✔ a passes one (1.311168ms)
✖ b fails on purpose (2.658667ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
`;

function assess(output, targets = ['tests/a.test.mjs'], status = 0) {
  const parsed = parseTestOutput(output);
  return { parsed, verdict: assessRun({ status, targets, parsed }) };
}

// ---------------------------------------------------------------------------
// ① 两种方言都能解析出非零计数
// ---------------------------------------------------------------------------

test('TAP 方言（Node 22 默认）：汇总逐项 + 失败名字/文件/首行报错', () => {
  const { parsed } = assess(TAP_SAMPLE);
  assert.equal(parsed.dialect, 'tap');
  assert.deepEqual(parsed.summary, {
    tests: 2,
    pass: 1,
    fail: 1,
    skipped: 0,
    cancelled: 0,
    todo: 0,
  });
  assert.deepEqual(parsed.missingCounters, []);
  assert.equal(parsed.failures.length, 1);
  assert.equal(parsed.failures[0].name, 'b fails on purpose');
  assert.equal(parsed.failures[0].file, '/repo/tests/b.test.mjs', 'TAP 的 location 带 :行:列，要剥掉');
  assert.match(parsed.failures[0].error, /Expected values to be strictly equal/);
});

test('spec 方言（Node 24 默认）：汇总必须解析出非零计数（本 bug 的核心）', () => {
  const { parsed, verdict } = assess(SPEC_SAMPLE, ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs'], 1);
  assert.equal(parsed.dialect, 'spec');
  assert.equal(parsed.summary.tests, 4, 'spec 的 `ℹ tests 4` 必须读成 4，不是 0');
  assert.equal(parsed.summary.pass, 2);
  assert.equal(parsed.summary.fail, 2);
  assert.equal(parsed.summary.skipped, 0);
  assert.deepEqual(parsed.missingCounters, []);
  assert.equal(parsed.failures.length, 2, '失败段里 2 条，不许把就地打的那次也算成一条');
  assert.equal(parsed.failures[0].name, 'b fails on purpose');
  assert.equal(parsed.failures[0].file, 'tests/b.test.mjs');
  assert.match(parsed.failures[0].error, /Expected values to be strictly equal/);
  assert.equal(parsed.failures[1].name, 'c.test.mjs', '整个文件 import 失败时名字退回文件名');
  assert.equal(parsed.failures[1].file, 'tests/c.test.mjs');
  assert.equal(verdict.ok, false, 'fail=2 必须判红');
  assert.ok(verdict.reasons.some((reason) => /退出码 1/.test(reason)), JSON.stringify(verdict.reasons));
});

test('同一批用例的 TAP 与 spec 输出给出相同计数（两种方言口径一致）', () => {
  const tap = parseTestOutput(TAP_SAMPLE).summary;
  const spec = parseTestOutput(SPEC_SAMPLE).summary;
  // TAP 样本是 2 例（1 过 1 挂），spec 样本是同一批 + 一个 import 失败的文件：只比口径，不比样本。
  assert.equal(tap.pass + tap.fail + tap.skipped, tap.tests);
  assert.equal(spec.pass + spec.fail + spec.skipped, spec.tests);
  assert.deepEqual(Object.keys(tap), Object.keys(spec));
});

test('两种方言的汇总块同时出现时，以更靠后的为准（用例自己 echo 的噪音不算数）', () => {
  const noisy = `# tests 999\n${SPEC_SAMPLE}`;
  const { parsed } = assess(noisy, ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/c.test.mjs'], 1);
  assert.equal(parsed.dialect, 'spec');
  assert.equal(parsed.summary.tests, 4);
});

// ---------------------------------------------------------------------------
// ② 截断 ⇒ 判「没读到」，不许补 0
// ---------------------------------------------------------------------------

test('截断的汇总：没读到的计数是 null（不是 0），并点名缺了哪几项', () => {
  const { parsed, verdict } = assess(TRUNCATED_SPEC_SAMPLE, ['tests/a.test.mjs']);
  assert.equal(parsed.summary.tests, 682, '读到的要保留');
  assert.equal(parsed.summary.pass, null, '没读到的 pass 必须是 null，不许补 0');
  assert.equal(parsed.summary.fail, null, '没读到的 fail 必须是 null，不许补 0');
  assert.deepEqual(parsed.missingCounters, ['pass', 'fail']);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => /汇总缺项/.test(reason) && /pass/.test(reason)),
    JSON.stringify(verdict.reasons),
  );
});

test('汇总整段没读到：判「没读到汇总」，不是判「0 用例通过」', () => {
  const { parsed, verdict } = assess(TRUNCATED_EARLY_SAMPLE, ['tests/a.test.mjs']);
  assert.equal(parsed.sawSummary, false);
  assert.equal(parsed.dialect, null);
  assert.equal(parsed.summary.tests, null);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => /没读到汇总/.test(reason)),
    JSON.stringify(verdict.reasons),
  );
});

test('空输出同样是「没读到」，不是「0 用例通过」', () => {
  const { verdict } = assess('', ['tests/a.test.mjs']);
  assert.equal(verdict.ok, false);
});

// ---------------------------------------------------------------------------
// ③ 0 用例 / 自相矛盾 / fail 无明细 —— 一律判红
// ---------------------------------------------------------------------------

test('spec 报 0 用例：必须判红（0 永远不是全绿）', () => {
  const { parsed, verdict } = assess(SPEC_ZERO_SAMPLE, ['tests/a.test.mjs']);
  assert.equal(parsed.summary.tests, 0);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => /解析到 0 个用例/.test(reason)),
    JSON.stringify(verdict.reasons),
  );
});

test('TAP 报 0 用例：同样判红（旧实现正是在这里读成「全绿」）', () => {
  const { parsed, verdict } = assess(TAP_ZERO_SAMPLE, ['tests/a.test.mjs']);
  assert.equal(parsed.summary.tests, 0);
  assert.equal(verdict.ok, false);
});

test('用例数比实跑文件数还少：判红（有文件根本没报数）', () => {
  const { verdict } = assess(SPEC_SAMPLE, [
    'tests/a.test.mjs',
    'tests/b.test.mjs',
    'tests/c.test.mjs',
    'tests/d.test.mjs',
    'tests/e.test.mjs',
  ], 1);
  assert.ok(
    verdict.reasons.some((reason) => /比实跑文件数/.test(reason)),
    JSON.stringify(verdict.reasons),
  );
});

test('汇总自相矛盾（tests ≠ 分项之和）：判红', () => {
  const { verdict } = assess(SPEC_INCONSISTENT_SAMPLE, ['tests/a.test.mjs']);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => /汇总自相矛盾/.test(reason)),
    JSON.stringify(verdict.reasons),
  );
});

test('汇总说 fail=1 却没有失败明细：判红（不许把「没读到明细」当通过）', () => {
  const { parsed, verdict } = assess(SPEC_FAIL_NO_DETAIL_SAMPLE, ['tests/a.test.mjs']);
  assert.equal(parsed.summary.fail, 1);
  assert.equal(parsed.failures.length, 0);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => /fail=1，却一条失败明细都没解析到/.test(reason)),
    JSON.stringify(verdict.reasons),
  );
});

test('计数与 rc 都对得上时才判过（spec，全绿）', () => {
  const green = `✔ a passes one (1.311168ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
`;
  const { verdict } = assess(green, ['tests/a.test.mjs']);
  assert.deepEqual(verdict, { ok: true, reasons: [] });
});

test('rc 非 0 就判红，哪怕计数看起来全绿（rc 是独立的一条证据）', () => {
  const green = `ℹ tests 1
ℹ pass 1
ℹ fail 0
ℹ skipped 0
ℹ cancelled 0
ℹ todo 0
`;
  const { verdict } = assess(green, ['tests/a.test.mjs'], 1);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.some((reason) => /退出码 1/.test(reason)), JSON.stringify(verdict.reasons));
});

test('判红时能点名「输出里查不到任何记录」的文件', () => {
  // 事实边界：spec/TAP 只在**失败**或**脚本式文件**时打文件名，全绿的多用例文件不带文件名
  // ——所以这里能给的只是「完全没痕迹的文件」（a 是 pass，样本里确实查不到它），不是
  // 「每文件用例数」。拿不到就说拿不到，不编。
  const untraced = filesWithoutTrace(SPEC_SAMPLE, [
    'tests/a.test.mjs',
    'tests/b.test.mjs',
    'tests/never-mentioned.test.mjs',
  ]);
  assert.deepEqual(untraced, ['tests/a.test.mjs', 'tests/never-mentioned.test.mjs']);
});

// ---------------------------------------------------------------------------
// ④ 不喂固定文本：直接 spawn 当前 node 的两种 reporter 跑临时用例
// ---------------------------------------------------------------------------

function runReporter(reporter, files, cwd) {
  const args = ['--test', '--test-concurrency=1'];
  if (reporter) args.push(`--test-reporter=${reporter}`);
  args.push(...files);
  // 本文件自己就跑在 `node --test` 的子进程里（NODE_TEST_CONTEXT 会被继承）：
  // 不清掉的话子 node 会把自己当成「测试子进程」，退出码和 reporter 都不再是闸看到的那样。
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env });
  return { status: result.status, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

test('端到端：真实 --test-reporter=spec 的输出能被解析出非零计数与失败明细', () => {
  const dir = mkdtempSync(join(tmpdir(), 'touwaka-spec-parse-'));
  try {
    writeFileSync(join(dir, 'a.test.mjs'), "import { test } from 'node:test';\ntest('a 过', () => {});\n");
    writeFileSync(
      join(dir, 'b.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('b 挂', () => { assert.equal(1, 2); });\n",
    );
    const { status, output } = runReporter('spec', ['a.test.mjs', 'b.test.mjs'], dir);
    assert.equal(status, 1, '注入失败后 rc 必须非 0');
    const parsed = parseTestOutput(output);
    assert.equal(parsed.dialect, 'spec');
    assert.equal(parsed.summary.tests, 2, '真实的 spec 输出必须解析出 2 个用例，不是 0');
    assert.equal(parsed.summary.fail, 1);
    assert.deepEqual(parsed.missingCounters, []);
    assert.equal(parsed.failures.length, 1);
    assert.equal(parsed.failures[0].name, 'b 挂');
    assert.match(parsed.failures[0].file ?? '', /b\.test\.mjs$/);
    const verdict = assessRun({
      status,
      targets: ['a.test.mjs', 'b.test.mjs'],
      parsed,
    });
    assert.equal(verdict.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端：真实 --test-reporter=tap 的输出同样能解析（两版 node 都能跑）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'touwaka-tap-parse-'));
  try {
    writeFileSync(join(dir, 'a.test.mjs'), "import { test } from 'node:test';\ntest('a 过', () => {});\n");
    writeFileSync(
      join(dir, 'b.test.mjs'),
      "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('b 挂', () => { assert.equal(1, 2); });\n",
    );
    const { status, output } = runReporter('tap', ['a.test.mjs', 'b.test.mjs'], dir);
    assert.equal(status, 1);
    const parsed = parseTestOutput(output);
    assert.equal(parsed.dialect, 'tap');
    assert.equal(parsed.summary.tests, 2);
    assert.equal(parsed.summary.fail, 1);
    assert.equal(parsed.failures.length, 1);
    assert.equal(parsed.failures[0].name, 'b 挂');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('端到端：本机默认 reporter 的输出（不带旗标）也能解析出非零计数', () => {
  const dir = mkdtempSync(join(tmpdir(), 'touwaka-default-parse-'));
  try {
    writeFileSync(
      join(dir, 'a.test.mjs'),
      "import { test } from 'node:test';\ntest('a 一', () => {});\ntest('a 二', () => {});\n",
    );
    const { status, output } = runReporter(null, ['a.test.mjs'], dir);
    assert.equal(status, 0);
    const parsed = parseTestOutput(output);
    assert.equal(parsed.summary.tests, 2, `默认 reporter 的输出必须解析出 2 例，实际方言=${parsed.dialect}`);
    assert.equal(parsed.summary.fail, 0);
    assert.deepEqual(parsed.missingCounters, []);
    assert.equal(
      assessRun({ status, targets: ['a.test.mjs'], parsed }).ok,
      true,
      '默认 reporter 全绿时必须判过（否则闸会假红）',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
