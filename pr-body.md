## 功能概述

实现用户邀请注册系统，支持管理员控制用户注册方式。

## 实现内容

### 数据库迁移
- `users` 表添加 `invitation_quota` 和 `invited_by` 字段
- 创建 `invitations` 表存储邀请码
- 创建 `invitation_usages` 表记录使用历史
- 添加系统配置默认值（registration 配置组）

### 后端 API
- `POST /api/auth/register` - 用户注册
- `GET /api/auth/registration-config` - 获取注册配置
- `GET /api/invitations` - 获取邀请码列表
- `POST /api/invitations` - 创建邀请码
- `DELETE /api/invitations/:id` - 撤销邀请码
- `GET /api/invitations/quota` - 获取配额信息
- `GET /api/invitations/:id/usage` - 获取使用记录
- `GET /api/invitations/:code/verify` - 验证邀请码（公开）
- `PUT /api/users/:id/invitation-quota` - 设置用户配额（管理员）
- `GET /api/users/:id/invitation-stats` - 获取用户邀请统计

### 前端页面
- `/register` - 注册页面（支持邀请码验证）
- `/invitations` - 邀请管理页面（配额查看、邀请码管理）
- 系统配置页面添加注册配置 Tab

## 测试说明

- [x] 前端构建通过
- [x] 后端模块加载成功
- [x] ESLint 检查通过

Closes #222