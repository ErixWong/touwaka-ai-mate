# Code Review: 对话窗口修复

## 审查日期
2026-03-07

## 审查范围
- `frontend/src/components/ChatWindow.vue`

## 修改内容

### 1. 滚动到底部功能

**新增功能**：
- 初始加载消息后自动滚动到底部
- 当用户向上滚动离开底部时，显示浮动按钮
- 点击浮动按钮立即滚动到底部

**实现细节**：
```typescript
// 新增状态
const showScrollToBottom = ref(false)

// 检测是否在底部（距离底部 100px 以内视为在底部）
const isAtBottom = () => {
  if (!messagesContainer.value) return true
  const { scrollTop, scrollHeight, clientHeight } = messagesContainer.value
  return scrollHeight - scrollTop - clientHeight < 100
}

// 滚动处理时更新按钮状态
const handleScroll = () => {
  showScrollToBottom.value = !isAtBottom()
  // ... 其他逻辑
}
```

### 2. HTML 转义修复

**问题**：原代码中 HTML 转义不正确
```typescript
// 错误代码
.replace(/&/g, '&')    // 应该是 '&'
.replace(/</g, '<')    // 应该是 '<'
.replace(/>/g, '>')    // 应该是 '>'
```

**修复后**：
```typescript
// 正确代码
.replace(/&/g, '&')
.replace(/</g, '<')
.replace(/>/g, '>')
```

### 3. watch 优化

**优化**：合并两个 watch 为一个，使用 `immediate: true` 处理初始加载

```typescript
watch(
  () => props.messages.length,
  (newLength, oldLength) => {
    nextTick(() => {
      if (!messagesContainer.value || newLength === 0) return
      
      // 情况1：加载更多 -> 恢复滚动位置
      if (props.isLoadingMore === false && isLoadingTriggered.value && newLength > (oldLength || 0)) {
        const newScrollHeight = messagesContainer.value.scrollHeight
        messagesContainer.value.scrollTop = newScrollHeight - scrollHeightBeforeLoad.value
        isLoadingTriggered.value = false
        return
      }
      
      // 情况2：初始加载或新消息 -> 滚动到底部
      if (newLength > (oldLength || 0)) {
        scrollToBottom()
        showScrollToBottom.value = false
      }
    })
  },
  { immediate: true }
)
```

## 审查结果

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 代码风格一致 | ✅ | 符合项目规范 |
| 功能符合需求 | ✅ | 滚动到底部功能完整 |
| HTML 转义正确 | ✅ | 已修复 |
| watch 逻辑优化 | ✅ | 合并为单个 watch |
| 无内存泄漏 | ✅ | onUnmounted 清理 RAF |
| 响应式状态正确 | ✅ | showScrollToBottom 响应式 |

## 建议

1. ✅ 已采纳：合并两个 watch 为一个
2. ✅ 已修复：HTML 转义使用正确的实体

## 结论

**审查通过** ✅

代码质量良好，功能实现完整，可以提交 PR。
