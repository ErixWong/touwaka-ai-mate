# App 模块当前架构总纲

## 1. 定位

App 模块当前已经从“平台统一状态机”模式，演进为“平台提供宿主能力，app 自己管理业务语义”的模式。

因此，理解当前架构要先记住一句话：

> 平台只负责 tick 和宿主能力，app 自己负责状态机和业务流程。

## 2. 平台边界

平台层当前负责：

1. `mini_apps` 元数据注册
2. `app_clock_registry` 注册与调度
3. `lib/app-clock.js` 提供统一 tick 宿主能力
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
3. tick 逻辑
4. routes / service 业务语义
5. 状态机（如果有）

## 4. 关于状态机

### 4.1 当前原则

1. `app_state` / `app_row_handlers` 属于历史机制，**已退出新标准主路径**，但兼容代码和部分存量治理入口仍存在。
2. 如果 app 有状态机，应由 app 自己代码管理。
3. 平台不再要求状态机必须存到平台公共表。

### 4.2 `states.js` 的地位

`apps/{appId}/states.js` 是推荐实现，适合集中导出：

1. `getInitialState()`
2. `getConfirmedState()`
3. `classifyStatus()`
4. `getStatusSummaryCategories()`

但它不是平台统一强制标准。

需要特别说明：

1. 对多数新 app，`states.js` 仍是推荐而非必选。
2. 但对已经走自治主路径、且服务层显式声明为严格状态 app 的存量 app（如 `invoice-mgr`、`contract-mgr`），当前实现里**已经把 `states.js` 当作必需依赖**。
3. 因此这里的“非强制”应理解为“不是平台对所有 app 一刀切强制”，而不是“所有 app 都可以省略”。

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
    routes.js         # 如果 app 需要自定义 API
  states.js           # 推荐：集中定义状态语义
```

## 6. 当前推荐阅读

1. 先看 [README.md](./README.md)
2. 再看 [app-generation-guide.md](./app-generation-guide.md)
3. 如需理解旧思路，再看 [historical/README.md](./historical/README.md)

---

✌Bazinga！
