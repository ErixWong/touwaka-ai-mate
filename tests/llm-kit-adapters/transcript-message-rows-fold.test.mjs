// erix-agent 0.23.0「一条消息一落盘」的宿主侧折叠回归（issue #1220）。
//
// 0.23 起引擎写两种 journal 行：轮行（`<runId>:engine:round:<n>`，**不带** `messages`，只留元数据）
// 与消息行（`<runId>:msg:<n>:<seq>`、`kind:"message"`、`seq` 轮内从 0 递增、`messages` 只一条，
// 且写在它描述的那次工具执行**之前**）。宿主可见形状不能变 ⇒ `store.load()` 返回前必须把消息行折回
// 轮行，于是 `records.flatMap(r => r.messages ?? [])` 仍是模型当时看到的序列。
//
// 本文件是纯函数级回归：不连库、不需要凭据，因此**始终会跑到**（`transcriptStoreContract` 在无
// 凭据时是 skip，这条不是）。上游 `docs/host-upgrade-guide-0.23.0_cn.md` §6 的四问里，问 1（原始行
// 布局）与问 2（`load()` 条数与正文完整）由这里守；问 3/问 4 在 touwaka 是空操作（全仓不消费
// `onRound(record).messages`、`snapshot.messages`，也不调 `projectTranscriptForDisplay`）。
import assert from "node:assert/strict";
import test from "node:test";

import { foldMessageRows } from "../../lib/llm-kit-adapters/transcript-store.js";

const RUN = "run_fold";
const msg = (text) => ({ role: "assistant", content: text });

/** §2 实测形状：种子轮 + 一轮（assistant 正文 + 工具结果分片）+ 一轮终稿 + 一条 control 行。 */
function engineRows023() {
  return [
    { dedupKey: `${RUN}:engine:round:0:seed`, round: 0, messages: [{ role: "system", content: "skill" }] },
    {
      dedupKey: `${RUN}:msg:1:0`,
      round: 1,
      kind: "message",
      seq: 0,
      messages: [{ role: "assistant", content: [{ type: "text", text: "A" }] }],
    },
    {
      dedupKey: `${RUN}:msg:1:1`,
      round: 1,
      kind: "message",
      seq: 1,
      partOf: `${RUN}:msg:1:0`,
      messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] }],
    },
    { dedupKey: `${RUN}:engine:round:1`, round: 1, response: { content: "A" } },
    { dedupKey: `${RUN}:msg:2:0`, round: 2, kind: "message", seq: 0, messages: [msg("B")] },
    { dedupKey: `${RUN}:engine:round:2`, round: 2, response: { content: "B" } },
    { dedupKey: `${RUN}:control:1`, round: 1, kind: "control" },
  ];
}

const pick = (records, dedupKey) => records.find((record) => record.dedupKey === dedupKey);

test("0.23 布局折叠后：每轮一条记录、正文完整、顺序与模型所见一致", () => {
  const folded = foldMessageRows(engineRows023());
  // 7 行原始账本 − 3 条被吸收的消息行 = 4 条（种子 / 轮1 / 轮2 / control）
  assert.deepEqual(folded.map((record) => record.dedupKey), [
    `${RUN}:engine:round:0:seed`,
    `${RUN}:engine:round:1`,
    `${RUN}:engine:round:2`,
    `${RUN}:control:1`,
  ]);
  assert.deepEqual(
    folded.flatMap((record) => record.messages ?? []).map((message) => message.role),
    ["system", "assistant", "assistant"],
    "flatMap 出来的序列必须等于模型当时看到的序列（§6 问 2）",
  );
  assert.equal(pick(folded, `${RUN}:engine:round:2`).messages[0].content, "B");
});

test("partOf 分片拼回同一条消息，不额外产生条目", () => {
  const folded = foldMessageRows(engineRows023());
  const round1 = pick(folded, `${RUN}:engine:round:1`);
  assert.equal(round1.messages.length, 1, "一轮的 assistant 正文 + 工具结果分片应为同一条消息链");
  assert.equal(round1.messages[0].role, "assistant", "拼接保留父消息身份");
  assert.equal(round1.messages[0].content.length, 2, "分片 content block 并入父消息");
});

