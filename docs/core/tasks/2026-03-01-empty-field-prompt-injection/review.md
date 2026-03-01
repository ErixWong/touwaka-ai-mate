# Code Review: 空字段提示注入修复

> 提交: a0a2148 (refactor: 移除专家字段的 JSON 解析逻辑)
> 审查日期: 2026-03-01
> 分支: fix/empty-field-prompt-injection

## 📋 变更概览

### 提交 1: 33b404b - fix: 专家系统提示词空字段处理优化

| 文件 | 变更 |
|------|------|
| `lib/utils/prompt-utils.js` | 新增 `formatListField()` 工具函数 |
| `lib/context-manager.js` | 重构 `enhanceWithSoul()` 方法 |
| `lib/reflective-mind.js` | 重构 `buildReflectionSystemPrompt()` 方法 |

### 提交 2: a0a2148 - refactor: 移除专家字段的 JSON 解析逻辑

| 文件 | 变更 |
|------|------|
| `lib/utils/prompt-utils.js` | 删除（不再需要） |
| `lib/context-manager.js` | 移除 `parseJsonField()`，简化 `extractSoul()` 和 `enhanceWithSoul()` |
| `lib/reflective-mind.js` | 简化 `buildReflectionSystemPrompt()`，移除数组处理 |
| `lib/chat-service.js` | 移除 `parseJson()` 方法，简化 `extractSoul()` |
| `lib/config-loader.js` | 移除 `parseJsonField()` 方法，简化 `parseSoulConfig()` |

## ✅ 优点

### 架构改进

1. **数据模型简化**: 字段从 JSON 数组改为纯字符串存储，消除了序列化/反序列化开销

2. **代码精简**: 移除了 4 个 `parseJson` 相关方法，减少了约 60 行代码

3. **职责清晰**: 格式化逻辑从代码层移至数据层，由用户/管理员在录入时决定格式

### 代码质量

4. **空值处理统一**: 所有字段使用 `?.trim()` 模式，简洁且一致

   ```javascript
   if (soul.coreValues?.trim()) {
     sections.push(`## 你的核心价值观\n${soul.coreValues.trim()}`);
   }
   ```

5. **动态构建 sections**: 使用数组动态构建提示词章节，空字段自动跳过

6. **JSDoc 完善**: 添加了空字段处理逻辑说明

## ❌ 问题

### 🟢 已解决

~~1. 代码重复 - DRY 原则违反~~ → 已通过删除 `formatListField` 解决

~~2. reflective-mind.js 的格式问题~~ → 检查当前代码，无重复的 `## 评分维度与权重`

### 🟡 建议改进

#### 1. 默认值不一致

**位置**: 
- [`lib/chat-service.js:1195`](../../../lib/chat-service.js:1195) - `emotionalTone: expert.emotional_tone || '温和、真诚'`
- [`lib/config-loader.js:132`](../../../lib/config-loader.js:132) - `emotionalTone: expert.emotional_tone || ''`

**问题**: `emotionalTone` 在 `chat-service.js` 中有默认值 `'温和、真诚'`，但在 `config-loader.js` 中默认为空字符串

**建议**: 统一默认值策略，或在数据库层面设置默认值

#### 2. 缺少 trim() 后的空字符串检查说明

**位置**: [`lib/context-manager.js:310`](../../../lib/context-manager.js:310)

**问题**: 代码使用 `soul.coreValues?.trim()` 检查，但如果 `coreValues` 是纯空格字符串，会被 trim 后跳过，这个行为在 JSDoc 中已说明，但建议在 `extractSoul()` 中提前 trim

**建议**: 考虑在 `extractSoul()` 中统一 trim，减少后续重复调用

```javascript
extractSoul(expert) {
  return {
    coreValues: expert.core_values?.trim() || '',
    // ...
  };
}
```

#### 3. 测试覆盖

**建议**: 添加单元测试验证空字段处理逻辑

- 所有字段为空时返回原 systemPrompt
- 部分字段为空时正确省略
- 纯空格字符串被视为空

## 📊 总结

| 类别 | 数量 |
|------|------|
| 🔴 严重问题 | 0 |
| 🟡 建议改进 | 3 |
| 🟢 已解决 | 2 |

## 🔧 修复清单

- [x] ~~提取 `formatListField` 到共享模块~~ → 已删除，不再需要
- [x] ~~修复重复的 `## 评分维度与权重`~~ → 检查通过，无此问题
- [x] ~~更新 `enhanceWithSoul()` 的 JSDoc~~ → 已完成
- [ ] 统一 `emotionalTone` 默认值
- [ ] 考虑在 `extractSoul()` 中统一 trim
- [ ] 添加单元测试

## 🎯 结论

**审查通过** ✅ 

代码质量良好，重构方向正确。建议的改进项为非阻塞项，可在后续迭代中处理。

---

*审查人: Maria 🌸*
