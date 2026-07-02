# OCR Tool 机制说明

## 1. 文档目的

本文档说明 `ocr-tool` app 在当前 wildcard 架构下的工作机制，包括：

- HTTP 入口如何进入 app
- 任务如何创建与返回 `task_id`
- 后端如何异步处理 OCR 任务
- 前端如何轮询状态并展示结果
- 任务为什么会暂存在内存里
- 当前实现中的已知边界与重构方向

---

## 2. app 定位

`ocr-tool` 是一个典型的“异步任务型 app”。

它的核心功能不是“同步返回 OCR 文本”，而是：

1. 用户提交图片
2. 后端快速创建任务并返回 `task_id`
3. app 后台异步处理 OCR
4. 前端通过 `task_id` 轮询任务状态
5. 任务完成后返回 OCR 结果

当前 manifest 入口见：`apps/ocr-tool/manifest.json`

---

## 3. 当前目录结构

```text
apps/ocr-tool/
├── manifest.json
├── tick/
│   └── index.js
├── server/
│   └── handlers/
│       ├── analyze.js
│       ├── status.js
│       └── presets.js
└── MECHANISM.md
```

相关平台共享模块：

- `lib/ocr-tool-store.js` - 内存任务存储
- `server/middlewares/app-wildcard-router.js` - wildcard 分发入口
- `lib/app-clock.js` - app tick 调度宿主

---

## 4. 总体架构

当前 `ocr-tool` 的主链路可以概括为：

```text
前端提交图片
-> wildcard handler
-> 创建 task_id
-> 立即返回给前端

后台 tick
-> 扫描 pending task
-> 调用平台能力（VLM）
-> 更新任务状态与结果

前端轮询 status
-> 根据 task_id 读取状态
-> 展示结果
```

它本质上是：

- 前端异步交互
- 后端异步执行
- 任务状态桥接前后端

---

## 5. HTTP 入口机制

### 5.1 wildcard 入口

当前新架构下，app 业务 HTTP 入口统一走：

- `/api/apps/:appId/*`

`ocr-tool` 对应的 handler 文件：

- `apps/ocr-tool/server/handlers/analyze.js`
- `apps/ocr-tool/server/handlers/status.js`
- `apps/ocr-tool/server/handlers/presets.js`

wildcard 的作用：

1. 识别 `appId`
2. 检查 `mini_apps` 中 app 是否存在且启用
3. 根据 URL 映射 handler 文件
4. 动态加载 handler 模块
5. 执行对应的 `get/post/put/delete/patch`

### 5.2 当前已确认规则

当前阶段平台约束：

- 所有 app handler 默认必须登录
- 暂不支持匿名 API

因此 `ocr-tool` 的 handler 都运行在“已认证用户”前提下。

---

## 6. 任务生命周期

### 6.1 提交阶段：`analyze`

入口文件：`apps/ocr-tool/server/handlers/analyze.js`

当前只支持普通 OCR 输入：

1. **普通 OCR 模式**
   - 前端直接提交 base64 图片
   - handler 校验图片格式与大小
   - 创建本地任务
   - 立即返回 `task_id`

### 6.2 处理中：`tick`

异步消费入口：`apps/ocr-tool/tick/index.js`

tick 的职责：

1. 清理过期任务
2. 计算当前并发槽位
3. 拉取 pending 任务
4. 标记为 processing
5. 调用 OCR 能力
6. 写回 done / error 状态

### 6.3 查询阶段：`status`

状态查询入口：`apps/ocr-tool/server/handlers/status.js`

它根据 `task_id`：

1. 读取任务
2. 校验当前用户是否拥有该任务
3. 返回任务状态、结果或错误

### 6.4 展示阶段：前端

前端模式应当是：

1. 调用 `analyze`
2. 拿到 `task_id`
3. 轮询 `status`
4. 若状态为 `done`，展示结果
5. 若状态为 `error`，展示错误

因此 `ocr-tool` 不是同步接口，而是标准的异步任务接口。

---

## 7. 任务存储机制

