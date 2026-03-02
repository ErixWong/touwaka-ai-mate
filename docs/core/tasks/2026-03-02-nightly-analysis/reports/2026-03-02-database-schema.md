# Touwaka Mate V2 - 数据库表结构清单

**生成时间**: 2026-03-02 02:40  
**数据库**: MySQL 8.0+  
**字符集**: utf8mb4  
**表数量**: 15 个

---

## 📊 表概览

| 序号 | 表名 | 说明 | 外键数量 | 索引数量 |
|------|------|------|----------|----------|
| 1 | providers | 服务提供商 | 0 | 0 |
| 2 | ai_models | AI模型 | 1 | 2 |
| 3 | experts | 专家 | 2 | 1 |
| 4 | skills | 技能 | 0 | 0 |
| 5 | skill_tools | 技能工具 | 1 | 2 |
| 6 | expert_skills | 专家技能关联 | 2 | 2 |
| 7 | users | 用户 | 0 | 3 |
| 8 | user_profiles | 用户画像 | 2 | 3 |
| 9 | topics | 话题 | 2 | 3 |
| 10 | messages | 消息 | 3 | 5 |
| 11 | roles | 角色 | 0 | 1 |
| 12 | permissions | 权限 | 1 | 2 |
| 13 | role_permissions | 角色权限关联 | 2 | 2 |
| 14 | user_roles | 用户角色关联 | 2 | 2 |
| 15 | role_experts | 角色专家关联 | 2 | 2 |

---

## 🔌 1. providers - 服务提供商表

**说明**: 存储LLM服务提供商配置（OpenAI、DeepSeek、Ollama等）

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| name | VARCHAR(128) | NOT NULL | - | 提供商名称 |
| base_url | VARCHAR(512) | NOT NULL | - | API基础URL |
| api_key | VARCHAR(512) | - | - | API密钥 |
| timeout | INT | - | 60000 | 请求超时时间（毫秒） |
| is_active | BIT(1) | - | b'1' | 是否激活 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

---

## 🤖 2. ai_models - AI模型表

**说明**: 存储可用的AI模型配置

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| name | VARCHAR(128) | NOT NULL | - | 模型显示名称 |
| model_name | VARCHAR(128) | NOT NULL | - | API调用使用的模型标识符 |
| provider_id | VARCHAR(32) | FOREIGN KEY | - | 关联providers.id |
| max_tokens | INT | - | 4096 | 最大token数 |
| cost_per_1k_input | DECIMAL(10,6) | - | 0 | 输入成本（每1K token） |
| cost_per_1k_output | DECIMAL(10,6) | - | 0 | 输出成本（每1K token） |
| description | TEXT | - | - | 模型描述 |
| is_active | BIT(1) | - | b'1' | 是否激活 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

**外键**:
- `provider_id` → `providers(id)` ON DELETE SET NULL

**索引**:
- idx_provider (provider_id)
- idx_active (is_active)

---

## 🎭 3. experts - 专家表

**说明**: 存储AI专家的人格定义

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| name | VARCHAR(128) | NOT NULL | - | 专家名称 |
| introduction | TEXT | - | - | 专家简介 |
| speaking_style | TEXT | - | - | 说话风格 |
| core_values | TEXT | - | - | 核心价值观 |
| behavioral_guidelines | TEXT | - | - | 行为规范 |
| taboos | TEXT | - | - | 禁忌事项 |
| emotional_tone | VARCHAR(256) | - | - | 情感基调 |
| expressive_model_id | VARCHAR(32) | FOREIGN KEY | - | 表达心智模型ID |
| reflective_model_id | VARCHAR(32) | FOREIGN KEY | - | 反思心智模型ID |
| prompt_template | TEXT | - | - | Prompt模板 |
| is_active | BIT(1) | - | b'1' | 是否激活 |
| avatar_base64 | TEXT | - | - | 小头像Base64（日常使用） |
| avatar_large_base64 | MEDIUMTEXT | - | - | 大头像Base64（对话框背景） |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

**外键**:
- `expressive_model_id` → `ai_models(id)` ON DELETE SET NULL
- `reflective_model_id` → `ai_models(id)` ON DELETE SET NULL

