/**
 * payload 指纹的**差分守卫**（issue #1227 阶段 2 切片 B2）。
 *
 * 宿主侧有一份本地副本 `lib/llm-kit-adapters/transcript-payload-fingerprint.js`（上游
 * `src/store/transcript-dedup.js` 不在包公共面，深路径 import 抛
 * ERR_PACKAGE_PATH_NOT_EXPORTED，包根也没有任何 dedup/fingerprint 符号）。两份实现一旦漂移，
 * 「同 key 异 payload」的判据就会在宿主与引擎之间分叉——上游契约套件能抓到语义级漂移
 *（`transcript-store-upstream-contract.test.mjs` 的 4 格），但抓不到「指纹字符串本身不同」。
 *
 * 本文件补的就是这一格：用**文件路径直载**上游那份模块（绕过 exports map，只读、不改它），
 * 对同一批 payload 逐条比对 `payloadFingerprint` / `differingTopLevelFields` / 冲突错形状。
 *
 * 上游搬走/改名 `src/store/transcript-dedup.js` 时本文件会红并点名——这是**故意的**：
 * 那时本地副本的「逐条对照表」已经失去锚点，必须人工复核（不是放宽断言就能过的）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

import {
  DEDUP_CONFLICT_CODE,
  PAYLOAD_VOLATILE_FIELDS,
  TranscriptDedupConflictError,
  dedupConflictError,
  differingTopLevelFields,
  payloadFingerprint,
} from "../../lib/llm-kit-adapters/transcript-payload-fingerprint.js";

/**
 * 上游模块路径（0.29.0：`src/store/transcript-dedup.js`）。
 * 直载文件而不是 `import("erix-agent/src/store/transcript-dedup.js")`：后者被包 exports 拦下。
 */
const UPSTREAM_PATH = new URL(
  "../../node_modules/erix-agent/src/store/transcript-dedup.js",
  import.meta.url,
);

let upstream = null;
try {
  upstream = await import(pathToFileURL(UPSTREAM_PATH.pathname).href);
} catch (error) {
  // 上游搬走/改名 ⇒ 这里不静默跳过，而是让测试红：本地副本的锚点需要人工复核。
  upstream = { __loadError: error };
}

/** 一批覆盖判据每个分支的 payload。 */
const PAYLOAD_BATTERY = [
  ["最小记录", { round: 1, messages: [] }],
  ["普通消息", {
    round: 3,
    dedupKey: "run:engine:round:3",
    roundKey: "run:engine:round:3",
    ts: "2026-10-31T00:00:00.000Z",
    messages: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
  }],
  ["字段顺序不同（同 payload）", {
    messages: [{ role: "user", content: [{ type: "text", text: "你好" }] }],
    ts: "2026-10-31T00:00:00.000Z",
    roundKey: "run:engine:round:3",
    dedupKey: "run:engine:round:3",
    round: 3,
  }],
  ["数组顺序不同（异 payload）", {
    round: 3,
    messages: [
      { role: "user", content: [{ type: "text", text: "后" }] },
      { role: "assistant", content: [{ type: "text", text: "先" }] },
    ],
  }],
  ["嵌套 ts 不同（异 payload）", {
    round: 3,
    messages: [{ role: "assistant", content: [], ts: "2026-10-31T00:00:01.000Z" }],
  }],
  ["宿主未知字段", { round: 3, hostLedger: { written: true }, messages: [] }],
  ["null / 布尔 / 数字混排", {
    round: 0,
    folded: false,
    foldedRoundRange: null,
    response: { stopReason: "end_turn", usage: { prompt_tokens: 1, completion_tokens: 0 } },
  }],
  ["非 JSON 叶子（NaN / Infinity / undefined / 函数）", {
    round: 2,
    messages: [],
    nan: Number.NaN,
    inf: Number.POSITIVE_INFINITY,
    missing: undefined,
    fn: () => {},
  }],
  ["bigint 叶子", { round: 2, big: 9007199254740993n }],
  ["Date 叶子（toJSON）", { round: 2, at: new Date("2026-10-31T00:00:00.000Z") }],
  ["四键全在 + 同 payload 其余不同顶层键", {
    dedupKey: "k",
    roundKey: "k",
    round: 7,
    ts: "x",
    onlyHere: 1,
  }],
];

