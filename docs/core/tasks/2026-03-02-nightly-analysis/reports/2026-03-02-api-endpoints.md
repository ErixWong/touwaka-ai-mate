# Touwaka Mate V2 - 后端 API 端点文档

**生成时间**: 2026-03-02 02:35  
**版本**: 2.0.0

---

## 📊 API 概览

| 分类 | 端点数量 | 控制器 |
|------|----------|--------|
| 认证管理 | 4 | AuthController |
| 用户管理 | 10 | UserController |
| 专家管理 | 9 | ExpertController |
| 话题管理 | 8 | TopicController |
| 消息管理 | 4 | MessageController |
| 聊天流式 | 2 | StreamController |
| 技能管理 | 15 | SkillController |
| 模型管理 | 5 | ModelController |
| 提供商管理 | 5 | ProviderController |
| 角色管理 | 10 | RoleController |
| 调试工具 | 1 | DebugController |
| **总计** | **73** | 11 个控制器 |

---

## 🔐 认证管理 API

**基础路径**: `/api/auth`  
**控制器**: AuthController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| POST | `/api/auth/login` | login | ❌ 公开 | 用户登录 |
| POST | `/api/auth/refresh` | refresh | ❌ 公开 | 刷新 Token |
| GET | `/api/auth/me` | me | ✅ 需要 | 获取当前用户信息 |
| POST | `/api/auth/logout` | logout | ✅ 需要 | 用户登出 |

---

## 👤 用户管理 API

**基础路径**: `/api/users`  
**控制器**: UserController

### 管理员专用

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/users` | getUsers | ✅ 需要 | 获取用户列表 |
| POST | `/api/users` | createUser | ✅ 需要 | 创建新用户 |
| DELETE | `/api/users/:id` | deleteUser | ✅ 需要 | 删除用户 |
| POST | `/api/users/:id/reset-password` | resetPassword | ✅ 需要 | 重置用户密码 |
| PUT | `/api/users/:id/roles` | updateUserRoles | ✅ 需要 | 更新用户角色 |
| GET | `/api/users/roles` | getRoles | ✅ 需要 | 获取所有角色列表 |

### 当前用户

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/users/me/preferences` | getMyPreferences | ✅ 需要 | 获取我的偏好设置 |
| PUT | `/api/users/me/preferences` | updateMyPreferences | ✅ 需要 | 更新我的偏好设置 |

### 用户 CRUD

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/users/:id` | getUser | ✅ 需要 | 获取用户信息 |
| PUT | `/api/users/:id` | updateUser | ✅ 需要 | 更新用户信息 |
| PUT | `/api/users/:id/preferences` | updatePreferences | ✅ 需要 | 更新用户偏好（兼容） |

---

## 🎭 专家管理 API

**基础路径**: `/api/experts`  
**控制器**: ExpertController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/experts` | list | ✅ 需要 | 获取专家列表 |
| GET | `/api/experts/:id` | get | ✅ 需要 | 获取专家详情 |
| POST | `/api/experts` | create | ✅ 需要 | 创建专家 |
| PUT | `/api/experts/:id` | update | ✅ 需要 | 更新专家 |
| DELETE | `/api/experts/:id` | delete | ✅ 需要 | 删除专家 |
| GET | `/api/experts/:id/skills` | getSkills | ✅ 需要 | 获取专家技能列表 |
| POST | `/api/experts/:id/skills` | updateSkills | ✅ 需要 | 更新专家技能 |
| POST | `/api/experts/:id/refresh` | refresh | ✅ 需要 | 刷新专家缓存 |

---

## 💬 话题管理 API

**基础路径**: `/api/topics`  
**控制器**: TopicController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| POST | `/api/topics/query` | query | ✅ 需要 | 复杂查询话题列表 |
| GET | `/api/topics` | list | ✅ 需要 | 获取话题列表（简单查询） |
| POST | `/api/topics/compress` | compress | ✅ 需要 | 手动触发压缩 |
| POST | `/api/topics` | create | ✅ 需要 | 创建话题 |
| GET | `/api/topics/:id` | get | ⚠️ 可选 | 获取话题详情（公开访问） |
| PUT | `/api/topics/:id` | update | ✅ 需要 | 更新话题 |
| DELETE | `/api/topics/:id` | delete | ✅ 需要 | 删除话题 |
| GET | `/api/topics/:topicId/messages` | listByTopic (MessageController) | ✅ 需要 | 获取话题下消息列表 |

