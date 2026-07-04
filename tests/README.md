# Tests 目录说明

本目录包含项目的各类测试与调试脚本，按功能分类如下。

## 单元测试

| 脚本 | 说明 |
|------|------|
| `chat-service-task-context.test.js` | 测试 ChatService `_prepareTaskContext()` 和 `getTaskContext()` 的返回结构 |
| `internal-controller-insertmessage.test.js` | 测试 InternalController `insertMessage()` 的 `task_db_id`/`task_id` 标准化行为（4 种场景） |
| `login.test.js` | 测试用户登录与 Token 验证（管理员/普通用户） |
| `mcp-reliability.test.js` | 测试 ToolManager 对 MCP 工具定义的映射与驻留进程调用契约 |
| `path-protocol.test.js` | 测试任务上下文中 task/skill/chat 三种模式的路径协议与相对路径报错 |
| `stream-controller-sendmessage.test.js` | 测试 `sendMessage()` 只触发一次 `processMessageAsync()` 且统一使用 `normalizedTaskDbId` |
| `test-query-builder.js` | 测试 Query Builder 的 `parseFilter`、`parseSort`、`parsePage`、`parseFields` 等方法 |
| `workspace-context-renderer.test.js` | 测试 `BaseContextOrganizer`/`MinimalContextOrganizer` 对 workspace 上下文的渲染（task/skill/chat 模式） |
| `workspace-view-model.test.js` | 测试 `buildWorkspacePromptViewModel()` 构建 workspace 展示视图模型 |

## LLM / AI 能力测试

| 脚本 | 说明 |
|------|------|
| `test-basic.js` | 基础测试：验证数据库连接、配置加载和 LLM 客户端初始化 |
| `test-internal-llm-qwen-thinking.js` | 测试 InternalLLMService 对 Qwen thinking 开关的控制效果 |
| `test-remote-llm-full.js` | 完整测试远程 LLM 调用（模拟 skill-loader 环境变量注入的真实请求） |
| `test-remote-llm.js` | 测试远程 LLM 调用（驻留进程状态、内部 API 模型解析、VM 沙箱 submit 工具） |
| `test-doc-embedding.js` | 测试文档平台向量化服务（5 种场景：正常、缺模型、无 chunk、revectorize、错误重试） |

## MCP / 驻留进程测试

| 脚本 | 说明 |
|------|------|
| `test-mcp-http-direct.js` | 测试 MCP HTTP 直连（initialize、tools/list 等 JSON-RPC 调用） |
| `test-mcp-stateless.js` | 测试 StatelessHTTPTransport 连接、获取工具列表及调用工具 |
| `test-resident-direct.js` | 直接测试驻留进程 invoke 执行（模拟 `ResidentProcess` 调用） |
| `test-resident-status.js` | 测试驻留进程状态 API（查询进程健康状态和运行信息） |

## Skill 相关测试

| 脚本 | 说明 |
|------|------|
| `run-skill.js` | 使用 VM 沙箱执行技能的通用命令行脚本（支持 kb-search、skill-manager 等） |
| `skill-admin.js` | 通过 HTTP API 管理技能的命令行脚本（列表、搜索、注册等操作） |
| `test-skill-analyzer.mjs` | 测试 SKILL.md 解析功能（标准 Claude Code 格式、工具提取等） |
| `test-skill-md-parsing.mjs` | 测试 SKILL.md 解析和技能导入（PDF、searxng、skill-importer 三种技能） |
| `test-skill-runner-error-guidance.js` | 测试 skill-runner 失败时是否返回脚本修复指导（语法错误/白名单违规） |
| `test-skill-runner-relative-path.js` | 测试 skill-runner 中相对路径按工作目录正确解析的行为 |
| `test-tool-parsing.mjs` | 测试 SkillLoader 从数据库加载技能并解析工具定义 |
| `tool-test.mjs` | 测试 ToolManager 加载技能工具并注册 tool 的完整流程 |
| `check-tool-usage.js` | 查询数据库中指定 skill 的 `skill_tools` 表记录 |
| `check-tool-usage.mjs` | 查询数据库中 searxng 技能的 `skill_tools` 完整记录（ESM 版本） |

## 沙箱 / 执行器测试

| 脚本 | 说明 |
|------|------|
| `test-sandbox-fs-restriction.js` | 测试沙箱 `fs/promises` 模块的路径限制（越界访问拦截） |
| `test-user-code-executor.js` | 测试 execute 工具（支持 JavaScript 和 Shell 命令在沙箱中执行） |
| `execute-script/execute-script.test.js` | 测试 Node.js/Python 脚本执行器在沙箱限制下的行为 |

## Skill Runtime 子目录

`skill-runtime/` 包含技能运行时的调试与验证脚本，详见 [skill-runtime/README.md](skill-runtime/README.md)。

| 脚本 | 说明 |
|------|------|
| `skill-runtime/run-skill-dev.js` | 开发调试专用技能执行脚本（简化 VM 沙箱，自动注入管理员权限） |
| `skill-runtime/run-skill-integration.js` | 真实链路专项验证测试（路径越界安全、非管理员权限、多入口、Python skill） |
| `skill-runtime/run-skill-real.js` | 生产级技能运行时验证脚本（真实 skill-runner 执行，严格的沙箱边界和权限） |
| `skill-runtime/vm-sandbox.js` | 测试专用 VM 沙箱辅助工具（`createTestSandbox`/`createDevSandbox`） |

## 异步服务 / 数据转换测试

| 脚本 | 说明 |
|------|------|
| `test_async_service.cjs` | 测试 MinerU 异步文档解析服务（支持 REST 和 MCP 两种传输方式，CommonJS 版本） |
| `test_async_service.js` | 测试 MinerU 异步文档解析服务（支持 REST 和 MCP 两种传输方式） |
| `test-convert-formula.js` | 测试 `excel_convert` 公式识别功能（验证 `=` 开头字符串是否识别为公式写入） |
| `test-markitdown.js` | 测试 markitdown MCP 服务对 PDF 文档的转换诊断 |
| `test-xlsx-xml.js` | 测试 `excel_convert` 生成 Excel 文件并验证 XML 格式正确性 |

## API / 消息 / 上下文测试

| 脚本 | 说明 |
|------|------|
| `message-retrieval-test.js` | 测试 `MinimalContextOrganizer` 基于时间边界的消息获取逻辑 |
| `test-api.mjs` | 测试向专家发送消息的完整流程（登录→获取 expert_id→发送消息） |

## 数据库 / 审计 / 杂项

| 脚本 | 说明 |
|------|------|
| `db-check.mjs` | 查询数据库中活跃专家、技能及专家技能关联关系 |
| `import-kb-article.js` | 通过 HTTP API 将 MD 文件内容导入到知识库 |
| `mini-app-dependency-audit.js` | 按路由、表、任务三维度审计 Mini-app 退役前置条件 |
| `timezone-test.js` | 测试时区处理逻辑（验证 `new Date(timestamp)` 不会因 ISO 字符串转换导致时区偏移） |
