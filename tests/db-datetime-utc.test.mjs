/**
 * issue #1282：DATETIME 列写入口径回归（**必须在 TZ=Asia/Shanghai 的子进程里跑**）
 *
 * ── 病 ────────────────────────────────────────────────────────────────────────
 * `messages.created_at` 有两条 Sequelize 序列化通道，口径不同：
 *   - 模型写入 `Model.create({ created_at: new Date() })` → Sequelize DATE serializer
 *     ⇒ 落 **UTC 挂钟**（正确）；
 *   - 裸 SQL + replacements（`SqlString.escape(Date)`）⇒ 落 **进程本地挂钟**（错）。
 * 进程 `TZ=UTC` 时两者重合（生产容器恰好如此，属巧合）；`TZ≠UTC` 时同一轮里模型写的
 * 行与裸 SQL 写的行差整 8 小时（实测 28800 秒），跨角色按 `created_at` 排序即错乱。
 *
 * ── 本文件为什么这样写（三条都是「防假绿」的硬约束）──────────────────────────
 * 1. **子进程 + 显式 TZ**：只写 `process.env.TZ = 'Asia/Shanghai'` 不算数——Node 的本地
 *    时区偏移在进程里定死后不随环境变量变化，那样写出来的用例会**假绿**（旧代码也能过）。
 *    这里用 `spawnSync(process.execPath, [probe], { env: { ...process.env, TZ } })`，
 *    并断言子进程报告的 `getTimezoneOffset() === -480`，证明 TZ 真的生效了。
 * 2. **断言读 DB 侧**：`select unix_timestamp(created_at)` 与测试自己记录的发送时刻 epoch
 *    比（误差 < 2 秒），并断言「模型 create 的行」与「裸 SQL 的行」互差 < 2 秒。
 *    禁止只断言 JS 里两个 Date 相等：同一套客户端时区解释会把误差一起挪掉，测不出来。
 * 3. **自插自删**：探针按自己插入的 id 删行，并复查剩余 0 行；不碰任何既有行。
 *
 * 探针实现见 `tests/helpers/datetime-utc-db-probe.mjs`（父进程只做断言，不连库）。
 * 凭据：`~/.config/mcp/creds/touwaka-test-db.json`（600，不入库）；缺失则 skip。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFAULT_CREDS_PATH, loadTestDbCreds } from "./helpers/test-db-guard.mjs";

const PROBE_PATH = fileURLToPath(new URL("./helpers/datetime-utc-db-probe.mjs", import.meta.url));
const TARGET_TZ = "Asia/Shanghai";
/** 判据容差（秒）：写入到回读的往返远小于此，旧代码的偏差是 28800 秒，量级差 4 个数量级 */
const TOLERANCE_SECONDS = 2;

const creds = loadTestDbCreds();

