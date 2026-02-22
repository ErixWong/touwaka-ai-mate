# 数据库手册

本手册涵盖 Touwaka Mate v2 的数据库设计、ORM 使用和查询 API。

## 文档索引

| 文档 | 说明 |
|------|------|
| [API 查询设计](./api-query-design.md) | 基于 Sequelize 的查询 API 规范 |
| [ORM 分析](./orm-analysis.md) | ORM 选型分析和决策 |
| [数据库初始化脚本](../../scripts/init-database.js) | 表结构定义和初始数据 |

## 快速开始

### 1. 环境配置

在项目根目录创建 `.env` 文件：

```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=touwaka_mate
DB_USER=your_db_user
DB_PASSWORD=your_db_password
```

### 2. 初始化数据库

```bash
npm run init-db
# 或
node scripts/init-database.js
```

### 3. 生成 Sequelize 模型

```bash
node scripts/generate-models.js
```

模型文件会生成到 `models/` 目录。

### 4. 使用模型

```javascript
import { models, initDatabase } from './models/index.js';

// 初始化连接
await initDatabase();

// 查询示例
const topics = await models.topic.findAll({
  include: [{ model: models.user, as: 'user' }]
});
```

## 数据库表结构

### 核心表

| 表名 | 说明 |
|------|------|
| `users` | 用户表 |
| `experts` | 专家/助手表 |
| `topics` | 话题/会话表 |
| `messages` | 消息表 |
| `skills` | 技能表 |

### 配置表

| 表名 | 说明 |
|------|------|
| `providers` | AI 服务提供商表 |
| `ai_models` | AI 模型配置表 |

### 关联表

| 表名 | 说明 |
|------|------|
| `user_profiles` | 用户档案（用户-专家关联） |
| `expert_skills` | 专家技能关联 |
| `user_roles` | 用户角色关联 |
| `role_permissions` | 角色权限关联 |

### 权限表

| 表名 | 说明 |
|------|------|
| `roles` | 角色表 |
| `permissions` | 权限表 |

## ER 图

```
┌─────────────┐     ┌─────────────┐
│  providers  │────<│  ai_models  │
└─────────────┘     └─────────────┘
                          │
                          │ expressive_model_id / reflective_model_id
                          ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│    users    │────<│   experts   │>────│   skills    │
└─────────────┘     └─────────────┘     └─────────────┘
      │                   │                   │
      │                   │                   │
      ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   topics    │────<│  messages   │     │expert_skills│
└─────────────┘     └─────────────┘     └─────────────┘
```

## 查询 API 使用

### 简单查询（GET）

```http
GET /api/topics?status=active&page=1&pageSize=10
```

### 复杂查询（POST /query）

```http
POST /api/topics/query
Content-Type: application/json

{
  "page": { "number": 1, "size": 10 },
  "filter": {
    "status": "active",
    "created_at_gte": "2026-01-01",
    "title_contains": "项目"
  },
  "sort": [{ "field": "updated_at", "order": "DESC" }],
  "include": ["Expert"]
}
```

### 操作符后缀

| 后缀 | 说明 | 示例 |
|------|------|------|
| `_gte` | >= | `created_at_gte` |
| `_lte` | <= | `created_at_lte` |
| `_like` | LIKE | `title_like` |
| `_contains` | 包含 | `title_contains` |
| `_in` | IN | `status_in` |
| `_null` | IS NULL | `expert_id_null` |

## 常用命令

```bash
# 初始化数据库
npm run init-db

# 重新生成模型（数据库变更后）
node scripts/generate-models.js

# 测试查询构建器
node tests/test-query-builder.js
```

---

*最后更新: 2026-02-20*
