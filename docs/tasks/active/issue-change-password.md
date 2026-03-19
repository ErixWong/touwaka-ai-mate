# 用户修改密码功能

## 需求描述

当前系统只有管理员重置用户密码的功能，缺少用户自己修改密码的入口。需要在设置页面的「个人资料」Tab 中添加修改密码功能。

## 功能设计

### 后端 API

- **路由**: `PUT /api/users/me/password`
- **权限**: 需要登录，只能修改自己的密码
- **请求参数**:
  - `old_password`: 旧密码（必填）
  - `new_password`: 新密码（必填，至少6位）
- **逻辑**:
  1. 验证旧密码是否正确
  2. 哈希新密码
  3. 更新数据库

### 前端界面

在设置页面「个人资料」Tab 添加修改密码表单：
- 旧密码输入框
- 新密码输入框
- 确认新密码输入框
- 保存按钮

## 技术要点

1. 后端在 `server/routes/user.routes.js` 添加新路由
2. 后端在 `server/controllers/user.controller.js` 添加 `changePassword` 方法
3. 前端在 `frontend/src/views/SettingsView.vue` 的「个人资料」Tab 添加表单
4. 前端在 `frontend/src/api/services.ts` 添加 `changePassword` API

## 验收标准

- [ ] 用户可以在「个人资料」Tab 看到修改密码表单
- [ ] 输入正确的旧密码和新密码后可以成功修改
- [ ] 旧密码错误时显示错误提示
- [ ] 新密码少于6位时显示错误提示
- [ ] 修改成功后显示成功提示