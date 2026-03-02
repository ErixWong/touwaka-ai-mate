# 技能路径逻辑修复

## 问题描述

技能路径拼接逻辑不一致，导致 `skill-manager` 无法正确执行删除操作。

### 根本原因

1. `lib/skill-loader.js` 中路径拼接逻辑过于复杂，有多种条件分支
2. `skill-manager/index.js` 的 `validateSkillPath` 函数硬编码了 `'skills'` 子目录
3. 路径重复拼接：`data/skills/skills/file-operations`

## 解决方案

统一路径规则：**技能目录 = dataBasePath + source_path**

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `lib/skill-loader.js` | 简化路径拼接，移除硬编码的 `'skills/'` 前缀处理 |
| `data/skills/skill-manager/index.js` | 修复 `validateSkillPath`，source_path 直接相对于 dataBasePath |
| `data/skills/skill-manager/SKILL.md` | 更新参数说明，明确 source_path 必须包含 `skills/` 前缀 |

### 路径示例

| source_path | dataBasePath | 最终路径 |
|-------------|--------------|----------|
| `skills/file-operations` | `data` | `data/skills/file-operations` |
| `skills/searxng` | `/shared` | `/shared/skills/searxng` |

## 提交记录

- Branch: `fix/skill-manager-syntax`
- Commit: `0653fd7`
- Merged to: `master`
