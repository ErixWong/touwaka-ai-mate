/**
 * 阶段 2 · 切片 A1（issue #1227）：把**上游真契约套件**接到真库 + 真适配器上跑。
 *
 * 上游 erix-agent 0.29.0 的 `package.json` 已导出契约套件子路径：
 *   exports["./contract-tests"] = "./test/contract/index.js"
 * 其中 `transcriptStoreContract(label, createStore)` 是 TranscriptStore 的官方判据。
 * 本文件不再本地复刻断言（那是 `transcript-store.contract.test.mjs` 的旧做法），
 * 而是**直接 import 上游套件**，用生产同一条适配链：
 *   tests → `createErixStore({ db, requestContext })`（lib/llm-kit-adapters/loop-bridge.js）
 *         → `createTouwakaTranscriptStore`（lib/llm-kit-adapters/transcript-store.js）
 *         → 真实 MariaDB `llm_kit_test`
 * 这样跑出来的红/绿就是「上游判据 × 我们的实现」的真实差集，是阶段 2 的工作清单。
 *
 * ── 套件规模（0.29.0 实测）──────────────────────────────────────────────────────────
 * `grep -c '^  test(` node_modules/erix-agent/test/contract/transcript-store.js` = **26** 格，
 * 不是工单里写的 12 格（12 是 0.14 时代必需面的旧数；0.22 的 payload 冲突判据与 0.23 的
 * 折叠义务各自又追加了若干格）。本文件按实测 26 格记录。
 *
 * ── 排除清单与逐条理由（可选 capability 面，本项目**有意不实现**）─────────────────
 * 上游 #78 把能力分两级：必需面 = {appendRound, load}；run snapshot / run-state 为**可选**。
 * 本仓 README / store 文件头明确「run snapshot / run-state 有意不实现，引擎每方法发一条
 * persistence_capability_degraded 诊断后跳过，run 正常执行」——这是**合法降级**。
 * 上游套件无条件调用这些可选方法，因此必须在**用例名层面**排除，而**不是**去实现一个假
 * snapshot / 假 run-state 来把告警压掉（那会把「未实现」伪装成「已实现」，比红更糟）。
 *
 * 排除方式：npm 脚本 `test:store-contract` 的 `--test-skip-pattern`（Node 22 原生过滤，
 * 被过滤的用例不执行、不计入 pass/fail），正则逐字列出下列 7 个用例名：
 *   1. `<label>: run snapshot 往返保真与 latest-only 覆盖语义`
 *      理由：调用 saveRunSnapshot/loadLatestRunSnapshot（可选 capability，未实现）。
 *   2. `<label>: run snapshot 未知 runId 返回 undefined`
 *      理由：同上。
 *   3. `<label>: run snapshot/run-state 多 runId 隔离`
 *      理由：调用 saveRunSnapshot/saveRunState/markRunState/loadRunState（可选，未实现）。
 *   4. `<label>: 新写入的 run-state 快照不包含终态 state`
 *      理由：调用 saveRunState/markRunState/loadRunState（可选，未实现）。
 *   5. `<label>: run snapshot/run-state 写失败向上抛出`
 *      理由：该格只把它自己注入的抛错桩再 assert.rejects 一遍，**完全不触达本 store 的任何
 *      实现**（它先 `store[method] = async () => { throw expected }`）。对我们的 store 零信息量，
 *      且语义上属于可选 run-state 面，一并排除；不拿它凑绿。
 *   6. `<label>: run-state 快照保真且终态独立读取`
 *      理由：调用 saveRunState/markRunState/loadRunState（可选，未实现）。
 *   7. `<label>: run-state 未知 runId 返回 undefined`
 *      理由：调用 loadRunState（可选，未实现）。
 *
 * 除上述 7 格外，其余 **19 格全部照跑**，包括：
 *   - 0.23 折叠义务 4 格（消息行折回载体 / 折叠幂等 / 「两份都留」守卫 / thinking+tool_use 块）；
 *   - 0.22 payload 冲突判据 4 格（同 payload 幂等 / 崩溃重跑幂等 / 异 payload 报冲突 /
 *     数组顺序 / 宿主未知字段 / roundKey 回落）；
 *   - 0.17 成对快路径探针 2 格（loadByDedupKey / loadMaxRound 与 load 事实一致；nullish 判据）。
 *
 * ── 为什么单独一个 npm 脚本、暂不进 test:llm-kit ────────────────────────────────────
 * 今天**必然有若干格是红的**，那些红就是阶段 2 的实现工作清单（已知：同 key 异 payload
 * 我们仍是 `INSERT IGNORE` 静默，上游要求 `code:"dedup_payload_conflict"`）。把它并进
 * `test:llm-kit` 会让「回归门禁」长期红着，失去门禁意义；因此先独立成
 * `npm run test:store-contract`，等实现补齐（红转绿）后再并入 `test:llm-kit`。
 *
 * ── 禁止事项（本文件的设计约束）────────────────────────────────────────────────────
 * · 不放宽上游断言、不 skip、不改 lib/ 运行代码；
 * · 不实现假 saveRunSnapshot/loadRunState 来消告警；
 * · 跑出多少红就报多少红（红名 + 报错原文进报告）。
 *
 * 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）；缺失则 skip。
 */

