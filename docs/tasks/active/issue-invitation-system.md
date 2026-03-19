# Issue #222: feat: 用户邀请注册功能

**GitHub Issue**: https://github.com/ErixWong/touwaka-ai-mate/issues/222

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

### 1. 数据库设计

#### 修改 `user` 表 - 添加邀请配额字段

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
  expires_at DATETIME DEFAULT NULL COMMENT '过期时间，NULL表示永不过期',
  status ENUM('active', 'exhausted', 'expired', 'revoked') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_code (code),
  INDEX idx_creator (creator_id),
  INDEX idx_status (status),
  FOREIGN KEY (creator_id) REFERENCES user(id)
);
```

#### 新增 `invitation_usage` 表

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

#### 系统配置新增

**存储位置**：`system_settings` 表（已存在的系统配置表）

**配置项**：

| setting_key | setting_value | value_type | description |
|-------------|---------------|------------|-------------|
| registration.allow_self_registration | false | boolean | 是否允许自主注册（无需邀请码） |
| registration.default_invitation_quota | 1 | number | 用户默认可生成的邀请码数量 |
| registration.default_invitation_max_uses | 5 | number | 每个邀请码默认可邀请人数 |
| registration.invitation_expiry_days | 0 | number | 邀请码默认有效天数（0表示永久） |

**实现方式**：

1. **数据库迁移**：在 `scripts/upgrade-database.js` 的 `MIGRATIONS` 数组中添加迁移项，插入默认配置：

```javascript
// 在 MIGRATIONS 数组末尾添加
{
  name: 'registration settings',
  check: async (conn) => {
    const [rows] = await conn.execute(
      `SELECT setting_key FROM system_settings WHERE setting_key = 'registration.allow_self_registration'`
    );
    return rows.length > 0;
  },
  migrate: async (conn) => {
    const settings = [
      { key: 'registration.allow_self_registration', value: 'false', type: 'boolean', desc: '是否允许自主注册' },
      { key: 'registration.default_invitation_quota', value: '1', type: 'number', desc: '用户默认可生成的邀请码数量' },
      { key: 'registration.default_invitation_max_uses', value: '5', type: 'number', desc: '每个邀请码默认可邀请人数' },
      { key: 'registration.invitation_expiry_days', value: '0', type: 'number', desc: '邀请码默认有效天数（0=永久）' },
    ];
    for (const s of settings) {
      await conn.execute(
        `INSERT IGNORE INTO system_settings (setting_key, setting_value, value_type, description) VALUES (?, ?, ?, ?)`,
        [s.key, s.value, s.type, s.desc]
      );
    }
  }
}
```

2. **服务层**：在 `server/services/system-setting.service.js` 的 `DEFAULT_SETTINGS` 中添加：

```javascript
const DEFAULT_SETTINGS = {
  // ... 现有配置 ...
  registration: {
    allow_self_registration: { value: false, type: 'boolean', description: '是否允许自主注册' },
    default_invitation_quota: { value: 1, type: 'number', description: '用户默认可生成的邀请码数量' },
    default_invitation_max_uses: { value: 5, type: 'number', description: '每个邀请码默认可邀请人数' },
    invitation_expiry_days: { value: 0, type: 'number', description: '邀请码默认有效天数（0=永久）' },
  },
};
```

3. **便捷方法**：在 `SystemSettingService` 类中添加：

```javascript
/**
 * 获取注册配置
 */
async getRegistrationConfig() {
  const settings = await this.getAllSettings();
  return settings.registration || {
    allow_self_registration: false,
    default_invitation_quota: 1,
    default_invitation_max_uses: 5,
    invitation_expiry_days: 0,
  };
}
```

### 2. API 设计

#### 用户端 API

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/invitations/quota` | 获取我的邀请配额 | 登录用户 |
| POST | `/api/invitations` | 创建邀请码 | 登录用户 |
| GET | `/api/invitations` | 获取我的邀请码列表 | 登录用户 |
| GET | `/api/invitations/:id/usage` | 获取邀请使用记录 | 邀请创建者 |
| DELETE | `/api/invitations/:id` | 撤销邀请码 | 邀请创建者 |

