# App 生成指导手册

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
2. 数据约束：app 要有自己的记录数据、状态数据和可选扩展表。
3. 行为约束：app 要么通过 handler，要么通过 tick，把状态从一个节点推进到下一个节点。
4. 展示约束：前端必须能根据 app 元数据把它渲染为一个可访问、可操作的界面。

所以，app 的生成本质上是“把一个声明式包安装成一个平台内可运行实例”的过程，而不是简单地新增几份前后端文件。

## 当前实现总览

### 核心目录

- `apps/{appId}/manifest.json`：app 的声明式描述入口。
- `apps/{appId}/migrations/*.js`：安装/卸载时的数据库迁移脚本。
- `apps/{appId}/handlers/*`：状态处理器。
- `apps/{appId}/tick/index.js`：后台轮询入口。
- `server/services/app-market.service.js`：app 安装/卸载核心服务。
- `server/services/mini-app.service.js`：app 运行期的数据和配置服务。
- `lib/app-clock.js`：统一 tick 调度器。
- `frontend/src/components/apps/GenericMiniApp.vue`：通用 app 前端容器。
- `frontend/src/views/AppDetailView.vue`：app 详情页装配入口。

### 核心数据表

- `mini_apps`：已安装 app 的元数据注册表。
- `mini_app_rows`：app 的业务记录。
- `app_state`：app 状态图定义。
- `app_row_handler`：行处理器注册。
- `app_clock_registry`：加入时钟调度的 app 列表。
- `app_tick_log` / `app_tick_run`：tick 历史和运行状态。

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
- `component`：前端组件名；为空时默认走 `GenericMiniApp`。
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
- `apps/doc-ocr-pipeline/tick/index.js`

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
9. 安装 handlers。
10. 注册 `mini_apps` 元数据。
11. 注册 `app_state` 状态图。
12. 注册 `app_clock_registry`。

### 开发一个 app 至少要准备什么

从后端角度，最少需要准备以下文件或声明：

1. `apps/{appId}/manifest.json`
2. `apps/{appId}/migrations/install.js`
3. `apps/{appId}/migrations/uninstall.js`
4. `apps/{appId}/tick/index.js`，如果这个 app 需要后台轮询
5. `apps/{appId}/handlers/*`，如果状态图依赖 handler

### manifest 里最重要的内容

以 `apps/contract-mgr-v2/manifest.json` 为例，几个关键段落分别负责不同职责：

- `fields`：定义主表单字段
- `extension_tables`：定义扩展存储结构
- `migrations`：定义安装/卸载迁移脚本
- `views`：定义列表展示
- `config`：定义运行时能力，例如 `step_resources`
- `states`：定义状态机
- `custom_handlers`：定义额外控制器或扩展动作

### handler 安装机制

`installHandlers()` 会收集需要安装的 handler，来源有两种：

1. 优先从 tick 模块导出的 `getStateGraph()` 中收集
2. 回退到 `manifest.states[].handler`

然后把 handler 文件保存到本地，并在数据库中注册 `app_row_handler` 记录。

这说明平台希望 app 的“状态推进逻辑”成为可管理资源，而不是散落在某个脚本里的隐式行为。

### state 安装机制

`installStates()` 会把 manifest 中的状态定义写入 `app_state` 表，核心字段包括：

- `name`
- `label`
- `is_initial`
- `is_terminal`
- `is_error`
- `handler_id`
- `success_next_state`
- `failure_next_state`

这一步的意义是把运行时状态图持久化，让前端展示、记录初始化和后台推进都能基于统一事实工作。

### 回滚为什么重要

安装流程同时修改：

- 文件系统
- 数据库元数据
- 扩展表
- 状态定义
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
- 依赖校验、表名校验、状态安装、handler 安装之间的契约仍然偏隐式，应继续文档化。

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

1. 根据路由中的 `appId` 调用 `getApp(appId)`。
2. 读取返回的 `component` 字段。
3. 如果 `component` 在 `AppComponentMap` 中有映射，则加载专用视图。
4. 否则回退到 `GenericMiniApp.vue`。

### 通用前端容器能做什么

`GenericMiniApp.vue` 当前已经具备较强的低代码容器能力：

- 列表渲染
- 状态筛选
- 分页
- 新建记录
- 编辑记录
- 删除记录
- 详情查看
- OCR 内容查看
- 批量上传
- 对比结果查看
- 步骤资源配置

它依赖的核心元数据来自：

- `app.fields`
- `app.views`
- `app.states`
- `app.config`

也就是说，只要一个 app 的模型足够遵守 manifest 约定，很多场景不需要定制前端页面也能直接运行。

### 自定义前端组件当前如何工作

后端已经提供了：

- `GET /api/app-market/component/:appId`

该接口会读取：

- `apps/{appId}/frontend/{component}.umd.js`
- 可选的同名 `.css`

并返回代码、样式和版本信息。

但当前默认详情页 `AppDetailView.vue` 并没有直接消费这个动态组件 API，而是维护了一个硬编码的 `AppComponentMap`。这意味着：

- 新 app 若想挂载专用前端，通常仍要修改主前端工程并发布。
- 后端提供的“动态组件接口”还没有真正成为默认装配通路。

### 这意味着什么

从第一性原则看，真正的 app 平台应尽量让“新 app 接入”不依赖修改平台主前端代码。当前系统已经有了后端动态组件基础，但前端最后一公里尚未完成。

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
  handlers/
    ...
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
7. `states`
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

### 步骤 4：实现状态推进逻辑

有两种常见组合：

1. `states + handlers`
2. `states + tick`

当前主流实现通常两者一起存在：

- 用 `states` 描述状态图
- 用 tick 驱动后台扫描与推进
- 用 handler 承载状态节点动作

### 步骤 5：决定是否走通用前端

如果只是标准化的记录录入、列表、详情、OCR 查看、对比，优先复用 `GenericMiniApp.vue`。

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
- handler 注册
- `mini_apps` 注册
- `app_state` 注册
- `app_clock_registry` 注册

### 步骤 7：验证 app 是否真正可运行

至少应确认：

1. `GET /api/mini-apps` 能看到该 app
2. `GET /api/mini-apps/:appId` 能拿到完整详情
3. 前端 `/apps/:appId` 能正常打开
4. 如果有 tick，`/api/app-clock/status` 能看到运行状态
5. 创建记录后，状态能够按预期推进

## 六、值得优先优化和重构的方向

### 1. 打通自定义前端动态加载闭环

现状：

- 后端有动态组件 API
- 前端仍靠 `AppComponentMap` 硬编码映射

建议：

- 让 `AppDetailView.vue` 优先根据 `app.component` 调用 `/api/app-market/component/:appId` 获取组件包
- 将当前硬编码映射仅保留为兼容兜底

这是最直接提升“平台化”的一步。

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

### 4. 拆分 `GenericMiniApp.vue`

现状：

- 单文件职责过多

建议：

- 拆成列表容器、表单容器、详情容器、对比容器
- 保持对外 props 不变，先做内部重构

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
- 用 `app_state + handler + tick` 驱动后台工作流
- 用 `GenericMiniApp` 承担通用前端渲染

它已经具备一个小型 app 平台的基础骨架，尤其适合文档处理、异步流水线和结构化数据提取类场景。

当前最大的短板不在于“不能工作”，而在于“平台化闭环还差最后一步”：

- 自定义前端动态装配未闭环
- 部分字段/配置存在历史欠账
- 关键契约仍主要依赖源码阅读而非文档沉淀

因此，本阶段最有价值的工作不是推翻重写，而是继续围绕现有骨架做契约收敛、装配自动化和运维能力增强。
