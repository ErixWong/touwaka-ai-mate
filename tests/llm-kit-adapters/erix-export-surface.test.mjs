/**
 * issue #1285 —— erix 装载面守卫：把「上游删导出」从「运行到那条路径才炸」变成「测试期就红」。
 *
 * 由来（不是推测）：erix-agent 0.30 的迁移指南已经喊了要删 16 个导出名，产物里却还在；
 * **删除边界落在 0.31**（包根 95 → 85，`erix-agent/tools` 53 → 46）。宿主是 ESM 具名导入，
 * 上游一删名，`import { x } from 'erix-agent'` 在**模块求值期**就抛 SyntaxError —— 也就是
 * 「进程起不来 / 跑到那个文件才炸」。上游的 `engineApiContract`（engine-api.contract.test.mjs）
 * 只钉它自己点名的名字（appendUserTurn / projectTranscriptForDisplay / parseModelJson …），
 * **不管我们实际消费哪几个**，所以这层必须宿主自己钉。
 *
 * 本文件钉两格：
 *   ① 装载面：`CONSUMED` 里每个名字在**当前装着的** erix-agent 上仍是 function（`NotesStoreError`
 *      必须是真 class —— 宿主 `lib/notes/db-note-record-store.js:67,81` 是 `new NotesStoreError(...)`，
 *      `server/tests/notes-infra.test.js:158` 是 `instanceOf`，两条都要求 class 语义）；
 *   ② 名单与源码一致：`lib/` `tests/` `server/` 里所有 `from 'erix-agent'` 的具名导入**逐个**都在
 *      `CONSUMED` 里，且 `CONSUMED` 里没有一个是「名单里躺着、源码里没人用」的僵尸条目。
 *      ⇒ 以后有人新加一个导入却忘了登记，这里红；上游删了某个名字，①红。
 *
 * 版本范围事实（issue #1285 要求留痕，别照常识猜 caret）：
 *   `package.json` 写 `"erix-agent": "^0.31.0"` ⇒ npm semver 实测范围是 `>=0.31.0 <0.32.0`。
 *   **0.x 上的 caret 不放下一 minor**，`satisfies('0.31.0','^0.30.0') === false`，
 *   所以下一次跨 minor（0.32）**必须显式改范围**，不会自动跟版，也不会静默漂进来。
 *
 * 全部离线：只 import 包 + 读本地源码，不连库、不联网。
 *
 * Run:
 *   node --test tests/llm-kit-adapters/erix-export-surface.test.mjs
 *   （已登记进 package.json 的 `npm run test:llm-kit` 显式文件清单，不登记等于没跑）
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/**
 * 宿主实际消费的导出名 → 期望形态。改动此表必须同步源码里的导入（第 ② 格会拦）。
 *
 * 名单来源：**扫出来的**，不是抄 issue 正文。issue #1285 只列了 5 个（单引号那批），
 * 实测还有 5 个是**双引号**导入（`grep "from 'erix-agent'"` 漏掉的那批）+ `foldMessageRows` 别名导入。
 */
const CONSUMED = {
  // —— 生产代码（lib/）——
  runToolLoop: 'function',                // lib/agent/agent-loop.js:25
  canonicalToOpenAIMessages: 'function',  // lib/agent/agent-loop.js:25 + lib/llm-kit-adapters/provider-adapter.js:29-32
  canonicalToolsToOpenAI: 'function',     // lib/llm-kit-adapters/provider-adapter.js:29-32
  createBuiltinNotesTools: 'function',    // lib/tool-manager.js:31
  createModelConfigResolver: 'function',  // lib/llm-kit-adapters/loop-bridge.js:2
  foldMessageRows: 'function',            // lib/llm-kit-adapters/transcript-store.js:89（导入即重命名 upstreamFoldMessageRows）
  isNoteRecord: 'function',               // lib/notes/notes-policy.js:12 + lib/notes/erix-notes-store-adapter.js:39
  NotesStoreError: 'class',               // lib/notes/db-note-record-store.js:31 + lib/notes/index.js:31（再导出）
  // —— 测试侧（tests/ / server/tests/）——
  appendUserTurn: 'function',             // tests/llm-kit-adapters/transcript-store-fastpath.test.mjs:33
  projectTranscriptForDisplay: 'function', // tests/llm-kit-adapters/transcript-store-message-meta.test.mjs:29
  estimateMessageTokens: 'function',      // tests/llm-kit-adapters/loop-bridge.test.mjs:4
};

/** 扫描面：宿主源码 + 测试。`temp/` 是本地草稿（.gitignore 第 8 行），不在闸内。 */
const SCAN_DIRS = ['lib', 'tests', 'server'];

