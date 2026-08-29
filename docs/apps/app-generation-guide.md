# App 生成指导手册

> 当前推荐入口：这份文档是 app 平台**现行实现**的主要说明文档。
> 若需要理解旧版 `app_state` / 平台统一状态机方案，请只把 `docs/apps/historical/app-platform-design.md` 当作历史参考，不要当作当前实现规范。

## 文档目的

本文不是面向理想设计，而是面向当前仓库已经落地的 app 平台实现。目标是回答四个实际问题：

1. 一个 app 如何注册到 `mini_apps`。
2. `AppClock` 与 tick 循环如何驱动 app 后台工作。
3. app 的后端如何被安装到平台上。
4. app 的前端如何在平台中被展示和运行。

同时，本文会从第一性原则出发，说明当前设计为什么这样成立、哪里合理、哪里还存在明显优化空间。

## 第一性原则

先不要把 app 理解为“一个页面”或“一个脚本”。在当前项目里，一个可运行的 app 至少包含四类约束：

1. 注册约束：平台必须知道这个 app 存在，也就是 `mini_apps` 中必须有记录。
2. 数据约束：app 要有自己的记录数据和可选扩展表；如果存在状态机，则状态语义属于 app 自己。
3. 行为约束：app 可以通过 tick、handler、routes 或其它 app 内部机制推进业务流程，平台不要求统一状态机实现。
4. 展示约束：前端必须能根据 app 元数据把它渲染为一个可访问、可操作的界面。

所以，app 的生成本质上是“把一个声明式包安装成一个平台内可运行实例”的过程，而不是简单地新增几份前后端文件。

## 当前实现总览

### 核心目录

- `apps/{appId}/manifest.json`：app 的声明式描述入口。
- `apps/{appId}/migrations/*.js`：安装/卸载时的数据库迁移脚本。
- `apps/{appId}/server/handlers/*`：wildcard handler（约定大于配置，见 wildcard-handler-spec.md）。
- `apps/{appId}/tick/index.js`：后台轮询入口。
- `server/services/app-market.service.js`：app 安装/卸载核心服务。
- `server/services/mini-app.service.js`：app 运行期的数据和配置服务。
- `lib/app-clock.js`：统一 tick 调度器。
- `frontend/src/views/AppDetailView.vue`：app 详情页装配入口（通过 `import.meta.glob('@apps/*/frontend/views/*.vue')` + `runtime.frontend.entry` 动态装配专用前端组件）。
- `frontend/src/components/apps/ReExtractDialog.vue`：仍保留的共享兼容组件示例。

### 核心数据表

- `mini_apps`：已安装 app 的元数据注册表。
- `mini_app_rows`：app 的业务记录。
- `app_clock_registry`：加入时钟调度的 app 列表。
- `app_tick_log` / `app_tick_run`：tick 历史和运行状态。

说明：

- `app_state` / `app_row_handlers` 属于旧平台表，当前已退出新标准主路径，但兼容代码仍存在。
- 现阶段平台不再把状态机定义视为平台统一元数据。
- 若 app 有状态机，状态定义应由 app 自己代码维护。

## 一、`mini_app` 表的注册

### `mini_apps` 在平台中的角色

`mini_apps` 不是普通配置表，而是 app 实例的总入口。平台多个关键能力都依赖它：

- app 列表展示依赖它
- app 详情加载依赖它
- app 权限控制依赖它
- tick 运行时获取 app 配置依赖它
- 通用前端容器渲染字段、视图、配置依赖它

模型定义见 `models/mini_app.js`。

### 关键字段

- `id`：app 唯一标识，通常与 `apps/{appId}` 目录名一致。
- `name` / `description` / `icon` / `type`：基础展示信息。
- `component`：前端组件名（兼容字段）；当前 `AppDetailView.vue` 实际依据 `runtime.frontend.entry` 动态装配 `apps/{appId}/frontend/views/*.vue`，未命中时显示“未配置前端组件”空态。
- `fields`：字段定义 JSON。
- `views`：视图定义 JSON。
- `config`：运行配置 JSON。
- `visibility`：权限范围，如 `all`、`owner`、`department`、`role`。
- `owner_id` / `creator_id`：实例拥有者与创建者。
- `is_active`：启用状态。
- `revision`：版本号。

