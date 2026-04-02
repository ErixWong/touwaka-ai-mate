# Task: 重构 recall 工具

## 目标
重构 recall 内置工具，采用 `mode` + `action` 双参数结构，清晰区分 Topic 和 Messages 两种查询维度。

## 需求

### 5 种使用场景
1. `mode=topic, action=list` - 列出最近话题
2. `mode=topic, action=search` - 搜索话题
3. `mode=topic, action=messages` - 获取某话题的消息清单
4. `mode=messages, action=list` - 列出最近消息（跨话题）
5. `mode=messages, action=detail` - 获取某条消息明细

### 统一分页
- `start`: 起始位置（从0开始）
- `count`: 数量（默认10）

## 变更范围
- `lib/tool-manager.js` - BUILTIN_TOOLS 定义 + executeRecall 实现

## 实现方案
```javascript
recall({ mode: 'topic', action: 'list', start: 0, count: 10 })
recall({ mode: 'topic', action: 'search', keyword: 'React性能', start: 0, count: 10 })
recall({ mode: 'topic', action: 'messages', topic_id: 'xxx', start: 0, count: 20 })
recall({ mode: 'messages', action: 'list', start: 0, count: 10 })
recall({ mode: 'messages', action: 'detail', message_id: 'xxx' })
```

## 新增方法
- `executeRecall()` - 主入口，参数校验 + 模式分发
- `recallTopicList()` - mode=topic, action=list
- `recallTopicSearch()` - mode=topic, action=search
- `recallTopicMessages()` - mode=topic, action=messages
- `recallMessagesList()` - mode=messages, action=list
- `recallMessageDetail()` - mode=messages, action=detail

## 删除方法
- `getMessageContent()` - 旧版
- `getTopicMessagesResult()` - 旧版
- `listTopics()` - 旧版
- `searchTopics()` - 旧版（功能已移植到 recallTopicSearch）
- `getTopicMessages()` - 旧版

## 状态
- [x] 设计评审
- [x] 代码实现
- [x] 测试验证（语法检查通过）
- [x] 代码审计
- [x] 修复问题
  - [x] 分页逻辑优化（使用固定大数量查询+内存分页）
  - [x] N+1 查询修复（并行查询总数）
  - [x] 字符串拼接隐患修复（处理 undefined 情况）
  - [x] 日志敏感信息修复（keyword 截断显示）
