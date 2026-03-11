# 远程 LLM 调用时间线问题

## 问题描述

远程 LLM 调用成功完成后，消息插入的时间戳与专家回复的时间戳完全相同（精确到秒），无法体现出实际的调用耗时。

## 观察到的现象

### 数据库记录

```
id                   | role      | created_at
---------------------+-----------+-------------------------
mmlthgeug593xh2208lw | assistant | 2026-03-11T01:08:54.000Z  ← 远程 LLM 结果
mmlthg4gz5irvccux30k | assistant | 2026-03-11T01:08:54.000Z  ← 专家回复
mmlth2xmi3qjhecfl73e | user      | 2026-03-11T01:08:37.000Z  ← 用户消息
```

### 内容预览

- `mmlthg4gz5irvccux30k` = "抱歉，让我实际调用一次..." ← **专家回复**（先插入）
- `mmlthgeug593xh2208lw` = "【远程 LLM 调用完成】..." ← **远程 LLM 结果**（后插入）

### 日志显示

```
[remote-llm-executor] LLM call completed, latency: 10301ms
```

远程 LLM 实际耗时 10.3 秒，但两条消息的 `created_at` 完全相同。

## 根本原因

**MySQL `DATETIME` 字段默认精度是秒级，不存储毫秒！**

查看 `models/message.js:86-90`：

```javascript
created_at: {
  type: DataTypes.DATE,  // ← 默认秒级精度
  allowNull: true,
  defaultValue: Sequelize.Sequelize.fn('current_timestamp')
}
```

即使两条消息在不同毫秒插入，数据库也只存储秒级时间戳，导致同一秒内的插入显示相同时间。

## 解决方案

### 方案 1：修改数据库字段精度（推荐）

将 `created_at` 改为 `DATETIME(3)`，支持毫秒精度：

```javascript
created_at: {
  type: DataTypes.DATE(3),  // ← 3位小数 = 毫秒精度
  allowNull: true,
  defaultValue: Sequelize.Sequelize.fn('current_timestamp(3)')
}
```

需要迁移脚本：
```sql
ALTER TABLE messages MODIFY COLUMN created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3);
```

### 方案 2：使用消息内容记录时间（当前实现）

已在消息内容中包含耗时信息：
```
【远程 LLM 调用完成】
耗时: 10301ms
```

这是最简单的方式，但需要解析内容才能获取时间信息。

### 方案 3：添加 metadata 字段

在 `messages` 表添加 `metadata` JSON 字段，存储详细信息：

```json
{
  "remote_llm": {
    "started_at": "2026-03-11T01:08:37.000Z",
    "completed_at": "2026-03-11T01:08:47.301Z",
    "latency_ms": 10301
  }
}
```

## 调用链分析

### 驻留进程的响应机制

查看 `data/skills/remote-llm/index.js` 的 `handleInvoke` 函数：

```javascript
async function handleInvoke(taskId, params) {
  // 立即返回确认
  sendResponse({
    task_id: taskId,
    result: {
      status: 'queued',
      message: '已放入队列，待执行完成后会通知您',
    },
  });
  
  // 添加到队列，后台异步执行
  taskQueue.push({ task_id: taskId, params });
  processQueue().catch(...);  // 不等待完成
}
```

驻留进程**立即返回** `queued` 响应，不等待远程 LLM 调用完成！

### 专家调用流程

查看 `lib/chat-service.js:319`：

```javascript
const toolResults = await expertService.handleToolCalls(collectedToolCalls, ...);
```

专家**等待**工具返回，但工具返回的是 `queued` 状态，不是远程 LLM 结果。

### 实际时间线

```
01:08:37  用户发送消息
01:08:37  专家开始处理
01:08:37  专家调用 remote-llm-submit 工具
01:08:37  工具调用驻留进程
01:08:37  驻留进程立即返回 { status: 'queued' }  ← 专家拿到结果
01:08:37  专家继续生成回复（LLM 流式生成）
          
          （并行）驻留进程后台执行远程 LLM 调用
          └── 需要 10.3 秒

01:08:47  远程 LLM 调用完成，驻留进程调用 /internal/messages/insert 插入结果
          └── 但数据库时间精度是秒，记录为 01:08:54？

01:08:54  专家回复生成完成，插入数据库

问题：为什么远程 LLM 结果（01:08:47 完成）记录为 01:08:54？
```

### 问题根源

**远程 LLM 调用结果的消息时间戳是插入时的时间，而不是调用完成时间！**

检查 `/internal/messages/insert` 的实现（`server/controllers/internal.controller.js:69`）：

```javascript
const message = await this.Message.create({
  id: messageId,
  topic_id: finalTopicId,
  user_id,
  expert_id,
  role,
  content,
  // created_at 使用数据库默认值 current_timestamp
});
```

`created_at` 使用数据库的 `current_timestamp`，即插入时的时间。

但如果远程 LLM 在 01:08:47 完成，为什么插入时间会是 01:08:54？

**可能的原因**：

1. 驻留进程的 `processQueue` 是同步执行的，会等待前一个任务完成
2. 远程 LLM 调用完成后，`notifyExpert` 调用 `/internal/messages/insert` 可能需要时间
3. 或者，远程 LLM 调用的耗时不是 10 秒，而是接近 17 秒

需要进一步检查日志确认实际调用时长。

## 可能的改进方向

### 方案 1：记录完成时间到 metadata

在消息的 `metadata` 字段中记录实际完成时间：

```json
{
  "task_id": "xxx",
  "started_at": "2026-03-11T01:08:37.000Z",
  "completed_at": "2026-03-11T01:08:47.301Z",
  "latency_ms": 10301
}
```

### 方案 2：延迟专家回复

让专家等待远程 LLM 结果返回后再生成回复，但这会增加用户等待时间。

### 方案 3：在消息内容中体现时间

当前实现已在消息内容中包含耗时信息：

```
【远程 LLM 调用完成】

模型: kimi-k2.5
耗时: 10301ms
Token: xxx
```

这是最简单的方式，用户可以看到实际耗时。

## 当前状态

**功能正常**：远程 LLM 调用和消息插入都工作正常。

**改进建议**：如果需要精确的时间跟踪，可以在 `messages` 表添加 `metadata` 字段来存储详细信息。

---

*Created: 2026-03-11*
*Issue: #80 相关*