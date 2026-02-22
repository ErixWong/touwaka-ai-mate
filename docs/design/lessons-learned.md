# 调试经验

> 遇到问题时先查本文档，再查 [development-guide.md](development-guide.md) 的规范定义。

---

## 1. CORS 版本不兼容

**现象**：API 返回纯文本 `Not Found`  
**原因**：`koa-cors@0.0.16` 与 Koa 3.x 不兼容  
**解决**：

```bash
npm uninstall koa-cors
npm install @koa/cors
```

---

## 2. 响应格式判断服务器状态

| Content-Type | 含义 |
|--------------|------|
| `application/json` | 框架正常，路由问题（404 = 接口不存在） |
| `text/plain` | 服务器异常，中间件问题 |

---

## 3. users 表没有 role 字段

**现象**：查询报错 `Unknown column 'role' in 'SELECT'`  
**原因**：`users` 表无 `role` 字段，角色通过 `user_roles` 关联表  
**解决**：

```javascript
// ❌ 错误
SELECT id, email, role FROM users...

// ✅ 正确
SELECT u.id, u.email, r.name as role 
FROM users u 
LEFT JOIN user_roles ur ON u.id = ur.user_id 
LEFT JOIN roles r ON ur.role_id = r.id
```

---

## 4. 快速调试

```bash
# 检查端口占用
netstat -aon | findstr :3000

# 终止进程
taskkill /F /PID <pid>

# 测试账号
admin@example.com / password123
test@example.com / password123
```

---

## 5. messages 表必须有 user_id 和 expert_id

**现象**：INSERT 报错 `Unknown column 'user_id' in 'INSERT INTO'`
**原因**：messages 表设计遗漏了 `user_id` 和 `expert_id` 字段
**解决**：

```sql
ALTER TABLE messages ADD COLUMN user_id VARCHAR(32) NOT NULL AFTER topic_id;
ALTER TABLE messages ADD COLUMN expert_id VARCHAR(32) AFTER user_id;
ALTER TABLE messages ADD INDEX idx_user (user_id);
ALTER TABLE messages ADD INDEX idx_expert (expert_id);
```

**设计原则**：虽然 `topic_id` 可以 JOIN 获取 `user_id` 和 `expert_id`，但直接存储更便于查询。

---

## 6. 消息存储统一由 ChatService 处理

**现象**：代码中存在两条消息存储路径，造成混乱
**原因**：`lib/db.js` 和 `lib/chat-service.js` 都有 INSERT 消息的方法
**解决**：
- 删除 `lib/db.js` 的 `addMessage()` 方法
- 删除 `lib/memory-system.js` 的 `addMessage()` 方法
- 消息存储统一由 `ChatService.saveUserMessage()` 和 `ChatService.saveAssistantMessage()` 处理

---

## 7. users 表使用 nickname 而非 real_name

**现象**：查询报错 `Unknown column 'u.real_name' in 'SELECT'`
**原因**：代码中使用了 `real_name` 字段，但数据库 `users` 表实际使用 `nickname` 字段
**解决**：

```javascript
// ❌ 错误
SELECT up.*, u.email, u.real_name FROM user_profiles up JOIN users u...

// ✅ 正确
SELECT up.*, u.email, u.nickname FROM user_profiles up JOIN users u...
```

**涉及文件**：
- `lib/db.js` - `getUserProfile()` 方法
- `lib/context-manager.js` - `buildUserProfileContext()` 方法
- `lib/memory-system.js` - `getUserPreferredName()` 方法

---

## 8. messages 表使用 created_at 而非 timestamp

**现象**：查询报错 `Unknown column 'timestamp' in 'SELECT'`
**原因**：代码中使用了 `timestamp` 字段，但数据库 `messages` 表使用 `created_at` 字段
**解决**：

```javascript
// ❌ 错误
SELECT id, role, content, timestamp FROM messages ORDER BY timestamp DESC

// ✅ 正确
SELECT id, role, content, created_at FROM messages ORDER BY created_at DESC
```

**涉及文件**：
- `lib/db.js` - `getRecentMessages()`, `getMessagesByTimeRange()`, `getMessagesWithInnerVoice()`, `assignMessagesToTopic()`
- `lib/memory-system.js` - `getRecentMessages()` 中的字段映射

---

## 9. topics 表使用 title 而非 name

**现象**：Topic 标题显示为 undefined
**原因**：代码中使用了 `name` 字段，但数据库 `topics` 表使用 `title` 字段
**解决**：

```javascript
// ❌ 错误
SELECT * FROM topics  // 然后使用 t.name

// ✅ 正确
SELECT id, title, description, ... FROM topics  // 使用 t.title
```

**涉及文件**：
- `lib/db.js` - `createTopic()`, `getTopicsByExpertAndUser()`
- `lib/context-manager.js` - `buildTopicContext()`
- `lib/memory-system.js` - `matchOrCreateTopic()`

---

## 规范速查（详见 development-guide.md）

- **字段命名**：API 必须用 snake_case
- **主键生成**：必须用 `Utils.newID()`，禁止自增 ID
- **数据库方法**：SELECT 用 `query()`，UPDATE/DELETE 用 `execute()`
- **this 绑定**：路由中控制器方法用箭头函数 `(ctx) => ctrl.method(ctx)` 或 `.bind()`
- **认证中间件**：`authenticate()` 和 `requireAdmin()` 必须加括号调用（工厂函数）
- **users 表字段**：使用 `nickname` 而非 `real_name`
