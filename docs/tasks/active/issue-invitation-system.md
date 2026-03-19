# Issue #222: feat: 用户邀请注册功能

**GitHub Issue**: https://github.com/ErixWong/touwaka-ai-mate/issues/222

## 概述

实现用户邀请注册功能，允许现有用户生成邀请链接，新用户通过邀请链接注册账户。同时提供管理员配置，控制是否允许自主注册。

## 需求分析

### 核心需求
1. **邀请码生成**：用户可以生成邀请链接/邀请码
2. **邀请注册**：新用户通过邀请链接注册账户
3. **注册控制**：管理员可配置是否允许自主注册（无邀请码）
4. **邀请记录**：记录邀请关系（谁邀请了谁）

### 业务规则
- 默认关闭自主注册，必须通过邀请码注册
- 管理员可以在系统设置中开启自主注册
- 邀请码可以设置有效期和使用次数限制
- 邀请码使用后记录邀请关系

## 技术方案

### 1. 数据库设计

#### 新增 `invitation` 表

```sql
CREATE TABLE invitation (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL UNIQUE COMMENT '邀请码',
  creator_id VARCHAR(32) NOT NULL COMMENT '创建者用户ID',
  max_uses INT DEFAULT NULL COMMENT '最大使用次数，NULL表示无限制',
  used_count INT DEFAULT 0 COMMENT '已使用次数',
  expires_at DATETIME DEFAULT NULL COMMENT '过期时间，NULL表示永不过期',
  status ENUM('active', 'exhausted', 'expired') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_creator (creator_id),
  INDEX idx_status (status)
);
```

#### 新增 `invitation_usage` 表（记录邀请使用记录）

```sql
CREATE TABLE invitation_usage (
  id INT PRIMARY KEY AUTO_INCREMENT,
  invitation_id INT NOT NULL COMMENT '邀请ID',
  user_id VARCHAR(32) NOT NULL COMMENT '注册用户ID',
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invitation_id) REFERENCES invitation(id),
  FOREIGN KEY (user_id) REFERENCES user(id)
);
```

#### 修改 `user` 表

```sql
ALTER TABLE user ADD COLUMN invited_by INT DEFAULT NULL COMMENT '邀请记录ID';
ALTER TABLE user ADD FOREIGN KEY (invited_by) REFERENCES invitation(id);
```

#### 系统配置新增

在 `system_setting` 表中新增配置项：

| setting_key | setting_value | value_type | description |
|-------------|---------------|------------|-------------|
| registration.allow_self_registration | false | boolean | 是否允许自主注册（无需邀请码） |
| registration.invitation_expiry_days | 7 | number | 邀请码默认有效天数（0表示永久） |
| registration.invitation_max_uses | 1 | number | 邀请码默认最大使用次数（0表示无限制） |

### 2. API 设计

#### 邀请相关 API

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/invitations` | 创建邀请码 | 登录用户 |
| GET | `/api/invitations` | 获取我的邀请码列表 | 登录用户 |
| GET | `/api/invitations/:code` | 验证邀请码（公开） | 无 |
| GET | `/api/invitations/:id/usage` | 获取邀请使用记录 | 邀请创建者 |

#### 注册 API

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/auth/register` | 用户注册 | 公开 |
| GET | `/api/auth/registration-config` | 获取注册配置 | 公开 |

#### 注册请求体

```json
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "password123",
  "invitation_code": "ABCD1234"  // 可选，取决于系统配置
}
```

### 3. 前端设计

#### 新增页面
- 邀请管理页面：`/settings/invitations`
- 邀请注册页面：`/register?code=ABCD1234`

#### 修改页面
- 登录页面：添加"注册"链接（根据配置显示）
- 系统设置页面：添加注册配置选项

### 4. 实现步骤

#### Phase 1: 数据库迁移
1. 在 `scripts/upgrade-database.js` 添加迁移脚本
2. 创建 `invitation` 和 `invitation_usage` 表
3. 修改 `user` 表添加 `invited_by` 字段
4. 添加系统配置默认值

#### Phase 2: 后端实现
1. 创建 `Invitation` 模型
2. 创建 `invitation.controller.js`
3. 创建 `invitation.routes.js`
4. 修改 `auth.controller.js` 添加注册功能
5. 修改 `system-setting.service.js` 添加注册配置

#### Phase 3: 前端实现
1. 创建邀请管理组件
2. 创建注册页面
3. 修改登录页面
4. 修改系统设置页面

### 5. 安全考虑

1. **邀请码安全**：使用加密安全的随机字符串（16位以上）
2. **注册限制**：防止批量注册攻击
3. **密码强度**：强制密码复杂度要求
4. **邮箱验证**：可选的邮箱验证流程

## 验收标准

- [ ] 用户可以生成邀请链接
- [ ] 新用户可以通过邀请链接注册
- [ ] 管理员可以配置是否允许自主注册
- [ ] 邀请码有有效期和使用次数限制
- [ ] 邀请关系被正确记录
- [ ] 前端界面友好，操作流畅

## 相关文件

- `server/controllers/auth.controller.js` - 添加注册功能
- `server/controllers/invitation.controller.js` - 新建
- `server/routes/auth.routes.js` - 添加注册路由
- `server/routes/invitation.routes.js` - 新建
- `server/services/system-setting.service.js` - 添加注册配置
- `scripts/upgrade-database.js` - 数据库迁移
- `client/src/views/Register.vue` - 新建注册页面
- `client/src/views/InvitationManage.vue` - 新建邀请管理页面