**索引**:
- idx_active (is_active)

---

## 🛠️ 4. skills - 技能表

**说明**: 存储技能定义

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(64) | PRIMARY KEY | - | 唯一标识 |
| name | VARCHAR(128) | NOT NULL | - | 技能名称 |
| description | TEXT | - | - | 技能描述 |
| version | VARCHAR(32) | - | - | 版本号 |
| author | VARCHAR(128) | - | - | 作者 |
| tags | JSON | - | - | 标签数组 |
| source_type | ENUM('url','zip','local') | - | 'local' | 来源类型 |
| source_path | VARCHAR(512) | - | - | 本地路径 |
| source_url | VARCHAR(512) | - | - | 来源URL |
| skill_md | TEXT | - | - | SKILL.md内容 |
| security_score | INT | - | 100 | 安全评分 |
| security_warnings | JSON | - | - | 安全警告 |
| license | TEXT | - | - | 许可证信息 |
| argument_hint | VARCHAR(128) | - | '' | 参数提示 |
| disable_model_invocation | BIT(1) | - | b'0' | 禁用模型调用 |
| user_invocable | BIT(1) | - | b'1' | 用户可调用 |
| allowed_tools | TEXT | - | - | 允许的工具列表（JSON数组） |
| is_active | BIT(1) | - | b'1' | 是否激活 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

---

## 🔧 5. skill_tools - 技能工具表

**说明**: 存储技能的工具定义

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| skill_id | VARCHAR(64) | NOT NULL | - | 关联skills.id |
| name | VARCHAR(64) | NOT NULL | - | 工具名称 |
| description | TEXT | - | - | 工具描述 |
| parameters | TEXT | - | - | JSON Schema格式的参数定义 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

**外键**:
- `skill_id` → `skills(id)` ON DELETE CASCADE

**索引**:
- idx_skill_name (skill_id, name) UNIQUE
- idx_skill_id (skill_id)

---

## 🔗 6. expert_skills - 专家技能关联表

**说明**: 专家与技能的多对多关联

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| expert_id | VARCHAR(32) | NOT NULL | - | 关联experts.id |
| skill_id | VARCHAR(32) | NOT NULL | - | 关联skills.id |
| is_enabled | BIT(1) | - | b'1' | 是否启用 |
| config | JSON | - | - | 技能配置 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |

**外键**:
- `expert_id` → `experts(id)` ON DELETE CASCADE
- `skill_id` → `skills(id)` ON DELETE CASCADE

**索引**:
- uk_expert_skill (expert_id, skill_id) UNIQUE

---

## 👤 7. users - 用户表

**说明**: 存储用户账号信息（固有属性，全局一致）

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| username | VARCHAR(32) | UNIQUE | - | 用户名 |
| email | VARCHAR(256) | UNIQUE | - | 邮箱 |
| password_hash | VARCHAR(256) | - | - | 密码哈希 |
| nickname | VARCHAR(128) | - | - | 昵称 |
| avatar | TEXT | - | - | 用户头像Base64（约5-15KB） |
| gender | VARCHAR(16) | - | - | 性别：male/female/other |
| birthday | DATE | - | - | 生日 |
| occupation | VARCHAR(128) | - | - | 职业 |
| location | VARCHAR(128) | - | - | 所在地 |
| status | ENUM('active','inactive','banned') | - | 'active' | 账号状态 |
| preferences | JSON | - | - | 用户偏好设置 |
| last_login | DATETIME | - | - | 最后登录时间 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

**索引**:
- idx_username (username)
- idx_email (email)
- idx_status (status)

---

## 📝 8. user_profiles - 用户画像表

**说明**: 存储专家对用户的认知（用户对每个专家有独立的画像）

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| user_id | VARCHAR(32) | NOT NULL | - | 关联users.id |
| expert_id | VARCHAR(32) | NOT NULL | - | 关联experts.id |
| preferred_name | VARCHAR(128) | - | - | 用户希望被称呼的名字 |
| introduction | TEXT | - | - | 用户自我介绍 |
| background | TEXT | - | - | 背景画像（LLM总结生成） |
| notes | TEXT | - | - | 专家对用户的笔记 |
| first_met | DATETIME | - | - | 首次见面时间 |
| last_active | DATETIME | - | - | 最后活跃时间 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

