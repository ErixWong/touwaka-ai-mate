---
name: kb-search
description: "知识库检索技能。用于查询和搜索知识库内容，支持语义搜索。当专家需要检索知识、查找知识点时触发。"
argument-hint: "[search|global_search|list_articles] --kb_id=xxx"
user-invocable: false
allowed-tools: []
---

# KB Search - 知识库检索技能

用于查询和搜索知识库内容的技能。

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `list_my_kbs` | 列出我的知识库 | `page`, `pageSize` |
| `get_kb` | 获取知识库详情 | `id` |
| `list_articles` | 列出文章 | `kb_id`, `page`, `status`, `search` |
| `get_article` | 获取文章详情 | `kb_id`, `id` |
| `get_article_tree` | 获取文章完整结构 | `kb_id`, `article_id` |
| `list_sections` | 列出节 | `kb_id`, `article_id` |
| `list_paragraphs` | 列出段落 | `kb_id`, `section_id` |
| `list_knowledge_points` | 列出知识点 | `kb_id`, `section_id` |
| `list_tags` | 列出标签 | `kb_id` |
| `search` | 语义搜索 | `kb_id`, `query`, `top_k` |
| `search_in_article` | 文章内搜索 | `kb_id`, `article_id`, `query` |
| `global_search` | 全局搜索 | `query`, `top_k` |

## 知识库查询

### list_my_kbs

列出当前用户可访问的知识库。

**参数：**
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20

### get_kb

获取知识库详情。

**参数：**
- `id` (string, required): 知识库 ID

## 文章查询

### list_articles

获取知识库下的文章列表。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20
- `status` (string, optional): 状态过滤（pending/processing/ready/error）
- `search` (string, optional): 搜索关键词

### get_article_tree

获取文章的完整树状结构（包含所有节和段落）。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, required): 文章 ID

## 段落查询

### list_knowledge_points

获取知识点列表（便捷方法，只返回标记为知识点的段落）。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `section_id` (string, optional): 节 ID 过滤
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

## 搜索操作

### search

在指定知识库中进行语义搜索（搜索知识点段落）。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1
- `format` (string, optional): 输出格式，可选 'table'

### search_in_article

在指定文章中进行语义搜索。

**参数：**
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, required): 文章 ID
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1

### global_search

全局语义搜索，搜索用户所有知识库。

**参数：**
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 10
- `threshold` (number, optional): 相似度阈值，默认 0.1
- `format` (string, optional): 输出格式，可选 'table'

## 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |
| `USER_ID` | 用户 ID（调试用） | 可选 |

## 典型工作流程

### 问答检索

1. `list_my_kbs` - 确认可访问的知识库
2. `search` 或 `global_search` - 语义搜索相关知识点
3. `get_article_tree` - 如果需要更多上下文

### 内容浏览

1. `list_articles` - 查看知识库中的文章
2. `get_article_tree` - 查看文章完整结构
3. `list_knowledge_points` - 查看特定节的知识点

## 权限说明

只能查询 `owner_id === userId` 的知识库（由 API 层验证）。

## 技术说明

- 通过 API 调用执行操作，使用用户 Token 认证
- 搜索只在 `is_knowledge_point=true` 的段落中进行
- 搜索结果包含相似度分数和完整路径信息