### 注册发生在哪里

真实注册入口在 `server/services/app-market.service.js` 的 `installAppMetadata()`：

```js
await this.models.MiniApp.create({
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  icon: manifest.icon || '📱',
  type: manifest.type,
  component: manifest.component || null,
  fields: JSON.stringify(manifest.fields || []),
  views: JSON.stringify(manifest.views || {}),
  config: JSON.stringify(config || manifest.config || {}),
  visibility,
  owner_id: userId,
  creator_id: userId,
  sort_order: 0,
  is_active: true,
  revision: 1
})
```

这意味着 `mini_apps` 不是开发者手动插入的，而是安装流程在解析 manifest 后自动写入的安装产物。

### 生成新 app 时最小要求

如果要让一个新 app 在平台中出现，至少需要准备：

1. 唯一的 `manifest.id`
2. 合法的 `manifest.fields`
3. 合法的 `manifest.views`
4. 合法的 `manifest.config`
5. 安装时可执行的元数据写入流程

换句话说，`mini_apps` 的注册不是独立工作，它是 manifest 安装链路的中间结果。

### 设计合理性

这种设计合理，因为它把“远端 app 包定义”与“本地平台实例状态”分离开了：

- manifest 描述 app 应该长什么样
- `mini_apps` 记录该 app 在当前平台实例里如何被启用和配置

这样才能支持权限、排序、实例配置覆盖和未来升级回滚。

### 当前缺口

- `models/mini_app.js` 里 `is_active` 仍使用 `BOOLEAN`，与项目规则中“布尔统一 `BIT(1)`”不一致。
- `revision` 虽然存在，但目前更多是字段变更计数，没有真正形成完整乐观锁机制。

## 二、`app_clock` 与 tick 循环

### `AppClock` 的角色

`AppClock` 是平台级后台调度器，核心代码位于 `lib/app-clock.js`。它做的事情不是直接执行业务，而是按固定节奏唤醒已注册 app 的 tick 脚本。

从第一性原则看，平台需要一个统一后台执行机制，原因有三点：

1. 很多 app 是异步工作流，不能依赖请求线程同步完成。
2. 多个 app 需要共享同一套调度、日志和错误治理能力。
3. 平台需要能够观测和手动干预后台运行状态。

### 注册入口：`app_clock_registry`

app 是否会进入 tick 调度，不是由目录存在决定，而是由 `app_clock_registry` 是否有记录决定。

安装时在 `server/services/app-market.service.js#registerToClockRegistry()` 中写入：

```js
await this.models.AppClockRegistry.create({
  id: Utils.default.newID(20),
  app_id: appId,
  tick_script: null,
  is_active: true
})
```

这一步把 app 从“已安装”升级为“会被后台唤醒”。

### tick 调度流程

`AppClock.start()` 后会周期性调用 `wakeNext()`。

简化后的运行逻辑如下：

1. 从 `app_clock_registry` 查询所有 `is_active = true` 的 app。
2. 使用 round-robin 方式选出本次要唤醒的一个 app。
3. 如果该 app 上一次 tick 仍在运行，则跳过。
4. 如果该 app 因连续失败进入冷却期，则跳过。
5. 动态加载 `apps/{appId}/tick/index.js`。
6. 构建上下文并执行 `tick(context)`。
7. 将结果写入 `app_tick_log` 和 `app_tick_run`。

### tick 文件要求

当前默认约定是：

- 路径：`apps/{appId}/tick/index.js`
- 导出：`tick(context)`

现有 app 示例包括：

- `apps/contract-mgr-v2/tick/index.js`
- `apps/contract-mgr/tick/index.js`
- `apps/ocr-tool/tick/index.js`
- `apps/invoice-mgr/tick/index.js`
- `apps/els/tick/index.js`
- `apps/current-feature-analyzer/tick/index.js`
- `lib/doc-pipeline-worker.js`（平台内部流水线，非业务 app）

### tick 上下文里有什么

`AppClock.buildContext()` 会向 tick 注入统一服务能力，实际包括但不限于：

- LLM 调用能力
- MCP / skill 调用能力
- 扩展表查询与写入能力
- 文件读取能力
- OCR / 大纲 / chunk 处理能力
- 日志能力
- app 自身元数据与时钟注册信息