**外键**:
- `user_id` → `users(id)` ON DELETE CASCADE
- `expert_id` → `experts(id)` ON DELETE CASCADE

**索引**:
- uk_user_expert (user_id, expert_id) UNIQUE
- idx_expert (expert_id)
- idx_last_active (last_active)

---

## 💬 9. topics - 话题表

**说明**: 存储对话话题

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| user_id | VARCHAR(32) | NOT NULL | - | 关联users.id |
| expert_id | VARCHAR(32) | - | - | 关联experts.id |
| provider_name | VARCHAR(128) | - | - | 提供商名称 |
| model_name | VARCHAR(128) | - | - | 模型名称 |
| title | VARCHAR(256) | NOT NULL | - | 话题标题 |
| description | TEXT | - | - | 话题描述 |
| category | VARCHAR(128) | - | - | 分类 |
| keywords | JSON | - | - | 话题关键词数组（用于记忆召回） |
| status | ENUM('active','archived','deleted') | - | 'active' | 话题状态 |
| message_count | INT | - | 0 | 消息数量 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

**外键**:
- `user_id` → `users(id)` ON DELETE CASCADE
- `expert_id` → `experts(id)` ON DELETE SET NULL

**索引**:
- idx_user_status (user_id, status)
- idx_expert (expert_id)
- idx_updated (updated_at)

---

## 📨 10. messages - 消息表

**说明**: 存储对话消息

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| topic_id | VARCHAR(32) | NOT NULL | - | 关联topics.id |
| user_id | VARCHAR(32) | NOT NULL | - | 消息所属用户ID |
| expert_id | VARCHAR(32) | - | - | 专家ID |
| role | ENUM('system','user','assistant') | NOT NULL | - | 消息角色 |
| content | TEXT | NOT NULL | - | 消息内容 |
| content_type | ENUM('text','image','file') | - | 'text' | 内容类型 |
| prompt_tokens | INT | - | 0 | 输入token数量 |
| completion_tokens | INT | - | 0 | 输出token数量 |
| cost | DECIMAL(10,6) | - | 0 | 成本 |
| latency_ms | INT | - | 0 | 延迟（毫秒） |
| provider_name | VARCHAR(128) | - | - | 提供商名称 |
| model_name | VARCHAR(128) | - | - | 模型名称 |
| inner_voice | JSON | - | - | 内心独白 |
| tool_calls | JSON | - | - | 工具调用 |
| error_info | JSON | - | - | 错误信息 |
| is_deleted | BIT(1) | - | b'0' | 是否删除 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |

**外键**:
- `topic_id` → `topics(id)` ON DELETE CASCADE
- `user_id` → `users(id)` ON DELETE CASCADE
- `expert_id` → `experts(id)` ON DELETE SET NULL

**索引**:
- idx_topic (topic_id)
- idx_user (user_id)
- idx_expert (expert_id)
- idx_role (role)
- idx_created (created_at)

---

## 🔐 11. roles - 角色表

**说明**: RBAC权限系统的角色定义

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| name | VARCHAR(50) | UNIQUE NOT NULL | - | 角色标识：admin/creator/user |
| label | VARCHAR(100) | NOT NULL | - | 角色显示名称 |
| description | TEXT | - | - | 角色描述 |
| is_system | BIT(1) | - | b'0' | 系统角色，不可删除 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |
| updated_at | DATETIME | - | CURRENT_TIMESTAMP ON UPDATE | 更新时间 |

**索引**:
- idx_name (name)

---

## 🔑 12. permissions - 权限表

