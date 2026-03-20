# Task #237: 统一数据库字符集为 utf8mb4_unicode_ci

## 目标

将数据库所有表和列的字符集统一为 `utf8mb4_unicode_ci`。

## 背景

数据库字符集不一致问题：
- 数据库创建时指定了 `utf8mb4_unicode_ci`
- 但部分表使用了 `utf8mb4_bin` 或其他字符集
- 需要统一所有表和列的字符集

## 完成的工作

### 1. 创建字符集修复脚本

新增 `scripts/fix-charset.js`：
- 自动检测数据库、表、列的字符集
- 禁用外键检查后批量转换
- 验证修复结果

### 2. 执行字符集修复

- 数据库默认字符集：`utf8mb4_bin` → `utf8mb4_unicode_ci` ✅
- 29 个表从 `utf8mb4_bin` 转换为 `utf8mb4_unicode_ci` ✅

### 3. 重新生成数据库模型

执行 `node scripts/generate-models.js`，37 个 Sequelize 模型已更新。

## 相关文件

- `scripts/fix-charset.js` - 字符集修复脚本
- `models/*.js` - 重新生成的 Sequelize 模型

## Issue

Closes #237