这说明 tick 不是裸脚本，而是运行在平台统一能力容器中的后台函数。

### 容错与治理能力

当前 `AppClock` 已具备几项关键防护：

1. 防并发重入：用 `runningApps` 避免同一 app 同时跑多个 tick。
2. 启动清理：将未正常结束的 `app_tick_run` 标记为 `interrupted_by_restart`。
3. 连续失败冷却：连续失败达到阈值后，暂时不再继续唤醒该 app。
4. 输出裁剪：通过 `summarizeForLog()` 截断超长输出、base64、data URL，防止日志爆炸。
5. 管理接口：`server/routes/app-clock.routes.js` 提供状态查询与 `force-tick`。

### 为什么当前设计基本合理

因为平台里的很多 app 本质是“多阶段异步流水线”，例如：

- OCR 提交
- OCR 轮询
- 文本清洗
- AI 提取
- 结构化分段

这些阶段如果全部塞进单次 HTTP 请求，不仅超时风险高，也不利于重试与恢复。因此使用 tick 驱动状态前进，是比同步串行更合理的工程形态。

### 当前问题

- `tick_script` 字段存在，但当前主路径基本只使用默认 `tick/index.js`，字段尚未形成真实能力闭环。
- `AppClock` 的默认间隔和系统设置来源仍有分散，运行语义不够集中。

## 三、app 的后端如何安装到平台上

### 安装入口

安装入口在：

- 路由：`server/routes/app-market.routes.js`
- 控制器：`server/controllers/app-market.controller.js#installApp`
- 服务：`server/services/app-market.service.js#installApp`

前端调用的是 `POST /api/app-market/install`。

### 安装链路全流程

当前实现中的完整安装顺序如下。

1. 检查 app 是否已安装。
2. 从 registry 拉取 `manifest.json`。
3. 检查依赖，如 MCP 服务和平台最低版本。
4. 校验 `extension_tables` 表名是否合法。
5. 创建本地目录 `apps/{appId}`。
6. 下载并写入 migration 脚本。
7. 执行 install migration。
8. 保存本地 `manifest.json`。
9. 安装 handlers（如该 app 仍使用 handler 机制）。
10. 注册 `mini_apps` 元数据。
11. 注册 `app_clock_registry`。

### 开发一个 app 至少要准备什么

从后端角度，最少需要准备以下文件或声明：

1. `apps/{appId}/manifest.json`
2. `apps/{appId}/migrations/install.js`
3. `apps/{appId}/migrations/uninstall.js`
4. `apps/{appId}/tick/index.js`，如果这个 app 需要后台轮询
5. `apps/{appId}/server/handlers/*`，如果这个 app 需要自定义 API（wildcard 模式，见 wildcard-handler-spec.md）
6. `apps/{appId}/states.js`，如果该 app 想把状态定义集中到单独模块（推荐，非强制）

### manifest 里最重要的内容

以 `apps/contract-mgr-v2/manifest.json` 为例，几个关键段落分别负责不同职责：

- `fields`：定义主表单字段
- `extension_tables`：定义扩展存储结构
- `migrations`：定义安装/卸载迁移脚本
- `views`：定义列表展示
- `config`：定义运行时能力，例如 `step_resources`
- `states`：可选的状态声明。当前不再要求它一定作为平台统一事实源。
- `custom_handlers`：定义额外控制器或扩展动作

### 关于状态机定义的当前规则

当前架构规则已经变化：

1. 平台只负责 tick 调度、路由挂载、附件/数据库/LLM/MCP 等宿主能力。
2. 平台不再负责维护各个 app 的状态机元数据。
3. `app_state` / `app_row_handlers` 已退出新 app 标准依赖，但兼容代码和部分管理入口仍未完全删除。

如果 app 有状态机，推荐实现是：

- 在 `apps/{appId}/states.js` 中集中导出状态相关方法，例如：
- `getInitialState()`
- `getConfirmedState()`
- `classifyStatus()`
- `getStatusSummaryCategories()`

但这只是**默认推荐实现**，不是平台对所有 app 的统一强制标准。只要状态语义由 app 自己代码负责，而不是由平台通用层负责，也可以放在：

1. tick 模块常量中
2. app 自己的 service 模块中
3. app 自己的 routes / runtime 模块中

需要补充一条当前仓库事实（已更新）：

