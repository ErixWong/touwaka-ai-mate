/**
 * issue #1219：`scripts/check-unimported-identifiers.js` 自身的守卫测试
 *
 * 背景（工单实测）：`lib/doc-pipeline-defaults.js` 的 `createCallLlmFn` 里调用了
 * `parseJsonLikeContent` 和 `logger`，两个符号**都没有 import**。
 * 这个「用了却没 import」的状态从 `f9f6bdb`（2026-07-05）活到 #1219，
 * 根因不是那一处笔误，而是**检查面缺口**：`npm run lint` 里没有任何检查会抓它
 * （仓里没有 eslint，也没有 eslint 配置文件）。
 *
 * 本文件钉死四件事：
 *   ① 守卫自带红绿 fixture 全绿（`selfTest()` 返回空）——防「永远绿的假守卫」；
 *   ② **红**：把 #1219 修复前的 `createCallLlmFn` 原文喂进去，必须报出 `parseJsonLikeContent`
 *      （行号也要对得上，就是 `:433`）；
 *   ③ **绿**：修复后的真实 `lib/doc-pipeline-defaults.js` 源码零告警；
 *   ④ **变异**：往真实的 `lib/doc-pipeline-defaults.js` 源码里塞一个未导入调用，
 *      必须被抓到 —— 钉住「守卫对真实文件有效」，而不只是在玩具 fixture 上有效。
 *
 * 全部离线：只读本地文件，不联网、不依赖 DB。
 *
 * Run:
 *   node --test tests/unimported-identifiers-guard.test.mjs
 *   （已登记进 package.json 的 `npm run test:llm-kit` 显式文件清单，不登记等于没跑）
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  checkSource,
  selfTest,
  tokenize,
  isTestFile,
  DEFAULT_TARGETS,
} from "../scripts/check-unimported-identifiers.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

/** #1219 修复前 `createCallLlmFn` 的关键片段（原文摘自 master 20a1e3b:lib/doc-pipeline-defaults.js） */
const PREFIX_FRAGMENT = `
import { DEFAULT_INTERNAL_LLM_TIMEOUT_MS } from './internal-llm-timeout.js';

function createCallLlmFn(db) {
  let cachedTimeoutMs = null;
  let timeoutCachedAt = 0;
  const TIMEOUT_CACHE_TTL = 60000;

  return async (opts) => {
    let modelConfig;
    if (opts.model_id) {
      modelConfig = await db.getModelConfig(opts.model_id);
    } else {
      const ModelRegistry = db.getModel('ai_model');
      const defaultRow = await ModelRegistry.findOne({
        where: { is_active: true, model_type: 'text' },
        order: [['created_at', 'DESC']],
        raw: true,
        attributes: ['id'],
      });
      if (!defaultRow) {
        throw new Error('No active text model found for judge normalization.');
      }
      modelConfig = await db.getModelConfig(defaultRow.id);
    }

    if (!modelConfig) throw new Error('No LLM model available for judge normalization');

    const { callWithRetry } = await import('./chat/base-llm.js');
    const callOptions = {
      temperature: opts.temperature ?? 0.1,
      thinking: { type: 'disabled' },
    };
    if (opts.timeout) {
      callOptions.timeout = opts.timeout;
    } else {
      if (!cachedTimeoutMs || (Date.now() - timeoutCachedAt) >= TIMEOUT_CACHE_TTL) {
        try {
          const { getInternalLlmTimeoutMs } = await import('./internal-llm-timeout.js');
          cachedTimeoutMs = await getInternalLlmTimeoutMs(db);
        } catch {
          const { getInternalLlmTimeoutMs } = await import('./internal-llm-timeout.js');
          cachedTimeoutMs = await getInternalLlmTimeoutMs();
        }
        timeoutCachedAt = Date.now();
      }
      callOptions.timeout = cachedTimeoutMs;
    }
    if (opts.output_schema && typeof opts.output_schema === 'object' && Object.keys(opts.output_schema).length > 0) {
      callOptions.response_format = { type: 'json_object' };
    }
    logger.info('[DocPipeline] callLlm timeout options:', {
      model_id: opts.model_id || modelConfig.id,
      requested_timeout_ms: opts.timeout ?? null,
      call_options_timeout_ms: callOptions.timeout ?? null,
      model_timeout_ms: modelConfig.timeout ?? null,
    });
    const response = await callWithRetry(modelConfig, opts.messages || [], callOptions);
    const content = response.content || '';
    logger.info('[DocPipeline] Judge LLM raw content:', content);

    const parsed = parseJsonLikeContent(content, { logPrefix: '[DocPipeline]' });
    logger.info('[DocPipeline] Judge LLM parsed result:', parsed);

    return parsed;
  };
}
export { createCallLlmFn };
`;

test("① 守卫自带红绿 fixture 全绿（含反向变异）", () => {
  assert.deepEqual(selfTest(), [], "selfTest() 必须返回空数组");
});