test("种子轮（round 0）的初始上下文不因折叠而重复", () => {
  const folded = foldMessageRows(engineRows023());
  assert.equal(pick(folded, `${RUN}:engine:round:0:seed`).messages.length, 1);
});

test("引擎事实行不被写入 messages（只有轮行是载体）", () => {
  const folded = foldMessageRows(engineRows023());
  assert.ok(!("messages" in pick(folded, `${RUN}:control:1`)));
});

test("崩溃点：没有载体行时消息行原样保留，flatMap 仍能拼出正文", () => {
  const rows = [{
    dedupKey: `${RUN}:msg:3:0`,
    round: 3,
    kind: "message",
    seq: 0,
    messages: [msg("C")],
  }];
  const folded = foldMessageRows(rows);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].dedupKey, `${RUN}:msg:3:0`);
  assert.deepEqual(folded.flatMap((record) => record.messages ?? []), rows[0].messages);
});

test("0.23 之前的老账本原样透传（同一引用，逐字不变）", () => {
  const legacy = [{ dedupKey: `${RUN}:round:1`, round: 1, messages: [{ role: "user", content: "old" }] }];
  assert.equal(foldMessageRows(legacy), legacy, "无可折叠消息行必须返回入参本身");
});

test("宿主 appendUserTurn 的 :input: 行（无 seq）不被折叠吸走", () => {
  const rows = engineRows023();
  const inputRow = {
    dedupKey: `${RUN}:input:1`,
    round: 1,
    kind: "message",
    messages: [{ role: "user", content: "追问" }],
  };
  const folded = foldMessageRows([rows[0], inputRow, ...rows.slice(1)]);
  assert.ok(
    folded.some((record) => record.dedupKey === `${RUN}:input:1`),
    "appendUserTurn 的幂等判据是「load() 里看得见自己那条 dedupKey」，被吸走就会重复追加同一轮",
  );
});

// #1227 阶段 2 切片 B0：折叠**委托上游**，宿主侧不再保留第二份实现。
// 原先这里钉的是"同 dedupKey 的消息行重跑只入列一次"——那是本地副本自加的行级去重。
// 该形状在库里落不出来（`agent_rounds` / `agent_transcript_rounds` 的 dedup_key 都是唯一键，
// `INSERT IGNORE` 先到先得），而在折叠层静默丢一行会把「同 key 异 payload」的冲突行藏起来
//（那是 B1/B2 的靶子，上游契约格 `同 dedupKey 异 payload 明确报冲突`）。故这层去重随本地副本一起删除，
// 本格改成**锁住委托本身**：折叠函数必须**是**上游导出的那一个（防止有人再补一份副本）。
test("折叠实现 = 上游导出的 foldMessageRows（宿主侧不另存副本，#1227 B0）", async () => {
  const upstream = await import("erix-agent");
  assert.equal(typeof upstream.foldMessageRows, "function", "上游 0.29 必须从包根导出折叠函数");
  assert.equal(
    foldMessageRows,
    upstream.foldMessageRows,
    "宿主必须直接委托上游（import 别名），不得再写一份本地折叠（两份实现 = 静默漂移）",
  );
});

test("同轮多载体行时正文只挂第一条载体（上游口径），并保留载体自带的用户问题", () => {
  const folded = foldMessageRows([
    { dedupKey: `${RUN}:round:1`, round: 1, messages: [{ role: "user", content: "宿主预写" }] },
    { dedupKey: `${RUN}:msg:1:0`, round: 1, kind: "message", seq: 0, messages: [msg("A")] },
    { dedupKey: `${RUN}:engine:round:1`, round: 1 },
  ]);
  const withMessages = folded.filter((record) => Array.isArray(record.messages) && record.messages.length > 0);
  assert.equal(withMessages.length, 1, "同一轮只能有一条带正文的记录");
  assert.equal(withMessages[0].dedupKey, `${RUN}:round:1`, "载体 = 同轮第一条匹配行（上游 group.carrier === -1）");
  assert.deepEqual(
    withMessages[0].messages,
    [{ role: "user", content: "宿主预写" }, msg("A")],
    "touwaka legacy：宿主预写的用户行是该轮载体，其正文必须保留（取并集而非覆盖）",
  );
});

