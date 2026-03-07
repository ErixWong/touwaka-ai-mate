---
name: knowledge-base
description: 知识库管理 - 对知识库、文章和知识点进行增删改查操作，以及语义搜索。用于管理个人知识库内容。
argument-hint: "[operation] [params]"
user-invocable: true
allowed-tools: []
tools:
  - list_knowledge_bases
  - list_embedding_models
  - get_knowledge_base
  - create_knowledge_base
  - update_knowledge_base
  - delete_knowledge_base
  - list_knowledges
  - get_knowledge_tree
  - get_knowledge
  - create_knowledge
  - update_knowledge
  - delete_knowledge
  - list_points
  - get_point
  - create_point
  - update_point
  - delete_point
  - search
  - search_in_knowledge
  - global_search
---

# Knowledge Base - 知识库管理

管理用户的知识库体系，包括知识库（KnowledgeBase）、文章（Knowledge）和知识点（KnowledgePoint）的增删改查，以及语义搜索功能。

## 数据层级

```
知识库 (KnowledgeBase)
└── 文章 (Knowledge)
    └── 知识点 (KnowledgePoint)
```

## 工具

### 知识库操作

#### list_knowledge_bases

获取知识库列表。

**参数:**
- `page` (number, optional): 页码，默认 1
- `pageSize` (number, optional): 每页数量，默认 20

#### list_embedding_models

获取可用的嵌入模型列表。用于查看系统支持的向量嵌入模型。

**参数:** 无

**返回:**
- `id`: 模型 ID
- `name`: 模型显示名称
- `model_name`: 模型实际名称
- `embedding_dim`: 向量维度
- `provider_name`: 提供商名称
- `description`: 模型描述

#### get_knowledge_base

获取知识库详情。

**参数:**
- `id` (string, required): 知识库 ID

#### create_knowledge_base

创建新知识库。

**参数:**
- `name` (string, required): 知识库名称
- `description` (string, optional): 知识库描述
- `embedding_model_id` (string, optional): 向量模型 ID，默认 'bge-m3'
- `embedding_dim` (number, optional): 向量维度，默认 1024

#### update_knowledge_base

更新知识库信息。

**参数:**
- `id` (string, required): 知识库 ID
- `name` (string, optional): 新名称
- `description` (string, optional): 新描述
- `embedding_model_id` (string, optional): 向量模型 ID
- `embedding_dim` (number, optional): 向量维度

#### delete_knowledge_base

删除知识库。

**参数:**
- `id` (string, required): 知识库 ID

---

### 文章操作

#### list_knowledges

获取知识库下的文章列表。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `page` (number, optional): 页码，默认 1
- `pageSize` (number, optional): 每页数量，默认 20

#### get_knowledge_tree

获取知识库下文章的树状结构。

**参数:**
- `kb_id` (string, required): 知识库 ID

#### get_knowledge

获取文章详情。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID

#### create_knowledge

创建新文章。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `title` (string, required): 文章标题
- `parent_id` (string, optional): 父文章 ID（用于创建子文章）
- `summary` (string, optional): 文章摘要
- `source_type` (string, optional): 来源类型，默认 'manual'
- `source_url` (string, optional): 来源 URL

#### update_knowledge

更新文章信息。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID
- `title` (string, optional): 新标题
- `summary` (string, optional): 新摘要
- `status` (string, optional): 状态 (pending/processing/completed/failed)

#### delete_knowledge

删除文章。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID

---

### 知识点操作

#### list_points

获取文章下的知识点列表。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `page` (number, optional): 页码，默认 1
- `pageSize` (number, optional): 每页数量，默认 50

#### get_point

获取知识点详情。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `id` (string, required): 知识点 ID

#### create_point

创建新知识点。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `content` (string, required): 知识点内容（核心字段）
- `title` (string, optional): 知识点标题
- `context` (string, optional): 上下文信息

#### update_point

更新知识点。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `id` (string, required): 知识点 ID
- `title` (string, optional): 新标题
- `content` (string, optional): 新内容
- `context` (string, optional): 新上下文

#### delete_point

删除知识点。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `id` (string, required): 知识点 ID

---

### 搜索功能

#### search

在指定知识库中进行语义搜索（路 A：语义路径）。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `query` (string, required): 搜索查询
- `top_k` (number, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1

#### search_in_knowledge

在指定文章中进行语义搜索（路 B：结构路径）。用于已知用户问题属于哪个分类/章节时，精准搜索该分类下的内容。

**参数:**
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID（从 get_knowledge_tree 获取）
- `query` (string, required): 搜索查询
- `top_k` (number, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1

#### global_search

在所有知识库中进行全局语义搜索。

**参数:**
- `query` (string, required): 搜索查询
- `top_k` (number, optional): 返回结果数量，默认 10
- `threshold` (number, optional): 相似度阈值，默认 0.1

---

## 数据结构

### 知识库 (KnowledgeBase)
```json
{
  "id": "xxx",
  "name": "知识库名称",
  "description": "描述",
  "owner_id": 1,
  "embedding_model_id": "local",
  "embedding_dim": 384,
  "is_public": false,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z",
  "stats": {
    "knowledge_count": 10,
    "point_count": 100
  }
}
```

### 文章 (Knowledge)
```json
{
  "id": "xxx",
  "kb_id": "知识库ID",
  "parent_id": null,
  "title": "文章标题",
  "summary": "摘要",
  "source_type": "manual",
  "status": "pending",
  "position": 1,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### 知识点 (KnowledgePoint)
```json
{
  "id": "xxx",
  "knowledge_id": "文章ID",
  "title": "知识点标题",
  "content": "知识点内容",
  "context": "上下文",
  "position": 1,
  "token_count": 100,
  "is_vectorized": true,
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

## 使用示例

```javascript
// 获取知识库列表
{ "tool": "list_knowledge_bases", "params": { "page": 1, "pageSize": 10 } }

// 创建知识库
{ "tool": "create_knowledge_base", "params": { "name": "我的知识库", "description": "学习笔记" } }

// 在知识库中创建文章
{ "tool": "create_knowledge", "params": { "kb_id": "xxx", "title": "第一篇文章" } }

// 在文章中创建知识点
{ "tool": "create_point", "params": { "kb_id": "xxx", "knowledge_id": "yyy", "content": "这是一个重要知识点" } }

// 语义搜索
{ "tool": "search", "params": { "kb_id": "xxx", "query": "如何学习Vue", "top_k": 5 } }
```
