# Task-94: 优化工具名称 - 缩短 skill_id 前缀 + 移除 _meta 节省 token

## 目标

优化 OpenAI 函数调用中的工具名称，减少发送给 LLM 的 token 数量。

## 问题描述

1. **工具名过长**: 使用完整的 skill_id（20字符）作为前缀，如 `lz1a2b3c4d5e6f7g8h9i0_zip`
2. **_meta 占用 token**: `_meta` 字段被发送给 LLM，浪费上下文

## 解决方案

### 1. 缩短 skill_id 前缀（取后6位）

- 工具名格式: `7g8h9i_zip`（从 30+ 字符缩短到 10+ 字符）
- 唯一性保证: 36^6 ≈ 21.7亿种可能，碰撞概率极低

### 2. 移除发送给 LLM 的 _meta 字段

- `_meta` 仅用于内部执行路由，不应发送给 LLM
- 每个工具节省约 200-300 字符

## 修改文件

| 文件 | 修改内容 |
|------|---------|
| `lib/skill-loader.js` | 工具名使用 `skill.id.slice(-6)` |
| `lib/context-manager.js` | System Prompt 显示缩短后的工具名 |
| `lib/tool-manager.js` | `getToolDefinitions()` 移除 `_meta` 字段 |

## 状态

- [x] 代码修改完成
- [ ] 测试验证
- [ ] 代码审查
- [ ] 合并归档

## 相关链接

- GitHub Issue: https://github.com/ErixWong/touwaka-ai-mate/issues/94

✌Bazinga！