#### 公开 API

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| GET | `/api/invitations/:code/verify` | 验证邀请码 | 公开 |
| POST | `/api/auth/register` | 用户注册 | 公开 |
| GET | `/api/auth/registration-config` | 获取注册配置 | 公开 |

#### 管理员 API

| 方法 | 路径 | 描述 | 权限 |
|------|------|------|------|
| PUT | `/api/users/:id/invitation-quota` | 修改用户邀请配额 | 管理员 |

### 3. API 响应示例

#### GET `/api/invitations/quota` - 获取邀请配额

```json
{
  "success": true,
  "data": {
    "quota": 1,           // 可生成的邀请码总数
    "used": 0,            // 已生成的邀请码数量
    "remaining": 1        // 剩余可生成的数量
  }
}
```

#### GET `/api/invitations` - 获取邀请码列表

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 1,
        "code": "ABCD1234EFGH5678",
        "inviteLink": "https://example.com/register?code=ABCD1234EFGH5678",
        "maxUses": 5,
        "usedCount": 2,
        "remaining": 3,
        "status": "active",
        "expiresAt": null,
        "createdAt": "2026-03-19T10:00:00Z"
      }
    ],
    "total": 1
  }
}
```

#### GET `/api/invitations/:id/usage` - 获取邀请使用记录

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "userId": "u_abc123",
        "username": "newuser1",
        "usedAt": "2026-03-19T12:00:00Z"
      },
      {
        "userId": "u_def456",
        "username": "newuser2",
        "usedAt": "2026-03-19T13:00:00Z"
      }
    ],
    "total": 2
  }
}
```

#### GET `/api/invitations/:code/verify` - 验证邀请码

```json
{
  "success": true,
  "data": {
    "valid": true,
    "code": "ABCD1234EFGH5678",
    "remaining": 3,
    "expiresAt": null
  }
}
```

#### POST `/api/auth/register` - 注册请求

```json
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "password123",
  "invitation_code": "ABCD1234EFGH5678"
}
```

### 4. 前端设计

#### 用户邀请管理页面 `/settings/invitations`

```
┌─────────────────────────────────────────────────────────────┐
│  邀请管理                                                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📊 邀请配额                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  可生成邀请码：1 个  │  已生成：0 个  │  剩余：1 个    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  [+ 生成邀请码]  (按钮，剩余为0时禁用)                         │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  📋 我的邀请码                                                │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 邀请码        │ 状态   │ 已用/上限 │ 过期时间 │ 操作  │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ ABCD...5678   │ 有效   │ 2/5      │ 永久    │ [撤销] │    │
│  │               │        │          │         │ [复制] │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  👥 邀请记录                                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 用户名      │ 注册时间        │ 邀请码              │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ newuser1   │ 2026-03-19 12:00 │ ABCD...5678        │    │
│  │ newuser2   │ 2026-03-19 13:00 │ ABCD...5678        │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 注册页面 `/register?code=ABCD1234EFGH5678`

```
┌─────────────────────────────────────────────────────────────┐
│  注册                                                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  邀请码: [ABCD1234EFGH5678    ]  (从URL自动填充，可修改)       │
│                                                              │
│  用户名: [________________]                                  │
│                                                              │
│  邮箱:   [________________]                                  │
│                                                              │
│  密码:   [________________]                                  │
│                                                              │
│  确认密码: [________________]                                │
│                                                              │
│  [注册]                                                      │
│                                                              │
│  已有账户？[登录]                                             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 管理员 - 用户管理页面增强

在用户编辑弹窗中添加：

