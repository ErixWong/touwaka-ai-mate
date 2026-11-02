/**
 * issue #1253 —— 长期红测试的**显式隔离清单**（第 1 阶段：只记账，不修）
 *
 * 为什么要有这个文件：
 *   `npm test` 长期是占位符，28 个测试文件不在任何入口里，其中 9 个**从升级 0.29 之前
 *   就已经是红的**（已在基线 `7fe2fa4` 上复验，不是迁移造成的）。第 1 阶段的目标是
 *   「把 `npm test` 变成真入口 + 把这 9 个显式记账」，让它们**不再隐形**；第 2 阶段
 *   再逐条裁定（装依赖 / 改写成 node:test / 判为真回归开单）。
 *
 * 口径（刻意为之）：
 *   - `symptom` 必须是**实跑出来的报错首行**，不许写「可能坏了」「疑似」这类猜测。
 *     复现命令：`node --test <file>`（日志见 issue #1253 报告）。
 *     其中 `<repo>` 是工作树根（本单在 `/home/eric/worktrees/1253ent` 实测），
 *     只有这个前缀随工作树变化，其余逐字保留。
 *   - `issue` 一律 `#1253`：第 2 阶段拆子单后再改成子单号。
 *   - 隔离 ≠ 跳过问题：`scripts/run-tests.mjs` 每次都会把本清单逐条打印出来，
 *     `--verify-quarantine` 会**真跑**每一项，任何一项转绿都会让该模式非零退出
 *     （防「隔离名单只增不减」）。
 *   - 守卫格：`tests/quarantine-manifest.test.mjs` 断言每条都有非空 reason/issue/symptom，
 *     且 `file` 真实存在于磁盘、是 `*.test.{js,mjs}`、不重复。
 *
 * 不许为了变绿做这些事（issue #1253 红线）：
 *   - 弱化或删除任何断言；
 *   - 把文件从磁盘删掉当成「修好」；
 *   - 往 `test:llm-kit` / `test:store-contract` 的 `--test-skip-pattern` 里加名字。
 */

export default [
  {
    file: 'tests/chat-service-task-context.test.js',
    reason: '用例是 vitest 形态（import { describe, it, expect, vi } from "vitest"），仓库未安装 vitest',
    issue: '#1253',
    symptom:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from <repo>/tests/chat-service-task-context.test.js",
  },
  {
    file: 'tests/doc-access-permission.test.js',
    reason:
      'import 了不存在的绝对路径 ../lib/node_modules/sequelize/index.js（该 stub 目录早就不在仓库里）',
    issue: '#1253',
    symptom:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<repo>/lib/node_modules/sequelize/index.js' imported from <repo>/tests/doc-access-permission.test.js",
  },
  {
    file: 'tests/internal-controller-insertmessage.test.js',
    reason: '用例是 vitest 形态（describe/it/expect/vi/beforeEach），仓库未安装 vitest',
    issue: '#1253',
    symptom:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from <repo>/tests/internal-controller-insertmessage.test.js",
  },
  {
    file: 'tests/login.test.js',
    reason:
      '不是 node:test 用例，是自带 main() 的 HTTP 脚本：要求 http://127.0.0.1:3000 有跑着的服务（E2E 前置）',
    issue: '#1253',
    symptom: '❌ 请求失败: connect ECONNREFUSED 127.0.0.1:3000',
  },
  {
    file: 'tests/message-controller-query-json.test.js',
    reason:
      '不是 node:test 用例，是自带 assert()/main 的脚本；唯一红是「聚合查询 chat_tool_calls 一次」——' +
      '实测 controller.query 现在打 3 条 raw SQL（tool_calls 聚合 + recall detail + reasoning），' +
      '断言仍按 #1134 时的「恰好 1 条」写，属**实现与断言漂移**，第 2 阶段需裁定改断言还是改实现',
    issue: '#1253',
    symptom: '❌ 聚合查询 chat_tool_calls 一次',
  },
  {
    file: 'tests/stream-controller-runtime-state.test.js',
    reason: '用例是 vitest 形态（describe/it/expect/vi/beforeEach），仓库未安装 vitest',
    issue: '#1253',
    symptom:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from <repo>/tests/stream-controller-runtime-state.test.js",
  },
  {
    file: 'tests/stream-controller-sendmessage.test.js',
    reason: '用例是 vitest 形态（describe/it/expect/vi/beforeEach），仓库未安装 vitest',
    issue: '#1253',
    symptom:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from <repo>/tests/stream-controller-sendmessage.test.js",
  },
  {
    file: 'tests/workspace-context-renderer.test.js',
    reason: '用例是 vitest 形态（describe/it/expect），仓库未安装 vitest',
    issue: '#1253',
    symptom:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from <repo>/tests/workspace-context-renderer.test.js",
  },
  {
    file: 'tests/workspace-view-model.test.js',
    reason: '用例是 vitest 形态（describe/it/expect），仓库未安装 vitest',
    issue: '#1253',
    symptom:
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vitest' imported from <repo>/tests/workspace-view-model.test.js",
  },
];