- 早期 `server/services/mini-app.service.js` 中的 `STRICT_STATE_APP_IDS`（把 `invoice-mgr` 和 `contract-mgr` 视为严格状态 app、缺失 `states.js` 即报错）**已移除**。当前自治主路径下，app 初始状态取自安装时展开的 `config.step_resources` 首个 key（`MiniAppService.getAppInitialState()`），带 `'pending'` 兜底，不再依赖 `states.js` 导出。

关键约束只有一条：

- **状态机必须由 app 自己管理，平台不要再猜状态名或兜底业务状态语义。**

### handler 安装机制（历史机制）

`installHandlers()` 是旧平台机制的一部分，会收集需要安装的 handler，来源有两种：

1. 优先从 tick 模块导出的 `getStateGraph()` 中收集
2. 回退到 `manifest.states[].handler`

然后把 handler 文件保存到本地，并在数据库中注册 `app_row_handler` 记录。

这说明旧平台曾经希望把 app 的“状态推进逻辑”注册成平台可管理资源。但在当前架构下，这不再是强制方向。

### state 安装机制（历史机制）

`installStates()` 会把 manifest 中的状态定义写入 `app_state` 表，核心字段包括：

- `name`
- `label`
- `is_initial`
- `is_terminal`
- `is_error`
- `handler_id`
- `success_next_state`
- `failure_next_state`

这一步属于旧平台机制。当前推荐的新 app 不应再依赖它作为主路径。

### 回滚为什么重要

安装流程同时修改：

- 文件系统
- 数据库元数据
- 扩展表
- （历史）状态定义
- handler 注册
- 时钟注册

如果没有回滚，任何一步失败都会产生“半安装 app”。当前 `rollbackInstall()` 虽然不是跨资源强事务，但已经是非常必要的补偿机制。

### 对当前实现的反思

合理性：

- 安装责任集中在 `AppMarketService`，这是对的。
- 失败有补偿式回滚，这是对的。
- manifest 驱动安装，降低了手工注册成本，这也是对的。

优化点：

- 当前安装成功后只形成“本地目录 + 数据库注册”，但对前端自定义组件的自动接入还不完整。
- 历史的状态安装、handler 安装机制与当前“状态机由 app 自己管理”的方向并不完全一致，需要继续收口。

## 四、app 的前端如何处理

### 前端发现 app 的方式

前端 app 列表页是 `frontend/src/views/AppsView.vue`。

它调用：

- `frontend/src/api/mini-apps.ts#getApps()`
- 后端接口：`GET /api/mini-apps`

后端由 `MiniAppService.getAccessibleApps(userId)` 返回当前用户可访问的 app 列表。

所以，前端看到哪些 app，最终取决于：

1. app 是否已经注册到 `mini_apps`
2. `is_active` 是否为真
3. `visibility` 是否允许当前用户访问

### 前端进入 app 详情后的装配方式

详情入口是 `frontend/src/views/AppDetailView.vue`。

流程如下：

1. 根据路由中的 `appId` 调用 `getAppWithRuntime(appId)`。
2. 读取返回的 `runtime.frontend.entry` 字段。
3. 通过 `import.meta.glob('@apps/*/frontend/views/*.vue')` 匹配并动态加载对应视图组件。
4. 若 `runtime.frontend.entry` 未声明或匹配不到，则显示“该应用尚未配置前端组件”的空状态，不再回退到 `GenericMiniApp.vue`。

### 关于通用前端容器的当前事实

`GenericMiniApp.vue` 已经从当前主路径退役并删除，不再作为现行实现的一部分。

这意味着当前前端装配现实是：

1. 平台主路径依赖 `AppDetailView.vue` 的 glob 动态装配（`runtime.frontend.entry` → `frontend/views/*.vue`）
2. app 若要在当前前端可用，需要提供 `frontend/views/*.vue` 专用视图组件并声明 `runtime.frontend.entry`
3. “通用容器覆盖大多数 app”的思路属于历史方案，不应再当作当前实现假设

### 自定义前端组件当前如何工作

后端已经提供了：

- `GET /api/app-market/component/:appId`

该接口会读取：

- `apps/{appId}/frontend/{component}.umd.js`
- 可选的同名 `.css`

并返回代码、样式和版本信息。