function runProbe() {
  const child = spawnSync(process.execPath, [PROBE_PATH], {
    env: { ...process.env, TZ: TARGET_TZ },
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdout = child.stdout ?? "";
  const stderr = child.stderr ?? "";
  const marker = "__PROBE_RESULT__";
  const line = stdout.split("\n").find((entry) => entry.startsWith(marker));
  assert.ok(
    line,
    `子进程没有输出 ${marker} 结果行（exit=${child.status}）\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
  );
  const payload = JSON.parse(line.slice(marker.length));
  assert.equal(
    child.status,
    0,
    `子进程退出码应为 0，实际 ${child.status}\n--- stderr ---\n${stderr}`,
  );
  return { payload, stdout, stderr };
}

if (!creds) {
  test("DATETIME 写入口径 = UTC 挂钟（TZ=Asia/Shanghai 子进程 + DB 侧 unix_timestamp 断言）", {
    skip: `缺少测试库凭据 ${DEFAULT_CREDS_PATH}`,
  }, () => {});
} else {
  test("DATETIME 写入口径 = UTC 挂钟（TZ=Asia/Shanghai 子进程 + DB 侧 unix_timestamp 断言）", (t) => {
    const { payload } = runProbe();

    // ── 0. 先证明「子进程的 TZ 真的生效」——否则后面全绿也没有意义 ──────────────
    assert.equal(payload.tz.env, TARGET_TZ, "子进程 TZ 环境变量没被设成目标时区");
    assert.equal(
      payload.tz.offsetMinutes,
      -480,
      `子进程的本地时区偏移应为 UTC+8（getTimezoneOffset=-480），实际 ${payload.tz.offsetMinutes}`,
    );

    const { rows, sentMs } = payload;
    const toSeconds = (ms) => ms / 1000;
    const toUtcWall = (epochSeconds) => new Date(epochSeconds * 1000).toISOString();

    // ── 1. 每条写入都必须落在「发送时刻 ±2s」，且挂钟就是 UTC 挂钟 ──────────────
    // 旧代码（裸 SQL 直传 Date）在 TZ=+8 下会落到 +28800 秒，这里会立刻红。
    const arms = [
      ["模型 create 写入的 messages 行", rows.modelMessage, sentMs.model],
      ["裸 SQL 写入的投影 messages 行", rows.projectionMessage, sentMs.raw],
      ["裸 SQL 写入的 agent_rounds 行", rows.agentRound, sentMs.raw],
      ["裸 SQL 写入的 chat_tool_calls 行", rows.chatToolCall, sentMs.raw],
      ["裸 SQL 写入的 canonical.created_at", rows.canonicalCreated, sentMs.raw],
      ["裸 SQL 写入的 canonical.updated_at", rows.canonicalUpdated, sentMs.raw],
      // 投影修复写入口 projectRequest({apply:true}) → applyProjectionWrites() 的裸 SQL INSERT
      //（issue #1282 点名的病根就在这条路上）
      ["投影修复写入口补回的 messages 行", rows.projectionAppliedMessage, sentMs.apply],
    ];
    for (const [label, row, sentMsValue] of arms) {
      const drift = row.epoch - toSeconds(sentMsValue);
      assert.ok(
        Math.abs(drift) < TOLERANCE_SECONDS,
        `${label} 的 created_at 与真实发送时刻相差 ${drift.toFixed(3)} 秒（容差 ${TOLERANCE_SECONDS} 秒）` +
          `：库里挂钟 ${row.wall}，真实时刻应约 ${toUtcWall(toSeconds(sentMsValue))}`,
      );
    }

    // ── 2. 两条通道必须互差 < 2 秒（这就是 issue 里 28800 秒那组数的判据）────────
    const modelVsRaw = rows.modelMessage.epoch - rows.projectionMessage.epoch;
    assert.ok(
      Math.abs(modelVsRaw) < TOLERANCE_SECONDS,
      `模型 create 行与裸 SQL 行的 created_at 互差 ${modelVsRaw.toFixed(3)} 秒` +
        `（模型 ${rows.modelMessage.wall} / 裸 SQL ${rows.projectionMessage.wall}；容差 ${TOLERANCE_SECONDS} 秒）`,
    );

    const rawEpochs = [
      rows.projectionMessage.epoch,
      rows.agentRound.epoch,
      rows.chatToolCall.epoch,
      rows.canonicalCreated.epoch,
      rows.canonicalUpdated.epoch,
    ];
    const spread = Math.max(...rawEpochs) - Math.min(...rawEpochs);
    assert.ok(
      spread < TOLERANCE_SECONDS,
      `裸 SQL 四个写点之间的 created_at 最大互差 ${spread.toFixed(3)} 秒（容差 ${TOLERANCE_SECONDS} 秒）`,
    );

    // ── 3. 自插自删：探针插入的每一行都删掉了、且一行不剩 ─────────────────────
    // 手动删的那行（为制造漂移删掉的投影 messages 行）单独记在 manualDeletes 里。
    assert.equal(
      payload.manualDeletes.projectionMessage,
      1,
      `制造漂移时应删掉自己写的投影 messages 行 1 行，实际 ${payload.manualDeletes.projectionMessage}`,
    );
    assert.equal(
      payload.deletedTotal,
      5,
      `清理阶段应删掉自己插入的 5 行，实际 ${payload.deletedTotal}；明细 ${JSON.stringify(payload.deleted)}`,
    );
    assert.equal(
      payload.remainingTotal,
      0,
      `清理后仍剩 ${payload.remainingTotal} 行（探针必须只留 0 行）；明细 ${JSON.stringify(payload.remaining)}`,
    );

    t.diagnostic(
      `TZ=${payload.tz.env}（offset=${payload.tz.offsetMinutes}min, localHours=${payload.tz.localHours}）` +
        ` ｜ 模型臂挂钟 ${rows.modelMessage.wall} / 裸 SQL 臂挂钟 ${rows.projectionMessage.wall}` +
        ` ｜ 互差 ${modelVsRaw.toFixed(3)} 秒`,
    );
  });
}
