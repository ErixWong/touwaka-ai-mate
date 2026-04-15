# App 平台开发就绪评估报告

> **评估日期**：2026-04-14
> **评估对象**：[`app-platform-design.md`](app-platform-design.md)
> **评估目标**：判断设计文档是否具备开发条件，识别前置依赖和风险

---

## 一、总体结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 设计完整度 | ⭐⭐⭐⭐ | 数据模型、API、前端架构、状态机均已详细设计 |
| 基础设施就绪 | ⭐⭐⭐⭐ | 核心依赖（调度器、MCP、附件服务）均已实现 |
| 可立即开发 | ⭐⭐⭐⭐ | Phase 1 可启动，需先完成 2 个前置项 |
| 风险等级 | 🟡 中 | 时钟调度器需扩展，脚本安全需评估 |

**结论：可以启动 Phase 1 开发，需先完成数据库迁移和前端字段组件。**

---

## 二、现有基础设施盘点

### ✅ 已就绪（可直接复用）

| 基础设施 | 位置 | 就绪状态 | 说明 |
|----------|------|----------|------|
| 后台任务调度器 | [`lib/background-scheduler.js`](../../lib/background-scheduler.js) | ✅ 完整 | 支持 register/start/stop/防重叠/超时保护，可直接注册 App Clock 任务 |
| MCP Client 驻留进程 | [`lib/resident-skill-manager.js`](../../lib/resident-skill-manager.js) | ✅ 完整 | 支持 invokeByName 调用 MCP 工具，markitdown/mineru 已部署 |
| 附件服务 | [`server/controllers/attachment.controller.js`](../../server/controllers/attachment.controller.js) | ✅ 完整 | 上传/下载/Token/批量/权限检查，mini_app_files 可复用此模式 |
| 数据库迁移框架 | [`scripts/upgrade-database.js`](../../scripts/upgrade-database.js) | ✅ 完整 | 幂等迁移、safeExecute、check 函数，新增 6 张表无障碍 |
| 模型自动生成 | [`scripts/generate-models.js`](../../scripts/generate-models.js) | ✅ 完整 | 迁移后自动生成 Sequelize 模型 |
| 分页查询工具 | [`lib/query-builder.js`](../../lib/query-builder.js) | ✅ 完整 | buildQueryOptions + buildPaginatedResponse，通用 CRUD 直接用 |
| 权限中间件 | [`server/middlewares/auth.js`](../../server/middlewares/auth.js) | ✅ 完整 | JWT 认证、角色检查、session 注入 |
| RBAC 体系 | `roles` + `user_roles` + `role_permissions` | ✅ 完整 | App 级权限可直接复用 |
| 组织架构 | `departments` + `positions` | ✅ 完整 | 部门级 visibility 可直接查询 |
| 知识库权限模式 | [`lib/kb-permission.js`](../../lib/kb-permission.js) | ✅ 完整 | visibility ENUM 模式可直接参考复制 |
| fapiao 技能 | [`data/skills/fapiao/index.js`](../../data/skills/fapiao/index.js) | ✅ 完整 | 发票 OCR + 结构化提取，Phase 1 发票管理直接调用 |
| 技能调用链 | [`lib/tool-manager.js`](../../lib/tool-manager.js) | ✅ 完整 | callSkill/callMcp 已在脚本 context.services 中设计 |
| 前端路由框架 | [`frontend/src/router/index.ts`](../../frontend/src/router/index.ts) | ✅ 完整 | 添加 /apps 路由无障碍 |
| 前端导航栏 | [`frontend/src/components/AppHeader.vue`](../../frontend/src/components/AppHeader.vue) | ✅ 完整 | 添加 App 导航项无障碍 |
| i18n 体系 | [`frontend/src/i18n/`](../../frontend/src/i18n/) | ✅ 完整 | 中英双语，新增 apps 命名空间即可 |
| Controller 模式 | 21 个已有 Controller | ✅ 完整 | 参考任意 Controller 创建 MiniAppController |

### ⚠️ 部分就绪（需扩展）

| 基础设施 | 现状 | 需要的扩展 |
|----------|------|-----------|
| BackgroundTaskScheduler | 已有 3 个注册任务 | 需注册第 4 个 `app-clock` 任务，实现 App 行记录扫描 + 脚本调度 |
| 附件服务 | source_tag 分发模式 | 需新增 `mini_app_file` source_tag 类型，或独立实现文件管理 |
| MCP 路由 | [`server/routes/mcp.routes.js`](../../server/routes/mcp.routes.js) 已有 | 脚本中的 services.callMcp 需封装为独立服务层，不经过 HTTP |

### ❌ 未实现（需新建）

