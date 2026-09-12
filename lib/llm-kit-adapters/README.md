# erix-llm-kit 适配器（touwaka 项目侧）

erix-llm-kit 的"驱动模型"：接口在库，DB 适配器在项目侧（ADR-001/002）。
本目录是 touwaka 的 MariaDB 适配器实现。

## 适配器清单

| 文件 | 接口 | 后端 |
|---|---|---|
| `model-config-provider.js` | ModelConfigProvider | `ai_models` + `providers` 表（经 lib/db.js） |
| `transcript-store.js` | TranscriptStore | `llm_kit_transcripts` 表（可通过 `tableName` 指定其他表，适配器内 Sequelize 模型） |
| `message-converter.js` | OpenAI ↔ canonical 双向转换 | 纯函数，无 DB 依赖 |
| `provider-adapter.js` | erix Provider (`chatStream`/`chat`) | `LLMClient.callStream`/`call`，纯桥接 |

## 与 erix-agent 0.3.5 的行为变化（touwaka 侧知悉项）

- checkpoint 执行后写失败由静默改为 fail-closed（抛出 `KitError` `checkpoint_failed`），该次请求会显式失败。由于 `request_id` 每请求新生成，且本项目没有复用 `runId` 的 resume 场景，无需按 tool id 做幂等保护。
- observer 回调异常改走 `onObserverError`，不再掀掉整轮循环；`runErix` 已接线到 `logger.warn`。
- 流式 `onDelta` 时机不变。本项目显式传入 `retry.attempts >= 1`，仍在尝试成功后批量 flush；仅 `CHAT_STREAM_RECOVERY_MAX_ATTEMPTS=0` 时才会启用 0.3.5 的实时透传路径。
- 其余 0.3.5 变化（file store `runId` 哈希、`ERIX_*` env 校验、`providerOptions` 保护、内置 provider 的 SSE 解析）本项目不适用。

## 测试

契约测试消费已发布的 `erix-agent@0.3.5` 包，通过
`erix-agent/contract-tests` 导入接口兼容断言：

```bash
# 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）
#   { "host": "127.0.0.1", "port": 3306, "user": "eric", "password": "…", "database": "llm_kit_test" }
node --test tests/llm-kit-adapters/*.test.mjs
```

契约测试使用默认的 `llm_kit_transcripts` 表；元数据测试使用独立的
`llm_kit_transcripts_meta_test` 表，因此可以在 Node.js 测试默认并发下安全运行。

测试会在 `llm_kit_test` 库内建/删 `providers` 与 `ai_models` 两表（sequelize sync 真实模型定义），
**不要**把凭据指向 touwaka_mate 生产库。