test("上游 transcript-dedup.js 仍可直载（本地副本的锚点还在）", () => {
  assert.equal(
    upstream.__loadError, undefined,
    `无法直载上游判据 ${UPSTREAM_PATH.pathname}：${upstream.__loadError?.message}\n`
      + "上游搬走/改名了该文件 ⇒ 请复核 lib/llm-kit-adapters/transcript-payload-fingerprint.js "
      + "的逐条对照表并更新本测试的 UPSTREAM_PATH。",
  );
  for (const symbol of ["DEDUP_CONFLICT_CODE", "PAYLOAD_VOLATILE_FIELDS", "payloadFingerprint", "dedupConflictError", "differingTopLevelFields"]) {
    assert.ok(symbol in upstream, `上游缺少符号 ${symbol}`);
  }
  assert.equal(typeof upstream.payloadFingerprint, "function");
  assert.equal(typeof upstream.dedupConflictError, "function");
  assert.equal(typeof upstream.differingTopLevelFields, "function");
});

test("volatile 字段清单与上游逐字一致（剥的是顶层这四个）", () => {
  assert.deepEqual([...PAYLOAD_VOLATILE_FIELDS], [...upstream.PAYLOAD_VOLATILE_FIELDS]);
  assert.deepEqual([...PAYLOAD_VOLATILE_FIELDS], ["dedupKey", "roundKey", "round", "ts"]);
  assert.equal(DEDUP_CONFLICT_CODE, upstream.DEDUP_CONFLICT_CODE);
});

test("差分：同一批 payload 上本地指纹与上游指纹逐条相等", () => {
  for (const [label, payload] of PAYLOAD_BATTERY) {
    assert.equal(
      payloadFingerprint(payload),
      upstream.payloadFingerprint(payload),
      `指纹漂移：${label}`,
    );
  }
});

test("差分：顶层差异字段清单与上游逐条相等", () => {
  const pairs = [];
  for (let index = 0; index < PAYLOAD_BATTERY.length; index += 1) {
    for (let other = index + 1; other < PAYLOAD_BATTERY.length; other += 1) {
      pairs.push([PAYLOAD_BATTERY[index], PAYLOAD_BATTERY[other]]);
    }
  }
  for (const [[leftLabel, left], [rightLabel, right]] of pairs) {
    assert.deepEqual(
      differingTopLevelFields(left, right),
      upstream.differingTopLevelFields(left, right),
      `差异字段清单漂移：${leftLabel} vs ${rightLabel}`,
    );
  }
});

test("差分：冲突错的 code / 字段形状与上游一致", () => {
  const existing = { round: 1, messages: [{ role: "user", content: [{ type: "text", text: "甲" }] }] };
  const incoming = { round: 1, messages: [{ role: "user", content: [{ type: "text", text: "乙" }] }] };
  const args = {
    runId: "run-x",
    key: "run-x:engine:round:1",
    existing,
    incoming,
    existingFingerprint: payloadFingerprint(existing),
    incomingFingerprint: payloadFingerprint(incoming),
  };
  const ours = dedupConflictError(args);
  const theirs = upstream.dedupConflictError(args);

  assert.ok(ours instanceof TranscriptDedupConflictError);
  assert.equal(ours.code, theirs.code);
  assert.equal(ours.key, theirs.key);
  assert.equal(ours.runId, theirs.runId);
  assert.deepEqual(ours.differingFields, theirs.differingFields);
  assert.deepEqual(ours.differingFields, ["messages"]);
  assert.equal(ours.existingFingerprint, theirs.existingFingerprint);
  assert.equal(ours.incomingFingerprint, theirs.incomingFingerprint);
  assert.equal(ours.message, theirs.message, "冲突错消息必须逐字一致（宿主日志/告警靠它对齐）");
});

test("指纹形状：sha256: + 24 hex；顶层四键不参与、嵌套 ts 参与", () => {
  const base = { round: 1, dedupKey: "k", roundKey: "k", ts: "t1", messages: [] };
  assert.match(payloadFingerprint(base), /^sha256:[0-9a-f]{24}$/u);

  // 顶层 volatile 四键全换 ⇒ 指纹不变（信封）
  assert.equal(
    payloadFingerprint(base),
    payloadFingerprint({ ...base, round: 99, dedupKey: "k2", roundKey: "k2", ts: "t2" }),
    "顶层 dedupKey/roundKey/round/ts 是身份/派生字段，不得参与 payload",
  );

  // 嵌套 ts ⇒ 指纹变化（内容）
  const nested = { ...base, messages: [{ role: "assistant", content: [], ts: "a" }] };
  const nestedOther = { ...base, messages: [{ role: "assistant", content: [], ts: "b" }] };
  assert.notEqual(payloadFingerprint(nested), payloadFingerprint(nestedOther));

  // 对象键排序稳定、数组保序
  assert.equal(
    payloadFingerprint({ round: 1, a: 1, b: 2 }),
    payloadFingerprint({ b: 2, round: 1, a: 1 }),
  );
  assert.notEqual(
    payloadFingerprint({ round: 1, list: [1, 2] }),
    payloadFingerprint({ round: 1, list: [2, 1] }),
  );
});
