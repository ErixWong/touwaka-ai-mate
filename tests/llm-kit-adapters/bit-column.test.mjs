/**
 * `BIT(1)` → 布尔：**唯一转换实现**的六格输入输出表（issue #1227 阶段 3 切片 C2c）
 *
 * 纯函数，不连库。钉住两件事：
 *   ① 六格输入（`Buffer[0]` / `Buffer[1]` / `0` / `1` / `null` / `undefined`）的输出**逐格**正确；
 *   ② 全仓只有**一份**实现：`transcript-projection.js` 只是 re-export，`transcript-store.js`
 *      从同一个模块 import（本文件用读源码 + 动态 import 两条路各证一遍）。
 *
 * 为什么这两条都要钉：C1 已经在 `transcript-projection.js` 里写过一份正确实现，C2c 若在
 * store 里再写一份，两份必然漂移；而「`Boolean(Buffer.from([0])) === true`」这种缺陷的
 * 特征恰恰是**没有测试会自然覆盖到**——它只在没有连接级 `typeCast` 的连接上出现
 * （`lib/db.js` 有，`scripts/*` 的 `DB_*` 直连没有），线上与单测都容易漏。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { bitToBoolean } from "../../lib/llm-kit-adapters/bit-column.js";
// 既有调用方从 projection 拿同一个函数（C1 的 import 面不能破）
import { bitToBoolean as fromProjection } from "../../lib/llm-kit-adapters/transcript-projection.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

test("bitToBoolean：六格输入输出表（Buffer[0]/Buffer[1]/0/1/null/undefined）", () => {
  const table = [
    { label: "Buffer b'0'", value: Buffer.from([0]), expected: false },
    { label: "Buffer b'1'", value: Buffer.from([1]), expected: true },
    { label: "number 0", value: 0, expected: false },
    { label: "number 1", value: 1, expected: true },
    { label: "null", value: null, expected: false },
    { label: "undefined", value: undefined, expected: false },
  ];
  for (const row of table) {
    assert.equal(
      bitToBoolean(row.value),
      row.expected,
      `${row.label} 应转成 ${row.expected}（实际 ${String(bitToBoolean(row.value))}）`,
    );
  }
});

test("bitToBoolean：另外四种驱动的形态也不许漏（string / boolean / Uint8Array / 空 buffer）", () => {
  // mysql2 在某些配置下把 BIT 回成字符串（"\0"/"0"/"1"）；Uint8Array 是 Buffer 的父类，
  // 将来换驱动/换包装时 `Buffer.isBuffer` 会漏，必须按字节判。
  assert.equal(bitToBoolean("\0"), false);
  assert.equal(bitToBoolean("0"), false);
  assert.equal(bitToBoolean(""), false);
  assert.equal(bitToBoolean("1"), true);
  assert.equal(bitToBoolean(true), true);
  assert.equal(bitToBoolean(false), false);
  assert.equal(bitToBoolean(new Uint8Array([0])), false);
  assert.equal(bitToBoolean(new Uint8Array([1])), true);
  assert.equal(bitToBoolean(Buffer.alloc(0)), false);
});

test("bitToBoolean：boolean 输入幂等——typeCast 通道（lib/db.js 已转 boolean）不会被改坏", () => {
  // 反向保护：通道 A 上 `row.is_error` 已经是 boolean，转换器必须原样返回。
  // 若有人把转换器写成「只认 Buffer」或「`!!value` 以外的奇怪逻辑」，通道 A 会立刻红。
  for (const value of [true, false]) {
    assert.equal(bitToBoolean(value), value, `bitToBoolean(${value}) 必须等于 ${value}`);
    assert.equal(typeof bitToBoolean(value), "boolean");
  }
});

test("bitToBoolean：反例钉住缺陷本身——Boolean()/Number() 在 Buffer 上都是错的", () => {
  // 这两条不是"测试转换器"，是**缺陷的复现器**：将来有人把转换器改回
  // `Boolean(row.is_error)` 或 `Number(row.is_error)`，上面两张表会红；这两条同时说明
  // 为什么红的是对的（Buffer 上 Boolean 恒真、Number 是 NaN ⇒ 恒假）。
  assert.equal(Boolean(Buffer.from([0])), true, "Buffer b'0' 在 Boolean() 下恒真——这正是 #1227 C2c 的病灶");
  assert.ok(Number.isNaN(Number(Buffer.from([0]))), "Number(Buffer) 是 NaN——这是 C1 修掉的恒假缺陷");
  assert.ok(Number.isNaN(Number(Buffer.from([1]))));
});

test("单一实现：全仓只有一个 BIT 转换定义点，且 projection 只是 re-export", async () => {
  const store = await readFile(path.join(REPO_ROOT, "lib/llm-kit-adapters/transcript-store.js"), "utf8");
  const projection = await readFile(path.join(REPO_ROOT, "lib/llm-kit-adapters/transcript-projection.js"), "utf8");

  // store 必须从公共模块 import，不许自己写一份
  assert.match(store, /import \{ bitToBoolean \} from "\.\/bit-column\.js";/);
  assert.doesNotMatch(store, /function bitToBoolean/, "store 不许再定义一份转换器");
  // projection 只 re-export（C1 的 import 面保持，但不留第二份实现）
  assert.match(projection, /import \{ bitToBoolean \} from "\.\/bit-column\.js";/);
  assert.match(projection, /export \{ bitToBoolean \};/);
  assert.doesNotMatch(projection, /function bitToBoolean/, "projection 不许再定义一份转换器");

  // 两个入口拿到的是同一个函数对象（不是两份同语义实现）
  assert.equal(fromProjection, bitToBoolean);
});

test("单一实现：lib/ 下没有第二处「BIT 列 Buffer 判字节」的转换逻辑", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  // 判据：lib/ 里出现「按字节判 BIT 真值」的形态（`.some((byte) => byte !== 0)`）的地方
  // 只应有 bit-column.js。其余 Buffer.isBuffer 都是日志/路径/embedding 的形态判断，不会被命中。
  const { stdout } = await run("grep", ["-rn", "some((byte) => byte !== 0)", "lib"], { cwd: REPO_ROOT });
  const byteWise = stdout.split("\n").filter(Boolean).map((line) => line.split(":")[0]);
  assert.deepEqual(
    [...new Set(byteWise)],
    ["lib/llm-kit-adapters/bit-column.js"],
    `按字节判 BIT 真值的实现只允许一处，实际：${JSON.stringify(byteWise)}`,
  );
  // 反向也钉一下：不许有第二处 `function bitToBoolean` / `bitToBoolean(value) {` 定义。
  const { stdout: defs } = await run("grep", ["-rln", "function bitToBoolean", "lib"], { cwd: REPO_ROOT });
  assert.deepEqual(defs.split("\n").filter(Boolean), ["lib/llm-kit-adapters/bit-column.js"]);
});
