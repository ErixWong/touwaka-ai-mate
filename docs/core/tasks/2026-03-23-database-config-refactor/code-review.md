# 代码审计报告 - 数据库配置重构

## 变更概述

移除 `config/database.json` 和 `models/index.js`，统一从环境变量读取数据库配置。

## 审计结果

### ✅ 通过项

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 删除冗余代码 | ✅ | 移除了 `models/index.js` 中独立的 Sequelize 实例 |
| 配置统一 | ✅ | 所有数据库配置统一从环境变量读取 |
| 错误处理 | ✅ | 必填字段缺失时抛出明确错误 |
| 代码复用 | ✅ | `role.controller.js` 改用 `ctx.db.getModel()` |

### ⚠️ 需要注意

| 文件 | 问题 | 建议 |
|------|------|------|
| `server/index.js` | 调试日志会打印敏感信息 | 生产环境应移除或脱敏 |
| `tests/*.js` | 测试脚本需要 `.env` 文件 | 文档说明 |

### 🔍 详细分析

#### 1. `server/index.js` 变更

**变更前：**
```javascript
// 从 config/database.json 读取配置模板
const configPath = path.join(__dirname, '..', 'config', 'database.json');
const content = fs.readFileSync(configPath, 'utf-8');
const config = JSON.parse(content);
return this.resolveEnvVars(config);
```

**变更后：**
```javascript
// 直接从环境变量读取
const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`数据库配置缺失: ${missing.join(', ')}`);
}
return {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionLimit: 10,
};
```

**评估：** ✅ 更简洁，错误信息更明确

#### 2. `server/controllers/role.controller.js` 变更

**变更前：**
```javascript
import { models } from '../../models/index.js';
const { role, permission, role_permission, role_expert, expert } = models;
```

**变更后：**
```javascript
// 在每个函数内部获取模型
const role = ctx.db.getModel('role');
const permission = ctx.db.getModel('permission');
const expert = ctx.db.getModel('expert');
```

**评估：** ✅ 避免了独立的数据库连接，与其他 Controller 保持一致

#### 3. 测试脚本变更

`tests/check-tool-usage.js`、`scripts/check-kb.js`、`tests/tool-test.mjs` 都添加了必填字段验证：

```javascript
const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`数据库配置缺失: ${missing.join(', ')}`);
  process.exit(1);
}
```

**评估：** ✅ 统一的错误处理方式

### 🐛 发现的问题

#### 问题 1：调试日志泄露敏感信息

**位置：** `server/index.js` 第 25-33 行

```javascript
console.log('DB_HOST:', process.env.DB_HOST || '(not set)');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '******' : '(not set)');
```

**风险：** 生产环境中 `DB_HOST` 可能包含内网地址

**建议：** 生产环境移除调试日志，或使用 `logger.debug()` 级别

### 📋 测试建议

1. **本地测试：** 删除 `.env` 文件，验证程序是否正确报错
2. **Docker 测试：** 验证环境变量正确传递
3. **1Panel 测试：** 验证 1Panel 环境变量配置生效

## 结论

**审计通过** ✅

变更简化了配置管理，消除了冗余代码，错误处理更加明确。建议在生产环境移除调试日志。