# 技能导入指南

## 概述

本文档描述如何将 `data/skills/` 目录下的技能注册到系统数据库。

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
- 工具清单（名称、功能、参数、脚本路径）

### 3. 确认脚本路径

脚本路径**相对于技能目录**：
```
正确：scripts/extract_text.py
错误：data/skills/pdf/scripts/extract_text.py
```

### 4. 构建工具定义

每个工具必须包含 **4个字段**：

```json
{
  "name": "tool_name",
  "description": "工具功能描述",
  "script_path": "scripts/tool.py",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {"type": "string", "description": "参数说明"}
    },
    "required": ["param1"]
  }
}
```

**⚠️ script_path 必须填写**，否则数据库会使用默认值 `index.js`，导致执行失败。

### 5. 调用注册API

```
skill-manager_register_skill(
  source_path: "skills/pdf",   // 推荐格式：skills/{目录名}
  name: "PDF",                 // 技能名称
  description: "PDF操作",      // 技能描述
  tools: [                     // 工具定义数组
    {
      "name": "pdf_extract_text",
      "description": "提取文本",
      "script_path": "scripts/extract_text.py",
      "parameters": {...}
    }
  ]
)
```

**✅ source_path 自动规范化**：
- 系统会自动处理路径格式，以下格式都会被规范化为技能目录名：
  - `data/skills/pdf` → `pdf`（移除 data/skills 前缀）
  - `skills/pdf` → `pdf`（移除 skills 前缀）
  - `pdf` → `pdf`（保持不变）
- 推荐直接使用技能目录名（如 `pdf`）或 `skills/{目录名}` 格式

### 6. 验证注册结果

- 确认返回的 `skill_id` 不为空
- 确认工具数量匹配
- 验证 `script_path` 字段正确存储

## 路径拼接逻辑

执行器查找脚本的方式：
```
base_dir + source_path + "/" + script_path
```

示例（source_path = "skills/pdf"）：
```
data/skills/pdf/scripts/extract_text.py
└─────┬─────┘└──┬──┘└────────┬────────┘
   base   source   script_path
```

## 常见错误

| 错误现象 | 原因 | 解决方案 |
|----------|------|----------|
| 找不到脚本 index.js | tools未包含script_path字段 | 在工具定义中添加script_path |
| Invalid path 错误 | source_path格式错误 | 使用 `skills/pdf` 而非 `pdf` |
| 找不到脚本 | source_path使用了绝对路径 | 使用相对路径 |
| register返回空 | 数据库写入失败 | 检查字段完整性 |
| 工具未注册 | tools数组为空 | 确认SKILL.md包含工具定义 |

## 实际案例

### PPTX技能注册

```
source_path: skills/pptx
tools: [
  {name: "pptx_unpack", script_path: "scripts/unpack.py", ...},
  {name: "pptx_pack", script_path: "scripts/pack.py", ...},
  ...
]
```

### PDF技能注册

```
source_path: skills/pdf
tools: [
  {name: "pdf_extract_text", script_path: "scripts/extract_text.py", ...},
  {name: "pdf_split", script_path: "scripts/split.py", ...},
  ...
]
```

## 检查清单

注册前确认：
- [ ] source_path 以 `skills/` 开头
- [ ] 每个工具包含 4 个必须字段：name, description, script_path, parameters
- [ ] script_path 是相对于技能目录的路径（如 `scripts/tool.py`）
- [ ] 脚本文件实际存在于 `data/skills/{目录}/scripts/` 下

注册后验证：
- [ ] 查询数据库确认 script_path 字段正确
- [ ] 测试执行器能否找到脚本文件
