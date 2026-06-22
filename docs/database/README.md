# 数据库手册

本手册覆盖当前仓库中的数据库初始化、模型生成、查询规范与主要业务表概览。

## 文档索引

| 文档 | 说明 |
|------|------|
| [API 查询设计](./api-query-design.md) | 查询参数、过滤器、分页与排序约定 |
| [数据库初始化脚本](../../scripts/init-database.js) | 初始建表与基础数据脚本 |
| [数据库升级脚本](../../scripts/upgrade-database.js) | 增量迁移入口 |
| [模型生成脚本](../../scripts/generate-models.js) | `models/` 再生入口 |

## 重要约束

- 数据库字段禁止未经确认擅改。
- 布尔字段统一使用 `BIT(1)`。
- `models/` 为生成产物，禁止手改。
- 结构变更后必须同步更新 `scripts/upgrade-database.js` 并重新生成模型。

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

### 3. 执行数据库升级

```bash
node scripts/upgrade-database.js
```

### 4. 重新生成 Sequelize 模型

```bash
node scripts/generate-models.js
```

模型文件会生成到 `models/` 目录。

## 主要表分类

### 核心业务表

| 表名 | 说明 |
|------|------|
| `users` | 用户表 |
| `experts` | 专家 / 助手表 |
| `topics` | 话题 / 会话表 |
| `messages` | 消息表 |
| `skills` | 技能表 |

### AI 与配置表

| 表名 | 说明 |
|------|------|
| `providers` | AI 服务提供商表 |
| `ai_models` | AI 模型配置表 |
| `system_settings` | 系统级配置 |

### 关联与权限表

| 表名 | 说明 |
|------|------|
| `user_profiles` | 用户档案 / 用户与专家关系 |
| `expert_skills` | 专家技能关联 |
| `user_roles` | 用户角色关联 |
| `role_permissions` | 角色权限关联 |
| `roles` | 角色表 |
| `permissions` | 权限表 |

### App 平台相关表

| 表名 | 说明 |
|------|------|
| `mini_apps` | 已安装 app 注册表 |
| `mini_app_rows` | app 通用业务记录 |
| `app_clock_registry` | tick 调度注册表 |
| `app_tick_log` | tick 执行历史 |
| `app_tick_run` | tick 运行状态 |

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

### 常见操作符后缀

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

# 执行数据库升级
node scripts/upgrade-database.js

# 重新生成模型（数据库变更后）
node scripts/generate-models.js
```

---

*最后更新: 2026-06-20*
