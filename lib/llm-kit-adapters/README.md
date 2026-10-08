# erix-llm-kit 适配器（touwaka 项目侧）

erix-llm-kit 的"驱动模型"：接口在库，DB 适配器在项目侧（ADR-001/002）。
本目录是 touwaka 的 MariaDB 适配器实现。

## 适配器清单

| 文件 | 接口 | 后端 |
|---|---|---|
| `model-config-provider.js` | ModelConfigProvider | `ai_models` + `providers` 表（经 lib/db.js） |
| `transcript-store.js` | TranscriptStore | `agent_rounds`/`messages`/`chat_tool_calls` 三层拆行（issue #1134/#1146，sequelize 参数化 raw query） |
| `provider-adapter.js` | erix Provider (`chatStream`/`chat`) | `LLMClient.callStream`/`call`，纯桥接 |

## 与 erix-agent 0.16.0 的行为变化（touwaka 侧知悉项，issue #1146）

0.16.0 给宿主 store 新增了两条明文义务，本目录已合规，**零 DDL**：

1. **同轮保序**（契约 "Load order"）：`load()` 必须对同 `round` 的记录保持持久化追加顺序，
   引擎 `resume-manager` 直接按返回顺序重建状态、**不再二次排序**，且明文禁止依赖执行计划/
   主键扫描/filesort 巧合。`agent_rounds` 查询已改为 `ORDER BY round_no ASC, id ASC`；
   `id` 由 `Utils.newID` 生成（时间戳前缀 + 同毫秒递增，且本身就是主键的一部分），
   符合契约“插入时间戳 + 唯一二级键（或主键一部分）”的可选项，故不需新增 `append_seq` 列。
2. **字段保真**（契约 "Store fidelity requirements"）：不得用字段白名单重建 `RoundRecord`。
   `roundKey`/`meta`/`response` 已移出 `SUMMARY_FIELDS`，随 `record_json` 原样往返；
   `load()` 的 `response` 合成改为 **record_json 优先**、仅历中行（`record_json` 无 response）
   才用 `stop_reason`/`usage` 列合成，否则列合成会把完整的 `response.content` 覆盖掉。
   `stop_reason`/`usage` 两列**有意保留不删**（与 `record_json` 内容重复，仍供查询与排查用）。

另：0.16.0 的 `projectTranscriptForDisplay` 新增 `key` / `meta.sourceInferred` 等**只读增量字段**，
本项目当前不消费该投影（无调用点），无需改动；按上游要求不要把投影 `key` 当持久 ID 或
`tool_use.id` 使用。

## TranscriptStore 保真声明（load() 往返等价面）

拆行前的 RoundRecord 与 `load()` 输出在以下字段上等价：

- 基础（#1134）：`round`、`ts`、`dedupKey`、`messages`（含 tool_use/tool_result 块位置）、
  `folded`、`foldedRoundRange`、`foldedPayload`，以及其余未拆行的未知字段（走 `record_json`）。
- 本次新增（#1146）：`roundKey`、`meta`、`response`（含 `response.content` 的 text/reasoning/tool_use
  块与 `usage`/`stopReason`）。

**已知偏离（需 Eric 决策，本 issue 不做）**：`messages[].meta.source` **仍未落库**——
`messages` 表没有对应列，补列属红线 2.1（数据库字段禁擅改）。后果按上游契约：
合成消息的分类回退到文本前缀启发式，注入的 judge 方向提示轮可能被当成真实用户消息，
且 resume 后评委的 `judge-control` 排除规则失效（当前文本启发式识别不出其
`【Judge 评审意见】` 前缀）。

另一不可保真的约定局限：同一 assistant 消息内的块序按 `[text…, tool_use…, reasoning]`
还原（拆行后块间相对位置无法记录），非该约定的块序不能保真。

## 与 erix-agent 0.3.5 的行为变化（touwaka 侧知悉项）

- checkpoint 执行后写失败由静默改为 fail-closed（抛出 `KitError` `checkpoint_failed`），该次请求会显式失败。由于 `request_id` 每请求新生成，且本项目没有复用 `runId` 的 resume 场景，无需按 tool id 做幂等保护。
- observer 回调异常改走 `onObserverError`，不再掀掉整轮循环；`runErix` 已接线到 `logger.warn`。
- 流式 `onDelta` 时机不变。本项目显式传入 `retry.attempts >= 1`，仍在尝试成功后批量 flush；仅 `CHAT_STREAM_RECOVERY_MAX_ATTEMPTS=0` 时才会启用 0.3.5 的实时透传路径。
- 其余 0.3.5 变化（file store `runId` 哈希、`ERIX_*` env 校验、`providerOptions` 保护、内置 provider 的 SSE 解析）本项目不适用。

## 测试

契约测试消费已发布的 `erix-agent` 包，通过
`erix-agent/contract-tests` 导入接口兼容断言：

```bash
# 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）
#   { "host": "127.0.0.1", "port": 3306, "user": "eric", "password": "…", "database": "llm_kit_test" }
npm run test:llm-kit   # 不要用目录形式 node --test tests/llm-kit-adapters/（MODULE_NOT_FOUND）
```

契约与元数据测试共用同一组三层表（agent_rounds/messages/chat_tool_calls），
以独立 runId 命名空间隔离，因此可以在 Node.js 测试默认并发下安全运行。

测试会在 `llm_kit_test` 库内建/删 `providers` 与 `ai_models` 两表（sequelize sync 真实模型定义），
**不要**把凭据指向 touwaka_mate 生产库。
