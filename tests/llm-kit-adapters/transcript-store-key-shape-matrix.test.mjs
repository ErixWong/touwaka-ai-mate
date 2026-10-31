/**
 * 阶段 2 · 切片 A2（issue #1227）：键形状矩阵（本地资产，不依赖上游套件）。
 *
 * 目的：把「同一套折叠/探针判据」放到**真实 MariaDB + 生产适配链**上，对 0.23 起引擎会写出的
 * 每一种行形状逐类断言其归宿，让阶段 2 的改动有可回归的靶子：
 *   - 哪些行被判成**载体行**（消息折回它身上）；
 *   - 哪些行被**折叠吸走**（不再作为独立行出现在 `load()` 里）；
 *   - `loadByDedupKey` / `loadMaxRound` 两条成对探针能不能命中。
 *
 * 适配链与生产一致：
 *   `createErixStore({db, requestContext})`（lib/llm-kit-adapters/loop-bridge.js）
 *   → `createTouwakaTranscriptStore`（lib/llm-kit-adapters/transcript-store.js）
 *   → 真库 `llm_kit_test`（先过 tests/helpers/test-db-guard.mjs 的 #1167 硬断言）。
 *
 * ── 本文件覆盖的行形状（工单 A2 清单）───────────────────────────────────────────────
 *  1. 引擎轮行        `<runId>:engine:round:<n>`
 *  2. 逐条消息行      `<runId>:msg:<round>:<seq>`（`kind:"message"` + 安全整数 `seq`）
 *  3. 种子行          `…:engine:round:0:seed`
 *  4. resume 载体行   `…:engine:round:<n>:resume`
 *  5. 控制行          `…:engine:round:<n>:control:<slot>`
 *  6. 宿主追问行      `<runId>:input:<…>`
 *  7. 只有 `roundKey` 没有 `dedupKey` 的行
 *  8. 宿主预写行      `{round, messages:[单条 user/text], dedupKey, roundKey, ts}`（上游
 *     `src/store/append-user-turn.js:161-167` 的**正确**形状）及其错误形状
 *     （多带 `kind:"message"` / 多带安全整数 `seq` / 两者都带）
 *
 * ── 已知缺陷（本文件钉成**会红**的用例，不 skip、不放宽）──────────────────────────
 * **写侧身份键缺 `roundKey` 回落**：
 *   - 我们写侧（canonical）：`lib/llm-kit-adapters/transcript-store.js:150`
 *       `const key = dedupKey ?? `${runId}:round:${record?.round}``
 *   - 上游身份键：`node_modules/erix-agent/src/store/transcript-dedup.js:72-76`
 *       `recordKey = record?.dedupKey ?? record?.roundKey ?? `${runId}:round:${round}``
 *   - 折叠侧（#1227 阶段 2 切片 B0 起**委托上游**，不再是本地副本）：上游
 *       `node_modules/erix-agent/src/store/message-rows.js` 的 `rowKey` = `dedupKey ?? roundKey`
 * 后果：同一条逻辑记录（roundKey 相同、payload 相同，只有 `round`/`ts` 漂移）在写侧被算成
 * 两个不同的 key ⇒ 落两行；而折叠侧与上游都认它们是同一个身份。`load()` 因此重复正文，
 * 且上游「崩溃重跑形状仍判幂等」的判据在这里失效。
 * 该缺陷由 `roundKey-only 记录写两次（round/ts 漂移）应幂等` 与
 * `第二次显式带 dedupKey===roundKey 应幂等` 两格钉住；两格都**预期红**。
 * 参照系：同一序列喂上游 `createMemoryTranscriptStore` 应只落一行（绿格，证明是「我们缺回落」
 * 而不是「上游也这样」）。
 *
 * ── 一个与上游不一致、但**不是**缺陷的观察（不改断言方向）──────────────────────────
 * 对「只有 roundKey」的行，探针 `loadByDedupKey(runId, <写侧隐式键>)` 会 miss：
 * 候选行是 SQL `dedup_key = :probe` 命中的，但 JS 判据 `(dedupKey ?? roundKey) === probe`
 * 用的是 roundKey ⇒ miss。这与上游**一致**（上游 recordKey 也优先 roundKey，探针同样按
 * roundKey 命中），所以本文件把它断言成「miss」，不当作缺陷。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// logs/ 目录可能非本用户属主：屏蔽文件写入，别让日志权限错误掩盖数据库结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import { openTestDatabase, DEFAULT_CREDS_PATH } from "../helpers/test-db-guard.mjs";

// 生产默认档：canonical 真相。
process.env.ERIX_TRANSCRIPT_READ_MODE = "new";

const { createErixStore } = await import("../../lib/llm-kit-adapters/loop-bridge.js");
const { createMemoryTranscriptStore } = await import("erix-agent");

const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const db = dbCtx?.db ?? null;

/** 本文件独占的 request_id 前缀，只清自己写入的行。 */
const PREFIX = `kcs-${randomUUID().slice(0, 8)}-`;
const runId = (label) => `${PREFIX}${label}`;

