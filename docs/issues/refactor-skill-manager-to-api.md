# Issue: 重构 skill-manager 为 API 调用模式

## 问题背景

当前 `skill-manager` 技能直接访问数据库执行操作，而 `kb-search` 技能采用通过 API 调用后台服务的方式。根据架构设计原则，**业务逻辑应该留在后台服务中**，skill 应该只作为轻量级的调用层。

## 现状对比

### kb-search（推荐模式）

```javascript
// 通过 HTTP API 调用后台服务
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';

async function httpRequest(method, path, data) {
  // 使用用户 Token 认证
  headers: {
    'Authorization': `Bearer ${USER_ACCESS_TOKEN}`,
  }
  // ...
}

// 调用后台 API
async function listMyKnowledgeBases(params) {
  return await httpRequest('GET', `/api/kb?page=${page}&pageSize=${pageSize}`);
}
```

**优点**：
- ✅ 业务逻辑集中在后台服务
- ✅ 使用用户 Token 认证，权限由 API 层统一控制
- ✅ 无需在 skill 中暴露数据库凭证
- ✅ 数据库结构变更不影响 skill 代码
- ✅ 便于审计和日志记录

### skill-manager（当前模式）

```javascript
// 直接连接数据库
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.SKILL_DB_HOST || 'localhost',
  port: parseInt(process.env.SKILL_DB_PORT || '3306'),
  database: process.env.SKILL_DB_NAME || 'touwaka_mate',
  user: process.env.SKILL_DB_USER || 'root',
  password: process.env.SKILL_DB_PASSWORD || '',
};

// 直接执行 SQL
const [skills] = await pool.query('SELECT * FROM skills WHERE ...');
await pool.execute('INSERT INTO skills (...) VALUES (...)');
```

**问题**：
- ❌ 数据库凭证需要注入到沙箱环境（安全风险）
- ❌ 业务逻辑分散在 skill 代码中
- ❌ 数据库结构变更需要同步修改 skill 代码
- ❌ 权限控制逻辑需要在 skill 中重复实现
- ❌ 不便于统一审计

## 改进方案

### 1. 创建后台 API 端点

在 `server/routes/` 和 `server/controllers/` 中添加技能管理 API：

```javascript
// server/routes/skill.js
router.get('/api/skills', authMiddleware, skillController.listSkills);
router.get('/api/skills/:id', authMiddleware, skillController.getSkillDetails);
router.post('/api/skills/register', authMiddleware, skillController.registerSkill);
router.delete('/api/skills/:id', authMiddleware, skillController.deleteSkill);
router.patch('/api/skills/:id/toggle', authMiddleware, skillController.toggleSkill);
```

### 2. 重构 skill-manager/index.js

改为 API 调用模式，参考 kb-search 的实现：

```javascript
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';

async function httpRequest(method, path, data) {
  // ... 与 kb-search 相同的实现
}

async function listSkills(params) {
  const { is_active, search } = params;
  let query = `?`;
  if (is_active !== undefined) query += `is_active=${is_active}&`;
  if (search) query += `search=${encodeURIComponent(search)}&`;
  return await httpRequest('GET', `/api/skills${query}`);
}

async function registerSkill(params) {
  return await httpRequest('POST', '/api/skills/register', params);
}

// ... 其他方法
```

### 3. 权限控制

在 API 层实现权限验证：

```javascript
// 只有管理员或特定角色可以管理技能
async function registerSkill(req, res) {
  if (!req.user.roles.includes('admin')) {
    return res.status(403).json({ error: 'Permission denied' });
  }
  // ...
}
```

## 迁移步骤

1. **创建 API 端点** - 在后台服务中实现技能管理 API
2. **重构 skill-manager** - 改为 API 调用模式
3. **更新环境变量** - 移除 `SKILL_DB_*` 变量，使用 `API_BASE` 和 `USER_ACCESS_TOKEN`
4. **更新 skill_parameters 配置** - 移除数据库参数配置
5. **测试验证** - 确保所有功能正常工作

## 影响范围

- `data/skills/skill-manager/index.js` - 需要完全重写
- `server/routes/skill.js` - 新增路由文件
- `server/controllers/skill.controller.js` - 新增控制器文件
- `skill_parameters` 表 - 需要更新配置

## 优先级

**中等** - 当前实现可以工作，但存在安全隐患和维护成本。建议在下次迭代中处理。

## 相关文档

- [kb-search 实现](../../data/skills/kb-search/index.js) - API 调用模式参考
- [skill-manager 当前实现](../../data/skills/skill-manager/index.js) - 待重构
- [知识库技能拆分 Issue](./split-knowledge-base-skill.md) - 类似的重构工作

---

*创建时间: 2026-03-07*
*状态: 待处理*