**说明**: 权限定义（含菜单路由配置）

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| id | VARCHAR(32) | PRIMARY KEY | - | 唯一标识 |
| code | VARCHAR(100) | UNIQUE NOT NULL | - | 权限码：user:create, expert:edit等 |
| name | VARCHAR(100) | NOT NULL | - | 权限名称 |
| type | ENUM('menu','button','api') | - | 'api' | 权限类型 |
| parent_id | VARCHAR(32) | - | - | 父权限ID（用于菜单层级） |
| route_path | VARCHAR(255) | - | - | Vue路由路径（菜单权限用） |
| route_component | VARCHAR(255) | - | - | Vue组件路径 |
| route_icon | VARCHAR(100) | - | - | 菜单图标 |
| sort_order | INT | - | 0 | 排序顺序 |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |

**外键**:
- `parent_id` → `permissions(id)` ON DELETE SET NULL

**索引**:
- idx_code (code)
- idx_type (type)

---

## 🔗 13. role_permissions - 角色权限关联表

**说明**: 角色与权限的多对多关联

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| role_id | VARCHAR(32) | NOT NULL | - | 关联roles.id |
| permission_id | VARCHAR(32) | NOT NULL | - | 关联permissions.id |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |

**主键**: (role_id, permission_id)

**外键**:
- `role_id` → `roles(id)` ON DELETE CASCADE
- `permission_id` → `permissions(id)` ON DELETE CASCADE

---

## 🔗 14. user_roles - 用户角色关联表

**说明**: 用户与角色的多对多关联（支持多角色）

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| user_id | VARCHAR(32) | NOT NULL | - | 关联users.id |
| role_id | VARCHAR(32) | NOT NULL | - | 关联roles.id |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |

**主键**: (user_id, role_id)

**外键**:
- `user_id` → `users(id)` ON DELETE CASCADE
- `role_id` → `roles(id)` ON DELETE CASCADE

---

## 🔗 15. role_experts - 角色专家关联表

**说明**: 角色对专家的访问权限

| 字段名 | 类型 | 约束 | 默认值 | 说明 |
|--------|------|------|--------|------|
| role_id | VARCHAR(32) | NOT NULL | - | 关联roles.id |
| expert_id | VARCHAR(32) | NOT NULL | - | 关联experts.id |
| created_at | DATETIME | - | CURRENT_TIMESTAMP | 创建时间 |

**主键**: (role_id, expert_id)

**外键**:
- `role_id` → `roles(id)` ON DELETE CASCADE
- `expert_id` → `experts(id)` ON DELETE CASCADE

---

## 📈 ER关系图（简化）

```
providers (1) ───< (N) ai_models
                    │
                    └──< (N) experts (expressive_model, reflective_model)

experts (1) ───< (N) expert_skills >─── (N) skills (1) ───< (N) skill_tools
    │
    └──< (N) user_profiles >─── (1) users (1) ───< (N) user_roles >─── (N) roles
    │                              │
    └──< (N) topics >──────────────┘                    │
         │                                              │
         └──< (N) messages                              └──< (N) role_permissions
                                                         │
                                                         └──< (N) role_experts

roles (1) ───< (N) role_permissions >─── (N) permissions
```

---

## 🎯 关键设计特点

### 1. **二分心智架构**
- `experts.expressive_model_id` - 表达心智（快速响应）
- `experts.reflective_model_id` - 反思心智（深度思考）

### 2. **用户画像分离**
- `users` - 全局用户属性
- `user_profiles` - 每个专家视角下的用户画像

### 3. **RBAC权限系统**
- 3个表：`roles`, `permissions`, `role_permissions`
- 支持菜单权限和API权限
- 支持角色-专家访问控制

### 4. **软删除机制**
- `topics.status` - 'deleted'状态而非物理删除
- `messages.is_deleted` - 标记删除

### 5. **多租户数据隔离**
- 所有核心表都有 `user_id` 字段
- 查询时通过 user_id 过滤

---

## 📝 初始数据

脚本初始化时会创建：
- 3个 Providers (OpenAI, DeepSeek, Ollama)
- 5个 AI Models
- 2个 Users (admin/test, 密码: password123)
- 2个 Experts (Eric, Skills Studio)
- 6个 Skills (2个基础 + 4个内置)
- 22个 Skill Tools
- 3个 Roles (admin, creator, user)
- 菜单权限和API权限

---

*文档生成时间: 2026-03-02 02:40*  
*分析来源: scripts/init-database.js*