const TS = (second) => `2026-08-30T00:00:${String(second).padStart(2, "0")}.000Z`;
const text = (value) => ({ type: "text", text: value });
const userText = (value) => ({ role: "user", content: [text(value)] });
const assistantText = (value) => ({ role: "assistant", content: [text(value)] });

let requestContext = null;

async function cleanup() {
  if (!db) return;
  const pattern = `${PREFIX}%`;
  const [rounds] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern } },
  );
  const roundIds = rounds.map((row) => row.id);
  if (roundIds.length > 0) {
    await db.sequelize.query(
      "DELETE FROM messages WHERE round_id IN (:roundIds)",
      { replacements: { roundIds } },
    );
    await db.sequelize.query(
      "DELETE FROM chat_tool_calls WHERE round_id IN (:roundIds)",
      { replacements: { roundIds } },
    );
  }
  await db.sequelize.query(
    "DELETE FROM messages WHERE request_id LIKE :pattern",
    { replacements: { pattern } },
  );
  await db.sequelize.query(
    "DELETE FROM chat_tool_calls WHERE request_id LIKE :pattern",
    { replacements: { pattern } },
  );
  await db.sequelize.query(
    "DELETE FROM agent_transcript_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern } },
  );
  await db.sequelize.query(
    "DELETE FROM agent_rounds WHERE request_id LIKE :pattern",
    { replacements: { pattern } },
  );
}

if (creds) {
  const [userRows] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  requestContext = {
    topic_id: null,
    user_id: userRows?.[0]?.id ?? "u_key_shape_matrix",
    expert_id: null,
  };
}

const store = () => createErixStore({ db, requestContext });

after(async () => {
  await cleanup();
  if (db && typeof db.close === "function") {
    await db.close();
  } else if (db?.sequelize) {
    await db.sequelize.close();
  }
});

