import test from "node:test";
import assert from "node:assert/strict";

// 上游 v0.54.0 #447（多字节安全截断）的对应件：`truncateMultisafe`。
// 设计依据见 docs/design/2026-07-29-llm-kit-upstream-delta-2026-07-29.md 的 §2.9 / §3 Phase 2。

import { truncateMultisafe } from "../../lib/llm-kit-adapters/transcript-store.js";

/** 串里是否残留**孤立代理项**：它是 JSON / Utf8JsonWriter / utf8mb4 的非法值，也是本函数的病根本身。 */
function hasLoneSurrogate(str) {
  for (const ch of str) {
    // Array.from 按码点走：代理对在这里是单个两码元 char，半边的话只有一个码元
    if (ch.length === 1) {
      const code = ch.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdfff) return true;
    }
  }
  return false;
}

test("按码点截断：不把多字节字符截成半个", () => {
  const text = `ok${"😀".repeat(8)}end`;
  for (const max of [1, 2, 3, 4, 5, 7, 9, 13]) {
    const cut = truncateMultisafe(text, max);
    assert.equal(hasLoneSurrogate(cut), false, `max=${max} 截出孤立代理项: ${JSON.stringify(cut)}`);
    assert.ok(Array.from(cut).length <= max + 1, `max=${max} 时除省略号外不得超出：${JSON.stringify(cut)}`);
  }
});

test("不超长时原样返回，不凭空加省略号", () => {
  assert.equal(truncateMultisafe("中文", 10), "中文");
  assert.equal(truncateMultisafe("中文", 2), "中文");
  assert.equal(truncateMultisafe("abc", 3), "abc");
});

test("超长时补省略号，且省略号不占 max 名额（上游同口径）", () => {
  assert.equal(truncateMultisafe("abcdef", 3), "abc…");
  assert.equal(Array.from(truncateMultisafe("a😀b😀c", 3)).length, 4, "3 个码点 + 1 个省略号");
  assert.equal(truncateMultisafe("a😀b😀c", 3), "a😀b…");
});

test("正好切在代理对上：剔掉高半边，不留半个字符", () => {
  // "😀" 占两个码元；max=1 时按码点只取 "a"，不该出现半个 emoji
  assert.equal(truncateMultisafe("a😀", 1), "a…");
  assert.equal(truncateMultisafe("😀😀", 1), "😀…", "按码点切：代理对是完整的一个码点，不会被拆半");
});

test("退化入参与边界：空 / 0 / 负 / 非数", () => {
  assert.equal(truncateMultisafe("", 5), "");
  assert.equal(truncateMultisafe(null, 5), "");
  assert.equal(truncateMultisafe(undefined, 5), "");
  assert.equal(truncateMultisafe("abc", 0), "");
  assert.equal(truncateMultisafe("abc", -1), "");
  assert.equal(truncateMultisafe("abc", Number.NaN), "");
  assert.equal(truncateMultisafe("abc", Number.POSITIVE_INFINITY), "", "Infinity 与上游同口径归为退化配置 ⇒ 空串");
  assert.equal(truncateMultisafe(12345, 3), "123…", "非字符串入参先字符串化，不抛");
});
