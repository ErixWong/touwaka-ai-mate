# KB Editor - 知识库编辑技能

知识库管理技能，用于创建和管理知识库、文章、知识点。

**目标用户**：知识专家（专门负责整理知识的 AI 专家）

## 功能

- 知识库 CRUD（创建/读取/更新/删除）
- 文章 CRUD（支持树状结构）
- 知识点 CRUD
- 获取可用的嵌入模型列表

## 权限

只能操作 `owner_id === userId` 的知识库（由 API 层验证）

## 工具清单

### 知识库操作

### list_my_kbs

列出当前用户拥有的知识库。

**参数**：
- `page` (integer, optional): 页码，默认 1
- `pageSize` (integer, optional): 每页数量，默认 20

### list_embedding_models

获取可用的嵌入模型列表，用于创建知识库时选择。

**参数**：无

### get_kb

获取知识库详情。

**参数**：
- `id` (string, required): 知识库 ID

### create_kb

创建知识库。

**参数**：
- `name` (string, required): 知识库名称
- `description` (string, optional): 知识库描述
- `embedding_model_id` (string, optional): 嵌入模型 ID，默认 bge-m3
- `embedding_dim` (integer, optional): 向量维度，默认 1024

### update_kb

更新知识库。

**参数**：
- `id` (string, required): 知识库 ID
- `name` (string, optional): 新名称
- `description` (string, optional): 新描述
- `embedding_model_id` (string, optional): 新嵌入模型 ID
- `embedding_dim` (integer, optional): 新向量维度

### delete_kb

删除知识库。

**参数**：
- `id` (string, required): 知识库 ID

---

### 文章操作

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

### create_knowledge

创建文章。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `title` (string, required): 文章标题
- `parent_id` (string, optional): 父文章 ID（用于创建子文章）
- `summary` (string, optional): 文章摘要
- `source_type` (string, optional): 来源类型
- `source_url` (string, optional): 来源 URL

### update_knowledge

更新文章。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID
- `title` (string, optional): 新标题
- `summary` (string, optional): 新摘要
- `status` (string, optional): 状态（draft/published）
- `position` (integer, optional): 排序位置

### delete_knowledge

删除文章。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `id` (string, required): 文章 ID

---

### 知识点操作

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

### create_point

创建知识点。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `content` (string, required): 知识点内容
- `title` (string, optional): 知识点标题
- `context` (string, optional): 上下文信息

### update_point

更新知识点。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `id` (string, required): 知识点 ID
- `title` (string, optional): 新标题
- `content` (string, optional): 新内容
- `context` (string, optional): 新上下文
- `position` (integer, optional): 排序位置

### delete_point

删除知识点。

**参数**：
- `kb_id` (string, required): 知识库 ID
- `knowledge_id` (string, required): 文章 ID
- `id` (string, required): 知识点 ID

## 环境变量

以下环境变量由 skill-loader 自动注入：

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `USER_ACCESS_TOKEN` | 用户的 JWT access token | ✅ |
| `API_BASE` | API 基础地址 | ✅ |
| `USER_ID` | 用户 ID（调试用） | 可选 |

## 使用示例

```
// 创建知识库
create_kb(name="产品文档", description="产品相关文档和知识")

// 创建文章
create_knowledge(kb_id="kb123", title="功能介绍", parent_id=null)

// 创建子文章
create_knowledge(kb_id="kb123", title="用户管理", parent_id="k456")

// 创建知识点
create_point(kb_id="kb123", knowledge_id="k789", content="用户可以通过邮箱注册账号...")
```

## 技术说明

- 通过 API 调用执行操作，使用用户 Token 认证
- 所有权限验证由 API 层完成
- 支持审计日志记录
