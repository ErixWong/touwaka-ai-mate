# 知识库向量存储升级日志

## 2026-03-06

### 升级内容

#### 1. MariaDB 升级
- 从 MariaDB 10.11 升级到 **11.7.2**
- 支持原生 VECTOR 类型

#### 2. 向量字段类型变更
- **models/knowledge_point.js**: embedding 字段从 `BLOB` 改为 `VECTOR(1024)`
- 向量维度: 1024 (由 bge-m3 模型生成)

#### 3. 代码适配
- **server/controllers/knowledge-base.controller.js**:
  - 新增 `toVectorSQL()` 函数，使用 `VEC_FromText()` 转换向量
  - 更新向量存储逻辑（创建、更新、批量向量化）
  - 新增 `updateKnowledgeStatusRecursively()` 方法递归更新文章状态
  - 修复状态统计查询：`LENGTH(embedding) > 0` → `embedding IS NOT NULL`
  - 添加 embedding API 调试日志

#### 4. 前端修复
- **KnowledgeDetailView.vue**: 修复重新向量化后的刷新逻辑

### 数据库迁移

```sql
-- 修改列类型
ALTER TABLE knowledge_points MODIFY COLUMN embedding VECTOR(1024) COMMENT '向量（1024维）';
```

### 向量函数

- **存储**: `VEC_FromText('[0.1, 0.2, ...]')`
- **查询**: `VEC_Distance_Cosine(embedding, VEC_FromText('[...]'))`
