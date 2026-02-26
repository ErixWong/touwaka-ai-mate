# 设置界面用户管理

> 创建日期：2026-02-26

## 需求描述

在设置界面添加「用户管理」功能模块。

## 功能要求

### 布局结构

1. **上部：搜索过滤区**
   - 使用 filter 组件帮助搜索用户
   - 支持按用户名、邮箱、昵称等字段筛选

2. **下部：用户列表区**
   - 使用 list 显示用户清单
   - 每行末尾显示「编辑」按钮
   - 点击编辑按钮弹出 Modal 以编辑用户信息

3. **头部操作区**
   - 「添加用户」按钮

### 用户信息字段

#### 可编辑字段
| 字段 | 类型 | 说明 |
|------|------|------|
| username | string | 用户名 |
| email | string | 邮箱 |
| nickname | string | 昵称 |
| avatar | string | 头像（支持上传） |
| gender | string | 性别：male/female/other |
| birthday | date | 生日 |
| occupation | string | 职业 |
| location | string | 所在地 |
| status | enum | 状态：active/inactive/banned |

#### 只读字段
- id
- preferences
- last_login
- created_at
- updated_at

### 特殊功能

1. **头像上传**：支持修改用户头像（Base64 存储，参考专家头像实现）
2. **重置密码**：编辑 Modal 中提供「重置密码」功能
3. **新增用户**：支持添加新用户
4. **删除用户**：支持删除用户

### 数据库变更

用户头像采用 Base64 存储方案（与专家头像一致）。

**字段说明：**
- `avatar` (TEXT): 存储压缩后的 Base64 头像数据
- 压缩规格：128×128，质量 80%，限制 100KB（实际约 5-15KB）
- 复用 [`frontend/src/utils/imageCompress.ts`](../../frontend/src/utils/imageCompress.ts) 中的 `compressSmallAvatar()` 方法

#### 升级 SQL（现有数据库）

```sql
-- 修改 avatar 字段类型为 TEXT（支持 Base64 存储）
ALTER TABLE users MODIFY COLUMN avatar TEXT NULL 
COMMENT '用户头像Base64（约5-15KB）';
```

#### 初始化脚本

[`scripts/init-database.js`](../../scripts/init-database.js) 中 `users` 表定义已包含 `avatar TEXT` 字段，新安装无需额外操作。

## 技术方案

### 前端组件

- 位置：`frontend/src/views/SettingsView.vue` 新增 Tab
- 复用现有组件样式：panel-header、pagination、dialog

### 后端 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/users | 获取用户列表（支持分页、搜索） |
| POST | /api/users | 创建新用户 |
| PUT | /api/users/:id | 更新用户信息 |
| DELETE | /api/users/:id | 删除用户 |
| POST | /api/users/:id/reset-password | 重置用户密码 |

## 进度

- [x] 后端：用户列表 API
- [x] 后端：创建用户 API
- [x] 后端：更新用户 API
- [x] 后端：删除用户 API
- [x] 后端：重置密码 API
- [x] 后端：角色列表 API
- [x] 后端：更新用户角色 API
- [x] 前端：用户管理 Tab 布局
- [x] 前端：用户搜索过滤功能
- [x] 前端：用户列表展示
- [x] 前端：用户编辑 Modal（含头像上传、重置密码）
- [x] 前端：新增用户功能
- [x] 前端：删除用户功能
- [x] 前端：角色选择功能
- [x] i18n：添加相关翻译

---

*状态：✅ 已完成*
