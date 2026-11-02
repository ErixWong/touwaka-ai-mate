/**
 * issue #1253 —— 隔离清单守卫格（`tests/QUARANTINE.mjs` 的机器判据）
 *
 * 为什么要有：隔离清单是**记账**，不是「跳过问题」。没有守卫的话它会腐化成两种假账：
 *   ① 写错/写旧的路径（文件早改名或删了，条目却还在，等于把真问题藏起来）；
 *   ② 条目缺 reason/issue（后人不知道它为什么红、该找哪张单）。
 * 另外顺手钉住两条**反弱化**：聚合入口的 skip-pattern 必须与既有脚本逐字一致，
 * `npm test` 必须真的指向聚合入口而不是退回占位符。
 *
 * 变异自证（本单实测）：往清单里塞一条 `tests/__mutation_does_not_exist__.test.js`
 * ⇒ 「隔离清单里的 file 必须真实存在于磁盘上」这一格变红（`not ok N - 隔离清单里的
 * file 必须真实存在于磁盘上`）；`git checkout` 还原后 md5 一致、全绿。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import quarantine from './QUARANTINE.mjs';
import { discoverTestFiles, KNOWN_SKIP_PATTERN } from '../scripts/run-tests.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const SCRIPTS = PACKAGE_JSON.scripts ?? {};
const DISCOVERED = discoverTestFiles();

/** 猜测式措辞：symptom 必须是实跑出来的报错首行，不是「可能坏了」。 */
const HEDGE_WORDS = ['可能', '疑似', '也许', '大概', '或许', '待查', 'TODO', 'FIXME', 'unknown'];

function readScriptSkipPattern(scriptName) {
  const body = SCRIPTS[scriptName] ?? '';
  const match = /--test-skip-pattern='([^']*)'/.exec(body) ?? /--test-skip-pattern=([^\s]+)/.exec(body);
  return match ? match[1] : null;
}

test('隔离清单非空且每条都有非空 file / reason / issue / symptom', () => {
  assert.ok(Array.isArray(quarantine), 'tests/QUARANTINE.mjs 的默认导出必须是数组');
  assert.ok(quarantine.length > 0, '隔离清单为空：本单的 9 个长期红文件必须显式记账，不许悄悄删条目');
  for (const [index, item] of quarantine.entries()) {
    const label = `QUARANTINE[${index}]（${item?.file ?? '无 file'}）`;
    for (const key of ['file', 'reason', 'issue', 'symptom']) {
      assert.equal(typeof item?.[key], 'string', `${label}.${key} 必须是字符串`);
      assert.ok(item[key].trim().length > 0, `${label}.${key} 不能为空`);
    }
    assert.ok(item.reason.trim().length >= 8, `${label}.reason 太短，写清成因分类`);
    assert.ok(item.symptom.trim().length >= 8, `${label}.symptom 太短，必须是实跑出来的报错首行`);
  }
});

test('隔离清单里的 file 必须真实存在于磁盘上', () => {
  const missing = quarantine
    .map((item) => item.file)
    .filter((file) => !existsSync(join(ROOT, file)));
  assert.deepEqual(
    missing,
    [],
    `隔离清单里有不存在于磁盘的路径（改名/删除后忘了同步，等于把问题藏起来）：${JSON.stringify(missing)}`,
  );
});

test('隔离清单里的 file 必须是普通文件且是 *.test.{js,mjs}', () => {
  for (const item of quarantine) {
    const full = join(ROOT, item.file);
    assert.ok(statSync(full).isFile(), `${item.file} 不是普通文件`);
    assert.match(item.file, /\.test\.(?:js|mjs)$/, `${item.file} 不是 *.test.{js,mjs}`);
  }
});

test('隔离清单里的 file 必须落在磁盘发现集合内（否则 runner 的排除是空转）', () => {
  const notDiscovered = quarantine
    .map((item) => item.file)
    .filter((file) => !DISCOVERED.includes(file));
  assert.deepEqual(
    notDiscovered,
    [],
    `这些隔离项不在 scripts/run-tests.mjs 的磁盘发现结果里：${JSON.stringify(notDiscovered)}`,
  );
});

test('隔离清单没有重复条目', () => {
  const files = quarantine.map((item) => item.file);
  assert.equal(new Set(files).size, files.length, `隔离清单有重复 file：${JSON.stringify(files)}`);
});

test('隔离清单的 issue 形如 #NNN', () => {
  for (const item of quarantine) {
    assert.match(item.issue, /^#\d+$/, `${item.file} 的 issue 必须是 #NNN 形态，实际=${item.issue}`);
  }
});

test('symptom 必须是实跑报错首行，不许写猜测式措辞', () => {
  for (const item of quarantine) {
    for (const word of HEDGE_WORDS) {
      assert.ok(
        !item.symptom.includes(word),
        `${item.file} 的 symptom 含猜测措辞「${word}」：隔离记账只认实跑出来的报错首行`,
      );
    }
  }
});

test('聚合入口的 skip-pattern 与 test:llm-kit / test:store-contract 逐字相同（不许放宽）', () => {
  for (const scriptName of ['test:llm-kit', 'test:store-contract']) {
    assert.ok(SCRIPTS[scriptName], `package.json 缺少 ${scriptName} 脚本（不许删）`);
    const pattern = readScriptSkipPattern(scriptName);
    assert.ok(pattern, `${scriptName} 必须保留 --test-skip-pattern（不许放宽）`);
    assert.equal(
      pattern,
      KNOWN_SKIP_PATTERN,
      `${scriptName} 的 --test-skip-pattern 与 scripts/run-tests.mjs 的 KNOWN_SKIP_PATTERN 不一致：` +
        '聚合入口继承同一口径，任何一侧放宽都会让本格变红',
    );
  }
});

test('npm test 指向聚合入口 test:all，占位符必须消失', () => {
  assert.equal(SCRIPTS.test, 'npm run test:all', 'npm test 必须指向 test:all');
  assert.ok(SCRIPTS['test:all'], 'package.json 缺少 test:all 脚本');
  assert.ok(
    !/no test specified/.test(SCRIPTS.test ?? ''),
    'npm test 仍是 "Error: no test specified" 占位符',
  );
  assert.match(SCRIPTS['test:all'], /scripts\/run-tests\.mjs/, 'test:all 必须调用 scripts/run-tests.mjs');
});
