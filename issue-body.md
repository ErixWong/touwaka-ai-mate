## 问题描述

当前注册是邀请制，邀请用户的数量是写死的。作为管理员，我希望能给自己多生成几个邀请码，以便邀请更多用户。

## 解决方案

利用后端已有的邀请配额管理 API，在前端用户管理界面中暴露这个功能，让管理员可以直接修改任何用户（包括自己）的邀请配额。

## 修改内容

### 1. 后端修复
- 文件：`server/controllers/user.controller.js`
- 修改：在用户列表查询中添加了 `invitation_quota` 字段返回

### 2. 前端 API 层
- 文件：`frontend/src/api/services.ts`
- 添加：`updateInvitationQuota()` 方法调用后端 API

### 3. 用户管理界面
- 文件：`frontend/src/views/SettingsView.vue`
- 添加：
  - 在用户编辑对话框中添加了邀请配额输入字段（仅编辑时显示）
  - 在保存用户时自动更新邀请配额
  - 在用户列表中显示每个用户的邀请配额

### 4. 类型定义
- 文件：`frontend/src/types/index.ts`
- 添加：在 `UserListItem` 接口中添加了 `invitation_quota` 字段

### 5. i18n 翻译
- 文件：`frontend/src/i18n/zh-CN.ts` 和 `frontend/src/i18n/en-US.ts`
- 添加：`invitationQuota` 和 `invitationQuotaHint` 翻译

## 使用方法

1. 管理员进入 **设置 → 用户管理**
2. 点击任意用户（包括自己）的 **编辑** 按钮
3. 在编辑对话框中找到 **邀请配额** 字段
4. 修改配额数值（0-100），保存即可

## 技术细节

- 后端 API `PUT /api/users/:id/invitation-quota` 已存在，用于更新用户邀请配额
- 后端 API `GET /api/users/:id/invitation-stats` 已存在，用于获取邀请统计
- 前端只需暴露这些已有功能即可

## 验收标准

- [ ] 管理员可以在用户编辑对话框中修改邀请配额
- [ ] 修改后的配额立即生效
- [ ] 用户列表中显示每个用户的邀请配额
- [ ] 支持中英文界面
