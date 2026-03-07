# Pull Request: 修复 ChatWindow HTML 转义问题

## 问题描述

ChatWindow.vue 中的 `formatMessage` 函数存在 HTML 转义问题，可能导致 XSS 安全漏洞。

### 原始代码（有问题）
```javascript
// 转义 HTML
let formatted = content
  .replace(/&/g, '&')
  .replace(/</g, '<')
  .replace(/>/g, '>')
```

这段代码实际上没有进行任何转义，只是将字符替换为自身。

### 修复后代码
```javascript
// 转义 HTML（防止 XSS 攻击）
let formatted = content
  .replace(/&/g, '&')
  .replace(/</g, '<')
  .replace(/>/g, '>')
```

## 修复内容

| 字符 | 修复前 | 修复后 | 说明 |
|------|--------|--------|------|
| `&` | `&` | `&` | 正确的 HTML 实体 |
| `<` | `<` | `<` | 防止 HTML 标签注入 |
| `>` | `>` | `>` | 防止 HTML 标签注入 |

## 影响范围

- 文件：`frontend/src/components/ChatWindow.vue`
- 行号：297-300

## 安全影响

此修复防止了潜在的 XSS（跨站脚本）攻击。如果用户发送包含 HTML 或 JavaScript 代码的消息，修复后会正确显示为文本，而不是被浏览器执行。

## 测试建议

1. **HTML 标签测试**：发送 `<b>bold</b>`，应显示为纯文本而非粗体
2. **XSS 测试**：发送 `<script>alert('xss')</script>`，应显示为纯文本而非弹出警告框
3. **特殊字符测试**：发送 `a & b < c > d`，应正确显示所有字符

## 相关链接

- 创建 PR：https://github.com/ErixWong/touwaka-ai-mate/pull/new/fix/chat-window-html-escape
- 任务文档：docs/core/tasks/2026-03-07-chat-window-fix/README.md

## Checklist

- [x] 代码已提交
- [x] 分支已推送到远程
- [ ] PR 已创建（通过 GitHub 网页界面）
- [ ] 代码审查通过
- [ ] 测试通过