import { test, after } from "node:test";

// logs/ 目录可能非本用户属主：屏蔽文件写入，别让日志权限错误掩盖数据库结果。
import logger from "../../lib/logger.js";
for (const method of ["info", "warn", "error", "debug"]) {
  if (typeof logger[method] === "function") logger[method] = () => {};
}

import { openTestDatabase, DEFAULT_CREDS_PATH } from "../helpers/test-db-guard.mjs";

// 生产默认档：canonical 真相（ERIX_TRANSCRIPT_READ_MODE 未配置时也是 new）。
// 显式钉住，避免外部 shell 残留 legacy 让结果含义漂移。
process.env.ERIX_TRANSCRIPT_READ_MODE = "new";

const { transcriptStoreContract } = await import("erix-agent/contract-tests");
const { createErixStore } = await import("../../lib/llm-kit-adapters/loop-bridge.js");

const dbCtx = await openTestDatabase();
const creds = dbCtx?.creds ?? null;
const CREDS_PATH = dbCtx?.credsPath ?? DEFAULT_CREDS_PATH;
const db = dbCtx?.db ?? null;

/**
 * 上游套件内部**硬编码**的 runId 全集（0.29.0 实测；它不导出 fixture，故只能列在这里）。
 * 上游每个用例都 `await createStore()` 要一个「干净的新 store」，而我们的 store 无状态、
 * 状态全在 DB 里 ⇒ 唯一能给出「干净」的方式是在 createStore 时清掉这些 runId 的行。
 * 刻意**不**给 runId 加前缀：套件里多处断言 dedupKey 字符串逐字等于
 * `${foldRunId}:engine:round:2` 之类，加前缀会改断言对象（等于改契约）。
 *
 * 维护提示：升级 erix-agent 后若上游新增了 runId，这里会漏清 → 表现为「第二次跑同一格时
 * 命中上一轮残留行」。升级时请对照 `node_modules/erix-agent/test/contract/transcript-store.js`
 * 复核本清单。
 */
export const CONTRACT_RUN_IDS = Object.freeze([
  "run-1",
  "same-round-order-run",
  "fidelity-run",
  "nonexistent-run",
  "run-a",
  "run-b",
  "snapshot-run",
  "missing-snapshot-run",
  "snapshot-state",
  "failed-run",
  "state-run",
  "missing-state-run",
  "fold-run",
  "probe-run",
  "probe-run-empty",
  "nullish-run",
  "dedup-run",
  "roundkey-run",
  "implicit-run",
]);

/**
 * 清掉契约 runId 的行（只清本清单，绝不 DELETE 全表）。
 * 删除顺序与 tests/llm-kit-adapters/transcript-store.contract.test.mjs#cleanup 一致：
 * 子行（messages / chat_tool_calls）→ canonical → 展示面 agent_rounds。
 *
 * @param {string[]} runIds
 */
async function purgeRuns(runIds) {
  if (!db) return;
  const [rounds] = await db.sequelize.query(
    "SELECT id FROM agent_rounds WHERE request_id IN (:runIds)",
    { replacements: { runIds } },
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
  // 兜底：历史残留的、round_id 已不在 agent_rounds 的子行也按 request_id 清掉
  await db.sequelize.query(
    "DELETE FROM messages WHERE request_id IN (:runIds)",
    { replacements: { runIds } },
  );
  await db.sequelize.query(
    "DELETE FROM chat_tool_calls WHERE request_id IN (:runIds)",
    { replacements: { runIds } },
  );
  await db.sequelize.query(
    "DELETE FROM agent_transcript_rounds WHERE request_id IN (:runIds)",
    { replacements: { runIds } },
  );
  await db.sequelize.query(
    "DELETE FROM agent_rounds WHERE request_id IN (:runIds)",
    { replacements: { runIds } },
  );
}

if (!creds) {
  test("上游 transcriptStoreContract × touwaka store（真实 MariaDB）", {
    skip: `缺少凭据 ${CREDS_PATH}`,
  }, () => {});
} else {
  const [userRows] = await db.sequelize.query("SELECT id FROM users LIMIT 1");
  const requestContext = {
    topic_id: null,
    user_id: userRows?.[0]?.id ?? "u_store_contract",
    expert_id: null,
  };

  // 上游要求「每次 createStore 返回干净的新 store」。生产适配链是无状态的，
  // 干净 = 先清掉本套件会写的那批 runId 的残留行，再返回同一个生产包装层。
  const createStore = async () => {
    await purgeRuns(CONTRACT_RUN_IDS);
    return createErixStore({ db, requestContext });
  };

  transcriptStoreContract("touwaka-mariadb", createStore);

  after(async () => {
    await purgeRuns(CONTRACT_RUN_IDS);
    if (typeof db.close === "function") {
      await db.close();
    } else if (db.sequelize) {
      await db.sequelize.close();
    }
  });
}
