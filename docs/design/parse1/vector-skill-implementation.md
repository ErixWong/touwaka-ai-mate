# 为什么 V1 暂时不实现向量检索技能加载

## 核心原因：依赖链太长

实现向量检索技能加载需要以下前置条件，形成依赖链：

```
向量检索技能加载
    ↓ 依赖
技能描述的 Embedding 生成
    ↓ 依赖
Embedding 模型配置（哪个模型？API Key？）
    ↓ 依赖
数据库向量存储（MariaDB VECTOR 或 BLOB）
    ↓ 依赖
数据库向量索引（HNSW 或应用层计算）
    ↓ 依赖
数据库版本检测和兼容性处理
```

## 具体复杂度分析

### 1. 需要修改数据库 Schema

```sql
-- 新增技能向量表
CREATE TABLE skill_embeddings (
  skill_id VARCHAR(32) PRIMARY KEY,
  embedding BLOB NOT NULL,  -- 1536 维 float = 6KB 每个技能
  model_version VARCHAR(32), -- 模型变更时需要重新生成
  updated_at DATETIME,
  FOREIGN KEY (skill_id) REFERENCES skills(id)
);

-- 或者使用 MariaDB 11.7+ 的 VECTOR 类型
CREATE TABLE skill_embeddings (
  skill_id VARCHAR(32) PRIMARY KEY,
  embedding VECTOR(1536),  -- 原生向量类型
  VECTOR INDEX idx_embedding (embedding)  -- HNSW 索引
);
```

### 2. 需要 Embedding 模型集成

```javascript
// lib/embedding-client.js - 需要新增模块
class EmbeddingClient {
  constructor() {
    // 需要配置：OpenAI text-embedding-ada-002？
    // 还是本地模型？ollama？
    // 每个请求都要钱！
  }
  
  async getEmbedding(text) {
    // API 调用 + 错误处理 + 重试
    // 缓存机制（避免重复生成）
  }
}
```

### 3. 数据库兼容性 nightmare

| 数据库 | 向量支持 | 需要处理 |
|--------|---------|---------|
| MySQL 9 | 有 VECTOR 类型，无索引 | 应用层计算相似度 |
| MariaDB 11.7+ | VECTOR + VECTOR INDEX | 使用 HNSW |
| MariaDB <11.7 | 无 | BLOB + 应用层计算 |

```javascript
// 需要实现自适应策略
class VectorSearchAdapter {
  async detectCapabilities() {
    // 检测数据库版本和向量支持
  }
  
  async search(embedding, limit) {
    if (this.supportsVectorIndex) {
      return await this.nativeVectorSearch(embedding, limit);
    } else {
      return await this.applicationLayerSearch(embedding, limit);
    }
  }
}
```

### 4. 技能变更时的同步问题

```javascript
// 当 skill.md 更新时，需要重新生成 embedding
// 需要触发机制：
// - 数据库 trigger？
// - 应用层监听？
// - 定时任务扫描？
```

### 5. 成本考量

| 场景 | 估算 |
|------|------|
| 50 个技能 × 每次启动生成 embedding | 50 次 API 调用 ≈ $0.005 |
| 技能更新频率高 | 成本累积 |
| 本地 Embedding 模型 | 需要额外部署资源 |

---

## 替代方案：关键词匹配为什么足够

### V1 的场景假设

- 技能数量不多（10-20 个）
- 技能描述清晰
- 用户意图相对明确

### 关键词匹配的效果

```javascript
用户: "查一下上海明天天气"
关键词: ["查", "上海", "明天", "天气"]

技能匹配结果:
- weather: 描述包含 "天气" → score: 1
- search: 描述包含 "搜索" → score: 0
- calculator: 无匹配 → score: 0

Top5 返回: [weather, ...] ✅
```

### 复杂度对比

| 方面 | 向量检索 | 关键词匹配 |
|------|---------|-----------|
| 代码量 | 200+ 行 + 新模块 | 20 行 |
| 数据库修改 | 新增表/字段 | 无 |
| 外部依赖 | Embedding API | 无 |
| 运维复杂度 | 高 | 低 |
| 准确性 | 90% | 70%（技能少时足够） |

---

## 结论

**V1 不实现向量检索的原因：**

1. **不是瓶颈** - 技能数量少时，全量加载或关键词匹配已足够
2. **复杂度与收益不匹配** - 需要大量基础设施改动
3. **V2 更合适** - Task Layer 的向量基础设施可以复用（Topic 也需要向量）
4. **渐进式优化** - 关键词匹配 → 向量检索是平滑升级路径

**建议的实现顺序：**

```
V1 现在: 全量加载（当前）
    ↓
V1 改进: 关键词匹配（20行代码）
    ↓
V2 基础: Topic 向量 + 记忆向量
    ↓
V2 扩展: 技能向量（复用已有基础设施）
```

这样 V2 做技能向量时，Embedding Client、向量存储、兼容性处理都已经有了。
