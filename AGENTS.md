# Touwaka Mate v2 - AI 开发守则入口

> 本项目使用 AI Assistant（Kilo/Claude）作为主开发工具。此文件为 AI Assistant 提供项目级统一执行入口，用于约束开发、审查、提交流程与文档留痕。

---

## 1. 文档优先级与入口

### 执行优先级

当多份文档存在交叉约束时，按以下优先级执行：

1. 用户当次明确指令
2. 本文件 `AGENTS.md`
3. `docs/SOUL.md`
4. `docs/development/*.md`
5. 其他任务文档、设计文档、Issue/PR 上下文

### 开工前最少阅读集

进行非微小修改前，至少确认以下文档是否与当前任务相关：

1. `AGENTS.md`
2. `docs/SOUL.md`
3. `docs/development/coding-standards.md`
4. `docs/development/code-review-checklist.md`
5. 当前任务对应的 `docs/tasks/active/...` 文档或 GitHub Issue

### 冲突处理原则

- 若 `docs/SOUL.md`、任务文档、旧注释与本文件冲突，以本文件为准。
- 若仓库实际状态与文档描述不一致，以“当前仓库可验证事实”为准，并在修改中顺手修正文档。
- 若涉及数据库字段、外部接口契约、发布流程等高风险变更，禁止自行猜测，必须先获得明确确认。

---

## 2. 红线规则（违反必纠）

### 2.1 数据库字段禁止擅改

任何数据库字段的增删改，必须先获得 Eric 明确同意。

- 禁止使用 `TINYINT`
- 布尔字段统一使用 `BIT(1)`
- 数据库结构变更后必须同步更新 `scripts/upgrade-database.js`
- `models/` 为生成产物，禁止手改，结构变更后必须重新生成

### 2.2 全栈 snake_case

字段命名从数据库到前端保持全程 snake_case，禁止任何形式的字段名转换：

`数据库 -> 后端 -> API -> 前端`

唯一允许的转换是类型转换，例如 `BIT(1) -> boolean`，但字段名不变。

### 2.3 统一响应格式

后端必须使用 `ctx.success()` / `ctx.error()` 输出统一结构，前端按 `response.data.data` 消费。

- 禁止直接返回裸 `ctx.body = {...}` 破坏契约
- 分页响应必须复用 `buildPaginatedResponse()`
- 成功判断使用 `response.code === 200`
- 禁止依赖不存在的 `response.success`

### 2.4 AI Provider 调用必须走统一层

| 能力 | 统一入口 | 禁止 |
|------|----------|------|
| LLM Chat | `LLMClient` / `InternalLLMService` | 业务代码直接拼 provider URL |
| Embedding | `EmbeddingClient` | 业务层自建 `/embeddings` 请求 |
| ASR | `ASRClient` | 业务层直连 provider |
| TTS | `TTSClient` | 业务层直连 provider |

详见 `docs/development/llm-call-standards.md`。

### 2.5 URL 归一化必须复用

所有 provider `base_url` 处理必须通过 `lib/llm-url-utils.js` 的 `normalizeBaseUrl()`，禁止自写协议补全或手工拼接兼容逻辑。

### 2.6 配置来源统一

模型配置必须通过 `db.getModelConfig()` 或 `modelRegistry` 获取完整配置（含 provider JOIN）。

- 禁止直接读取 `ai_model` 裸数据用于 LLM/Embedding/ASR/TTS 调用
- 默认模型选择统一走 `modelRegistry`

### 2.7 主键与模型生成规则

- 所有数据库主键默认使用 `Utils.newID()`
- 禁止把自增主键和手动 ID 方案混用
- `models/` 目录为数据库反向生成结果，禁止手动编辑

---

## 3. Git 与任务流程

### 3.1 标准流程

统一按以下顺序执行：

`Issue -> 创建分支 -> 开发 -> 本地审查/验证 -> PR -> squash merge -> 关闭 Issue`

若本次工作没有正式 Issue，也必须保留 `docs/tasks` 追踪记录。

### 3.2 分支策略

- 分支类型：`feature` | `fix` | `refactor` | `docs`
- 分支命名推荐：`{type}/{issue-or-date}-{short-desc}`
- 当前仓库集成基线按 `master` 处理
- 若未来仓库默认分支发生切换，以远端默认分支为准，但文档需要同步更新

说明：这样兼容现有仓库中的 `fix/20260613-...`、`refactor/20260614-...` 等实际分支形式，也避免 `main/master` 描述冲突。

### 3.3 提交规范

- 有 Issue 编号时：`#{issue}: type 描述`
- 无 Issue 的内部小任务或纯文档任务：`type: 描述`
- `type` 使用：`feat` | `fix` | `refactor` | `docs` | `test` | `chore`

