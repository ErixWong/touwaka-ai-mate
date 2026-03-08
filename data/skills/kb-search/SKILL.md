# KB Search - 知识库检索技能

用于查询和搜索知识库内容的技能。

**目标用户**：所有专家（用于检索知识）

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

## 功能

- 知识库查询
- 文章查询
- 节查询
- 段落查询（知识点）
- 标签查询
- 语义搜索

## 权限

只能查询 `owner_id === userId` 的知识库（由 API 层验证）

---

## 工具清单

### 知识库查询

#### list_my_kbs

列出当前用户可访问的知识库。

**参数**：
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20

#### get_kb

获取知识库详情。

**参数**：
- `id` (string, required): 知识库 ID

---

### 文章查询

#### list_articles

获取知识库下的文章列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20
- `status` (string, optional): 状态过滤（pending/processing/ready/error）
- `search` (string, optional): 搜索关键词

#### get_article

获取文章详情。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID

#### get_article_tree

获取文章的完整树状结构（包含所有节和段落）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, required): 文章 ID

**返回示例**：
```json
{
  "article": { "id": "art_001", "title": "Python 入门教程" },
  "tree": [
    {
      "id": "sec_001",
      "title": "第一章 Python简介",
      "level": 1,
      "children": [...],
      "paragraphs": [...]
    }
  ]
}
```

---

### 节查询

#### list_sections

查询节列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, optional): 文章 ID 过滤
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

---

### 段落查询

#### list_paragraphs

查询段落列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `section_id` (string, optional): 节 ID 过滤
- `is_knowledge_point` (boolean, optional): 是否知识点过滤
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

#### list_knowledge_points

获取知识点列表（便捷方法，只返回标记为知识点的段落）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `section_id` (string, optional): 节 ID 过滤
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

---

### 标签查询

#### list_tags

获取标签列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

---

### 搜索操作

#### search

在指定知识库中进行语义搜索（搜索知识点段落）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1
- `format` (string, optional): 输出格式，可选 'table'

#### search_in_article

在指定文章中进行语义搜索（结构路径）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, required): 文章 ID
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 5
- `threshold` (number, optional): 相似度阈值，默认 0.1

#### global_search

全局语义搜索，搜索用户所有知识库。

**参数**：
- `query` (string, required): 搜索查询
- `top_k` (integer, optional): 返回结果数量，默认 10
- `threshold` (number, optional): 相似度阈值，默认 0.1
- `format` (string, optional): 输出格式，可选 'table'

---

## 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |
| `USER_ID` | 用户 ID（调试用） | 可选 |

---

## 使用示例

### 查看知识库和文章

```javascript
// 1. 列出我的知识库
list_my_kbs()

// 2. 获取知识库详情
get_kb(id="kb123")

// 3. 列出知识库下的文章
list_articles(kb_id="kb123")

// 4. 获取文章的完整结构
get_article_tree(kb_id="kb123", article_id="art456")
```

### 语义搜索

```javascript
// 在知识库中搜索
search(kb_id="kb123", query="如何安装 Python", top_k=5)

// 在特定文章中搜索
search_in_article(kb_id="kb123", article_id="art456", query="变量定义")

// 全局搜索
global_search(query="配置环境变量", top_k=10)
```

### 查询知识点

```javascript
// 获取知识库中的所有知识点
list_knowledge_points(kb_id="kb123")

// 获取特定节下的知识点
list_knowledge_points(kb_id="kb123", section_id="sec789")
```

---

## 典型工作流程

### 问答检索

1. `list_my_kbs` - 确认可访问的知识库
2. `search` 或 `global_search` - 语义搜索相关知识点
3. `get_article_tree` - 如果需要更多上下文

### 内容浏览

1. `list_articles` - 查看知识库中的文章
2. `get_article_tree` - 查看文章完整结构
3. `list_knowledge_points` - 查看特定节的知识点

---

## 技术说明

- 通过 API 调用执行操作，使用用户 Token 认证
- 所有权限验证由 API 层完成
- 搜索只在 `is_knowledge_point=true` 的段落中进行
- 搜索结果包含相似度分数和完整路径信息
