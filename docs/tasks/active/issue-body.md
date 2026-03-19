## 概述

实现用户邀请注册功能，允许现有用户生成邀请链接，新用户通过邀请链接注册账户。同时提供管理员配置，控制是否允许自主注册。

## 核心需求

1. **邀请码生成**：用户可以生成邀请链接/邀请码
2. **邀请注册**：新用户通过邀请链接注册账户
3. **注册控制**：管理员可配置是否允许自主注册（无邀请码）
4. **邀请记录**：记录邀请关系（谁邀请了谁）

## 业务规则

- 默认关闭自主注册，必须通过邀请码注册
- 管理员可以在系统设置中开启自主注册
- 邀请码可以设置有效期和使用次数限制
- 邀请码使用后记录邀请关系

## 技术方案

### 数据库设计

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
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### 新增 `invitation_usage` 表

```sql
CREATE TABLE invitation_usage (
  id INT PRIMARY KEY AUTO_INCREMENT,
  invitation_id INT NOT NULL COMMENT '邀请ID',
  user_id VARCHAR(32) NOT NULL COMMENT '注册用户ID',
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 修改 `user` 表

```sql
ALTER TABLE user ADD COLUMN invited_by INT DEFAULT NULL COMMENT '邀请记录ID';
```

#### 系统配置新增

| setting_key | default_value | description |
|-------------|---------------|-------------|
| registration.allow_self_registration | false | 是否允许自主注册 |
| registration.invitation_expiry_days | 7 | 邀请码默认有效天数 |
| registration.invitation_max_uses | 1 | 邀请码默认最大使用次数 |

### API 设计

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| POST | `/api/invitations` | 创建邀请码 | 登录用户 |
| GET | `/api/invitations` | 获取我的邀请码列表 | 登录用户 |
| GET | `/api/invitations/:code` | 验证邀请码 | 公开 |
| POST | `/api/auth/register` | 用户注册 | 公开 |
| GET | `/api/auth/registration-config` | 获取注册配置 | 公开 |

### 实现步骤

1. **Phase 1**: 数据库迁移 - 创建表和添加配置
2. **Phase 2**: 后端实现 - Controller、Service、Routes
3. **Phase 3**: 前端实现 - 注册页面、邀请管理页面

## 验收标准

- [ ] 用户可以生成邀请链接
- [ ] 新用户可以通过邀请链接注册
- [ ] 管理员可以配置是否允许自主注册
- [ ] 邀请码有有效期和使用次数限制
- [ ] 邀请关系被正确记录