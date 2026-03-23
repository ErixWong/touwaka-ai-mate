## 背景

在完成 Issue #325（工具调用结果存储优化）的代码审计后，发现以下潜在改进点：

## 改进点

### 1. SUMMARY_THRESHOLD 硬编码

**现状**：
```javascript
// lib/chat-service.js:756
const SUMMARY_THRESHOLD = 500;  // 硬编码
```

**建议**：
将阈值做成可配置项，支持以下方式：
- 专家级配置：`expert.tool_result_threshold`
- 系统级配置：`system_settings` 表

**优先级**：低（当前硬编码已满足需求）

### 2. 摘要文本硬编码中文

**现状**：
```javascript
// lib/chat-service.js:819-823
buildToolResultSummary(messageId, toolName, resultLength, isSuccess) {
  const status = isSuccess ? '成功' : '失败';
  return `工具: ${toolName}
结果: ${resultLength} 字符 | ${status}
→ 调用 get_message_content("${messageId}") 获取完整结果`;
}
```

**建议**：
- 抽取为 i18n 翻译键
- 支持多语言摘要

**优先级**：低（暂不影响功能）

## 关联

- PR #326
- Issue #325