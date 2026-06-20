# App 模块文档

本目录是 App 模块的统一文档入口。

当前规则：

1. 平台负责 tick 调度、路由挂载、附件/数据库/LLM/MCP 等宿主能力。
2. app 自己负责业务语义与状态机。
3. `states.js` 是推荐实现，但不是平台强制标准。
4. `app_state` / `app_row_handlers` 属于历史机制，当前已退役。

## 推荐阅读顺序

1. [current-architecture.md](./current-architecture.md)
   - 当前架构总纲
   - 平台边界
   - app 边界
   - `states.js` 的定位

2. [app-generation-guide.md](./app-generation-guide.md)
   - 当前实现的详细开发手册
   - 安装链路
   - tick 宿主能力
   - GenericMiniApp 与 app 详情装配

3. [historical/README.md](./historical/README.md)
   - 历史设计稿入口
   - 仅作背景参考，不代表当前实现

## 当前规范摘要

### 平台负责什么

1. `mini_apps` 注册与装配
2. `app_clock_registry` 与 tick 调度
3. app routes 挂载
4. 附件、数据库、LLM、MCP 等宿主能力
5. 统一日志、运行上下文、后台治理

### 平台不负责什么

1. 不再维护各个 app 的统一状态机元数据
2. 不再主导 `pending_*` / `confirmed` / `*_failed` 等业务状态名
3. 不再要求 app 必须使用 `app_state` / `app_row_handlers`

### app 自己负责什么

1. 业务表结构与扩展表
2. tick / routes / service 内的业务语义
3. 是否有状态机
4. 状态如何流转
5. 是否用 `states.js` 集中定义状态

---

✌Bazinga！
