# KB Search - 知识库检索技能

## 功能

- 知识库查询
- 文章查询
- 知识点查询
- 语义搜索

## 权限

只能查询 `owner_id === userId` 的知识库（由 API 层验证）

## 工具清单

### 知识库查询

### list_my_kbs

列出当前用户可访问的知识库。

**参数**：
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20

### get_kb

获取知识库详情。

**参数**：
- `id` (string, required): 知识库 ID

---

### 文章查询

### list_knowledges

获取知识库下的文章列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20

### get_knowledge_tree

获取文章树状结构。

**参数**：
- `kb_id` (string, required): 知识库 ID

### get_knowledge

获取文章详情。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID

---

### 知识点查询

### list_points

获取知识点列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 50

### get_point

获取知识点详情。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `id` (string, required): 知识点 ID

---

### 搜索操作

### search

在指定知识库中进行语义搜索。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1
- `format` (string, optional): 输出格式，可选 'table'

### search_in_knowledge

在指定文章中进行语义搜索（结构路径）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1

### global_search

全局语义搜索，搜索用户所有知识库。

**参数**：
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 10
- `threshold` (number, optional): 相似度阈值，默认 0.1
- `format` (string, optional): 输出格式，可选 'table'

## 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| USER_ACCESS_TOKEN | 用户的 JWT access token | ✅ |
| API_BASE | API 基础地址 | ✅ |
| USER_ID | 用户 ID（调试用） | 可选 |