任务存储定义在：`lib/ocr-tool-store.js`

当前实现使用：

- 一个进程内 `Map` 保存任务对象
- 一个队列数组保存待处理 task id

### 7.1 为什么使用内存

原因是实现简单，适合：

- 单机运行
- 中低并发
- 短生命周期任务

### 7.2 这不等于“可靠常驻”

虽然任务在 Node 进程内会暂时驻留，但这只是：

- 当前进程级内存
- 不是平台承诺的持久化状态

意味着：

- 服务重启后任务会丢失
- 多实例之间任务不共享
- 不能把内存当成长期唯一真相

### 7.3 清理机制

当前任务不会在“前端取走结果后立即删除”。

清理方式是：

- `tick` 执行时调用 `pruneTasks()`
- 超过 TTL 的旧任务会被清掉
- 已完成任务会保留一段时间，便于前端轮询和重试

这意味着它是“有过期时间的临时任务缓存”，而不是长期任务中心。

---

## 8. OCR 执行机制

### 8.1 普通 OCR 模式

普通模式由 `tick/index.js` 中的 `processTask()` 处理。

主要流程：

1. 从任务中取出 `image_data_url`
2. 根据 app config 选择模型
3. 若未指定模型，通过 `modelRegistry` 选择默认 multimodal 模型
4. 为了避免 VLM 限制，对图片做压缩
5. 构造多模态消息
6. 调用 `callLLMWithRetry()`
7. 成功后写入 OCR 文本结果
8. 失败后写入错误状态

## 9. 平台能力依赖

`ocr-tool` 自己不直接硬编码所有平台底层能力，而是复用宿主能力。

当前关键依赖包括：

- `modelRegistry` - 选择默认 multimodal 模型
- `callLLMWithRetry()` - 调用多模态模型
- `db` / `deps.services.query()` / `deps.services.getModel()` - 数据访问
- `app-clock` - tick 调度

所以 `ocr-tool` 的正确结构不是“自己维护一整套平台”，而是：

```text
handler -> app业务逻辑 -> 平台能力
```

---

## 10. 当前入口状态

当前 `ocr-tool` 的业务入口已统一为 wildcard：

1. 新入口：wildcard
   - `/api/apps/ocr-tool/*`

旧的 `/api/ocr/*` 平台固定路由与 controller 已移除。

---

## 11. 推荐重构方向

如果要让 `ocr-tool` 在 wildcard 架构下长期稳定运行，建议按以下结构重构：

```text
apps/ocr-tool/server/handlers/
  analyze.js
  status.js
  presets.js

apps/ocr-tool/server/services/
  ocr-task.service.js
```

职责建议：

- `handlers/*`
  - 只负责参数提取、调用 service、返回响应
- `ocr-task.service.js`
  - 负责普通 OCR 任务创建、状态读取
- `tick/index.js`
  - 继续负责异步消费，不应迁回平台 controller

### 11.1 为什么不应继续依赖平台 controller

因为 wildcard 新标准的目标是：

- 路由入口 app 内聚
- 业务逻辑 app 内聚
- 平台只提供宿主能力

`ocr-tool` 当前已不再依赖平台 controller，核心后端逻辑收敛在 app 自身目录中。

---

## 12. 当前已知边界

截至当前分支，`ocr-tool` 机制文档需要结合最新审计结果一起看。

当前已知关注点：

- 任务状态仍以内存为主，不适合作为长期唯一真相

因此当前状态更适合定义为：

- 已进入 wildcard 架构迁移期
- 主机制已成型
- 仍需继续优化任务状态存储

---

## 13. 一句话总结

`ocr-tool` 是一个“前端提交任务、后端异步 OCR、前端轮询状态”的 app。

wildcard 只负责把请求正确分发到 app handler；真正决定 app 是否可靠运行的关键，是：

- 任务是否被正确创建
- tick 是否能异步消费
- 状态是否能被轮询读取
- 重要状态是否只依赖内存

如果这四件事收敛清楚，`ocr-tool` 就能成为 wildcard 架构下的标准异步任务型 app 样板。