/** `import { a, b } from 'erix-agent'` / `export { a } from 'erix-agent'`（支持多行花括号）。 */
const ROOT_IMPORT_RE =
  /(?:^|\n)[ \t]*(?:import|export)\s+(?:type\s+)?(?:\*\s+as\s+\w+\s+)?(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]erix-agent['"]/g;

/**
 * `from 'erix-agent/<subpath>'` / `import('erix-agent/<subpath>')`：子路径只放行上游自带的
 * `contract-tests`（它由上游套件自己钉），其他子路径一律红（防止「名单外的新入口」静默出现）。
 */
const SUBPATH_IMPORT_RE = /(?:from|import\s*\()\s*['"]erix-agent\/([\w./-]+)['"]/g;
const ALLOWED_SUBPATHS = new Set(['contract-tests']);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** 只剥**整行**注释（`//` / `*` / `/*` 开头），不碰字符串内的 `//`——宁可少剥，不误伤代码。 */
function stripWholeLineComments(text) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !(trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'));
    })
    .join('\n');
}

/** 扫出 `from 'erix-agent'` 的具名导入名（含来源文件，便于失败时点名）。 */
function collectRootImports() {
  const found = new Map(); // name → [relative file, ...]
  const subpaths = new Set();
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      const text = stripWholeLineComments(readFileSync(file, 'utf8'));
      const rel = relative(ROOT, file);
      for (const match of text.matchAll(ROOT_IMPORT_RE)) {
        for (const raw of match[1].split(',')) {
          // 逐条导入可带别名：`a as b` → 取原名（`from` 侧要解析的就是原名）。
          const name = raw.trim().split(/\s+as\s+/)[0].trim();
          if (!name) continue;
          if (!found.has(name)) found.set(name, []);
          if (!found.get(name).includes(rel)) found.get(name).push(rel);
        }
      }
      for (const match of text.matchAll(SUBPATH_IMPORT_RE)) {
        if (ALLOWED_SUBPATHS.has(match[1])) continue;
        subpaths.add(`${rel} → erix-agent/${match[1]}`);
      }
    }
  }
  return { found, subpaths };
}

test('装载面：宿主消费的 11 个名字在当前 erix-agent 上仍可解析（上游删导出 ⇒ 这里红，不是运行时炸）', async () => {
  const entry = await import('erix-agent');
  const missing = Object.keys(CONSUMED).filter((name) => typeof entry[name] !== 'function');
  assert.deepEqual(
    missing,
    [],
    `erix-agent 已不再导出这些宿主消费的名字：${missing.join(', ')}`
      + `（实测版本 ${JSON.parse(readFileSync(join(ROOT, 'node_modules/erix-agent/package.json'), 'utf8')).version}）`,
  );

  for (const [name, kind] of Object.entries(CONSUMED)) {
    const value = entry[name];
    if (kind === 'class') {
      // class 语义是承重的：宿主有 `new NotesStoreError(...)` 与 `instanceOf` 两个读点。
      assert.match(
        Function.prototype.toString.call(value),
        /^class\b/,
        `${name} 必须是 class（宿主 new + instanceof 两处都靠它），实测源码头：`
          + Function.prototype.toString.call(value).slice(0, 40),
      );
      assert.ok(new value('probe') instanceof Error, `${name} 必须可 new 出 Error 实例`);
    }
  }
});

test('名单与源码一致：from \'erix-agent\' 的具名导入逐个在名单里，名单里也没有僵尸条目', () => {
  const { found, subpaths } = collectRootImports();

  assert.deepEqual(
    [...subpaths],
    [],
    `出现了名单外的子路径导入（只放行 ${[...ALLOWED_SUBPATHS].join('/')}）：`
      + '请先扩名单，否则这里留静默缺口',
  );
  assert.ok(found.size > 0, '扫描面里一个 `from \'erix-agent\'` 都没扫到 ⇒ 扫描口径坏了，不是「干净」');

  const unlisted = [...found.keys()].filter((name) => !(name in CONSUMED));
  assert.deepEqual(
    unlisted,
    [],
    `源码新导入了未登记的名字：${unlisted.map((n) => `${n}（${found.get(n).join(', ')}）`).join('；')}`
      + ' —— 请加进本文件 CONSUMED，让上游删名在测试期就红',
  );

  const zombies = Object.keys(CONSUMED).filter((name) => !found.has(name));
  assert.deepEqual(
    zombies,
    [],
    `名单里的这些名字源码已不再导入：${zombies.join(', ')} —— 删名单或补回导入，别留僵尸断言`,
  );
});