---

## 📨 消息管理 API

**基础路径**: `/api/messages`  
**控制器**: MessageController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/messages/expert/:expertId` | listByExpert | ✅ 需要 | 按专家+用户获取消息 |
| GET | `/api/messages` | list | ⚠️ 可选 | 获取消息列表（旧API，兼容） |
| GET | `/api/messages/:id` | get | ✅ 需要 | 获取单条消息详情 |
| DELETE | `/api/messages/expert/:expertId` | clearByExpert | ✅ 需要 | 删除指定专家的所有消息 |

**设计说明**: 消息按 expert + user 组织，topic 只是对话历史的阶段性总结

---

## 🔗 聊天流式 API

**基础路径**: `/api/chat`  
**控制器**: StreamController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| POST | `/api/chat` | sendMessage | ✅ 需要 | 发送消息（非流式） |
| GET | `/api/chat/stream` | subscribe | ✅ 需要 | SSE 订阅流式响应 |

**说明**: `/api/stream` 路由已预留但当前无实际端点

---

## 🛠️ 技能管理 API

**基础路径**: `/api/skills`  
**控制器**: SkillController

### 基础 CRUD

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/skills` | list | ❓ 未标注 | 获取技能列表 |
| GET | `/api/skills/:id` | get | ❓ 未标注 | 获取技能详情 |
| PUT | `/api/skills/:id` | update | ❓ 未标注 | 更新技能 |
| DELETE | `/api/skills/:id` | delete | ❓ 未标注 | 删除技能 |

### 技能安装

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| POST | `/api/skills/from-url` | installFromUrl | ❓ 未标注 | 从 URL 安装 |
| POST | `/api/skills/from-zip` | installFromZip | ❓ 未标注 | 从 ZIP 安装（文件上传） |
| POST | `/api/skills/from-path` | installFromPath | ❓ 未标注 | 从本地目录安装 |

### 技能分析

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| POST | `/api/skills/:id/reanalyze` | reanalyze | ❓ 未标注 | 重新分析技能 |

### 技能参数

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/skills/:id/parameters` | getParameters | ❓ 未标注 | 获取技能参数 |
| POST | `/api/skills/:id/parameters` | saveParameters | ❓ 未标注 | 保存技能参数（全量替换） |

### Skills Studio API

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| POST | `/api/skills/register` | register | ❓ 未标注 | 注册技能（从本地路径） |
| POST | `/api/skills/assign` | assign | ❓ 未标注 | 分配技能给专家 |
| POST | `/api/skills/unassign` | unassign | ❓ 未标注 | 取消技能分配 |
| PATCH | `/api/skills/:id/toggle` | toggle | ❓ 未标注 | 启用/禁用技能 |

**⚠️ 注意**: Skill 路由当前没有添加 `authenticate()` 中间件，需要确认是否是有意为之

---

## 🤖 模型管理 API

**基础路径**: `/api/models`  
**控制器**: ModelController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/models` | list | ✅ 需要 | 获取模型列表 |
| GET | `/api/models/:id` | getById | ✅ 需要 | 获取模型详情 |
| POST | `/api/models` | create | ✅ 需要 | 创建模型 |
| PUT | `/api/models/:id` | update | ✅ 需要 | 更新模型 |
| DELETE | `/api/models/:id` | delete | ✅ 需要 | 删除模型 |

---

## 🔌 提供商管理 API

