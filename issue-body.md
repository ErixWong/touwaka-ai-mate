# 功能需求：用户级技能参数系统

## 问题背景

### 当前问题
1. **权限问题**：`GET /api/skills/:id/parameters` 只需要 `authenticate()` 认证，任何登录用户都能查看技能参数值
2. **安全风险**：普通用户可以看到全局参数值，包括敏感参数（如 API Key）
3. **灵活性不足**：所有用户共享同一套参数配置，无法实现个性化设置

### 当前架构
- 技能参数存储在 `skill_parameters` 表
- 参数是全局的，所有用户共享
- 普通用户可以查看参数值（只读）
- 只有管理员可以修改参数

## 解决方案

### 核心思路
创建 `user_skill_parameters` 表，实现用户级别的参数覆盖机制：
1. 调用技能时，优先使用用户自己的参数值
2. 如果用户没有设置，则回退到全局默认值
3. 用户可以在 Skills Management 界面管理自己的参数

### 数据库设计

```sql
CREATE TABLE user_skill_parameters (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL COMMENT '用户ID',
  skill_id VARCHAR(32) NOT NULL COMMENT '技能ID',
  param_name VARCHAR(100) NOT NULL COMMENT '参数名',
  param_value TEXT COMMENT '参数值',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_user_skill_param (user_id, skill_id, param_name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
) COMMENT '用户技能参数表（只存储用户覆盖的参数）';
```

> **注意**：用户参数表只存储用户实际覆盖的参数，不存储所有参数的副本。`is_secret` 属性从全局参数定义继承。

### API 设计

#### 用户级 API
| 接口 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/api/skills/:id/my-parameters` | GET | 用户 | 获取当前用户的参数（合并全局默认值） |
| `/api/skills/:id/my-parameters` | POST | 用户 | 保存当前用户的参数 |

#### 管理员 API（保持不变）
| 接口 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/api/skills/:id/parameters` | GET | 管理员 | 获取全局参数 |
| `/api/skills/:id/parameters` | POST | 管理员 | 保存全局参数 |

### 参数优先级
调用技能时的参数获取逻辑：
1. 优先使用 `user_skill_parameters` 中用户设置的值
2. 如果用户未设置，使用 `skill_parameters` 中的全局默认值
3. 敏感参数（`is_secret=1`）在 API 返回时默认隐藏

### 前端改造
1. Skills Management 页面区分「全局参数」和「我的参数」两个 Tab
2. 普通用户只能看到「我的参数」Tab
3. 管理员可以看到两个 Tab
4. 「我的参数」页面显示参数名和默认值提示，用户可覆盖

---

## ⚠️ 设计注意点

### 1. 参数定义同步问题
**问题**：当管理员在 `skill_parameters` 表中新增/删除参数时，用户的 `user_skill_parameters` 不会自动同步。

**解决方案**：用户参数表只存储用户实际覆盖的参数，不存储所有参数的副本。查询时动态合并。

### 2. 敏感参数的继承问题
**问题**：如果全局参数标记为 `is_secret=1`，用户设置的参数是否也应该继承这个属性？

**解决方案**：`is_secret` 属性从全局参数定义继承，用户参数表不存储此字段。

### 3. 参数删除的级联处理
**问题**：当全局参数被删除时，用户设置的对应参数如何处理？

**解决方案**：
- 外键级联删除会自动处理技能删除的情况
- 查询时忽略没有全局定义的用户参数（孤儿数据）
- 可选：定期清理孤儿数据的定时任务

### 4. 某些参数不应允许用户覆盖
**问题**：某些系统级配置（如数据库连接）可能不应该允许用户自定义。

**解决方案**：在 `skill_parameters` 表增加 `allow_user_override` 字段：
```sql
ALTER TABLE skill_parameters ADD COLUMN allow_user_override TINYINT(1) DEFAULT 1 COMMENT '是否允许用户覆盖';
```

### 5. 性能考虑
**问题**：每次调用技能都需要查询两张表并合并。

**解决方案**：
- 在 `skill-loader.js` 中实现缓存机制
- 用户参数变更时清除对应用户的缓存
- 缓存 key 格式：`skill_params:{skill_id}:{user_id}`

### 6. 用户体验
**问题**：用户如何知道有哪些参数可以设置？

**解决方案**：
- 显示参数名和全局默认值（敏感值脱敏显示为 `••••••••`）
- 用户可选择覆盖某个参数
- 清晰标注哪些参数是用户覆盖的，哪些是使用默认值

### 7. 审计追踪
**问题**：用户参数的变更是否需要记录日志？

**解决方案**：暂不实现，后续如有需求可添加 `updated_by` 字段。

---

## 实现步骤

### Phase 1: 数据库迁移
- [ ] 在 `skill_parameters` 表添加 `allow_user_override` 字段
- [ ] 创建 `user_skill_parameters` 表
- [ ] 执行迁移并重新生成模型

### Phase 2: 后端 API
- [ ] 添加 `GET /api/skills/:id/my-parameters` 接口
- [ ] 添加 `POST /api/skills/:id/my-parameters` 接口
- [ ] 修改 `skill-loader.js` 中的参数加载逻辑，支持用户级参数覆盖
- [ ] 实现参数缓存机制

### Phase 3: 前端改造
- [ ] 修改 `SkillParametersModal.vue`，区分全局/用户参数
- [ ] 添加「我的参数」管理界面
- [ ] 权限控制：普通用户只能管理自己的参数

### Phase 4: 安全加固
- [ ] 修改 `GET /api/skills/:id/parameters` 为管理员权限
- [ ] 敏感参数值在 API 返回时脱敏处理

## 预期效果
1. 普通用户无法看到全局参数的敏感值
2. 用户可以设置自己的参数值，实现个性化配置
3. 调用技能时自动使用用户自己的参数
4. 管理员仍可管理全局默认参数
5. 管理员可控制哪些参数允许用户覆盖

## 相关文件
- `server/routes/skill.routes.js` - 路由定义
- `server/controllers/skill.controller.js` - 控制器
- `lib/skill-loader.js` - 技能加载器
- `frontend/src/components/SkillParametersModal.vue` - 参数管理组件
- `scripts/upgrade-database.js` - 数据库迁移