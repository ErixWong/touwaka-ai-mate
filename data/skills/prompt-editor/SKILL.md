---
name: prompt-editor
description: "提示词编辑技能。用于读取、备份、修改、恢复系统提示词。当需要修改专家的系统提示词时触发。"
argument-hint: "[read|backup|update|restore|list_backups] --prompt_path=xxx"
user-invocable: false
allowed-tools: []
---

# Prompt Editor - 提示词编辑技能

用于读取、备份、修改、恢复系统提示词的技能。

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `read_prompt` | 读取提示词 | `prompt_path` |
| `backup_prompt` | 创建备份 | `prompt_path` |
| `update_prompt` | 更新提示词 | `prompt_path`, `content` |
| `restore_prompt` | 恢复备份 | `backup_path`, `prompt_path` |
| `list_backups` | 列出备份 | `backup_dir` |

## read_prompt

读取系统提示词文件内容。

**参数：**
- `prompt_path` (string, required): 提示词文件路径

## backup_prompt

创建提示词备份（带时间戳）。

**参数：**
- `prompt_path` (string, required): 提示词文件路径

## update_prompt

更新提示词内容。

**参数：**
- `prompt_path` (string, required): 提示词文件路径
- `content` (string, required): 新的提示词内容

**说明：** 执行前自动创建备份

## restore_prompt

从备份恢复提示词。

**参数：**
- `backup_path` (string, required): 备份文件路径
- `prompt_path` (string, required): 目标提示词文件路径

## list_backups

列出所有备份文件。

**参数：**
- `backup_dir` (string, required): 备份目录路径

## 安全机制

1. **修改前强制备份** - update_prompt 执行前自动创建备份
2. **备份保留** - 所有备份带时间戳，不自动删除
3. **快速恢复** - restore_prompt 可从任意备份恢复

## 使用示例

```
1. 读取当前提示词
   read_prompt(prompt_path="config/system-prompt.md")

2. 创建备份
   backup_prompt(prompt_path="config/system-prompt.md")

3. 更新提示词
   update_prompt(prompt_path="config/system-prompt.md", content="新内容...")

4. 列出备份
   list_backups(backup_dir="config/backups/")

5. 恢复备份
   restore_prompt(backup_path="config/backups/prompt-2026-03-09.md", prompt_path="config/system-prompt.md")
