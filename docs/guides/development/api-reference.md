# API 参考

## 认证 API

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| POST | `/api/auth/login` | 登录 | ❌ |
| POST | `/api/auth/refresh` | 刷新 Token | ❌ |
| GET | `/api/auth/me` | 当前用户 | ✅ |

## 用户 API

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/users/:id` | 用户信息 | ✅ |

## 话题 API

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/topics` | 话题列表 | ✅ |
| POST | `/api/topics` | 创建话题 | ✅ |
| GET | `/api/topics/:id` | 话题详情 | ✅ |
| PUT | `/api/topics/:id` | 更新话题 | ✅ |
| DELETE | `/api/topics/:id` | 删除话题 | ✅ |

## 消息 API

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/messages?topic_id=` | 消息列表 | ✅ |

## 专家 API

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/experts` | 专家列表 | ✅ |
| GET | `/api/experts/:id` | 专家详情 | ✅ |

## 模型 API

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/models` | 模型列表 | ✅ |

## 聊天 API

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/stream/chat` | SSE 流式聊天 | ✅ |

## 文档 API（待实现）

| 方法 | 端点 | 描述 | 认证 |
|------|------|------|------|
| GET | `/api/docs` | 文档列表 | ✅ |
| POST | `/api/docs` | 创建文档 | ✅ |
| GET | `/api/docs/:id` | 文档详情 | ✅ |
| PUT | `/api/docs/:id` | 更新文档 | ✅ |
| DELETE | `/api/docs/:id` | 删除文档 | ✅ |

---

## 环境变量

### 数据库

```bash
DB_HOST=localhost
DB_PORT=3306
DB_NAME=touwaka_mate
DB_USER=your_db_user
DB_PASSWORD=your_db_password
```

### JWT

```bash
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
```

### LLM API（二选一）

```bash
OPENAI_API_KEY=sk-xxx
# 或
DEEPSEEK_API_KEY=sk-xxx
```

### 其他

```bash
API_PORT=3000
FRONTEND_URL=http://localhost:5173
```

---

## 错误码

| 码 | 含义 |
|----|------|
| 400 | 参数错误 |
| 401 | 未认证 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器错误 |

---

## 响应格式

### 成功

```json
{
  "success": true,
  "data": { ... }
}
```

### 失败

```json
{
  "success": false,
  "error": "错误信息",
  "code": 400
}
```

---

*最后更新: 2026-02-22*
