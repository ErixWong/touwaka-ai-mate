/**
 * payload 指纹与「同 key 异 payload」冲突错（issue #1227 阶段 2 切片 B2）。
 *
 * ── 为什么这里有一份本地实现（而不是 import 上游）──────────────────────────────────
 * 上游判据的唯一真相在 `erix-agent/src/store/transcript-dedup.js`（0.29.0），但它是
 * **引擎内部模块**（该文件头自述「不发公共面」），包的 `exports` 只有
 * `.` / `./tools` / `./contract-tests` 三档：
 *   `node -e "import('erix-agent/src/store/transcript-dedup.js')"`
 *   ⇒ `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './src/store/transcript-dedup.js'
 *      is not defined by "exports"`
 *   `node -p "Object.keys(require('erix-agent')).filter(k=>/dedup|fingerprint/i.test(k))"`
 *   ⇒ `[]`（包根没有任何 dedup/fingerprint 符号；0.29.0 实测，2026-10-31）
 * 所以只能本地复制判据（与 B1 的 `recordKey` 同一处理）。**上游改判据时靠契约格翻红兜底**：
 * `tests/llm-kit-adapters/transcript-store-upstream-contract.test.mjs` 直接跑上游
 * `erix-agent/contract-tests` 的 `transcriptStoreContract`，其中 4 格专盯本模块：
 *   · `同 dedupKey 重放同 payload 是幂等 no-op（字段顺序不算差异）`
 *   · `崩溃重跑形状（顶层 ts/round 漂了）仍判幂等，不得误判成冲突`
 *   · `同 dedupKey 异 payload 明确报冲突，既不覆盖也不静默丢弃`
 *   · `数组顺序与嵌套字段是 payload 的一部分（顺序换了就是冲突）`
 *   · `宿主自有未知字段也算 payload（多一个字段就是冲突）`
 *   · `回落到 roundKey 与隐式 <runId>:round:<n> 键时判据一致`
 * 另有一道**差分守卫**：`tests/llm-kit-adapters/transcript-payload-fingerprint.test.mjs`
 * 用文件路径直载上游这份模块（绕过 exports map），对同一批 payload 逐条比对指纹，
 * 本地副本与上游算出的 `sha256:` 必须逐字相等；上游搬走/改名该文件时该测试会红并点名。
 *
 * ── 逐条对照（上游坐标 → 本文件位置）────────────────────────────────────────────
 * | 上游 `src/store/transcript-dedup.js`            | 本文件                        |
 * |-------------------------------------------------|-------------------------------|
 * | `:29` `DEDUP_CONFLICT_CODE`                     | 同名常量（:55）                |
 * | `:35` `PAYLOAD_VOLATILE_FIELDS`（四个顶层键）    | 同名常量（:61）                |
 * | `:43` `TranscriptDedupConflictError`            | 同名类（:69）                  |
 * | `:79` `canonicalJson`（键排序 / 数组保序 / 非 JSON 叶子兜底） | `canonicalJson`（:101） |
 * | `:112` `payloadOf`（剥**顶层**四键，嵌套不动）   | `payloadOf`（:134）            |
 * | `:123` `digest`（sha256 取前 24 hex，`sha256:` 前缀） | `digest`（:145）         |
 * | `:133` `payloadFingerprint`                     | 同名导出（:155）               |
 * | `:150` `dedupConflictError`（错消息形状）        | 同名导出（:174）               |
 * | `:188` `differingTopLevelFields`（顶层差异字段，前 8 个） | 同名导出（:212）      |
 * 上游没有 `isDedupConflict()` 这个符号（0.29.0 实测 `grep -rn isDedupConflict` 只命中
 * 契约套件里**测试自带的**局部 helper `test/contract/transcript-store.js:528`），故本模块
 * 也不发明它：宿主判据就是 `error.code === DEDUP_CONFLICT_CODE`，与上游契约逐字一致。
 *
 * ── 判据要点（与上游一字不差，改任一条都要先改上游）────────────────────────────────
 * · 摘要 = `sha256:` + sha256(canonicalJson(payload)) 前 24 位十六进制；
 * · 规范化：对象**逐层排序键**（字段顺序不是语义）、数组**保序**（消息顺序是语义）、
 *   `undefined`/函数/symbol 作为对象成员丢弃、`NaN`/`Infinity` 记成 `null`；
 * · 排除的只有**顶层** `dedupKey` / `roundKey` / `round` / `ts`；嵌套层级的 `ts` 是内容，
 *   照常参与摘要（崩溃重跑时漂的是顶层 `ts`，不是消息里的 `ts`）。
 *
 * 不落新列（零 DDL）：canonical 存着完整 `record_json`，已有行的指纹随时可重算。
 */

import { createHash } from "node:crypto";

/** 可判定的错误码：宿主不必 `instanceof` 也能分流（上游 `transcript-dedup.js:29`）。 */
export const DEDUP_CONFLICT_CODE = "dedup_payload_conflict";

/**
 * 顶层「身份 / 派生 / 墙钟」字段：说明这条记录是谁、什么时候写的，**不属于** payload。
 * 只排除顶层同名键，嵌套层级照常参与摘要（上游 `transcript-dedup.js:35`）。
 */
export const PAYLOAD_VOLATILE_FIELDS = Object.freeze(["dedupKey", "roundKey", "round", "ts"]);

const VOLATILE = new Set(PAYLOAD_VOLATILE_FIELDS);

