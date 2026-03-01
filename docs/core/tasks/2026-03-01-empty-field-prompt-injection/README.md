# 空字段提示注入修复

> 创建日期: 2026-03-01
> 状态: 进行中
> 分支: fix/empty-field-prompt-injection

## 📋 需求概述

### 背景

当 Soul 对象的某些字段（coreValues、behavioralGuidelines、taboos、emotionalTone、speakingStyle）为空时，系统提示词会输出"未定义"或空字符串，可能导致：
1. 提示词冗余，浪费 token
2. 潜在的提示注入风险
3. 模型输出不符合预期

### 目标

- 空字段时省略整个章节，而非输出"未定义"
- 统一格式化逻辑，提取公共方法
- 提高系统提示词质量

## 🎯 验收标准

- [x] 空字段正确省略
- [ ] 代码重复消除（提取共享方法）
- [ ] 功能测试通过
- [ ] Code Review 通过

## 📝 开发笔记

### 变更文件

- `lib/context-manager.js` - enhanceWithSoul 方法重构
- `lib/reflective-mind.js` - buildReflectionSystemPrompt 方法重构

### 核心改动

1. 新增 `formatListField()` 方法统一处理数组/字符串格式
2. 使用数组动态构建 sections，空值时跳过
3. 只在有有效内容时追加到系统提示词

## 🔗 相关链接

- Code Review: [review.md](./review.md)