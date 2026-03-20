## 问题描述

当前用户注册时，用户名（username）没有格式限制，中文和特殊字符都能通过。

## 解决方案

采用方案C：分离 username 和 nickname 的概念

- `username`：登录名，限制格式
  - 字母开头
  - 仅允许字母、数字、下划线
  - 长度 3-32 位
  - 正则：`/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/`
  
- `nickname`：昵称/显示名，允许中文

## 修改范围

- [ ] server/controllers/auth.controller.js - 注册验证
- [ ] server/controllers/user.controller.js - 创建/更新用户验证
- [ ] 前端验证逻辑（如有）

## 影响范围

- 新注册用户需要遵循新规则
- 已有用户不受影响（数据库中已有中文用户名可继续使用）