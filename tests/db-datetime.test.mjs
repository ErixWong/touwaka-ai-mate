/**
 * issue #1282：`lib/db-datetime.js` 的 `toDbDatetime()` 单测（**不连库**）
 *
 * 钉住两件事：
 *   1. 值域契约：`Date` / epoch 毫秒 → `YYYY-MM-DD HH:mm:ss.SSS` 的 **UTC** 挂钟；
 *      `null` / `undefined` 原样返回；字符串原样透传；非法值抛 `ERR_INVALID_DB_DATETIME`
 *      （宁可炸，也不要把 `'Invalid Date'` / `'true'` 静默写进 DATETIME 列）。
 *   2. **不受进程 TZ 影响**：同一时刻在 `TZ=UTC` / `TZ=Asia/Shanghai` /
 *      `TZ=America/New_York` 三个**子进程**里必须输出**同一串**。
 *
 * 为什么必须子进程：在同一个进程里改 `process.env.TZ` 不会改变 `Date` 的本地偏移
 * （Node 在进程内缓存时区），那样写出来的用例是**假绿**。这里用
 * `spawnSync(process.execPath, [脚本], { env: { ...process.env, TZ } })` 显式设时区，
 * 并同时断言「本地小时确实随 TZ 变了」——否则 helper 输出相同可能只是因为 TZ 没生效。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { toDbDatetime } from "../lib/db-datetime.js";

/** 固定时刻：2026-11-03T14:21:49.695Z（issue #1282 实测表里 user 行的真实 epoch） */
const FIXED_EPOCH_MS = 1793715709695;
const FIXED_UTC_WALL = "2026-11-03 14:21:49.695";

const HELPER_URL = pathToFileURL(new URL("../lib/db-datetime.js", import.meta.url).pathname).href;

test("toDbDatetime：Date → UTC 挂钟字面量", () => {
  assert.equal(toDbDatetime(new Date(FIXED_EPOCH_MS)), FIXED_UTC_WALL);
});

test("toDbDatetime：epoch 毫秒与 Date 同结果", () => {
  assert.equal(toDbDatetime(FIXED_EPOCH_MS), FIXED_UTC_WALL);
  assert.equal(toDbDatetime(0), "1970-01-01 00:00:00.000");
});

test("toDbDatetime：毫秒补零到三位（DATETIME(3) 列不丢精度）", () => {
  assert.equal(toDbDatetime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6))), "2026-01-02 03:04:05.006");
  assert.equal(toDbDatetime(new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 60))), "2026-01-02 03:04:05.060");
});

test("toDbDatetime：null / undefined 原样返回（不发明值）", () => {
  assert.equal(toDbDatetime(null), null);
  assert.equal(toDbDatetime(undefined), undefined);
});

test("toDbDatetime：字符串原样透传（helper 不重新解释调用方给的挂钟）", () => {
  for (const raw of ["2026-11-03 14:21:49.695", "2026-11-03T14:21:49.695Z", "", "not-a-date"]) {
    assert.equal(toDbDatetime(raw), raw);
  }
});

test("toDbDatetime：非法值抛 ERR_INVALID_DB_DATETIME（不许静默写坏 DATETIME）", () => {
  const cases = [new Date("nope"), Number.NaN, Number.POSITIVE_INFINITY, true, false, {}, [], 10n];
  for (const value of cases) {
    assert.throws(
      () => toDbDatetime(value),
      (error) => error.code === "ERR_INVALID_DB_DATETIME",
      `值 ${String(value)} 应抛 ERR_INVALID_DB_DATETIME`,
    );
  }
});

test("toDbDatetime：同一时刻在 TZ=UTC / Asia/Shanghai / America/New_York 子进程里输出同一串", () => {
  const childScript = `
    import { toDbDatetime } from ${JSON.stringify(HELPER_URL)};
    const epoch = ${FIXED_EPOCH_MS};
    process.stdout.write(JSON.stringify({
      fromDate: toDbDatetime(new Date(epoch)),
      fromNumber: toDbDatetime(epoch),
      offsetMinutes: new Date(epoch).getTimezoneOffset(),
      localHours: new Date(epoch).getHours(),
    }));
  `;
  const zones = ["UTC", "Asia/Shanghai", "America/New_York"];
  const observed = zones.map((tz) => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", childScript], {
      // 显式给 TZ（不是 process.env.TZ = ...，那在 Node 里改不动已缓存的时区）
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
      timeout: 60_000,
    });
    assert.equal(child.status, 0, `TZ=${tz} 的子进程失败：${child.stderr}`);
    return { tz, ...JSON.parse(child.stdout) };
  });

  for (const entry of observed) {
    assert.equal(entry.fromDate, FIXED_UTC_WALL, `TZ=${entry.tz} 下 Date 输入的输出漂了`);
    assert.equal(entry.fromNumber, FIXED_UTC_WALL, `TZ=${entry.tz} 下 number 输入的输出漂了`);
  }

  // 反证「TZ 真的生效了」：本地偏移必须是 0 / -480 / +300 或 +240（纽约冬夏令时）
  assert.deepEqual(observed.map((entry) => entry.offsetMinutes), [0, -480, observed[2].offsetMinutes]);
  assert.ok(
    [300, 240].includes(observed[2].offsetMinutes),
    `America/New_York 的偏移应为 300(EST) 或 240(EDT)，实际 ${observed[2].offsetMinutes}`,
  );
  const localHours = observed.map((entry) => entry.localHours);
  assert.equal(
    new Set(localHours).size,
    3,
    `三个时区的本地小时应互不相同（否则 TZ 没生效，本用例是假绿）：${JSON.stringify(localHours)}`,
  );
});
