---
name: kb-editor
description: "知识库编辑技能。用于创建和管理知识库、文章、节、段落、标签。当知识专家需要整理知识、导入文档、构建知识结构时触发。"
argument-hint: "[create_kb|create_article|create_section|create_paragraph] --kb_id=xxx"
user-invocable: false
allowed-tools: []
---

# KB Editor - 知识库编辑技能

知识库管理技能，用于创建和管理知识库、文章、节、段落、标签。

## 知识库结构

```
knowledge_bases (知识库)
├── kb_tags (标签)
│   └── kb_article_tags (文章-标签关联)
└── kb_articles (文章)
    └── kb_sections (节，自指向无限层级)
        ├── kb_sections (子节...)
        └── kb_paragraphs (段，可标记为知识点)
```

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `list_my_kbs` | 列出我的知识库 | `page`, `pageSize` |
| `list_embedding_models` | 获取嵌入模型列表 | - |
| `get_kb` | 获取知识库详情 | `id` |
| `create_kb` | 创建知识库 | `name`, `description`, `embedding_model_id` |
| `update_kb` | 更新知识库 | `id`, `name`, `description` |
| `delete_kb` | 删除知识库 | `id` |
| `list_articles` | 列出文章 | `kb_id`, `page`, `status`, `search` |
| `get_article` | 获取文章详情 | `kb_id`, `id` |
| `get_article_tree` | 获取文章完整结构 | `kb_id`, `article_id` |
| `create_article` | 创建文章 | `kb_id`, `title`, `tags[]` |
| `update_article` | 更新文章 | `kb_id`, `id`, `title`, `tags[]` |
| `delete_article` | 删除文章 | `kb_id`, `id` |
| `list_sections` | 列出节 | `kb_id`, `article_id` |
| `create_section` | 创建节 | `kb_id`, `article_id`, `parent_id`, `title` |
| `update_section` | 更新节 | `kb_id`, `id`, `title` |
| `move_section` | 移动节 | `kb_id`, `id`, `direction` |
| `delete_section` | 删除节 | `kb_id`, `id` |
| `list_paragraphs` | 列出段落 | `kb_id`, `section_id` |
| `create_paragraph` | 创建段落 | `kb_id`, `section_id`, `content`, `is_knowledge_point` |
| `update_paragraph` | 更新段落 | `kb_id`, `id`, `content` |
| `move_paragraph` | 移动段落 | `kb_id`, `id`, `direction` |
| `delete_paragraph` | 删除段落 | `kb_id`, `id` |
| `list_tags` | 列出标签 | `kb_id` |
| `create_tag` | 创建标签 | `kb_id`, `name` |
| `update_tag` | 更新标签 | `kb_id`, `id`, `name` |
| `delete_tag` | 删除标签 | `kb_id`, `id` |

## 知识库操作

### list_my_kbs

列出当前用户拥有的知识库。

**参数：**
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20

### create_kb

创建知识库。

**参数：**
- `name` (string, required): 知识库名称
- `description` (string, optional): 知识库描述
- `embedding_model_id` (string, optional): 嵌入模型 ID，默认 bge-m3
- `embedding_dim` (integer, optional): 向量维度，默认 1024

## 文章操作

### create_article

创建文章。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `title` (string, required): 文章标题
- `summary` (string, optional): 文章摘要
- `tags` (string[], optional): 标签名数组，如 `['Python', '编程']`

### get_article_tree

获取文章的完整树状结构（包含所有节和段落）。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, required): 文章 ID

## 节操作

### create_section

创建节。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, required): 所属文章 ID
- `parent_id` (string, optional): 父节 ID（用于创建子节）
- `title` (string, required): 节标题

**说明：**
- 不传 `parent_id` 创建顶级节（章）
- 传 `parent_id` 创建子节
- 系统自动计算 `level` 和 `position`
- 最大层级深度为 10 层

## 段落操作

### create_paragraph

创建段落。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `section_id` (string, required): 所属节 ID
- `title` (string, optional): 段落标题
- `content` (string, required): 段落内容
- `context` (string, optional): 知识点上下文（用于语义检索）
- `is_knowledge_point` (boolean, optional): 是否为知识点，默认 false

⚠️ **核心原则：严格保留原文**
- `content` 必须是**原文完整复制**，禁止提炼、总结、改写或省略
- 即使原文很长，也要完整录入，不能截断
- 如果原文有多个段落，每个段落应单独创建一条记录

**知识点段落：**
- 设置 `is_knowledge_point: true` 的段落会被向量化，可用于语义搜索
- 普通段落不会被向量化，只作为上下文展示

**Context 字段说明：**
- 用途：用于语义检索时提供上下文信息
- 生成原则：用一两句话总结该知识点和知识点所处的文章（中文）
- 示例：如果知识点是"Python 是一种解释型语言"，Context 可以是"Python 编程语言简介 - 介绍 Python 的基本特性和应用场景"

## 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |
| `USER_ID` | 用户 ID（调试用） | 可选 |

## 典型工作流程

### 导入新文档

1. `create_article` - 创建文章，设置标题和标签
2. `create_section` - 根据文档结构创建节（章→节→小节）
3. `create_paragraph` - 创建段落，标记知识点（`is_knowledge_point: true`）
4. `get_article_tree` - 验证结构完整性

### 调整内容结构

1. `get_article_tree` - 查看当前结构
2. `move_section` / `move_paragraph` - 调整顺序
3. `update_section` / `update_paragraph` - 修改内容

## 权限说明

只能操作 `owner_id === userId` 的知识库（由 API 层验证）。
