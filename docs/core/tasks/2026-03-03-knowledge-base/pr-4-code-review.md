# PR #4 代码审计报告

**审计日期**: 2026-03-06
**审计范围**: Knowledge Base 功能 (PR #4)
**代码变更**: +10,378 行 / -155 行, 52 个文件
**更新**: 2026-03-06 20:58 - 新增提交 `6978502` 修复部分问题

---

## 1. 审计概要

### 1.1 功能概述
PR #4 实现了完整的知识库系统 (Knowledge Base)，包括：
- 知识库 CRUD 操作
- 文章树状结构管理
- 知识点向量化存储
- 语义搜索 (RAG)
- 本地嵌入模型支持 (BGE-M3)

### 1.2 风险评级 (更新后)

| 类别 | 风险等级 | 问题数量 | 状态 |
|------|----------|----------|------|
| 🔴 高危 | 2 | 1 | 1 已修复 |
| 🟠 中危 | 3 | 3 | 1 已修复 |
| 🟡 低危 | 2 | 3 | - |
| 🔵 建议 | 1 | 5 | - |

---

## 2. 高危问题 🔴

### 2.1 SQL 注入风险 - `toVectorSQL` 函数

**文件**: `server/controllers/knowledge-base.controller.js`
**位置**: 第 24-30 行

```javascript
function toVectorSQL(embedding) {
  if (!Array.isArray(embedding)) return null;
  const jsonStr = JSON.stringify(embedding);
  return `VEC_FromText('${jsonStr}')`;  // ⚠️ 直接拼接 SQL
}
```

**问题**: 虽然当前代码中 `embedding` 是由系统生成的数组，但直接字符串拼接 SQL 存在潜在注入风险。

**建议修复**:
```javascript
function toVectorSQL(embedding) {
  if (!Array.isArray(embedding)) return null;
  // 验证所有元素都是数字
  if (!embedding.every(n => typeof n === 'number' && isFinite(n))) {
    throw new Error('Invalid embedding data');
  }
  const jsonStr = JSON.stringify(embedding);
  return `VEC_FromText('${jsonStr}')`;
}
```

### 2.2 内部 API 认证密钥硬编码

**文件**: `server/middlewares/auth.js`, `data/skills/knowledge-base/index.js`

```javascript
// auth.js
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'internal-api-secret';

// index.js
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'internal-api-secret';
```

**问题**: 默认密钥硬编码在代码中，如果用户未配置环境变量，系统将使用弱密钥。

**建议修复**:
- 移除默认值，强制要求配置
- 或在启动时检查并发出警告

```javascript
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET;
if (!INTERNAL_SECRET) {
  logger.warn('[Security] INTERNAL_API_SECRET not set, internal API disabled');
}
```

---

## ✅ 已修复问题 (提交 6978502)

### ✅ userId 类型处理问题已修复

**文件**: `server/middlewares/auth.js`

**原问题**: 内部认证时对 userId 进行 parseInt 处理，可能导致 UUID类型 ID 被错误转换。

**修复内容**:
```javascript
// 修复前
const parsedUserId = parseInt(internalUserId, 10);
ctx.state.userId = isNaN(parsedUserId) ? internalUserId : parsedUserId;

// 修复后
ctx.state.userId = internalUserId;  // 直接使用字符串
```

### ✅ 嵌入模型已更新为 BGE-M3

**文件**: `lib/local-embedding.js`

**更新内容**:
- 模型从 `all-MiniLM-L6-v2` (384维) 升级为 `BGE-M3` (1024维)
- 更好的中英文双语支持

---

## 3. 中危问题 🟠

### 3.1 递归状态更新可能导致栈溢出

**文件**: `server/controllers/knowledge-base.controller.js`
**函数**: `updateKnowledgeStatusRecursively`

```javascript
async updateKnowledgeStatusRecursively(knowledgeId, isChildUpdate = false) {
  // ... 状态计算逻辑 ...
  
  // 递归更新父节点
  const knowledge = await this.Knowledge.findByPk(knowledgeId, { ... });
  if (knowledge?.parent_id) {
    await this.updateKnowledgeStatusRecursively(knowledge.parent_id, true);  // ⚠️ 无限递归风险
  }
}
```

**问题**: 深层树结构可能导致栈溢出；循环引用（数据损坏）会导致无限递归。

**建议修复**:
```javascript
async updateKnowledgeStatusRecursively(knowledgeId, isChildUpdate = false, visited = new Set()) {
  // 防止循环引用
  if (visited.has(knowledgeId)) {
    logger.warn(`[KB] Circular reference detected at ${knowledgeId}`);
    return;
  }
  visited.add(knowledgeId);
  
  // 限制递归深度
  if (visited.size > 100) {
    logger.warn('[KB] Max recursion depth reached');
    return;
  }
  
  // ... 其余逻辑 ...
}
```

### 3.2 RAG 服务中存在同步 JSON 解析

**文件**: `lib/rag-service.js`
**函数**: `vectorSearch`

```javascript
for (const point of points) {
  try {
    const embedding = JSON.parse(point.embedding.toString());  // ⚠️ 同步解析
    // ...
  } catch (error) {
    // 跳过解析失败的向量
  }
}
```

**问题**: 大量知识点时，同步解析会阻塞事件循环。

**建议修复**: 使用控制器中已有的 `parseEmbedding` 函数，它已经处理了 Buffer 格式。

### 3.3 控制器中存在未使用的导入

**文件**: `server/controllers/knowledge-base.controller.js`

```javascript
import { Op, DataTypes } from 'sequelize';  // DataTypes 未使用
```

### 3.4 技能文件中的 console.log 调试语句

**文件**: `data/skills/knowledge-base/index.js`

```javascript
function getUserId(context) {
  console.log('[KB Skill] Context:', JSON.stringify(context));  // ⚠️ 调试日志
  console.log('[KB Skill] userId:', context?.userId, 'user_id:', context?.user_id);
  return context.userId || context.user_id;
}
```

**问题**: 生产代码中不应包含 console.log，可能泄露敏感信息。

**建议修复**: 移除或使用 logger。

---

## 4. 低危问题 🟡

### 4.1 缺少输入验证

**文件**: `server/controllers/knowledge-base.controller.js`

多处缺少对 `id` 参数格式的验证：

```javascript
async getKb(ctx) {
  const { id } = ctx.params;  // 未验证 id 格式
  const kb = await this.KnowledgeBase.findOne({ ... });
}
```

**建议**: 添加 ID 格式验证工具函数。

### 4.2 魔法数字

```javascript
const DIMENSION = 1024;  // local-embedding.js
const defaultThreshold = 0.7;  // rag-service.js
const defaultThreshold = 0.1;  // controller (不一致!)
```

**问题**: 阈值在不同文件中不一致，应统一配置。

### 4.3 错误处理不一致

部分函数返回 `null`，部分抛出异常，部分返回 `{ success: false }`。

---

## 5. 代码质量建议 🔵

### 5.1 类型定义
建议为 TypeScript 迁移添加 JSDoc 类型注释：

```javascript
/**
 * @typedef {Object} KnowledgeBase
 * @property {string} id
 * @property {string} name
 * @property {string} owner_id
 * @property {string} [embedding_model_id]
 * @property {number} [embedding_dim]
 */
```

### 5.2 测试覆盖
当前 PR 缺少单元测试，建议添加：
- `parseEmbedding` 函数测试
- `cosineSimilarity` 函数测试
- API 端点集成测试

### 5.3 文档完善
- 添加 API 文档 (OpenAPI/Swagger)
- 补充数据库迁移说明

### 5.4 性能优化
- 考虑批量向量搜索使用数据库原生向量索引
- 添加分页缓存

### 5.5 国际化
错误消息硬编码中文，建议使用 i18n：

```javascript
ctx.error('知识库不存在或无权限', 404);
// 改为
ctx.error(i18n.t('kb.notFound'), 404);
```

---

## 6. 安全检查清单

| 检查项 | 状态 | 备注 |
|--------|------|------|
| SQL 注入防护 | ⚠️ | `toVectorSQL` 需加强 |
| XSS 防护 | ✅ | Vue 自动转义 |
| CSRF 防护 | ✅ | 使用 JWT |
| 认证机制 | ⚠️ | 内部 API 密钥需强化 |
| 授权检查 | ✅ | owner_id 验证 |
| 输入验证 | ⚠️ | 部分缺少 |
| 敏感数据保护 | ✅ | 向量数据不暴露 |
| 错误信息泄露 | ⚠️ | 部分错误包含堆栈 |

---

## 7. 结论

### 7.1 总体评价
PR #4 实现了功能完整的知识库系统，代码结构清晰，但存在一些安全和稳定性问题需要在合并前修复。

### 7.2 合并建议
**建议**: 有条件合并

**合并前必须修复**:
1. ✅ SQL 注入风险 - `toVectorSQL` 添加验证
2. ✅ 移除 console.log 调试语句
3. ✅ 递归深度限制

**可后续修复**:
- 统一阈值配置
- 添加单元测试
- 国际化支持

---

## 8. 审计签名

**审计人**: Kilo Code
**审计日期**: 2026-03-06
**PR 链接**: https://github.com/ErixWong/touwaka-ai-mate/pull/4