```
┌─────────────────────────────────────────────────────────────┐
│  编辑用户                                                    │
├─────────────────────────────────────────────────────────────┤
│  ...                                                         │
│  邀请配额: [1     ] (可生成的邀请码数量)                       │
│  ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

#### 管理员 - 系统设置页面增强

```
┌─────────────────────────────────────────────────────────────┐
│  注册设置                                                    │
├─────────────────────────────────────────────────────────────┤
│  □ 允许自主注册（无需邀请码）                                  │
│                                                              │
│  默认邀请配额: [1     ] (每个用户可生成的邀请码数量)            │
│                                                              │
│  默认邀请次数: [5     ] (每个邀请码可邀请的人数)                │
│                                                              │
│  邀请码有效期: [0     ] 天 (0表示永久)                         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 5. 业务逻辑

#### 生成邀请码

```
1. 检查用户邀请配额
   - 已生成数量 < 配额 → 允许生成
   - 已生成数量 >= 配额 → 拒绝，提示"已达邀请码上限"

2. 生成邀请码
   - 生成16位随机字符串
   - 设置 max_uses = 系统默认值
   - 设置 expires_at = 根据系统配置计算

3. 返回邀请链接
   - 格式: {baseUrl}/register?code={code}
```

#### 使用邀请码注册

```
1. 验证邀请码
   - 邀请码存在且状态为 active
   - used_count < max_uses
   - 未过期（expires_at 为空或大于当前时间）

2. 创建用户
   - 创建用户记录
   - 设置 invited_by = invitation.id

3. 更新邀请码
   - used_count += 1
   - 如果 used_count >= max_uses，更新 status = 'exhausted'

4. 记录使用
   - 在 invitation_usage 表插入记录
```

### 6. 实现步骤

#### Phase 1: 数据库迁移
1. 修改 `user` 表，添加 `invitation_quota` 和 `invited_by` 字段
2. 创建 `invitation` 表
3. 创建 `invitation_usage` 表
4. 添加系统配置默认值

#### Phase 2: 后端实现
1. 修改 `system-setting.service.js` 添加注册配置
2. 创建 `invitation.controller.js`
3. 创建 `invitation.routes.js`
4. 修改 `auth.controller.js` 添加注册功能
5. 修改 `user.controller.js` 添加配额管理

#### Phase 3: 前端实现
1. 创建邀请管理页面
2. 创建注册页面
3. 修改登录页面
4. 修改系统设置页面
5. 修改用户管理页面

---

## 验收标准

### 管理员
- [ ] 可以在系统设置中配置注册相关参数
- [ ] 可以针对特定用户调整邀请配额
- [ ] 可以查看全局邀请统计

### 普通用户
- [ ] 可以查看自己的邀请配额
- [ ] 可以生成邀请码（在配额内）
- [ ] 可以查看邀请码列表和状态
- [ ] 可以查看每个邀请码的使用记录
- [ ] 可以复制邀请链接
- [ ] 可以撤销未用完的邀请码

### 新用户
- [ ] 可以通过邀请链接进入注册页面
- [ ] 邀请码自动填充到注册表单
- [ ] 可以手动输入邀请码
- [ ] 注册成功后邀请关系被正确记录

---

## 相关文件

### 后端
- `server/controllers/auth.controller.js` - 添加注册功能
- `server/controllers/invitation.controller.js` - 新建
- `server/controllers/user.controller.js` - 添加配额管理
- `server/routes/auth.routes.js` - 添加注册路由
- `server/routes/invitation.routes.js` - 新建
- `server/services/system-setting.service.js` - 添加注册配置

### 数据库
- `scripts/upgrade-database.js` - 数据库迁移

### 前端
- `frontend/src/views/RegisterView.vue` - 新建注册页面
- `frontend/src/views/InvitationView.vue` - 新建邀请管理页面
- `frontend/src/views/SettingsView.vue` - 添加注册配置
- `frontend/src/views/UserManageView.vue` - 添加配额编辑
- `frontend/src/api/invitation.ts` - 新建邀请 API