| 基础设施 | 设计文档引用 | 影响范围 | 替代方案 |
|----------|-------------|----------|----------|
| DynamicForm.vue | [`docs/design/parse2/form-system-design.md`](parse2/form-system-design.md) | 前端表单渲染 | **需新建 GenericMiniApp 的字段渲染组件** |
| LLM 直接调用服务 | 脚本 context.services.callLlm | 后端脚本执行 | 需封装 LLM 调用为独立 Service，供脚本调用 |
| 脚本加载器 | app_row_handlers.handler 字段 | 时钟调度 | 需实现动态 require/import 脚本模块 |

---

## 三、前置任务清单

> 以下任务必须在 Phase 1 正式编码前完成。

### 前置 1：数据库表创建（6 张新表）

**工作量**：中等（约 1 个迁移脚本，6 个 check+migrate 函数）

需要在 [`scripts/upgrade-database.js`](../../scripts/upgrade-database.js) 的 `MIGRATIONS` 数组末尾添加：

| 表名 | 用途 | 外键依赖 |
|------|------|----------|
| `mini_apps` | 小程序注册表 | `users`（owner_id, creator_id） |
| `mini_app_rows` | 数据记录 | `mini_apps`, `users` |
| `mini_app_files` | 关联文件 | `mini_app_rows`, `mini_apps` |
| `app_row_handlers` | 处理脚本 | 无 |
| `app_state_events` | 状态-脚本绑定 | `mini_apps`, `app_row_handlers` |
| `app_action_logs` | 执行日志 | `app_row_handlers`, `mini_app_rows`, `mini_apps` |
| `mini_app_role_access` | 角色访问控制 | `mini_apps`, `roles` |

**风险**：低。迁移框架成熟，所有表结构已在设计文档中以完整 SQL 给出。

**⚠️ 注意**：根据 SOUL.md 规范，数据库字段增删改需获得 Eric 明确同意。

### 前置 2：前端字段渲染组件

**工作量**：中等（8 个 Vue 组件）

设计文档中定义了 `GenericMiniApp.vue` 需要的字段渲染组件：

```
frontend/src/components/apps/fields/
├── TextField.vue           # text → <input>
├── TextAreaField.vue       # textarea → <textarea>
├── NumberField.vue         # number → <input type="number">
├── DateField.vue           # date → <DatePicker>
├── SelectField.vue         # select → <Select>
├── FileField.vue           # file → <FileUpload>
├── BooleanField.vue        # boolean → <Switch>
├── GroupField.vue          # group → 递归渲染子字段
└── RepeatingField.vue      # repeating → 可编辑表格
```

**风险**：中。GroupField 和 RepeatingField 的递归渲染有一定复杂度。

**缓解**：Phase 1 先实现基础类型（text/number/date/select/file/boolean），Group 和 Repeating 留到 Phase 2。

### 前置 3：脚本服务层封装（callMcp / callLlm / callSkill）

**工作量**：小（1 个 Service 文件）

脚本中的 `context.services` 需要封装三个调用方法：

- `services.callMcp(serverName, toolName, args)` — 调用 MCP 服务（通过 `global.residentSkillManager`）
- `services.callLlm(promptKey, variables)` — 调用 LLM（从 ChatService 提取独立调用逻辑）
- `services.callSkill(skillId, toolName, args)` — 调用技能（通过 SkillLoader）

> **注意**：这不是独立的前置阻塞项，而是脚本开发的一部分。
> 脚本返回的 JSON 直接填入 `row.data`，能提取的字段自动填入，提取不出的留空由用户手工补全。
> LLM 调用封装会在开发第一个需要 LLM 的脚本（如合同条款对比）时同步完成。

**风险**：低。callMcp 和 callSkill 已有现成实现（ResidentSkillManager / SkillLoader），callLlm 需从 ChatService 提取。

---

## 四、设计文档质量评估

### ✅ 规格完整的部分

| 模块 | 完整度 | 说明 |
|------|--------|------|
| 数据库表结构 | ⭐⭐⭐⭐⭐ | 6 张表的完整 CREATE TABLE SQL，含字段类型、注释、索引、外键 |
| API 端点设计 | ⭐⭐⭐⭐ | 所有 CRUD + AI 提取 + 批量 + 对比 + 验证 API 均已列出 |
| 状态机设计 | ⭐⭐⭐⭐⭐ | 状态定义、流转规则、脚本绑定、时钟调度机制完整 |
| 处理脚本规范 | ⭐⭐⭐⭐⭐ | 脚本接口、返回值规范、3 个完整示例脚本 |
| 前端组件架构 | ⭐⭐⭐⭐ | GenericMiniApp 工作原理、字段映射、组件结构清晰 |
| 权限设计 | ⭐⭐⭐⭐ | App 级 + 记录级两层权限，Phase 1 极简方案明确 |
| 场景映射 | ⭐⭐⭐⭐⭐ | 5 个场景（A~E）均有完整的用户流程和技术路径 |
| 实施路线 | ⭐⭐⭐ | Phase 1/2/3 划分合理，但时间估算偏乐观 |

