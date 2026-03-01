# 上下文压缩功能增强

## 概述

本次任务增强了上下文压缩功能，包括：
1. 修复 `/api/topics/compress` 500 错误
2. 添加消息数量阈值触发条件
3. 分离刷新和压缩按钮的 UI
4. 实现反思触发压缩功能

## 修改内容

### 1. 修复 500 错误

**问题**：`topic.controller.js` 使用了不存在的 `expert_user` 模型

**修复**：将 `expert_user` 改为 `user_profile`

```javascript
// 修复前
const expertUser = await req.app.locals.models.expert_user.findOne({

// 修复后  
const userProfile = await req.app.locals.models.user_profile.findOne({
```

### 2. 添加消息数量阈值

**问题**：96 条消息因为 Token 数（16140）未超阈值（89600）而无法压缩

**解决方案**：添加 `maxMessages` 参数（默认 50），当未归档消息数超过此值时强制压缩

**修改文件**：
- `lib/memory-system.js` - `shouldCompressContext()` 和 `compressContext()` 方法
- `lib/chat-service.js` - 压缩检查逻辑

### 3. 分离刷新和压缩按钮

**修改文件**：
- `frontend/src/components/panel/TopicsTab.vue` - 分离按钮
- `frontend/src/i18n/locales/zh-CN.ts` - 添加翻译
- `frontend/src/i18n/locales/en-US.ts` - 添加翻译

### 4. 反思触发压缩

**功能**：当反思检测到话题偏移（`topicSuggestion.shouldCreateNew === true`）时，自动触发压缩

**修改文件**：
- `lib/memory-system.js` - 添加 `force` 参数跳过阈值检查
- `lib/chat-service.js` - 在 `performReflection()` 后调用压缩

### 5. 修复 "topics is not iterable" 错误

**问题**：`identifyTopics()` 返回 `{ topics: [...], userInfo: {...} }` 对象，但代码直接迭代返回值

**修复**：
```javascript
// 修复前
const topics = await this.identifyTopics(unarchivedMessages);
for (const topic of topics) { ... }  // ❌ 迭代对象

// 修复后
const identifyResult = await this.identifyTopics(unarchivedMessages);
const topics = identifyResult.topics || identifyResult;  // 兼容两种格式
for (const topic of topics) { ... }  // ✅ 迭代数组
```

## 压缩触发条件

| 触发方式 | 检查阈值 | 说明 |
|----------|----------|------|
| Token 超限 | ✅ | Token >= 上下文大小的 70% |
| 消息数超限 | ✅ | 未归档消息 >= 50 条 |
| 反思检测到话题偏移 | ❌ | `force=true` 跳过阈值检查 |

## 流程图

```
用户发送消息
    ↓
保存用户消息（topic_id = NULL）
    ↓
检查是否需要压缩（Token/消息数阈值）
    ↓
构建上下文 → 调用 LLM → 保存助手消息
    ↓
异步执行反思
    ↓
提取 inner_voice
累积 keywords
检测话题偏移（topicSuggestion）
    ↓
如果 shouldCreateNew === true
    ↓
调用 compressContext(force=true)
    ↓
LLM 识别话题边界
    ↓
创建 Topic，更新消息的 topic_id
```

## 测试要点

1. **Token 阈值触发**：大量长消息应触发压缩
2. **消息数阈值触发**：超过 50 条消息应触发压缩
3. **反思触发**：话题偏移时应自动压缩
4. **UI 分离**：刷新和压缩按钮功能独立
5. **错误处理**：LLM 返回异常格式时的容错

## 相关文件

- `lib/memory-system.js` - 记忆系统核心
- `lib/chat-service.js` - 聊天服务
- `server/controllers/topic.controller.js` - Topic API
- `frontend/src/components/panel/TopicsTab.vue` - 话题面板