但当前默认详情页 `AppDetailView.vue` **已经不再依赖硬编码组件映射**：它通过 `getAppWithRuntime(appId)` 获取 `runtime.frontend.entry`，再用 `import.meta.glob('@apps/*/frontend/views/*.vue')` 动态加载 `apps/{appId}/frontend/views/*.vue`。这意味着：

- 新 app 只要在 `apps/{appId}/frontend/views/` 下放置视图组件，并在 manifest 的 `runtime.frontend.entry` 声明入口，即可自动装配，无需修改主前端工程。
- 后端提供的 `/api/app-market/component/:appId` 动态组件接口与 glob 装配属于两条并行链路，当前默认主路径是 glob 装配。

### 这意味着什么

从第一性原则看，真正的 app 平台应尽量让“新 app 接入”不依赖修改平台主前端代码。当前系统已经通过 `import.meta.glob` + `runtime.frontend.entry` 实现了这一闭环：前端最后一公里已经打通，新 app 接入前端不再需要改主前端工程。

## 五、如何按当前实现生成一个新 app

以下步骤描述的是“符合当前代码事实”的最小可行路径。

### 步骤 1：创建 app 目录

目录建议如下：

```text
apps/{appId}/
  manifest.json
  migrations/
    install.js
    uninstall.js
  tick/
    index.js
  server/
    handlers/
    services/
  frontend/
    ... 可选
```

### 步骤 2：编写 `manifest.json`

至少明确：

1. `id`
2. `name`
3. `type`
4. `fields`
5. `views`
6. `config`
7. `states`（如果你选择 manifest 里保留状态声明）
8. `migrations`

如果 app 需要扩展表，则补充 `extension_tables`。
如果 app 需要自定义交互，则补充 `custom_handlers`。
如果 app 需要专用页面，则补充 `component`。

### 步骤 3：实现数据库迁移

在 `migrations/install.js` 中创建 app 需要的扩展表。
在 `migrations/uninstall.js` 中提供卸载反向清理逻辑。

注意：

- 涉及数据库字段变更必须先满足项目红线要求。
- 不要手改 `models/`，这些是生成产物。

#### 迁移执行模型（安装 + 升级共用）

平台 `app-market.service.js` 的 `runMigration()` 执行顺序固定为：

1. 调 `migration.check(sequelize)`，返回 `false` 则**跳过** `up()`；
2. `check()` 返回 `true` 才执行 `up()`。

触发时机有两个：

- **首次安装**（应用市场安装 app）；
- **app 升级**（应用市场「更新」按钮 → 保留数据卸载 → 重装 → 重跑迁移）。

因此 `install.js` 必须同时覆盖两条路径，写法约定：

- `up()` 全部幂等：建表用 `CREATE TABLE IF NOT EXISTS`；数据迁移用带条件的 `UPDATE`（条件不满足时影响 0 行），禁止“仅首装才能跑”的写法；
- `check()` 返回 `true` 的条件 = 表不齐（首装）**或**存在待迁移的历史数据（升级）。表已存在且无待迁移数据时返回 `false`，升级时自然跳过；
- 数据迁移与汇总计数重算都放在 `up()` 内完成，**禁止依赖“手动跑一次脚本”的体外迁移**——app 的数据演进必须随升级按钮自动发生；
- 需要发布数据迁移时，同步递增 `manifest.json` 的 `version` 并写 `changelog`，应用市场按版本差显示「更新」按钮（本地已装版本记录在 `mini_apps.config._registry_version`，安装/升级时由平台自动写入，app 无需关心）。

参考实现：`apps/standard-mgr/migrations/install.js`（首装建 4 张表；升级路径检测并迁移历史回填数据 valid→suspected，随后按实况重算汇总计数）。

升级链路：PR 合并到 master → registry manifest 版本变化 → 应用市场对该 app 显示「更新」→ 用户点击后 `check()`/`up()` 自动执行。

### 步骤 4：实现 app 自己的运行逻辑

有几种常见组合：

1. `states.js + tick`
2. `states.js + routes/service`
3. `tick/service` 内部常量直管

当前推荐方向是：

- 用 app 自己代码管理状态语义
- 用 tick 驱动后台扫描与推进（如果该 app 需要 tick）
- 平台不直接决定 `pending_*` / `confirmed` / `*_failed` 这类状态名

