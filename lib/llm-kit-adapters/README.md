# erix-llm-kit 适配器（touwaka 项目侧）

erix-llm-kit 的"驱动模型"：接口在库，DB 适配器在项目侧（ADR-001/002）。
本目录是 touwaka 的 MariaDB 适配器实现。

## 适配器清单

| 文件 | 接口 | 后端 |
|---|---|---|
| `model-config-provider.js` | ModelConfigProvider | `ai_models` + `providers` 表（经 lib/db.js） |
| `transcript-store.js` | TranscriptStore | `llm_kit_transcripts` 表（适配器内 Sequelize 模型） |

## 测试

契约测试（接口兼容断言来自库的 `@erix/llm-kit/contract-tests`，当前用相对路径引用，
待 `@erix/llm-kit` 发布到 Gitea npm registry 后换包导入）：

```bash
# 凭据：~/.config/mcp/creds/touwaka-test-db.json（600，不入库）
#   { "host": "127.0.0.1", "port": 3306, "user": "eric", "password": "…", "database": "llm_kit_test" }
node --test tests/llm-kit-adapters/
```

测试会在 `llm_kit_test` 库内建/删 `providers` 与 `ai_models` 两表（sequelize sync 真实模型定义），
**不要**把凭据指向 touwaka_mate 生产库。