test("② 红：#1219 修复前的 createCallLlmFn 原文必须被报出 parseJsonLikeContent", () => {
  const problems = checkSource(PREFIX_FRAGMENT);
  const names = problems.map((p) => p.name);
  assert.ok(
    names.includes("parseJsonLikeContent"),
    `必须报出 parseJsonLikeContent，实际: ${JSON.stringify(names)}`
  );
  // `logger` 同样没 import —— 一并钉住，别只盯一个符号
  assert.ok(
    names.includes("logger"),
    `必须报出 logger，实际: ${JSON.stringify(names)}`
  );
  // 命中的那一行确实是调用行（真实文件里这行是 :433，见交付说明里的 git show 原文证据）
  const pjl = problems.find((p) => p.name === "parseJsonLikeContent");
  const hitLine = PREFIX_FRAGMENT.split("\n")[pjl.line - 1];
  assert.ok(
    hitLine.includes("parseJsonLikeContent(content"),
    `命中行应包含调用表达式，实际第 ${pjl.line} 行: ${JSON.stringify(hitLine)}`
  );
  // `callWithRetry` / `getInternalLlmTimeoutMs` 是 `const {..} = await import()` 解构出来的，
  // 属于「本地声明」——不许误报（这是守卫的误报防线）
  assert.ok(!names.includes("callWithRetry"), "callWithRetry 来自解构声明，不该被报");
  assert.ok(
    !names.includes("getInternalLlmTimeoutMs"),
    "getInternalLlmTimeoutMs 来自解构声明，不该被报"
  );
});

test("③ 绿：修复后的真实 lib/doc-pipeline-defaults.js 零告警", () => {
  const src = readFileSync(join(REPO_ROOT, "lib", "doc-pipeline-defaults.js"), "utf8");
  assert.deepEqual(checkSource(src), [], "修复后的文件必须零告警");
  // 死导出真的没了：函数名不再出现，导出清单里也没有
  assert.ok(!src.includes("createCallLlmFn"), "createCallLlmFn 必须已删除（含 export 条目）");
  assert.ok(!src.includes("parseJsonLikeContent"), "连带死掉的调用也必须消失");
});

test("④ 变异：往真实 lib 源码里塞未导入调用，必须被抓到", () => {
  const src = readFileSync(join(REPO_ROOT, "lib", "doc-pipeline-defaults.js"), "utf8");
  const mutated = `${src}\nexport function __guardMutationProbe(x) {\n  return totallyUndeclaredHelper(x);\n}\n`;
  const problems = checkSource(mutated);
  assert.equal(problems.length, 1, `应恰好命中 1 处，实际: ${JSON.stringify(problems)}`);
  assert.equal(problems[0].name, "totallyUndeclaredHelper");
});

test("⑤ 判定面：全局白名单 / 测试全局 / 属性访问 / typeof 守卫写法都不误报", () => {
  const src = `
import { a } from './x.js';
function f(obj) {
  const n = Math.max(1, Date.now(), Number.parseInt('1', 10));
  if (typeof maybeGlobal !== 'undefined') return null;
  return obj?.deep?.value ?? JSON.stringify(process.env);
}
export { f };
`;
  assert.deepEqual(checkSource(src), []);
});

test("⑥ 词法：模板字符串 / 正则 / 注释里的标识符不算引用", () => {
  const src = `
const a = \`x \${unknownButInsideTemplate}\`;
const re = /parseJsonLikeContent|logger/g;
// logger.info('this is a comment')
/* parseJsonLikeContent(content) */
export { a, re };
`;
  const problems = checkSource(src);
  // 模板表达式里的 bare ref 会报（unknownButInsideTemplate 确实未声明）——
  // 但正则体与注释里的同名符号不许被报
  const names = problems.map((p) => p.name);
  assert.ok(!names.includes("parseJsonLikeContent"), "正则体里的字面量不该被当引用");
  assert.ok(!names.includes("logger"), "注释里的字面量不该被当引用");
  assert.ok(names.includes("unknownButInsideTemplate"), "模板表达式里的裸引用应当被报");
});

test("⑦ 扫描口径：默认目录与测试文件识别", () => {
  assert.deepEqual(DEFAULT_TARGETS, ["lib", "server", "scripts", "apps", "tests"]);
  assert.equal(isTestFile("/repo/tests/foo.test.mjs"), true);
  assert.equal(isTestFile("/repo/server/tests/bar.test.js"), true);
  assert.equal(isTestFile("/repo/lib/logger.js"), false);
});

test("⑧ 词法不炸：对含 shebang 与嵌套模板的真实文件不抛异常", () => {
  const src = readFileSync(join(REPO_ROOT, "scripts", "check-unimported-identifiers.js"), "utf8");
  const toks = tokenize(src);
  assert.ok(toks.length > 1000, `token 数应 > 1000，实际 ${toks.length}`);
  assert.deepEqual(checkSource(src), [], "守卫脚本自身也必须零告警");
});
