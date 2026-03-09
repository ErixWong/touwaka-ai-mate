# Prompt Editor

## 概述

Alice 的自我编辑技能。用于读取、备份、修改系统提示词。

## 功能

- **read_prompt**: 读取系统提示词文件
- **backup_prompt**: 创建备份（带时间戳）
- **update_prompt**: 更新提示词内容
- **restore_prompt**: 从备份恢复
- **list_backups**: 列出所有备份

## 工具定义

### read_prompt

读取系统提示词文件内容。

```json
{
  "name": "read_prompt",
  "description": "读取系统提示词文件",
  "script_path": "scripts/read_prompt.py",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt_path": {
        "type": "string",
        "description": "提示词文件路径"
      }
    },
    "required": ["prompt_path"]
  }
}
```

### backup_prompt

创建提示词备份。

```json
{
  "name": "backup_prompt",
  "description": "创建提示词备份（带时间戳）",
  "script_path": "scripts/backup_prompt.py",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt_path": {
        "type": "string",
        "description": "提示词文件路径"
      }
    },
    "required": ["prompt_path"]
  }
}
```

### update_prompt

更新提示词内容。

```json
{
  "name": "update_prompt",
  "description": "更新提示词内容",
  "script_path": "scripts/update_prompt.py",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt_path": {
        "type": "string",
        "description": "提示词文件路径"
      },
      "content": {
        "type": "string",
        "description": "新的提示词内容"
      }
    },
    "required": ["prompt_path", "content"]
  }
}
```

### restore_prompt

从备份恢复提示词。

```json
{
  "name": "restore_prompt",
  "description": "从备份恢复提示词",
  "script_path": "scripts/restore_prompt.py",
  "parameters": {
    "type": "object",
    "properties": {
      "backup_path": {
        "type": "string",
        "description": "备份文件路径"
      },
      "prompt_path": {
        "type": "string",
        "description": "目标提示词文件路径"
      }
    },
    "required": ["backup_path", "prompt_path"]
  }
}
```

### list_backups

列出所有备份文件。

```json
{
  "name": "list_backups",
  "description": "列出所有提示词备份",
  "script_path": "scripts/list_backups.py",
  "parameters": {
    "type": "object",
    "properties": {
      "backup_dir": {
        "type": "string",
        "description": "备份目录路径"
      }
    },
    "required": ["backup_dir"]
  }
}
```

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
```