### 步骤 5：决定是否走通用前端

当前不应再以复用 `GenericMiniApp.vue` 作为新 app 的默认前端方案（该组件已删除）。

按当前实现，优先策略应是：

1. 在 `apps/{appId}/frontend/views/` 下实现专用视图组件
2. 在 manifest 的 `runtime.frontend.entry` 声明入口路径（如 `frontend/views/AppRuntimeView.vue`）
3. `AppDetailView.vue` 通过 `import.meta.glob` 自动装配，无需修改主前端工程

只有在以下情况才建议做专用组件：

- 需要复杂可视化
- 需要树、图、看板、时间轴等特定交互
- 通用容器无法表达核心业务模型

### 步骤 6：通过 App Market 安装

平台当前安装入口不是“手工插库”，而是 App Market：

- 前端：`AppMarketPanel.vue`
- API：`POST /api/app-market/install`
- 服务：`AppMarketService.installApp()`

安装完成后，系统会自动完成：

- 本地目录生成
- migration 执行
- `mini_apps` 注册
- `app_clock_registry` 注册

### 步骤 7：验证 app 是否真正可运行

至少应确认：

1. `GET /api/mini-apps` 能看到该 app
2. `GET /api/mini-apps/:appId` 能拿到完整详情
3. 前端 `/apps/:appId` 能正常打开
4. 如果有 tick，`/api/app-clock/status` 能看到运行状态
5. 创建记录后，状态能够按预期推进

## 六、值得优先优化和重构的方向

### 1. 前端装配现状（已闭环）

现状：

- `AppDetailView.vue` 已通过 `import.meta.glob('@apps/*/frontend/views/*.vue')` + `runtime.frontend.entry` 动态装配 app 专用视图
- 新 app 放置 `frontend/views/*.vue` 并声明 manifest `runtime.frontend.entry` 即可自动接入，无需修改主前端工程

遗留优化：

- `/api/app-market/component/:appId`（UMD 组件包）与 glob 装配是两条并行链路，可考虑收敛为单一主路径
- 动态组件版本管理与热更新仍可增强

### 2. 收敛 `AppClock` 配置来源

现状：

- `lib/app-clock.js` 有自己的默认值
- 系统设置层也维护了时钟间隔配置

建议：

- 将默认值与运行配置统一交由同一配置入口管理
- 避免文档、代码、运行参数三套口径

### 3. 明确 `tick_script` 字段去留

现状：

- 字段存在
- 安装时固定写 `null`
- 实际默认只加载 `tick/index.js`

建议：

- 要么正式支持 manifest 自定义 tick 脚本路径
- 要么删除该历史预留，减少误导

### 4. 前端装配入口已收敛为 glob 动态加载

现状：

- `AppDetailView.vue` 已统一走 `import.meta.glob` + `runtime.frontend.entry` 装配，硬编码组件映射已移除
- `component` 字段与 UMD 动态组件接口仍作为兼容能力保留，但不是默认主路径

遗留优化：

- 可将 `/api/app-market/component/:appId` 收敛为 glob 装配的兜底，或明确弃用其中一条链路

### 5. 将文档补齐到“manifest 契约级”

现状：

- 很多规则分散在代码和已有 app 样例里

建议：

- 后续补一份 manifest 字段级参考手册
- 把 `fields`、`views`、`config.step_resources`、`states` 的契约写清楚

## 七、结论

当前 app 平台的核心思想是正确的：

- 用 manifest 描述 app
- 用安装服务把 manifest 转成平台内实例
- 用 `mini_apps` 作为实例注册表
- 用 `AppClock` + app 自己的 tick / routes / service 驱动后台工作流
- 用 `mini_apps` 元数据 + `AppDetailView.vue` 装配专用前端组件

它已经具备一个小型 app 平台的基础骨架，尤其适合文档处理、异步流水线和结构化数据提取类场景。

当前最大的短板不在于“不能工作”，而在于“平台化闭环还差最后一步”：

- 自定义前端动态装配未闭环
- 部分字段/配置存在历史欠账
- 关键契约仍主要依赖源码阅读而非文档沉淀

因此，本阶段最有价值的工作不是推翻重写，而是继续围绕现有骨架做契约收敛、装配自动化和运维能力增强。