### 3.4 PR 规范

- PR Title：`type: 描述`，不带 Issue 编号
- PR Body 中使用 `Closes #<issue-number>` 关联 Issue
- 合并方式：squash merge 到 `master`
- 创建前先检查未合并 PR：`gh pr list --state open`
- Windows 多行正文必须使用 `--body-file`，不要使用 `--body`

### 3.5 Issue 规范

- Issue 标题：`type: 描述`
- Labels：`bug` | `enhancement` | `documentation`
- 多行文本必须写入临时文件（如 `temp/issue-body.md`）后通过 `--body-file` 提交
- 临时文件使用后删除

示例：

```powershell
"C:\Program Files\GitHub CLI\gh.exe" issue create --title "docs: 说明标题" --body-file temp/issue-body.md
```

---

## 4. docs/tasks 留痕要求

### 4.1 什么时候必须建任务目录

以下情况必须在 `docs/tasks/active/` 建立任务目录：

1. 非微小代码修改
2. 涉及多个文件或多个阶段的工作
3. 需要评审、审计、交付说明或复盘
4. 虽然没有 Issue，但工作具有明确范围和产物

### 4.2 目录命名

推荐格式：`docs/tasks/active/task-{issue-or-date}-{slug}/`

例如：

- `task-793-system-config-branding-followup`
- `task-20260614-agents-consistency-revision`

### 4.3 最低必备文件

每个任务目录至少包含：

1. `README.md`：目标、范围、结果、验证结论
2. `BRANCH.md`：当前分支、建议分支、Issue 映射、修改范围

如有多轮审查，可增加：

- `review/*.md`
- `SELF-TEST.md`
- `AUDIT-ROUND*.md`
- 其他阶段性说明文档

### 4.4 状态流转

任务目录遵循：

`active -> review -> archived`

未完成的工作不要提前归档。

---

## 5. 开发实现要求

### 5.1 后端接口

- 控制器返回统一使用 `ctx.success()` / `ctx.error()`
- 分页接口使用 `buildPaginatedResponse()`
- 需要复杂查询的列表接口，优先支持 `GET` + `POST /query` 双入口
- 所有写操作必须校验权限，认证不等于授权

### 5.2 数据库与查询

- SELECT 使用 `db.query()` / `getOne()`
- UPDATE / DELETE 使用 `db.execute()`
- 涉及数据库结构变更时，同步维护迁移脚本与模型生成流程

### 5.3 前端约束

- 优先复用项目统一的 `apiClient` / `apiRequest`
- 禁止前端私自做 snake_case 与 camelCase 转换
- 新增用户可见文本时，检查是否需要同步 i18n
- 已有 Element Plus 组件可覆盖的场景，优先复用，不重复造轮子

### 5.4 技能 / AI 相关代码

- 统一遵守能力客户端分层
- 普通工具与驻留进程必须按各自模块格式要求实现
- 内部 API 响应同样遵守统一 `code/message/data` 契约

---

## 6. 何时必须先停下确认

遇到以下情况，不得自行继续推进：

1. 需要修改数据库字段、索引、外键、表结构
2. 需要改变现有 API 契约且可能影响前端/外部调用方
3. 需要引入新的第三方依赖，且版本发布时间不足 15 天
4. 需要变更发布流程、默认分支策略或生产配置
5. 发现文档与代码严重分叉，且无法从仓库事实判断正确方向

---

## 7. 提交前最少检查

1. `npm run lint` 通过
2. 涉及启动链路的改动，至少完成对应模块级验证
3. 无业务代码直接拼 provider URL
4. 无直接读取 `ai_model` 裸数据构造 AI 调用参数
5. URL 归一化已复用 `normalizeBaseUrl()`
6. 若改动了 `import` / `export`，已做 ES 模块导入校验
7. 若涉及前端文案，已检查 i18n
8. 已按要求更新 `docs/tasks`
9. 已按 `docs/development/code-review-checklist.md` 完成自查

---

## 8. 关键目录

| 目录 | 内容 |
|------|------|
| `lib/` | 核心库（LLM、Embedding、ASR、TTS client） |
| `server/controllers/` | API 控制器 |
| `apps/` | 独立 app |
| `models/` | Sequelize 自动生成模型 |
| `scripts/` | 数据库升级、模型生成等脚本 |
| `docs/development/` | 开发标准与代码审查清单 |
| `docs/tasks/` | 任务跟踪、审查、归档 |

---

## 9. 相关文档

- `docs/SOUL.md`
- `docs/development/coding-standards.md`
- `docs/development/code-review-checklist.md`
- `docs/development/llm-call-standards.md`

✌Bazinga！
