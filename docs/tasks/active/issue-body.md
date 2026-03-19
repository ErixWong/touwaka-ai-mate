## 概述

实现用户邀请注册功能，允许现有用户生成邀请链接，新用户通过邀请链接注册账户。同时提供管理员配置，控制是否允许自主注册。

---

## 用户角色与场景分析

### 1. 管理员视角

**需求**：
- 控制用户增长速度，防止过快增长
- 可以针对特定用户调整邀请权限
- 可以查看全局邀请统计

**控制参数**：
- 每个用户可生成的邀请码数量上限（默认：1个）
- 每个邀请码可邀请的用户数量（默认：5人）
- 是否允许自主注册（默认：关闭）

**管理员操作**：
- 在系统设置中配置全局默认值
- 在用户管理页面，针对特定用户调整邀请配额

### 2. 普通用户视角

**需求**：
- 知道自己还能生成多少个邀请码
- 知道每个邀请码的剩余使用次数
- 查看通过自己邀请码注册的用户列表

**用户操作**：
- 查看邀请配额：`可生成 1 个邀请码，已生成 0 个`
- 生成邀请码：点击按钮生成，复制链接分享
- 查看邀请码列表：每个邀请码的状态、使用次数、剩余次数
- 查看邀请记录：谁通过我的邀请码注册了

### 3. 新用户视角

**需求**：
- 通过邀请链接直接进入注册页面
- 邀请码自动填充，无需手动输入
- 也可以手动输入邀请码

**注册流程**：
1. 点击邀请链接 → 进入注册页面，邀请码已自动填充
2. 填写用户名、邮箱、密码
3. 完成注册

---

## 技术方案

### 数据库设计

#### 修改 `user` 表

```sql
ALTER TABLE user ADD COLUMN invitation_quota INT DEFAULT 1 COMMENT '可生成的邀请码数量上限';
ALTER TABLE user ADD COLUMN invited_by INT DEFAULT NULL COMMENT '邀请记录ID';
```

#### 新增 `invitation` 表

```sql
CREATE TABLE invitation (
  id INT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL UNIQUE COMMENT '邀请码',
  creator_id VARCHAR(32) NOT NULL COMMENT '创建者用户ID',
  max_uses INT DEFAULT 5 COMMENT '最大使用次数',
  used_count INT DEFAULT 0 COMMENT '已使用次数',
  expires_at DATETIME DEFAULT NULL COMMENT '过期时间',
  status ENUM('active', 'exhausted', 'expired', 'revoked') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 新增 `invitation_usage` 表

```sql
CREATE TABLE invitation_usage (
  id INT PRIMARY KEY AUTO_INCREMENT,
  invitation_id INT NOT NULL,
  user_id VARCHAR(32) NOT NULL,
  used_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 系统配置

| setting_key | default | description |
|-------------|---------|-------------|
| registration.allow_self_registration | false | 是否允许自主注册 |
| registration.default_invitation_quota | 1 | 用户默认可生成的邀请码数量 |
| registration.default_invitation_max_uses | 5 | 每个邀请码默认可邀请人数 |
| registration.invitation_expiry_days | 0 | 邀请码默认有效天数（0=永久） |

### API 设计

#### 用户端 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/invitations/quota` | 获取我的邀请配额 |
| POST | `/api/invitations` | 创建邀请码 |
| GET | `/api/invitations` | 获取我的邀请码列表 |
| GET | `/api/invitations/:id/usage` | 获取邀请使用记录 |
| DELETE | `/api/invitations/:id` | 撤销邀请码 |

#### 公开 API

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/invitations/:code/verify` | 验证邀请码 |
| POST | `/api/auth/register` | 用户注册 |
| GET | `/api/auth/registration-config` | 获取注册配置 |

#### 管理员 API

| 方法 | 路径 | 描述 |
|------|------|------|
| PUT | `/api/users/:id/invitation-quota` | 修改用户邀请配额 |

### 前端设计

#### 用户邀请管理页面 `/settings/invitations`

- 显示邀请配额（可生成/已生成/剩余）
- 生成邀请码按钮（配额用完时禁用）
- 邀请码列表（状态、已用/上限、过期时间、操作）
- 邀请记录（通过该用户邀请码注册的用户列表）

#### 注册页面 `/register?code=xxx`

- 邀请码自动填充（从URL参数）
- 可手动修改邀请码
- 用户名、邮箱、密码表单

#### 管理员增强

- 系统设置：添加注册配置选项
- 用户管理：添加邀请配额编辑

---

## 验收标准

### 管理员
- [ ] 可以在系统设置中配置注册相关参数
- [ ] 可以针对特定用户调整邀请配额

### 普通用户
- [ ] 可以查看自己的邀请配额
- [ ] 可以生成邀请码（在配额内）
- [ ] 可以查看邀请码列表和状态
- [ ] 可以查看每个邀请码的使用记录
- [ ] 可以复制邀请链接

### 新用户
- [ ] 可以通过邀请链接进入注册页面
- [ ] 邀请码自动填充到注册表单
- [ ] 注册成功后邀请关系被正确记录