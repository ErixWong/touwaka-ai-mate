# App 模块当前架构总纲

## 1. 定位

当前平台正在从“双调度体系”演进到“统一 Clock Core”模式。

因此，理解当前架构要先记住一句话：

> 平台统一负责 Clock Core；任务分为 `internal_job` 与 `app_tick` 两类，业务 app 只是其中一个子集。

## 2. 平台边界

平台层当前负责：

1. `mini_apps` 元数据注册
2. 统一 Clock / Scheduler 调度能力
3. `app_tick` 与 `internal_job` 的运行宿主能力
4. app 自定义 routes 挂载
5. 附件、数据库、LLM、MCP、日志等基础设施能力

平台层当前不应负责：

1. app 的初始状态推导
2. app 的确认态写入
3. app 的 completed / failed / processing 分类
4. app 的状态图统一持久化

## 3. app 边界

app 自己负责：

1. 业务数据结构
2. 扩展表 / 自治表
3. app 级周期任务逻辑（若存在）
4. routes / service 业务语义
5. 状态机（如果有）

需要特别区分：

1. `app_tick` 属于业务 app 子集
2. `internal_job` 属于平台内部任务
3. 平台内部状态机推进，不应再被错误建模成业务 app

## 4. 关于状态机

### 4.1 当前原则

1. `app_state` / `app_row_handlers` 属于历史机制，**已退出新标准主路径**，但兼容代码和部分存量治理入口仍存在。
2. 如果 app 有状态机，应由 app 自己代码管理。
3. 平台不再要求状态机必须存到平台公共表。

补充原则：

4. 平台内部状态机（如文档处理流水线）不属于 app 状态机，不应再以 `mini_apps` 形态存在。

### 4.2 `states.js` 的地位

`apps/{appId}/states.js` 是推荐实现，适合集中导出：

1. `getInitialState()`
2. `getConfirmedState()`
3. `classifyStatus()`
4. `getStatusSummaryCategories()`

但它不是平台统一强制标准。

需要特别说明：

1. 对多数新 app，`states.js` 仍是推荐而非必选。
2. 早期服务层的 `STRICT_STATE_APP_IDS`（曾把 `invoice-mgr`、`contract-mgr` 列为严格状态 app，缺失 `states.js` 即报错）**已移除**，当前不存在“缺失 states.js 即报错”的平台级强制。
3. 当前自治主路径下，app 初始状态取自安装时展开的 `config.step_resources` 首个 key（`MiniAppService.getAppInitialState()`），带 `'pending'` 兜底，不再依赖 `states.js` 导出。
4. 因此这里的“非强制”应理解为“平台不再把任何 app 的状态语义来源当作强制依赖”，状态完全由 app 自己代码负责。

只要状态语义由 app 自己负责，也可以放在：

1. `tick/index.js`
2. `server/routes.js`
3. `service` 模块常量

## 5. 当前推荐目录

```text
apps/{appId}/
  manifest.json
  migrations/
    install.js
    uninstall.js
  tick/
    index.js
  server/
    handlers/         # wildcard handler（约定大于配置，见 wildcard-handler-spec.md）
    services/         # 可选：app 自己的 service 模块
  states.js           # 推荐：集中定义状态语义
```

平台内部任务建议目录：

```text
server/jobs/
  doc-pipeline-job.js
  document-embedding-job.js
```

或：

```text
lib/clock/
lib/doc-pipeline-worker.js
```

## 6. 当前推荐阅读

1. 先看 [README.md](./README.md)
2. 再看 [../design/core/unified-clock-architecture.md](../design/core/unified-clock-architecture.md)
3. 再看 [app-generation-guide.md](./app-generation-guide.md)
4. 如需理解旧思路，再看 [historical/README.md](./historical/README.md)

---

✌Bazinga！
