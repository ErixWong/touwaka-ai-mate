import test from "node:test";
import assert from "node:assert/strict";

// 上游 v0.53.0 #463 的对应件：provider 不报 `total` 时派生，且缓存计数与 total 不重复计费。
// 设计依据见 docs/design/2026-07-29-llm-kit-upstream-delta-2026-07-29.md 的 §2.6 / §3 Phase 1。

import { normalizeUsage } from "../../lib/llm-kit-adapters/provider-adapter.js";

test("Anthropic 家族：provider 没报 total ⇒ 派生 input + cache_read + cache_write + output", () => {
  const usage = normalizeUsage({
    input_tokens: 1000,
    output_tokens: 250,
    cache_read_input_tokens: 4000,
    cache_creation_input_tokens: 800,
  });
  assert.equal(usage.total_tokens, 6050, "该家族的 input 不含缓存部分，必须加满四个分项");
  assert.equal(usage.cache_read_input_tokens, 4000, "cache 键只放分项，不被 total 污染");
  assert.equal(usage.cache_creation_input_tokens, 800);
});

test("OpenAI 家族：prompt_tokens 已含 cached_tokens ⇒ total 不再加缓存（防重复计费）", () => {
  const usage = normalizeUsage({
    prompt_tokens: 5000,
    completion_tokens: 300,
    prompt_tokens_details: { cached_tokens: 4200 },
    cached_tokens: 4200,
  });
  assert.equal(usage.total_tokens, 5300, "缓存是 prompt 的子集，加第二遍就是虚报成本");
  assert.equal(usage.cache_read_input_tokens, 4200);
});

test("provider 自己报了 total ⇒ 照抄不覆盖，且再归一一次不变（幂等）", () => {
  const raw = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, total_tokens: 999 };
  const once = normalizeUsage(raw);
  assert.equal(once.total_tokens, 999, "provider 口径优先，我们只在它缺席时补");
  assert.deepEqual(normalizeUsage(once), once, "幂等：归一两次 total 不眼胀");
});

test("分项全缺时不凭空造 total（造 0 会被当成「本轮零成本」而不是「没报」）", () => {
  assert.equal(normalizeUsage({}), undefined);
  assert.equal(normalizeUsage({ reasoning_tokens: 3 }), undefined);
  assert.equal(normalizeUsage(null), undefined);
  assert.equal(normalizeUsage("123"), undefined);
  assert.equal(normalizeUsage([1, 2]), undefined);
});

test("脏值一律当「没报」：NaN / 负数 / Infinity / null / 布尔", () => {
  assert.equal(
    normalizeUsage({ input_tokens: NaN, output_tokens: -5, cache_read_input_tokens: Infinity }),
    undefined,
    "脏值全被丢弃 ⇒ 无键 ⇒ undefined（不返回空对象，也不造 total 0）",
  );
  assert.equal(normalizeUsage({ input_tokens: null, output_tokens: true }), undefined);
});

test("字符串数字接受，键族名映射照旧（prompt/completion 与 input/output 同源）", () => {
  const usage = normalizeUsage({ prompt_tokens: "1200", completion_tokens: "80" });
  assert.equal(usage.input_tokens, 1200);
  assert.equal(usage.output_tokens, 80);
  assert.equal(usage.total_tokens, 1280);
});

test("只有 output 也能派生 total（provider 单边漏报时不至于整条无成本）", () => {
  assert.equal(normalizeUsage({ output_tokens: 42 }).total_tokens, 42);
});
