# 代码审计报告：Embedding 功能

**审计日期**: 2026-03-23  
**审计范围**: 移除本地 embedding 后的代码质量检查  
**相关 Issue**: #344

---

## 1. 代码质量审计

### 1.1 lib/embedding-worker.js

#### ✅ 正面评价

1. **清晰的代码结构** - 函数职责单一，注释完整
2. **良好的错误处理** - 每个关键步骤都有 try-catch 和日志记录
3. **合理的缓存机制** - tokenizer 懒加载并缓存

#### ⚠️ 问题发现

| 严重程度 | 问题 | 位置 | 状态 |
|---------|------|------|------|
| 🔴 高 | **维度调整后未使用调整后的数据** | line 259-273 | ✅ 已修复 |
| 🟡 中 | **未使用的变量 maxRetries** | line 115 | ✅ 已修复 |
| 🟡 中 | **未使用的导入 Utils** | line 17 | ✅ 已修复 |
| 🟡 中 | **embedding_dim 默认值不一致** | line 255 | ✅ 已修复 |
|  低 | **SQL 拼接** | line 322 | 可接受（batchSize 是内部常量） |

**Bug 详情 - 维度调整无效（已修复）：**

```javascript
// 原代码问题：
if (vectorDim !== expectedDim) {
  // ...计算 adjustedEmbedding
  const adjustedBuffer = toVectorBuffer(adjustedEmbedding);
  if (adjustedBuffer) {
    logger.info(`[EmbeddingTask] Adjusted vector dimension...`);
  }
}
// 问题：仍使用原始 vectorBuffer！
const hexString = vectorBuffer.toString('hex');

// 修复后：
let finalBuffer = vectorBuffer;
if (vectorDim !== expectedDim) {
  // ...计算 adjustedEmbedding
  const adjustedBuffer = toVectorBuffer(adjustedEmbedding);
  if (adjustedBuffer) {
    finalBuffer = adjustedBuffer;
  }
}
const hexString = finalBuffer.toString('hex');
```

---

### 1.2 server/controllers/kb.controller.js

#### ✅ 正面评价

1. **完整的 CRUD 实现** - 知识库、文章、节、段落、标签管理完善
2. **良好的事务处理** - `_setArticleTags` 使用事务保证数据一致性
3. **合理的权限验证** - 每个操作都验证资源归属

#### ⚠️ 问题发现

| 严重程度 | 问题 | 位置 | 状态 |
|---------|------|------|------|
| 🔴 高 | **SQL 注入风险 (article_id)** | line 1166-1168 | ✅ 已修复 |
| 🔴 高 | **SQL 注入风险 (queryEmbedding)** | line 1177, 1273 | ✅ 已修复 |
| 🔴 高 | **向量数据存储格式不一致** | line 1620-1622 | ✅ 已修复 |
| 🟡 中 | **embedding_dim 默认值不一致** | line 1549, 1556 | ✅ 已修复 |

**Bug 详情 - SQL 注入风险（已修复）：**

```javascript
// 原代码问题：
const articleFilter = article_id 
  ? `AND s.article_id = '${article_id}'`  // 危险！直接拼接
  : '';

// 修复后（使用参数化查询）：
const articleFilter = article_id
  ? 'AND s.article_id = ?'
  : '';
const replacements = article_id
  ? [kb_id, article_id, top_k]
  : [kb_id, top_k];
// ... query with replacements: [JSON.stringify(queryEmbedding), ...replacements]
```

**Bug 详情 - 向量存储格式不一致（已修复）：**

```javascript
// 原代码问题 - kb.controller.js 使用 JSON：
await this.KbParagraph.update(
  { embedding: JSON.stringify(embedding) },
  { where: { id: paragraph.id } }
);

// 修复后 - 使用二进制格式（与 embedding-worker.js 一致）：
const vectorBuffer = this._toVectorBuffer(finalEmbedding);
const hexString = vectorBuffer.toString('hex');
await this.db.sequelize.query(
  `UPDATE kb_paragraphs SET embedding = X'${hexString}' WHERE id = ?`,
  { replacements: [paragraph.id], type: this.db.sequelize.QueryTypes.UPDATE }
);
```

---

## 2. 架构设计审计

### 2.1 配置管理

| 项目 | 状态 | 说明 |
|------|------|------|
| API 配置来源 | ✅ 正确 | 从数据库 `ai_models` + `providers` 表获取 |
| 错误处理 | ✅ 正确 | 未配置时记录警告并返回 null |
| 日志记录 | ✅ 正确 | 关键操作都有日志 |

### 2.2 依赖关系

```
embedding-worker.js
  └── tiktoken (token 计数)
  └── sequelize (数据库)
  └── 远程 Embedding API

kb.controller.js
  └── sequelize (数据库)
  └── 远程 Embedding API
```

**建议**: 两处代码都有独立的 `_generateEmbedding` 实现，未来可考虑抽取为共享模块 `lib/embedding-service.js`

---

## 3. 修复记录

### ✅ 已修复问题

| 问题 | 修复位置 | 修复方式 |
|------|---------|---------|
| 维度调整 bug | `lib/embedding-worker.js` line 259-276 | 使用 `finalBuffer` 变量保存最终结果 |
| SQL 注入 (article_id) | `kb.controller.js` line 1165-1191 | 参数化查询，使用 `?` 占位符 |
| SQL 注入 (queryEmbedding) | `kb.controller.js` line 1269-1287 | 参数化查询，使用 `replacements` 数组 |
| 向量存储格式不一致 | `kb.controller.js` line 1605-1670 | 添加 `_toVectorBuffer` 方法，使用二进制格式 |
| 未使用的变量 `maxRetries` | `lib/embedding-worker.js` line 115 | 移除变量定义和 JSDoc 注释 |
| 未使用的导入 `Utils` | `lib/embedding-worker.js` line 17 | 移除导入语句 |
| embedding_dim 默认值不一致 | 多处 | 统一为 1536（OpenAI text-embedding-3-small 维度） |

---

## 4. 测试建议

1. **单元测试**
   - 测试维度不匹配时的处理逻辑
   - 测试 API 配置缺失时的错误处理

2. **集成测试**
   - 测试完整的向量化流程
   - 测试搜索功能的准确性

3. **边界测试**
   - 测试超大文本的 embedding 生成
   - 测试并发向量化请求

---

## 5. 总结

移除本地 embedding 后，代码审计发现并修复了以下问题：

### 已修复（🔴 高优先级）

1. **维度调整 bug** - embedding-worker.js 中调整后的向量现在被正确使用
2. **SQL 注入风险** - kb.controller.js 中的参数化查询已修复
3. **向量存储格式不一致** - revectorize 现在使用与 worker 相同的二进制格式

### 已修复（🟡 中优先级）

1. **未使用的变量和导入** - 已移除 `maxRetries` 和 `Utils`
2. **embedding_dim 默认值不一致** - 统一为 1536

所有问题已修复，代码可以合并。