### ⚠️ 需要补充的部分

| 缺失项 | 影响范围 | 优先级 | 建议 |
|--------|----------|--------|------|
| API 请求/响应体详细格式 | 后端开发 | 中 | Phase 1 开发时边写边补，参考现有 Controller 模式 |
| 错误码定义 | 前后端 | 低 | 复用现有统一响应格式 `ctx.success()` / `ctx.throw()` |
| 前端状态管理（Pinia store）| 前端开发 | 中 | 需新建 `stores/app.ts`，参考现有 store 模式 |
| SSE/轮询机制 | 前端实时更新 | 中 | 复用现有 StreamController 的 SSE 模式，或用简单轮询 |
| 脚本沙箱安全 | 后端安全 | 高 | 脚本直接 require 动态模块有安全风险，需评估 |
| i18n 词条 | 前端 | 低 | 新增 apps 命名空间即可 |

### ❌ 设计中的模糊点

| 模糊点 | 说明 | 建议 |
|--------|------|------|
| `services.callMcp` 的实现路径 | 设计文档说脚本调用 MCP，但未明确是直接调用 ResidentSkillManager 还是通过 HTTP | 建议直接调用 `global.residentSkillManager`，不走 HTTP |
| `services.callLlm` 的模型选择 | 脚本调用 LLM 时用哪个模型？用专家关联的模型还是系统默认模型？ | 建议在 `app_row_handlers` 表增加 `model_id` 字段，或使用系统默认模型 |
| 文件存储路径 | mini_app_files 的文件存储复用 attachments 目录还是独立目录？ | 建议复用 `data/attachments/` 目录，source_tag = `mini_app_file` |
| 批量任务表 | 设计文档提到 `batch_tasks` 但未给出完整 CREATE TABLE | Phase 1 可简化：用 mini_app_rows 的 status 分组统计代替独立 batch_tasks 表 |

---

## 五、开发风险评估

### 🔴 高风险

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| 脚本加载安全 | `app_row_handlers.handler` 指定的脚本路径如果被恶意修改，可能加载任意代码 | 限制脚本路径白名单（只允许 `scripts/` 和 `skills/` 前缀）；handler 路径需管理员审核 |
| JSON 字段查询性能 | `mini_app_rows.data` 是 JSON 类型，大量数据时查询/排序可能很慢 | 初期不优化；数据量超 1000 条时按需添加虚拟列索引（设计文档已预留方案） |

### 🟡 中风险

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| 时钟调度器扩展 | 现有 BackgroundTaskScheduler 是通用框架，App Clock 需要更复杂的逻辑（查状态→加载脚本→执行→更新状态） | 将 App Clock 逻辑封装为独立 handler 函数，注册到现有调度器 |
| GenericMiniApp 复杂度 | 一个组件覆盖所有 App 的表单/列表/详情，可能变得过于复杂 | 严格按字段类型拆分子组件；复杂 App 允许自定义组件覆盖 |
| 前端轮询性能 | 批量处理时前端频繁轮询状态可能增加服务器负担 | 轮询间隔从 2s 开始，逐步增加到 10s；或复用 SSE 推送 |

### 🟢 低风险

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| 数据库迁移 | 新增 6 张表，无破坏性变更 | 迁移框架成熟，幂等执行 |
| 权限模型 | 复用现有 RBAC + visibility 模式 | 直接参考知识库权限实现 |
| fapiao 技能集成 | 已有完整实现 | 脚本中直接调用即可 |

---

## 六、推荐开发顺序

基于依赖关系和风险等级，推荐以下开发顺序：

```
Phase 0: 前置准备
  ├── P0-1: 数据库迁移脚本（7 张表）     ← 必须先完成
  └── P0-2: 前端字段渲染组件（基础 6 个）  ← 前端依赖

Phase 1-A: 后端核心
  ├── P1A-1: MiniAppController + 路由     ← CRUD API
  ├── P1A-2: MiniAppDataService           ← 通用数据操作
  ├── P1A-3: App Clock 调度器             ← 状态机引擎
  └── P1A-4: 处理脚本框架（脚本加载器）    ← 脚本执行

Phase 1-B: 前端核心
  ├── P1B-1: AppHeader 导航 + 路由        ← 入口
  ├── P1B-2: AppsView 列表页              ← App 选择
  ├── P1B-3: AppDetailView + GenericMiniApp ← 核心组件
  └── P1B-4: Pinia store + API service    ← 状态管理

Phase 1-C: 第一个小程序
  ├── P1C-1: 发票管理 App 配置（INSERT）   ← 数据初始化
  ├── P1C-2: fapiao-extract 处理脚本      ← 复用 fapiao 技能
  └── P1C-3: 端到端测试                   ← 验证完整流程
```

