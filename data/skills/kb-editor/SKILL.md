---
name: kb-editor
description: "知识库编辑技能。用于创建和管理知识库、文章、节、段落、标签。当知识专家需要整理知识、导入文档、构建知识结构时触发。"
argument-hint: "[knowledge_base|article|section|paragraph|tag] --action=xxx"
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

## 工具（5个）

| 工具 | 操作（action） | 说明 |
|------|----------------|------|
| `knowledge_base` | list, list_models, get, create, update, delete | 知识库操作 |
| `article` | list, get, get_tree, create, update, delete | 文章操作 |
| `section` | list, create, update, move, delete | 节操作（支持无限层级） |
| `paragraph` | list, create, update, move, delete | 段落操作 |
| `tag` | list, create, update, delete | 标签操作 |

## knowledge_base - 知识库操作

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 操作类型：list, list_models, get, create, update, delete |
| `id` | string | get/update/delete | 知识库 ID |
| `name` | string | create | 知识库名称 |
| `description` | string | - | 知识库描述 |
| `embedding_model_id` | string | - | 嵌入模型 ID，默认 bge-m3 |
| `embedding_dim` | integer | - | 向量维度，默认 1024 |
| `page` | integer | - | 页码，默认 1 |
| `pageSize` | integer | - | 每页数量，默认 20 |

### 示例

```javascript
// 列出知识库
{ action: 'list', page: 1, pageSize: 20 }

// 获取嵌入模型列表
{ action: 'list_models' }

// 创建知识库
{ action: 'create', name: '我的知识库', description: '技术文档' }

// 更新知识库
{ action: 'update', id: 'kb_001', name: '新名称' }

// 删除知识库
{ action: 'delete', id: 'kb_001' }
```

## article - 文章操作

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 操作类型：list, get, get_tree, create, update, delete |
| `kb_id` | string | ✅ | 知识库 ID |
| `id` | string | get/update/delete | 文章 ID |
| `article_id` | string | get_tree | 文章 ID |
| `title` | string | create | 文章标题 |
| `summary` | string | - | 文章摘要 |
| `tags` | string[] | - | 标签名数组，如 `['Python', '编程']` |
| `status` | string | - | 状态过滤（pending/processing/ready/error） |
| `search` | string | - | 搜索关键词 |

### 示例

```javascript
// 列出文章
{ action: 'list', kb_id: 'kb_001', page: 1, pageSize: 20 }

// 获取文章详情
{ action: 'get', kb_id: 'kb_001', id: 'art_001' }

// 获取文章完整结构（包含节和段落）
{ action: 'get_tree', kb_id: 'kb_001', article_id: 'art_001' }

// 创建文章
{ action: 'create', kb_id: 'kb_001', title: 'Python 入门', tags: ['Python', '编程'] }

// 更新文章
{ action: 'update', kb_id: 'kb_001', id: 'art_001', title: '新标题' }

// 删除文章
{ action: 'delete', kb_id: 'kb_001', id: 'art_001' }
```

## section - 节操作

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 操作类型：list, create, update, move, delete |
| `kb_id` | string | ✅ | 知识库 ID |
| `id` | string | update/move/delete | 节 ID |
| `article_id` | string | create | 所属文章 ID |
| `parent_id` | string | - | 父节 ID（用于创建子节） |
| `title` | string | create | 节标题 |
| `direction` | string | move | 移动方向：up 或 down |

### 说明

- 不传 `parent_id` 创建顶级节（章）
- 传 `parent_id` 创建子节
- 系统自动计算 `level` 和 `position`
- 最大层级深度为 10 层

### 示例

```javascript
// 列出节
{ action: 'list', kb_id: 'kb_001', article_id: 'art_001' }

// 创建顶级节
{ action: 'create', kb_id: 'kb_001', article_id: 'art_001', title: '第一章' }

// 创建子节
{ action: 'create', kb_id: 'kb_001', article_id: 'art_001', parent_id: 'sec_001', title: '1.1 小节' }

// 更新节标题
{ action: 'update', kb_id: 'kb_001', id: 'sec_001', title: '新标题' }

// 移动节（与相邻节交换位置）
{ action: 'move', kb_id: 'kb_001', id: 'sec_001', direction: 'up' }

// 删除节（级联删除所有子节和段落）
{ action: 'delete', kb_id: 'kb_001', id: 'sec_001' }
```

## paragraph - 段落操作

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 操作类型：list, create, update, move, delete |
| `kb_id` | string | ✅ | 知识库 ID |
| `id` | string | update/move/delete | 段落 ID |
| `section_id` | string | create | 所属节 ID |
| `title` | string | - | 段落标题 |
| `content` | string | create | 段落内容 |
| `context` | string | - | 知识点上下文（用于语义检索） |
| `is_knowledge_point` | boolean | - | 是否为知识点，默认 false |
| `direction` | string | move | 移动方向：up 或 down |

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

### 示例

```javascript
// 列出段落
{ action: 'list', kb_id: 'kb_001', section_id: 'sec_001' }

// 创建普通段落
{ action: 'create', kb_id: 'kb_001', section_id: 'sec_001', content: '原文内容...' }

// 创建知识点段落
{
  action: 'create',
  kb_id: 'kb_001',
  section_id: 'sec_001',
  content: 'Python 是一种解释型语言...',
  context: 'Python 编程语言简介 - 介绍 Python 的基本特性',
  is_knowledge_point: true
}

// 更新段落
{ action: 'update', kb_id: 'kb_001', id: 'para_001', content: '新内容...' }

// 移动段落
{ action: 'move', kb_id: 'kb_001', id: 'para_001', direction: 'up' }

// 删除段落
{ action: 'delete', kb_id: 'kb_001', id: 'para_001' }
```

## tag - 标签操作

### 参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 操作类型：list, create, update, delete |
| `kb_id` | string | ✅ | 知识库 ID |
| `id` | string | update/delete | 标签 ID |
| `name` | string | create | 标签名称 |
| `description` | string | - | 标签描述 |

### 示例

```javascript
// 列出标签
{ action: 'list', kb_id: 'kb_001' }

// 创建标签
{ action: 'create', kb_id: 'kb_001', name: 'Python' }

// 更新标签
{ action: 'update', kb_id: 'kb_001', id: 'tag_001', name: '新名称' }

// 删除标签
{ action: 'delete', kb_id: 'kb_001', id: 'tag_001' }
```

## 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |
| `USER_ID` | 用户 ID（调试用） | 可选 |

## 典型工作流程

### 导入新文档

1. `knowledge_base` action=list - 查看知识库列表
2. `article` action=create - 创建文章，设置标题和标签
3. `section` action=create - 根据文档结构创建节（章→节→小节）
4. `paragraph` action=create - 创建段落，标记知识点（`is_knowledge_point: true`）
5. `article` action=get_tree - 验证结构完整性

### 调整内容结构

1. `article` action=get_tree - 查看当前结构
2. `section` action=move / `paragraph` action=move - 调整顺序
3. `section` action=update / `paragraph` action=update - 修改内容

## 权限说明

只能操作 `owner_id === userId` 的知识库（由 API 层验证）。