if (!creds) {
  test("键形状矩阵（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  // ────────────────────────────────────────────────────────────────────────────────
  // 1. 引擎轮行 = 载体；消息行 = 被吸走
  // ────────────────────────────────────────────────────────────────────────────────
  test("形状①引擎轮行：判成载体，消息行按 seq 折回并被吸走（探针按各自 key 命中）", async () => {
    const r = runId("engine-carrier");
    const s = store();
    await s.appendRound(r, {
      round: 1,
      dedupKey: `${r}:engine:round:1`,
      roundKey: `${r}:round:1`,
      ts: TS(0),
    });
    await s.appendRound(r, {
      round: 1,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:1:0`,
      ts: TS(1),
      messages: [userText("q")],
    });
    await s.appendRound(r, {
      round: 1,
      kind: "message",
      seq: 1,
      dedupKey: `${r}:msg:1:1`,
      ts: TS(2),
      messages: [assistantText("a")],
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 1, "两条消息行必须被吸走，只剩载体一行");
    assert.equal(loaded[0].dedupKey, `${r}:engine:round:1`, "载体身份 = 引擎轮行 key");
    assert.deepEqual(
      loaded[0].messages.map((message) => message.content[0].text),
      ["q", "a"],
      "正文按 seq 折回载体",
    );
    assert.equal(loaded[0].messages[0].ts, TS(1), "被折叠的消息保留自己那一行的 ts（#439 A）");

    // 探针：载体 key 命中折叠后的轮记录；消息行 key 命中**原始消息行**（探针不折叠）
    const carrierProbe = await s.loadByDedupKey(r, `${r}:engine:round:1`);
    assert.equal(carrierProbe?.dedupKey, `${r}:engine:round:1`);
    const rawMessageRow = await s.loadByDedupKey(r, `${r}:msg:1:0`);
    assert.equal(rawMessageRow?.kind, "message", "探针是原始行探针，不折叠（上游 message-rows.js 文件头）");
    assert.equal(rawMessageRow?.seq, 0);
    assert.equal(await s.loadMaxRound(r), 1);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 2. 种子行 = 不是载体（key 以 :seed 结尾）
  // ────────────────────────────────────────────────────────────────────────────────
  test("形状②种子行：保留正文但不当载体；round 0 的消息行因无载体而原样留存", async () => {
    const r = runId("seed");
    const s = store();
    await s.appendRound(r, {
      round: 0,
      dedupKey: `${r}:engine:round:0:seed`,
      ts: TS(0),
      messages: [userText("initial context")],
    });
    await s.appendRound(r, {
      round: 0,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:0:0`,
      ts: TS(1),
      messages: [assistantText("round0 message row")],
    });
    await s.appendRound(r, {
      round: 1,
      dedupKey: `${r}:engine:round:1`,
      roundKey: `${r}:round:1`,
      ts: TS(2),
    });
    await s.appendRound(r, {
      round: 1,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:1:0`,
      ts: TS(3),
      messages: [assistantText("round1 body")],
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 3, "种子行 + round0 消息行（无载体，原样留）+ round1 载体");
    assert.equal(loaded[0].dedupKey, `${r}:engine:round:0:seed`);
    assert.deepEqual(loaded[0].messages, [userText("initial context")], "种子正文不得被改写");
    assert.equal(loaded[1].dedupKey, `${r}:msg:0:0`, "round 0 无载体 ⇒ 消息行原样留在结果里");
    assert.equal(loaded[2].dedupKey, `${r}:engine:round:1`);
    assert.deepEqual(
      loaded[2].messages.map((message) => message.content[0].text),
      ["round1 body"],
      "round 1 正文照常折回",
    );

    const seedProbe = await s.loadByDedupKey(r, `${r}:engine:round:0:seed`);
    assert.deepEqual(seedProbe?.messages, [userText("initial context")]);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 3. resume 载体行
  // ────────────────────────────────────────────────────────────────────────────────
  test("形状③resume 载体行：判成载体，与自带正文取并集", async () => {
    const r = runId("resume-carrier");
    const s = store();
    await s.appendRound(r, {
      round: 2,
      dedupKey: `${r}:engine:round:2:resume`,
      roundKey: `${r}:round:2`,
      ts: TS(0),
      messages: [userText("direction hint")],
    });
    await s.appendRound(r, {
      round: 2,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:2:0`,
      ts: TS(1),
      messages: [assistantText("engine body")],
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 1, "resume 行是载体，消息行被吸走");
    assert.equal(loaded[0].dedupKey, `${r}:engine:round:2:resume`);
    assert.deepEqual(
      loaded[0].messages.map((message) => message.content[0].text),
      ["direction hint", "engine body"],
      "载体自带正文保留在前，消息行按 seq 追加在后",
    );
    const probe = await s.loadByDedupKey(r, `${r}:engine:round:2:resume`);
    assert.equal(probe?.dedupKey, `${r}:engine:round:2:resume`);
  });

  test("形状③′同轮两条载体：只认第一条载体（引擎轮行先落时 resume 行不被合并）", async () => {
    const r = runId("two-carriers");
    const s = store();
    await s.appendRound(r, {
      round: 3,
      dedupKey: `${r}:engine:round:3`,
      roundKey: `${r}:round:3`,
      ts: TS(0),
    });
    await s.appendRound(r, {
      round: 3,
      dedupKey: `${r}:engine:round:3:resume`,
      roundKey: `${r}:round:3`,
      ts: TS(1),
      messages: [userText("resume hint")],
    });
    await s.appendRound(r, {
      round: 3,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:3:0`,
      ts: TS(2),
      messages: [assistantText("engine body")],
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 2, "同轮两条载体都保留（不合并成一条）");
    assert.deepEqual(
      loaded[0].messages.map((message) => message.content[0].text),
      ["engine body"],
      "正文挂到**第一条**载体",
    );
    assert.deepEqual(
      loaded[1].messages.map((message) => message.content[0].text),
      ["resume hint"],
      "后到的载体保持自己的正文",
    );
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 4. 控制行
  // ────────────────────────────────────────────────────────────────────────────────
  test("形状④控制行：不是载体、不被吸走，原样独立留存（探针命中）", async () => {
    const r = runId("control");
    const s = store();
    await s.appendRound(r, {
      round: 1,
      dedupKey: `${r}:engine:round:1`,
      roundKey: `${r}:round:1`,
      ts: TS(0),
    });
    await s.appendRound(r, {
      round: 1,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:1:0`,
      ts: TS(1),
      messages: [assistantText("body")],
    });
    await s.appendRound(r, {
      round: 1,
      kind: "control",
      dedupKey: `${r}:engine:round:1:control:judge`,
      ts: TS(2),
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 2, "控制行既不折进载体也不吸走消息行");
    assert.deepEqual(
      loaded.map((record) => record.dedupKey),
      [`${r}:engine:round:1`, `${r}:engine:round:1:control:judge`],
    );
    assert.equal(loaded[1].messages, undefined, "控制行无正文");
    assert.equal(
      loaded.flatMap((record) => record.messages ?? []).length,
      1,
      "控制行不污染 flatMap 的正文序列",
    );
    assert.equal((await s.loadByDedupKey(r, `${r}:engine:round:1:control:judge`))?.kind, "control");
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 5. 宿主追问行（appendUserTurn 预写）
  // ────────────────────────────────────────────────────────────────────────────────
  test("形状⑤宿主追问行：不是载体、不被吸走（appendUserTurn 幂等判据依赖它可见）", async () => {
    const r = runId("input-row");
    const s = store();
    const inputKey = `${r}:input:m1`;
    await s.appendRound(r, {
      round: 1,
      dedupKey: `${r}:engine:round:1`,
      roundKey: `${r}:round:1`,
      ts: TS(0),
    });
    await s.appendRound(r, {
      round: 1,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:1:0`,
      ts: TS(1),
      messages: [assistantText("engine body")],
    });
    await s.appendRound(r, {
      round: 1,
      messages: [userText("follow-up question")],
      dedupKey: inputKey,
      roundKey: inputKey,
      ts: TS(2),
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 2, "追问行必须作为独立行可见");
    const inputRow = loaded.find((record) => record.dedupKey === inputKey);
    assert.ok(inputRow !== undefined, "load() 里必须看得见自己的 dedupKey（appendUserTurn 幂等判据）");
    assert.deepEqual(inputRow.messages, [userText("follow-up question")]);
    assert.deepEqual(
      loaded.flatMap((record) => record.messages ?? []).map((message) => message.content[0].text),
      ["engine body", "follow-up question"],
    );
    assert.equal((await s.loadByDedupKey(r, inputKey))?.dedupKey, inputKey);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 6. 只有 roundKey、没有 dedupKey
  // ────────────────────────────────────────────────────────────────────────────────
  test("形状⑥只有 roundKey：以 :round:<n> 结尾的当载体，其余不当载体", async () => {
    const r = runId("roundkey-only");
    const s = store();
    // (a) 可当载体：roundKey 以 :round:3 结尾
    await s.appendRound(r, {
      round: 3,
      roundKey: `${r}:round:3`,
      ts: TS(0),
      messages: [userText("carrier body")],
    });
    await s.appendRound(r, {
      round: 3,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:3:0`,
      ts: TS(1),
      messages: [assistantText("folded into roundKey carrier")],
    });
    // (b) 不可当载体：roundKey 不以 :round:<n> 结尾
    const rkInput = `${r}:input:rk-only`;
    await s.appendRound(r, { round: 4, roundKey: rkInput, ts: TS(2), messages: [userText("rk row")] });

    const loaded = await s.load(r);
    const round3 = loaded.filter((record) => record.round === 3);
    assert.equal(round3.length, 1, "roundKey-only 载体吸收 round 3 的消息行");
    assert.equal(round3[0].dedupKey, undefined, "canonical record_json 里没有 dedupKey（写入方没给）");
    assert.equal(round3[0].roundKey, `${r}:round:3`);
    assert.deepEqual(
      round3[0].messages.map((message) => message.content[0].text),
      ["carrier body", "folded into roundKey carrier"],
    );
    const round4 = loaded.filter((record) => record.round === 4);
    assert.equal(round4.length, 1, "非载体形状的 roundKey-only 行原样独立留存");
    assert.equal(round4[0].roundKey, rkInput);

    // 写侧实际落库的 dedup_key 是**隐式键**，不是 roundKey —— 这就是「写侧缺 roundKey 回落」
    // 的可见证据（上游 recordKey 会写 roundKey）。
    const [columns] = await db.sequelize.query(
      "SELECT round_no, dedup_key FROM agent_transcript_rounds WHERE request_id = :r ORDER BY round_no ASC",
      { replacements: { r } },
    );
    // 只看轮行（排除 :msg: 消息行），逐条钉住写侧落的 dedup_key 列值。
    const carrierKeys = columns
      .filter((row) => !String(row.dedup_key).includes(":msg:"))
      .map((row) => [row.round_no, row.dedup_key]);
    assert.deepEqual(
      carrierKeys,
      [[3, `${r}:round:3`], [4, `${r}:round:4`]],
      "写侧身份键 = dedupKey ?? <runId>:round:<n>；roundKey 不参与（上游是 dedupKey ?? roundKey ?? 派生）",
    );
    assert.equal(
      columns.some((row) => row.dedup_key === rkInput),
      false,
      "roundKey 的值没有成为写侧身份键（缺回落）",
    );

    // 探针：按 roundKey 都能命中（上游 nullish 判据）
    assert.equal((await s.loadByDedupKey(r, `${r}:round:3`))?.roundKey, `${r}:round:3`);
    assert.equal((await s.loadByDedupKey(r, rkInput))?.roundKey, rkInput);
    // 按写侧隐式键查 round 4：SQL 列命中了，但 JS 判据落到 roundKey ⇒ miss。
    // 与上游一致（上游 recordKey 优先 roundKey），故断言 miss 而不是缺陷。
    assert.equal(await s.loadByDedupKey(r, `${r}:round:4`), null);
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 7. 宿主预写行：正确形状 vs 错误形状
  // ────────────────────────────────────────────────────────────────────────────────
  test("形状⑦宿主预写行（正确形状）：独立留存，不被折叠吸走", async () => {
    const r = runId("prewrite-correct");
    const s = store();
    const inputKey = `${r}:input:m9`;
    await s.appendRound(r, { round: 2, dedupKey: `${r}:engine:round:2`, roundKey: `${r}:round:2`, ts: TS(0) });
    await s.appendRound(r, {
      round: 2,
      kind: "message",
      seq: 0,
      dedupKey: `${r}:msg:2:0`,
      ts: TS(1),
      messages: [assistantText("engine body")],
    });
    // 上游 src/store/append-user-turn.js:161-167 的正确形状：无 kind、无 seq
    await s.appendRound(r, {
      round: 2,
      messages: [userText("pre-written user row")],
      dedupKey: inputKey,
      roundKey: inputKey,
      ts: TS(2),
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 2, "正确形状的预写行不被吸走");
    assert.ok(loaded.some((record) => record.dedupKey === inputKey));
  });

  test("形状⑦′错误形状：只多带 kind:\"message\"（无 seq）——仍不被吸走（可折叠需 kind+seq 同时成立）", async () => {
    const r = runId("prewrite-kind-only");
    const s = store();
    const inputKey = `${r}:input:m10`;
    await s.appendRound(r, { round: 2, dedupKey: `${r}:engine:round:2`, roundKey: `${r}:round:2`, ts: TS(0) });
    await s.appendRound(r, {
      round: 2,
      kind: "message",
      messages: [userText("kind only")],
      dedupKey: inputKey,
      roundKey: inputKey,
      ts: TS(1),
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 2, "缺 seq ⇒ 不是可折叠消息行");
    assert.ok(loaded.some((record) => record.dedupKey === inputKey));
  });

  test("形状⑦″错误形状：只多带安全整数 seq（无 kind）——仍不被吸走", async () => {
    const r = runId("prewrite-seq-only");
    const s = store();
    const inputKey = `${r}:input:m11`;
    await s.appendRound(r, { round: 2, dedupKey: `${r}:engine:round:2`, roundKey: `${r}:round:2`, ts: TS(0) });
    await s.appendRound(r, {
      round: 2,
      seq: 0,
      messages: [userText("seq only")],
      dedupKey: inputKey,
      roundKey: inputKey,
      ts: TS(1),
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 2, "缺 kind ⇒ 不是可折叠消息行");
    assert.ok(loaded.some((record) => record.dedupKey === inputKey));
  });

  test("形状⑦‴错误形状：kind+seq 同时带上 ⇒ 被折叠吸走（appendUserTurn 幂等判据失效的危险形状）", async () => {
    const r = runId("prewrite-kind-and-seq");
    const s = store();
    const inputKey = `${r}:input:m12`;
    await s.appendRound(r, { round: 2, dedupKey: `${r}:engine:round:2`, roundKey: `${r}:round:2`, ts: TS(0) });
    await s.appendRound(r, {
      round: 2,
      kind: "message",
      seq: 0,
      messages: [userText("kind and seq")],
      dedupKey: inputKey,
      roundKey: inputKey,
      ts: TS(1),
    });

    const loaded = await s.load(r);
    assert.equal(loaded.length, 1, "kind+seq 齐全 ⇒ 被判成可折叠消息行并吸进载体");
    assert.equal(
      loaded.some((record) => record.dedupKey === inputKey),
      false,
      "预写行的 dedupKey 在 load() 里不可见 ⇒ appendUserTurn 会重复追加（危险形状，钉住现状）",
    );
    assert.deepEqual(
      loaded[0].messages.map((message) => message.content[0].text),
      ["kind and seq"],
      "正文被折进载体（不丢失，但身份消失）",
    );
  });

  // ────────────────────────────────────────────────────────────────────────────────
  // 8. 已知缺陷（预期红）：写侧身份键缺 roundKey 回落
  // ────────────────────────────────────────────────────────────────────────────────
  test("缺陷·写侧身份键缺 roundKey 回落：同 roundKey-only 记录写两次（round/ts 漂移）应幂等", async () => {
    const r = runId("roundkey-write-identity");
    const s = store();
    const roundKey = `${r}:input:k1`;
    const payload = () => [{ role: "user", content: [text("same payload")] }];

    await s.appendRound(r, { round: 4, roundKey, ts: TS(0), messages: payload() });
    await s.appendRound(r, { round: 9, roundKey, ts: TS(1), messages: payload() });

    const loaded = await s.load(r);
    // 上游判据：recordKey = dedupKey ?? roundKey ?? 派生（transcript-dedup.js:72-76），
    // payload 摘要排除 round/ts（PAYLOAD_VOLATILE_FIELDS，同文件 :35-38）⇒ 应判幂等 no-op，只落一行。
    assert.equal(
      loaded.length,
      1,
      "上游 recordKey 会回落到 roundKey：同 key + 同 payload（round/ts 是 volatile）应幂等；"
        + `实测落 ${String(loaded.length)} 行 ⇒ 写侧身份键缺 roundKey 回落（transcript-store.js:150）`,
    );
  });

  test("缺陷·写侧身份键缺 roundKey 回落：第二次显式带 dedupKey===roundKey 也应幂等", async () => {
    const r = runId("roundkey-explicit-dedup");
    const s = store();
    const roundKey = `${r}:input:k2`;
    const payload = () => [{ role: "user", content: [text("same payload")] }];

    await s.appendRound(r, { round: 4, roundKey, ts: TS(0), messages: payload() });
    await s.appendRound(r, { round: 4, roundKey, dedupKey: roundKey, ts: TS(0), messages: payload() });

    const loaded = await s.load(r);
    assert.equal(
      loaded.length,
      1,
      "同一条逻辑记录（dedupKey 是 volatile，payload 只有 messages）写两次应幂等；"
        + `实测落 ${String(loaded.length)} 行（第一次按隐式键 ${r}:round:4、第二次按 roundKey）`,
    );
  });

  // 参照系：把同两条序列喂上游 memory store，证明「只落一行」是上游语义而非我们的臆想。
  test("参照系·上游 createMemoryTranscriptStore 对同一 roundKey-only 序列判幂等（应绿）", async () => {
    const r = runId("upstream-oracle");
    const roundKey = `${r}:input:k1`;
    const payload = () => [{ role: "user", content: [text("same payload")] }];
    const upstream = createMemoryTranscriptStore();

    await upstream.appendRound(r, { round: 4, roundKey, ts: TS(0), messages: payload() });
    await upstream.appendRound(r, { round: 9, roundKey, ts: TS(1), messages: payload() });
    assert.equal((await upstream.load(r)).length, 1, "上游按 recordKey（含 roundKey 回落）判幂等");

    await upstream.appendRound(r, { round: 4, roundKey, dedupKey: roundKey, ts: TS(0), messages: payload() });
    assert.equal((await upstream.load(r)).length, 1, "显式 dedupKey 与 roundKey 同值仍是同一身份");
  });
}
