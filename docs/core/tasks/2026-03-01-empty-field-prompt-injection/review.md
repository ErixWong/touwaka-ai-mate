# Code Review: 空字段提示注入修复

> 提交: 未提交 (工作区变更)
> 审查日期: 2026-03-01
> 分支: fix/empty-field-prompt-injection

## 📋 变更概览

| 文件 | 变更 |
|------|------|
| `lib/context-manager.js` | enhanceWithSoul 方法重构 |
| `lib/reflective-mind.js` | buildReflectionSystemPrompt 方法重构 + 新增 formatListField |

## ✅ 优点

1. **安全性提升**: 空字段不再输出"未定义"或空字符串，避免了潜在的提示注入风险

2. **代码可读性**: 使用数组动态构建 sections，逻辑更清晰，易于维护

3. **一致的格式化逻辑**: 新增的 `formatListField()` 方法统一处理数组和字符串两种格式

4. **边界处理完善**: 对空数组 `[]` 的情况也做了正确处理，返回 null

## ❌ 问题

### 🟡 建议改进

#### 1. 代码重复 - DRY 原则违反

**位置**: 
- [`lib/context-manager.js:355-364`](../../../lib/context-manager.js:355)
- [`lib/reflective-mind.js:214-223`](../../../lib/reflective-mind.js:214)

**问题**: `formatListField()` 方法在两个文件中完全相同

**建议**: 提取到共享模块

```javascript
// lib/utils/prompt-utils.js
/**
 * 格式化列表字段
 * @param {Array|string} field - 列表字段
 * @returns {string|null} 格式化后的字符串
 */
export function formatListField(field) {
  if (!field) return null;
  if (Array.isArray(field)) {
    if (field.length === 0) return null;
    return field.map((v, i) => `${i + 1}. ${v}`).join('\n');
  }
  return field || null;
}
```

#### 2. reflective-mind.js 的格式问题

**位置**: [`lib/reflective-mind.js:155-160`](../../../lib/reflective-mind.js:155)

**问题**: 模板字符串中 `## 评分维度与权重` 出现了两次（一次在 soulSections 后，一次固定在模板中）

```javascript
return `你是角色的"反思心智"，负责根据角色的 Soul 进行自我反思和评价。

${soulSections}## 评分维度与权重

## 评分维度与权重
```

**建议**: 删除模板中固定的 `## 评分维度与权重` 行，只保留 `${soulSections}` 后的那一个

#### 3. 缺少 JSDoc 更新

**位置**: [`lib/context-manager.js:309`](../../../lib/context-manager.js:309)

**建议**: 补充 `enhanceWithSoul()` 方法的空字段处理逻辑说明

## 📊 总结

| 类别 | 数量 |
|------|------|
| 🔴 严重问题 | 0 |
| 🟡 建议改进 | 3 |

## 🔧 修复清单

- [ ] 提取 `formatListField` 到共享模块 `lib/utils/prompt-utils.js`
- [ ] 修复 `reflective-mind.js` 中重复的 `## 评分维度与权重`
- [ ] 更新 `enhanceWithSoul()` 的 JSDoc

---

*审查人: Maria 🌸*