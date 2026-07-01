# App 模块文档

本目录是 App 模块的统一文档入口。

当前规则：

1. 平台负责 tick 调度、路由挂载、附件/数据库/LLM/MCP 等宿主能力。
2. app 自己负责业务语义与状态机。
3. `states.js` 是推荐实现，但不是对所有 app 一刀切的统一强制标准；部分严格状态 app 当前仍把它作为必需依赖。
4. `app_state` / `app_row_handlers` 属于历史机制，已退出新标准主路径，但兼容代码和部分治理入口仍存在。

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
   - app 详情装配与当前前端接入方式

3. [wildcard-handler-spec.md](./wildcard-handler-spec.md) ⚡ **新版**
   - App 后端 Handler 编写规范（Wildcard 模式）
   - 约定大于配置：直接映射 handler 文件
   - ctx/deps 上下文说明
   - 平台服务复用（LLM、Attachment、OCR 等）
   - 权限校验方式

4. [historical/README.md](./historical/README.md)
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