---

## 七、与现有代码的集成点

### 新增文件清单

```
后端：
  scripts/upgrade-database.js                          ← 修改（添加 6 个迁移）
  server/controllers/mini-app.controller.js            ← 新建
  server/routes/mini-app.routes.js                     ← 新建
  server/services/mini-apps/
    ├── MiniAppService.js                              ← 新建（App 注册管理）
    ├── MiniAppDataService.js                          ← 新建（通用 CRUD）
    ├── AppClockScheduler.js                           ← 新建（时钟调度）
    ├── ScriptRunner.js                                ← 新建（脚本加载执行）
    └── LlmService.js                                  ← 新建（LLM 调用封装）
  scripts/app-handlers/
    ├── ocr-service/index.js                           ← 新建（OCR 处理脚本）
    ├── llm-extract/index.js                           ← 新建（LLM 提取脚本）
    └── fapiao-extract/index.js                        ← 新建（发票提取脚本）
  server/index.js                                      ← 修改（注册新路由和调度器）

前端：
  frontend/src/router/index.ts                         ← 修改（添加 /apps 路由）
  frontend/src/components/AppHeader.vue                ← 修改（添加 App 导航项）
  frontend/src/views/AppsView.vue                      ← 新建
  frontend/src/views/AppDetailView.vue                 ← 新建
  frontend/src/stores/app.ts                           ← 新建（Pinia store）
  frontend/src/api/services.ts                         ← 修改（添加 mini-app API）
  frontend/src/components/apps/
    ├── GenericMiniApp.vue                             ← 新建（核心通用组件）
    ├── AppCard.vue                                    ← 新建
    ├── AppContainer.vue                               ← 新建
    └── fields/
      ├── TextField.vue                                ← 新建
      ├── TextAreaField.vue                            ← 新建
      ├── NumberField.vue                              ← 新建
      ├── DateField.vue                                ← 新建
      ├── SelectField.vue                              ← 新建
      ├── FileField.vue                                ← 新建
      └── BooleanField.vue                             ← 新建
  frontend/src/i18n/locales/zh-CN.ts                   ← 修改（添加 apps 命名空间）
  frontend/src/i18n/locales/en-US.ts                   ← 修改（添加 apps 命名空间）
```

### 修改文件清单

| 文件 | 修改内容 | 风险 |
|------|----------|------|
| [`server/index.js`](../../server/index.js) | 注册 mini-app 路由 + App Clock 调度任务 | 低 |
| [`scripts/upgrade-database.js`](../../scripts/upgrade-database.js) | 添加 6 个迁移项 | 低 |
| [`frontend/src/router/index.ts`](../../frontend/src/router/index.ts) | 添加 /apps 和 /apps/:appId 路由 | 低 |
| [`frontend/src/components/AppHeader.vue`](../../frontend/src/components/AppHeader.vue) | 添加 App 导航链接 | 低 |
| [`frontend/src/api/services.ts`](../../frontend/src/api/services.ts) | 添加 mini-app API 函数 | 低 |
| [`frontend/src/i18n/locales/zh-CN.ts`](../../frontend/src/i18n/locales/zh-CN.ts) | 添加 apps 命名空间词条 | 低 |
| [`frontend/src/i18n/locales/en-US.ts`](../../frontend/src/i18n/locales/en-US.ts) | 添加 apps 命名空间词条 | 低 |

---

## 八、最终建议

### 可以立即开始的工作

1. **数据库迁移脚本** — 纯机械工作，设计文档已给出完整 SQL
2. **前端导航和路由** — 修改量小，无依赖
3. **MiniAppController 骨架** — 参考现有 Controller 模式

### 需要讨论的决策点

| 决策点 | 选项 | 建议 |
|--------|------|------|
| 脚本存放位置 | A: `scripts/app-handlers/` B: `data/skills/` 子目录 | 选 A，与技能目录分离，职责清晰 |
| LLM 调用方式 | A: 封装独立 LlmService B: 复用 ChatService | 选 A，ChatService 耦合太多聊天逻辑 |
| 文件存储 | A: 复用 attachments 服务 B: 独立存储 | 选 A，减少重复代码 |
| Phase 1 范围 | A: 只做发票管理 B: 发票 + 合同 | 选 A，先验证架构再扩展 |

### 不建议现在做的事

1. **GroupField / RepeatingField** — Phase 2 再实现，Phase 1 用扁平字段
2. **自定义组件**（ContractManager 等）— Phase 1 用 GenericMiniApp 覆盖
3. **虚拟列索引** — 等数据量上来后再优化
4. **批量任务独立表** — 用 status 分组统计代替
5. **App 管理后台 UI** — Phase 1 用 SQL 直接插入 App 配置
