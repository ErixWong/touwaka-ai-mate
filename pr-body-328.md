## 变更说明

将 `recall_topic` 内置工具与 `message-reader` 技能合并为统一的 `recall` 内置工具。

### 主要变更

1. **工具重命名与合并**
   - `recall_topic` → `recall`
   - 合并 `message-reader` 的 `get_message_content` 功能
   - 删除 `data/skills/message-reader/` 目录

2. **新增 `message_id` 参数**
   - `recall` 工具现在支持三种调用方式：
     - `recall()` - 列出最近话题
     - `recall({ topic_id: "xxx" })` - 获取指定话题的消息
     - `recall({ message_id: "xxx" })` - 获取单条消息的完整内容

3. **更新摘要提示**
   - 工具结果摘要中的提示从 `get_message_content("xxx")` 改为 `recall({ message_id: "xxx" })`

4. **更新相关注释**
   - `full-organizer.js`
   - `simple-organizer.js`
   - `reflective-mind.js`

### 技术细节

- `executeRecall()` 方法处理三种场景
- `getMessageContent()` 从数据库获取单条消息
- `getTopicMessagesResult()` 获取话题消息列表
- `listTopics()` 列出最近话题

Closes #328