**基础路径**: `/api/providers`  
**控制器**: ProviderController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/providers` | getAll | ❓ 未标注 | 获取所有 Providers |
| GET | `/api/providers/:id` | getOne | ❓ 未标注 | 获取单个 Provider |
| POST | `/api/providers` | create | ❓ 未标注 | 创建 Provider |
| PUT | `/api/providers/:id` | update | ❓ 未标注 | 更新 Provider |
| DELETE | `/api/providers/:id` | delete | ❓ 未标注 | 删除 Provider |

**⚠️ 注意**: Provider 路由当前没有添加 `authenticate()` 中间件，需要确认是否是有意为之

---

## 🔐 角色管理 API

**基础路径**: `/api/roles`  
**控制器**: RoleController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/roles` | list | ✅ 需要管理员 | 获取角色列表 |
| GET | `/api/roles/permissions/all` | listAllPermissions | ✅ 需要管理员 | 获取所有权限列表 |
| GET | `/api/roles/experts/all` | listAllExperts | ✅ 需要管理员 | 获取所有专家列表 |
| GET | `/api/roles/:id` | get | ✅ 需要管理员 | 获取角色详情 |
| PUT | `/api/roles/:id` | update | ✅ 需要管理员 | 更新角色 |
| GET | `/api/roles/:id/permissions` | getPermissions | ✅ 需要管理员 | 获取角色权限 |
| PUT | `/api/roles/:id/permissions` | updatePermissions | ✅ 需要管理员 | 更新角色权限 |
| GET | `/api/roles/:id/experts` | getExperts | ✅ 需要管理员 | 获取角色专家访问权限 |
| PUT | `/api/roles/:id/experts` | updateExperts | ✅ 需要管理员 | 更新角色专家访问权限 |

---

## 🐛 调试工具 API

**基础路径**: `/api/debug`  
**控制器**: DebugController

| 方法 | 端点 | Controller 方法 | 认证 | 说明 |
|------|------|-----------------|------|------|
| GET | `/api/debug/llm-payload` | getLLMPayload | ✅ 需要 | 获取最近一次 LLM Payload |

---

## 🏥 健康检查 API

**端点**: `/api/health`  
**类型**: 内置端点（无需控制器）

| 方法 | 端点 | 说明 |
|------|------|------|
| GET | `/api/health` | 服务健康检查（公开访问） |

---

## 🔍 关键发现

### 1. 认证不一致 ⚠️

| 路由 | 当前状态 | 建议 |
|------|----------|------|
| `/api/skills` | ❌ 无认证 | 添加 `authenticate()` |
| `/api/providers` | ❌ 无认证 | 添加 `authenticate()` |
| `/api/models` | ✅ 有认证 | 保持一致 |
| `/api/roles` | ✅ 需要管理员 | 正确 |

### 2. 路由实例化不一致

| 路由 | 实例化方式 | Controller 接收参数 |
|------|------------|---------------------|
| 标准路由 | 传 controller 实例 | `controller.method.bind(controller)` |
| Provider | 传 db 实例 | `new ProviderController(db)` |
| Role | 传类本身 | 直接传 `RoleController`（类/对象） |

### 3. 预留路由

- `/api/stream` - 当前无实际端点

---

## 📁 控制器文件映射

| 控制器 | 文件路径 | 方法数 | 状态 |
|--------|----------|--------|------|
| AuthController | `controllers/auth.controller.js` | 4 | ✅ |
| UserController | `controllers/user.controller.js` | 10 | ✅ |
| ExpertController | `controllers/expert.controller.js` | 9 | ✅ |
| TopicController | `controllers/topic.controller.js` | 8 | ✅ |
| MessageController | `controllers/message.controller.js` | 4 | ✅ |
| StreamController | `controllers/stream.controller.js` | 2 | ✅ |
| SkillController | `controllers/skill.controller.js` | 15 | ⚠️ 文件过大(1596行) |
| ModelController | `controllers/model.controller.js` | 5 | ✅ |
| ProviderController | `controllers/provider.controller.js` | 5 | ✅ |
| RoleController | `controllers/role.controller.js` | 10 | ⚠️ 实例化方式不一致 |
| DebugController | `controllers/debug.controller.js` | 1 | ⚠️ 可能生产环境不需要 |

---

*文档生成时间: 2026-03-02 02:35*  
*分析工具: Maria API 文档生成器 v1.0*
