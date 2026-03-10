# KB Editor - 知识库编辑技能

知识库管理技能，用于创建和管理知识库、文章、节、段落、标签。

**目标用户**：知识专家（专门负责整理知识的 AI 专家）

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

- 知识库 CRUD（创建/读取/更新/删除）
- 文章 CRUD（支持标签关联）
- 节 CRUD（无限层级树状结构）
- 段落 CRUD（可标记为知识点）
- 标签 CRUD
- 获取可用的嵌入模型列表

## 权限

只能操作 `owner_id === userId` 的知识库（由 API 层验证）

---

## 工具清单

### 知识库操作

#### list_my_kbs

列出当前用户拥有的知识库。

**参数**：
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20

#### list_embedding_models

获取可用的嵌入模型列表，用于创建知识库时选择。

**参数**：无

#### get_kb

获取知识库详情。

**参数**：
- `id` (string, required): 知识库 ID

#### create_kb

创建知识库。

**参数**：
- `name` (string, required): 知识库名称
- `description` (string, optional): 知识库描述
- `embedding_model_id` (string, optional): 嵌入模型 ID，默认 bge-m3
- `embedding_dim` (integer, optional): 向量维度，默认 1024

#### update_kb

更新知识库。

**参数**：
- `id` (string, required): 知识库 ID
- `name` (string, optional): 新名称
- `description` (string, optional): 新描述
- `embedding_model_id` (string, optional): 新嵌入模型 ID
- `embedding_dim` (integer, optional): 新向量维度

#### delete_kb

删除知识库。

**参数**：
- `id` (string, required): 知识库 ID

---

### 文章操作

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
      "children": [
        {
          "id": "sec_002",
          "title": "1.1 什么是Python",
          "level": 2,
          "children": [],
          "paragraphs": [
            { "id": "para_001", "content": "...", "is_knowledge_point": true }
          ]
        }
      ],
      "paragraphs": []
    }
  ]
}
```

#### create_article

创建文章。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `title` (string, required): 文章标题
- `summary` (string, optional): 文章摘要
- `source_type` (string, optional): 来源类型（manual/upload/url）
- `source_url` (string, optional): 来源 URL
- `file_path` (string, optional): 本地文件路径
- `status` (string, optional): 状态（pending/processing/ready/error）
- `tags` (string[], optional): 标签名数组，如 `['Python', '编程']`

#### update_article

更新文章。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID
- `title` (string, optional): 新标题
- `summary` (string, optional): 新摘要
- `source_type` (string, optional): 来源类型
- `source_url` (string, optional): 来源 URL
- `file_path` (string, optional): 本地文件路径
- `status` (string, optional): 状态
- `tags` (string[], optional): 标签名数组

#### delete_article

删除文章（级联删除所有节和段落）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID

---

### 节操作

#### list_sections

查询节列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, optional): 文章 ID 过滤
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

#### create_section

创建节。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `article_id` (string, required): 所属文章 ID
- `parent_id` (string, optional): 父节 ID（用于创建子节）
- `title` (string, required): 节标题

**说明**：
- 如果不传 `parent_id`，创建的是顶级节（章）
- 如果传 `parent_id`，创建的是子节
- 系统自动计算 `level` 和 `position`
- 最大层级深度为 10 层

#### update_section

更新节。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 节 ID
- `title` (string, optional): 新标题

#### move_section

移动节（与相邻节交换位置）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 节 ID
- `direction` (string, required): 移动方向，"up" 或 "down"

#### delete_section

删除节（级联删除所有子节和段落）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 节 ID

---

### 段落操作

#### list_paragraphs

查询段落列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `section_id` (string, optional): 节 ID 过滤
- `is_knowledge_point` (boolean, optional): 是否知识点过滤
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

#### create_paragraph

创建段落。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `section_id` (string, required): 所属节 ID
- `title` (string, optional): 段落标题
- `content` (string, required): 段落内容（完整的原文，不要提炼或总结）
- `context` (string, optional): 知识点上下文。当 `is_knowledge_point` 为 `true` 时，使用一两句话总结该知识点及其所在文章（中文），便于语义检索
- `is_knowledge_point` (boolean, optional): 是否为知识点，默认 false
- `token_count` (integer, optional): Token 数量，默认 0

**重要：知识点段落**：
- 设置 `is_knowledge_point: true` 的段落会被向量化，可用于语义搜索
- 普通段落不会被向量化，只作为上下文展示

**Context 字段说明**：
- **用途**：用于语义检索时提供上下文信息，帮助技能更准确地定位知识点
- **生成原则**：用一两句话总结该知识点和知识点所处的文章（中文）
- **示例**：如果知识点是"Python 是一种解释型语言"，Context 可以是"Python 编程语言简介 - 介绍 Python 的基本特性和应用场景"

#### update_paragraph

更新段落。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 段落 ID
- `title` (string, optional): 新标题
- `content` (string, optional): 新内容（原文，不要提炼或总结）
- `context` (string, optional): 知识点上下文。当 `is_knowledge_point` 为 `true` 时，使用一两句话总结该知识点及其所在文章（中文），便于语义检索
- `is_knowledge_point` (boolean, optional): 是否为知识点
- `token_count` (integer, optional): Token 数量

#### move_paragraph

移动段落（与相邻段交换位置）。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 段落 ID
- `direction` (string, required): 移动方向，"up" 或 "down"

#### delete_paragraph

删除段落。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 段落 ID

---

### 标签操作

#### list_tags

获取标签列表。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 100

#### create_tag

创建标签。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `name` (string, required): 标签名称
- `description` (string, optional): 标签描述

#### update_tag

更新标签。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 标签 ID
- `name` (string, optional): 新名称
- `description` (string, optional): 新描述

#### delete_tag

删除标签。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 标签 ID

---

## 环境变量

以下环境变量由 skill-loader 自动注入：

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |
| `USER_ID` | 用户 ID（调试用） | 可选 |

---

## 使用示例

### 创建知识库和文章

```javascript
// 1. 创建知识库
create_kb(name="产品文档", description="产品相关文档和知识")

// 2. 创建文章
create_article(kb_id="kb123", title="功能介绍", tags=["产品", "功能"])

// 3. 创建文章（带标签）
create_article(kb_id="kb123", title="API 文档", tags=["API", "开发"])
```

### 创建文章内容结构

```javascript
// 1. 创建顶级节（章）
create_section(kb_id="kb123", article_id="art456", title="第一章 快速开始")

// 2. 创建子节
create_section(kb_id="kb123", article_id="art456", parent_id="sec001", title="1.1 安装")

// 3. 创建段落
create_paragraph(
  kb_id="kb123",
  section_id="sec002",
  content="安装非常简单，只需要运行 npm install 命令即可完成...",
  is_knowledge_point=true
)

// 4. 创建普通段落（不会向量化）
create_paragraph(
  kb_id="kb123",
  section_id="sec002",
  content="这是补充说明文字，不需要被检索..."
)
```

### 获取文章完整结构

```javascript
// 获取文章树（包含所有节和段落）
get_article_tree(kb_id="kb123", article_id="art456")
```

### 标签管理

```javascript
// 创建标签
create_tag(kb_id="kb123", name="重要", description="重要内容")

// 给文章设置标签（在创建或更新文章时）
create_article(kb_id="kb123", title="新文章", tags=["重要", "产品"])
```

---

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

---

## 技术说明

- 通过 API 调用执行操作，使用用户 Token 认证
- 所有权限验证由 API 层完成
- 节支持无限层级（最大 10 层）
- 只有标记为知识点的段落会被向量化
- 标签与文章是多对多关系
