# 角色管理界面

> 创建日期：2026-02-27

## 需求描述

在设置界面添加「角色管理」功能模块，用于管理角色权限和专家访问控制。

## 管理员识别机制

系统通过检查用户是否拥有 `name='admin'` 的角色来认定管理员身份：
- 登录时，将用户的角色 `name` 写入 JWT token
- 认证中间件解析 token，将 `role` 存入 `ctx.state.userRole`
- [`requireAdmin()`](../middlewares/auth.js) 中间件检查 `ctx.state.userRole !== 'admin'`

## 功能要求

### 布局结构

```
┌─────────────────────────────────────────────────────────────┐
│ 角色管理                                                    │
├─────────────┬───────────────────────────────────────────────┤
│ [角色列表]   │  [Tab: 权限配置] [Tab: 专家访问权限]          │
│ ┌─────────┐ │  ┌─────────────────────────────────────────┐ │
│ │ admin  ✏️│ │  │                                         │ │
│ │creator ✏️│ │  │  (选中角色的权限/专家配置)               │ │
│ │ user   ✏️│ │  │                                         │ │
│ └─────────┘ │  └─────────────────────────────────────────┘ │
└─────────────┴───────────────────────────────────────────────┘
```

### 左侧面板（角色列表）

1. 显示所有角色，每行包含：
   - 角色名称（label）
   - 编辑按钮（末尾）
2. 点击角色行，右侧显示该角色的详细配置
3. 系统角色（`is_system: true`）不可删除，但可编辑

### 右侧 Tab 页面

#### Tab 1: 权限配置
- 使用复选框树形结构展示所有权限
- 按权限类型分组：menu / button / api
- 勾选/取消勾选即时保存

#### Tab 2: 专家访问权限
- 使用复选框列表展示所有专家
- 勾选/取消勾选即时保存
- 管理员角色默认拥有所有专家访问权限

### 编辑角色 Modal

点击角色行的编辑按钮，弹出 Modal 编辑：
- 角色标识（name）- 系统角色不可修改
- 显示名称（label）
- 描述（description）

## 数据库变更

### 新增表：role_experts

```sql
CREATE TABLE IF NOT EXISTS role_experts (
  role_id VARCHAR(32) NOT NULL,
  expert_id VARCHAR(32) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id, expert_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE
);
```

**字段说明：**
- `role_id`: 关联 roles 表
- `expert_id`: 关联 experts 表
- 管理员角色默认可访问所有专家，无需在此表记录

### 模型关联

```javascript
// models/init-models.js 添加
role.belongsToMany(expert, { through: role_expert, foreignKey: 'role_id', otherKey: 'expert_id', as: 'experts' });
expert.belongsToMany(role, { through: role_expert, foreignKey: 'expert_id', otherKey: 'role_id', as: 'roles' });
```

## 技术方案

### 前端组件

- 位置：`frontend/src/views/SettingsView.vue` 新增 Tab
- 复用现有组件样式：panel-header、pagination、dialog
- 使用 Ant Design 的 Tree 组件展示权限树

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/roles | 获取角色列表 |
| PUT | /api/roles/:id | 更新角色基本信息 |
| GET | /api/roles/:id/permissions | 获取角色的权限列表 |
| PUT | /api/roles/:id/permissions | 更新角色权限 |
| GET | /api/roles/:id/experts | 获取角色可访问的专家列表 |
| PUT | /api/roles/:id/experts | 更新角色专家访问权限 |
| GET | /api/permissions | 获取所有权限（树形结构）|
| GET | /api/experts/simple | 获取专家简表（id, name）|

## 进度

- [ ] 数据库：创建 role_experts 表
- [ ] 后端：角色列表 API
- [ ] 后端：更新角色 API
- [ ] 后端：角色权限管理 API
- [ ] 后端：角色专家访问权限 API
- [ ] 前端：角色管理 Tab 布局（左右结构）
- [ ] 前端：角色列表组件
- [ ] 前端：权限配置 Tab（树形复选框）
- [ ] 前端：专家访问权限 Tab
- [ ] 前端：角色编辑 Modal
- [ ] i18n：添加相关翻译

---

*状态：⏳ 待开始*