/**
 * 同 key 携带不同 payload 时抛出的错误（形状与上游 `transcript-dedup.js:43` 的
 * `TranscriptDedupConflictError` 一致；`name` 与 `NotesStoreError` 同风格）。
 */
export class TranscriptDedupConflictError extends Error {
  /**
   * @param {string} message
   * @param {{
   *   runId?: string,
   *   key?: string,
   *   existingFingerprint?: string,
   *   incomingFingerprint?: string,
   *   differingFields?: string[]
   * }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "TranscriptDedupConflictError";
    this.code = DEDUP_CONFLICT_CODE;
    this.runId = details.runId;
    this.key = details.key;
    this.existingFingerprint = details.existingFingerprint;
    this.incomingFingerprint = details.incomingFingerprint;
    this.differingFields = details.differingFields ?? [];
  }
}

/**
 * 规范化 JSON（上游 `transcript-dedup.js:79` 逐条同式）。
 * 为什么不用 `JSON.stringify` 裸打：它保留对象插入顺序（同一条记录换个字段顺序就换指纹），
 * 且遇到 `bigint` / 循环引用会直接抛。
 *
 * @param {any} value
 * @param {WeakSet<object>} seen
 * @returns {string}
 */
function canonicalJson(value, seen) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "undefined" || type === "function" || type === "symbol") return "null";
  if (type === "bigint") return JSON.stringify(String(value));
  if (type !== "object") return JSON.stringify(value) ?? "null";
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  try {
    const toJSON = /** @type {{ toJSON?: () => any }} */ (value).toJSON;
    if (typeof toJSON === "function") return canonicalJson(toJSON.call(value), seen);
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    }
    const parts = [];
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      const childType = typeof child;
      // 与 JSON.stringify 同取舍：对象成员里的 undefined/函数/symbol 整个丢掉。
      if (childType === "undefined" || childType === "function" || childType === "symbol") continue;
      parts.push(`${JSON.stringify(key)}:${canonicalJson(child, seen)}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * 参与摘要的那一份：顶层身份/派生字段剥掉，其余原样（上游 `transcript-dedup.js:112`）。
 * @param {any} record
 * @returns {any}
 */
function payloadOf(record) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  const kept = {};
  for (const [field, value] of Object.entries(record)) {
    if (VOLATILE.has(field)) continue;
    kept[field] = value;
  }
  return kept;
}

/** @param {any} value @returns {string} */
function digest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value, new WeakSet())).digest("hex").slice(0, 24)}`;
}

/**
 * payload 摘要（幂等/冲突的唯一判据，上游 `transcript-dedup.js:133`）。
 * 同 key 的两份记录摘要相等 ⇒ 同一份 payload ⇒ 幂等跳过；不等 ⇒ 明确冲突。
 * @param {any} record
 * @returns {string} 形如 `sha256:<24 hex>`
 */
export function payloadFingerprint(record) {
  return digest(payloadOf(record));
}

/**
 * 冲突错误（上游 `transcript-dedup.js:150`）：消息里带 runId、key、两份 payload 指纹，
 * 以及（拿得出发散点时）顶层差异字段名清单。
 * `existing` 传 `undefined` 表示「既有 payload 取不到正文，只能比指纹」。
 *
 * @param {{
 *   runId: string,
 *   key: string,
 *   existing: any,
 *   incoming: any,
 *   existingFingerprint: string,
 *   incomingFingerprint: string
 * }} input
 * @returns {TranscriptDedupConflictError}
 */
export function dedupConflictError({
  runId,
  key,
  existing,
  incoming,
  existingFingerprint,
  incomingFingerprint,
}) {
  const differingFields = differingTopLevelFields(existing, incoming);
  const where = differingFields.length > 0
    ? ` differing top-level fields: ${differingFields.join(", ")}.`
    : "";
  return new TranscriptDedupConflictError(
    `transcript appendRound dedup conflict (runId=${runId}, key=${key}):`
      + ` a record with this key is already persisted but its payload differs`
      + ` (existingFingerprint=${existingFingerprint}, incomingFingerprint=${incomingFingerprint}).`
      + ` Same-key append with a different payload is rejected — no overwrite, no silent drop;`
      + ` the stored record stays as-is.${where}`
      + ` Payload fingerprint = sha256 over the canonical JSON of the record with the top-level`
      + ` identity/volatile fields (${PAYLOAD_VOLATILE_FIELDS.join(", ")}) removed;`
      + ` object keys are sorted, array order is kept.`,
    {
      runId,
      key,
      existingFingerprint,
      incomingFingerprint,
      differingFields,
    },
  );
}

/**
 * 诊断用：两份记录的顶层差异字段名（含只在一侧出现的字段；上游 `transcript-dedup.js:188`）。
 * 既有侧取不到正文时返回空数组。名字排序后取前 8 个，避免一条错误消息把整个字段表抄完。
 * @param {any} existing
 * @param {any} incoming
 * @returns {string[]}
 */
export function differingTopLevelFields(existing, incoming) {
  if (!isPlainLike(existing) || !isPlainLike(incoming)) return [];
  const names = new Set([...Object.keys(payloadOf(existing)), ...Object.keys(payloadOf(incoming))]);
  const differing = [];
  for (const name of [...names].sort()) {
    if (digest(payloadOf(existing)[name]) !== digest(payloadOf(incoming)[name])) {
      differing.push(name);
    }
  }
  return differing.slice(0, 8);
}

/** @param {any} value @returns {boolean} */
function isPlainLike(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
