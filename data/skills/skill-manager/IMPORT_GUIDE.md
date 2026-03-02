# 技能导入指南

## 概述

本文档描述如何将`data/skills/`目录下的技能注册到系统数据库。

## 导入流程

```
读取SKILL.md → 分析scripts目录 → 构建工具定义 → 调用register_skill → 验证结果
```

## 步骤详解

### 1. 定位技能目录

```bash
data/skills/{skill_name}/
├── SKILL.md          # 技能说明（必需）
├── scripts/          # 脚本目录
│   ├── tool1.py
│   └── tool2.js
└── ...
```

### 2. 读取SKILL.md

提取以下信息：
- 技能名称
- 技能描述
- 工具清单（名称、功能、参数）

### 3. 确认脚本路径

脚本路径**相对于技能目录**：
```
正确：scripts/extract_text.py
错误：data/skills/pdf/scripts/extract_text.py
```

### 4. 构建工具定义

每个工具需要：
```json
{
  "name": "tool_name",
  "description": "工��功能描述",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {"type": "string", "description": "参数说明"}
    },
    "required": ["param1"]
  }
}
```

### 5. 调用注册API

```
skill-manager_register_skill(
  source_path: "pdf",        // 技能目录名（相对路径）
  name: "PDF",               // 技能名称
  description: "PDF操作",     // 技能描述
  tools: [...]               // 工具定义数组
)
```

### 6. 验证注册结果

确认返回的`skill_id`不为空，工具数量匹配。

## 路径拼接逻辑

执行器查找脚本的方式：
```
base_dir + "/skills/" + source_path + "/" + script_path
```

示例：
```
data/skills/pdf/scripts/extract_text.py
└─────┬────┘└┬┘└────────┬────────┘
  base    源路径   脚本路径
```

## 常见错误

| 错误现象 | 原因 | 解决方案 |
|----------|------|----------|
| 找不到脚本 | source_path使用了绝对路径 | 使用相对路径：`pdf`而非`/data/skills/pdf` |
| register返回空 | 数据库写入失败 | 检查字段完整性 |
| 工具未注册 | tools数组为空 | 确认SKILL.md包含工具定义 |

## 实际案例

### PPTX技能注册

```
source_path: pptx
tools:
  - pptx_create → scripts/create.js
  - pptx_extract → scripts/extract.js
  - pptx_modify → scripts/modify.js
```

### PDF技能注册

```
source_path: pdf
tools:
  - pdf_extract_text → scripts/extract_text.py
  - pdf_split → scripts/split.py
  - pdf_merge → scripts/merge.py
  - pdf_images → scripts/extract_images.py
  - pdf_to_images → scripts/to_images.py
  - pdf_to_docx → scripts/to_docx.py
  - pdf_watermark → scripts/watermark.py
```

## 注意事项

1. 删除旧技能需调用`delete_skill`，技能名和ID均可作为参数
2. 重新注册前必须先删除旧记录
3. 参数定义使用JSON Schema格式
4. 描述字段用于LLM判断何时调用该工具

---

创建时间：2025-01-16