test("无 dedupKey / roundKey 的行不能当载体（上游 rowKey 口径）", () => {
  const rows = [{ round: 1, kind: "message", seq: 0, messages: [msg("A")] }];
  const folded = foldMessageRows(rows);
  assert.equal(folded.length, 1, "无载体 ⇒ 消息行原样保留，不把正文挂到无身份的行上");
});

test("折叠后的每条消息带它自己那一行的 ts（上游 #439）", () => {
  const carrier = { dedupKey: `${RUN}:engine:round:1`, round: 1, ts: "2026-01-01T00:00:30.000Z" };
  const folded = foldMessageRows([
    carrier,
    { dedupKey: `${RUN}:msg:1:0`, round: 1, kind: "message", seq: 0, ts: "2026-01-01T00:00:01.000Z", messages: [{ role: "user", content: [{ type: "text", text: "提问" }] }] },
    { dedupKey: `${RUN}:msg:1:1`, round: 1, kind: "message", seq: 1, ts: "2026-01-01T00:00:02.000Z", messages: [{ role: "assistant", content: [{ type: "text", text: "答" }] }] },
    { dedupKey: `${RUN}:msg:1:2`, round: 1, kind: "message", seq: 2, ts: "2026-01-01T00:00:09.000Z", partOf: `${RUN}:msg:1:1`, messages: [{ role: "assistant", content: [{ type: "text", text: "（续）" }] }] },
  ]);
  const carrierOut = folded.find((r) => r.dedupKey === `${RUN}:engine:round:1`);
  assert.equal(carrierOut.messages.length, 2, "分片不额外产生条目");
  assert.deepEqual(
    carrierOut.messages.map((m) => m.ts),
    ["2026-01-01T00:00:01.000Z", "2026-01-01T00:00:02.000Z"],
    "逐条 ts = 该行自己的 ts；分片只追加 content，不改首片已经写上的戳",
  );

  const bare = foldMessageRows([carrier, { dedupKey: `${RUN}:msg:1:0`, round: 1, kind: "message", seq: 0, messages: [{ role: "user", content: "无戳行" }] }]);
  assert.equal(
    "ts" in bare.find((r) => r.dedupKey === `${RUN}:engine:round:1`).messages[0],
    false,
    "行上没有 ts ⇒ 缺键，不写 undefined、不拿轮行 ts 去猜",
  );
});

// #1227 阶段 2 切片 B0：本格改成**升级现场**（旧载体已带折好的正文、消息行又带着自己的 ts），
// 这才是上游 issue #439 守卫真正要防的形态。原先是"两条正文相同的独立消息行只入列一条"——
// 那是本地副本按内容签名去重的副作用（会把"同一句话说了两遍"的两条逻辑消息吞成一条，静默丢正文），
// 上游不做这层去重（正文相同 ≠ 身份相同），故本格随之改为钉上游的**逐字段深比较 + 剥掉信封 ts**。
test("#439 守卫：载体已带折好的正文（无 ts）+ 消息行（带 ts）不重复入列", () => {
  const carrier = {
    dedupKey: `${RUN}:engine:round:2`,
    round: 2,
    // ≤0.24 折出来的载体：消息上没有信封 ts
    messages: [
      { role: "user", content: [{ type: "text", text: "同一条" }] },
      { role: "assistant", content: [{ type: "text", text: "同一条回答" }] },
    ],
  };
  const folded = foldMessageRows([
    carrier,
    { dedupKey: `${RUN}:msg:2:0`, round: 2, kind: "message", seq: 0, ts: "2026-01-01T00:00:01.000Z", messages: [{ role: "user", content: [{ type: "text", text: "同一条" }] }] },
    { dedupKey: `${RUN}:msg:2:1`, round: 2, kind: "message", seq: 1, ts: "2026-01-01T00:00:02.000Z", messages: [{ role: "assistant", content: [{ type: "text", text: "同一条回答" }] }] },
  ]);
  const out = folded.find((r) => r.dedupKey === `${RUN}:engine:round:2`);
  assert.equal(out.messages.length, 2, "信封 ts 不参与身份判定：已折过的正文不得因 ts 差异再折一遍");
  assert.equal(
    folded.filter((record) => record.kind === "message").length,
    0,
    "消息行是重复副本，不得作为独立行留在结果里",
  );
  assert.deepEqual(out.messages.map((m) => m.content[0].text), ["同一条", "同一条回答"]);
});
