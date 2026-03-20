## 问题描述

用户名最小长度需要从3位改为6位。

## 修改内容

修改正则表达式从 `/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/` 改为 `/^[a-zA-Z][a-zA-Z0-9_]{5,31}$/`

- 字母开头
- 仅允许字母、数字、下划线
- 长度 6-32 位

## 修改文件

- server/controllers/auth.controller.js
- server/controllers/user.controller.js
- frontend/src/views/RegisterView.vue
- frontend/src/i18n/locales/zh-CN.ts
- frontend/src/i18n/locales/en-US.ts