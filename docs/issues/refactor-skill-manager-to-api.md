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

## 好消息：后台 API 已存在！

经过分析，后台已经有完整的技能管理 API：

### 现有 API 端点（`server/routes/skill.routes.js`）

| 端点 | 方法 | 功能 | 对应 skill-manager 工具 |
|------|------|------|------------------------|
| `/api/skills` | GET | 获取技能列表 | `list_skills` |
| `/api/skills/:id` | GET | 获取技能详情 | `list_skill_details` |
| `/api/skills/register` | POST | 注册技能 | `register_skill` |
| `/api/skills/:id` | DELETE | 删除技能 | `delete_skill` |
| `/api/skills/:id/toggle` | PATCH | 启用/禁用技能 | `toggle_skill` |
| `/api/skills/assign` | POST | 分配技能给专家 | - |
| `/api/skills/unassign` | POST | 取消技能分配 | - |

### 现有控制器（`server/controllers/skill.controller.js`）

- `list()` - 列出技能
- `get()` - 获取技能详情
- `register()` - 注册技能
- `delete()` - 删除技能
- `toggle()` - 启用/禁用技能
- `assign()` - 分配技能
- `unassign()` - 取消分配

## 改进方案

### 重构 skill-manager/index.js

改为 API 调用模式，参考 kb-search 的实现：

```javascript
const https = require('https');
const http = require('http');

// API 配置（从环境变量获取，由 skill-loader 注入）
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const USER_ACCESS_TOKEN = process.env.USER_ACCESS_TOKEN || '';
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * 发起 HTTP 请求（复用 kb-search 的实现）
 */
function httpRequest(method, path, data) {
  // ... 与 kb-search 相同的实现
}

/**
 * 列出所有技能
 */
async function listSkills(params) {
  const { is_active, search } = params;
  let query = '?';
  if (is_active !== undefined) query += `is_active=${is_active ? 1 : 0}&`;
  if (search) query += `search=${encodeURIComponent(search)}&`;
  return await httpRequest('GET', `/api/skills${query}`);
}

/**
 * 获取技能详情
 */
async function listSkillDetails(params) {
  const { skill_id } = params;
  return await httpRequest('GET', `/api/skills/${skill_id}`);
}

/**
 * 注册技能
 */
async function registerSkill(params) {
  return await httpRequest('POST', '/api/skills/register', params);
}

/**
 * 删除技能
 */
async function deleteSkill(params) {
  const { skill_id } = params;
  return await httpRequest('DELETE', `/api/skills/${skill_id}`);
}

/**
 * 启用/禁用技能
 */
async function toggleSkill(params) {
  const { skill_id, is_active } = params;
  return await httpRequest('PATCH', `/api/skills/${skill_id}/toggle`, { is_active });
}
```

## 迁移步骤

1. ✅ **后台 API 已存在** - 无需新建
2. **重构 skill-manager** - 改为 API 调用模式
3. **更新 SKILL.md** - 移除数据库参数配置说明
4. **更新 skill_parameters 配置** - 移除 `SKILL_DB_*` 参数
5. **测试验证** - 确保所有功能正常工作

## 影响范围

- `data/skills/skill-manager/index.js` - 需要完全重写
- `data/skills/skill-manager/SKILL.md` - 更新配置说明
- `skill_parameters` 表 - 需要更新配置（移除数据库参数）

## 优先级

**高** - 后台 API 已就绪，只需重构 skill 代码即可完成

## 相关文档

- [kb-search 实现](../../data/skills/kb-search/index.js) - API 调用模式参考
- [skill-manager 当前实现](../../data/skills/skill-manager/index.js) - 待重构
- [skill.controller.js](../../server/controllers/skill.controller.js) - 后台 API 控制器
- [skill.routes.js](../../server/routes/skill.routes.js) - 后台 API 路由
- [知识库技能拆分 Issue](./split-knowledge-base-skill.md) - 类似的重构工作

---

*创建时间: 2026-03-07*
*状态: 待处理*
*更新时间: 2026-03-07 - 发现后台 API 已存在，简化了迁移工作*
