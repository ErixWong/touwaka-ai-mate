# ORM 选型分析：是否需要使用 Sequelize

## 当前状态

项目目前使用 **mysql2** 直接操作数据库，并封装了一个 `Database` 类（[`lib/db.js`](lib/db.js)）提供基础查询方法。

### 现有封装能力

```javascript
// 基础方法
db.query(sql, params)      // 执行查询
db.insert(sql, params)     // 插入并返回 ID
db.execute(sql, params)    // 更新/删除
db.getOne(sql, params)     // 获取单条

// 业务方法（手动编写）
db.getExpert(id)
db.getModelConfig(id)
db.getUserById(id)
db.getRecentMessages(expertId, userId, limit)
db.getTopicsByExpertAndUser(expertId, userId, limit)
// ... 约 20+ 个业务方法
```

---

## 方案对比

### 方案 A：继续使用 mysql2（现状）

**优点：**
- ✅ 无需学习新框架
- ✅ 代码简单直接，完全控制 SQL
- ✅ 无额外依赖，包体积小
- ✅ 性能最优，无中间层开销
- ✅ 已有封装可复用

**缺点：**
- ❌ 需要手动实现分页、排序、过滤逻辑
- ❌ 关联查询需要手写 JOIN
- ❌ 没有模型验证
- ❌ 没有数据库迁移管理
- ❌ 字段名拼写错误只能在运行时发现

**实现复杂查询的工作量：**
```javascript
// 需要手动构建类似这样的查询
async queryTopics(params) {
  const { page, size, sort, filter } = params
  const conditions = []
  const values = []
  
  if (filter.expert_id) {
    conditions.push('expert_id = ?')
    values.push(filter.expert_id)
  }
  if (filter.status_in) {
    conditions.push(`status IN (${filter.status_in.map(() => '?').join(',')})`)
    values.push(...filter.status_in)
  }
  if (filter.title_like) {
    conditions.push('title LIKE ?')
    values.push(`%${filter.title_like}%`)
  }
  // ... 更多条件
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const offset = (page - 1) * size
  
  const items = await this.query(
    `SELECT * FROM topics ${whereClause} ORDER BY ${sort.by} ${sort.order} LIMIT ? OFFSET ?`,
    [...values, size, offset]
  )
  
  const countResult = await this.getOne(
    `SELECT COUNT(*) as total FROM topics ${whereClause}`,
    values
  )
  
  return {
    items,
    pagination: {
      page,
      size,
      total: countResult.total,
      pages: Math.ceil(countResult.total / size)
    }
  }
}
```

---

### 方案 B：引入 Sequelize

**优点：**
- ✅ 成熟稳定，社区活跃
- ✅ 内置分页、排序、过滤支持
- ✅ 模型定义清晰，有类型提示
- ✅ 自动处理关联关系
- ✅ 内置验证器
- ✅ 支持数据库迁移（Migrations）
- ✅ 钩子函数（生命周期回调）
- ✅ 事务支持完善

**缺点：**
- ❌ 学习曲线较陡
- ❌ 复杂查询仍需使用原生 SQL
- ❌ 有一定性能开销
- ❌ 需要重写现有 db.js 代码
- ❌ 增加约 2MB 依赖

**实现复杂查询的代码：**
```javascript
// 使用 Sequelize
async queryTopics(params) {
  const { page, size, sort, filter } = params
  
  const where = {}
  if (filter.expert_id) where.expert_id = filter.expert_id
  if (filter.status_in) where.status = { [Op.in]: filter.status_in }
  if (filter.title_like) where.title = { [Op.like]: `%${filter.title_like}%` }
  
  const result = await Topic.findAndCountAll({
    where,
    order: [[sort.by, sort.order]],
    limit: size,
    offset: (page - 1) * size,
  })
  
  return {
    items: result.rows,
    pagination: {
      page,
      size,
      total: result.count,
      pages: Math.ceil(result.count / size)
    }
  }
}
```

---

### 方案 C：引入 Knex.js（Query Builder）

**优点：**
- ✅ 轻量级，学习曲线平缓
- ✅ 链式调用，代码可读性好
- ✅ 内置分页、排序支持
- ✅ 渐进式迁移，可与现有代码共存
- ✅ 支持多种数据库
- ✅ 有迁移工具

**缺点：**
- ❌ 没有模型定义和验证
- ❌ 关联关系需手动处理
- ❌ 仍需部分手写逻辑

**实现复杂查询的代码：**
```javascript
// 使用 Knex
async queryTopics(params) {
  const { page, size, sort, filter } = params
  
  let query = knex('topics')
  
  if (filter.expert_id) query = query.where('expert_id', filter.expert_id)
  if (filter.status_in) query = query.whereIn('status', filter.status_in)
  if (filter.title_like) query = query.where('title', 'like', `%${filter.title_like}%`)
  
  const [items, countResult] = await Promise.all([
    query.clone()
      .orderBy(sort.by, sort.order)
      .limit(size)
      .offset((page - 1) * size),
    query.clone().count('* as total').first()
  ])
  
  return {
    items,
    pagination: {
      page,
      size,
      total: countResult.total,
      pages: Math.ceil(countResult.total / size)
    }
  }
}
```

---

## 工作量估算

### 如果继续使用 mysql2

需要实现一个通用的查询构建器：

```javascript
// lib/query-builder.js（新建，约 200 行）
class QueryBuilder {
  constructor(table) { ... }
  where(field, value) { ... }
  whereIn(field, values) { ... }
  whereLike(field, pattern) { ... }
  whereBetween(field, min, max) { ... }
  orderBy(field, direction) { ... }
  paginate(page, size) { ... }
  build() { ... }
}
```

**工作量：** 约 1-2 天

### 如果引入 Sequelize

1. 定义模型（约 8 个表）
2. 重写 db.js 中的方法
3. 更新所有 controller

**工作量：** 约 3-5 天

### 如果引入 Knex.js

1. 配置 Knex
2. 渐进式迁移现有方法
3. 新查询使用 Knex

**工作量：** 约 1-2 天

---

## 建议

### 推荐方案：Knex.js（方案 C）

**理由：**

1. **平衡点最佳**：在灵活性和便利性之间取得平衡
2. **渐进式迁移**：不需要一次性重写所有代码
3. **学习成本低**：链式 API 直观易懂
4. **满足需求**：足以支持我们设计的复杂查询 API
5. **包体积适中**：约 500KB，远小于 Sequelize

**迁移策略：**

```
Phase 1: 引入 Knex，配置连接
Phase 2: 新功能（如 Topics 分页查询）使用 Knex
Phase 3: 渐进式将 db.js 中的方法迁移到 Knex
Phase 4: （可选）使用 Knex migrations 管理数据库变更
```

### 备选方案：继续使用 mysql2 + 自定义 QueryBuilder

如果不想引入新依赖，可以实现一个轻量级的查询构建器，专门处理分页查询场景。

---

## 决策矩阵

| 维度 | mysql2 现状 | +QueryBuilder | Knex.js | Sequelize |
|------|-------------|---------------|---------|-----------|
| 学习成本 | - | 低 | 低 | 中高 |
| 代码改动 | - | 小 | 中 | 大 |
| 功能完整性 | 低 | 中 | 中高 | 高 |
| 灵活性 | 高 | 高 | 高 | 中 |
| 性能 | 最高 | 高 | 高 | 中 |
| 维护成本 | 高 | 中 | 低 | 低 |
| 迁移风险 | - | 低 | 低 | 中 |

---

## 向量字段支持分析

### 项目中的向量使用场景

根据项目设计，数据库中存在向量字段（如 `skills.embedding`），用于：
- 技能匹配的语义搜索
- 相似度计算（余弦相似度）

### MySQL 向量存储方案

| 方案 | 存储类型 | 相似度计算 | 性能 |
|------|----------|------------|------|
| BLOB + UDF | BLOB | 自定义函数 | 中 |
| JSON | JSON | 应用层计算 | 低 |
| MySQL 9.0+ VECTOR | VECTOR | 内置 COSINE_SIMILARITY | 高 |

### ORM 对向量的支持情况

#### Sequelize

**结论：❌ 不原生支持向量字段**

- Sequelize 没有内置的 VECTOR 或 BLOB 向量类型
- 需要将向量定义为 `BLOB` 或 `JSON` 类型
- **无法使用 Sequelize 的查询语法进行相似度计算**
- 必须使用 `sequelize.literal()` 编写原生 SQL

```javascript
// Sequelize 中使用向量（必须用原生 SQL）
const results = await sequelize.query(
  `SELECT id, name, 
   COSINE_SIMILARITY(embedding, :queryVector) as similarity
   FROM skills
   WHERE COSINE_SIMILARITY(embedding, :queryVector) > 0.7
   ORDER BY similarity DESC
   LIMIT 10`,
  {
    replacements: { queryVector: JSON.stringify(queryVector) },
    type: Sequelize.QueryTypes.SELECT
  }
)
```

#### Knex.js

**结论：✅ 可行，但需原生 SQL**

```javascript
// Knex 中使用向量（原生 SQL）
const results = await knex.raw(`
  SELECT id, name,
    COSINE_SIMILARITY(embedding, ?) as similarity
  FROM skills
  WHERE COSINE_SIMILARITY(embedding, ?) > ?
  ORDER BY similarity DESC
  LIMIT ?
`, [queryVector, queryVector, threshold, limit])
```

#### mysql2（现状）

**结论：✅ 完全支持**

```javascript
// mysql2 中使用向量（原生 SQL）
const results = await db.query(
  `SELECT id, name,
    COSINE_SIMILARITY(embedding, ?) as similarity
   FROM skills
   WHERE COSINE_SIMILARITY(embedding, ?) > ?
   ORDER BY similarity DESC
   LIMIT ?`,
  [JSON.stringify(queryVector), JSON.stringify(queryVector), threshold, limit]
)
```

### 向量查询结论

**无论选择哪个 ORM，向量相似度查询都需要使用原生 SQL。**

这是因为：
1. 向量相似度计算是数据库特有的功能
2. ORM 无法抽象这种复杂的数学运算
3. MySQL 9.0+ 的 `COSINE_SIMILARITY()` 函数需要直接调用

**因此，向量支持不应成为 ORM 选型的决定性因素。**

---

## 更新后的建议（不考虑学习曲线和包大小）

### 核心考量因素

1. **功能完整性** - 模型定义、验证、关联、钩子
2. **长期可维护性** - 迁移管理、代码规范
3. **类型安全** - 减少运行时错误
4. **与现有代码兼容性** - 迁移成本

### 最终推荐：Sequelize

**理由：**

| 维度 | Sequelize 优势 |
|------|---------------|
| **模型定义** | 统一的 Schema 定义，字段类型、默认值、验证规则一目了然 |
| **数据验证** | 内置验证器，在入库前自动校验，减少无效数据 |
| **关联关系** | 自动处理 JOIN，支持 hasOne/hasMany/belongsTo/belongsToMany |
| **钩子函数** | beforeCreate/afterUpdate 等生命周期回调，便于实现业务逻辑 |
| **事务支持** | 完善的事务管理和 CLS 上下文 |
| **迁移管理** | CLI 工具支持数据库版本控制 |
| **类型提示** | 配合 TypeScript 可获得良好的类型推导 |

**Sequelize 模型示例：**

```javascript
// models/topic.js
const { Model, DataTypes } = require('sequelize')

class Topic extends Model {
  static associate(models) {
    Topic.belongsTo(models.Expert, { foreignKey: 'expert_id' })
    Topic.belongsTo(models.User, { foreignKey: 'user_id' })
    Topic.hasMany(models.Message, { foreignKey: 'topic_id' })
  }
}

Topic.init({
  id: {
    type: DataTypes.STRING(20),
    primaryKey: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 200]
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'archived', 'deleted'),
    defaultValue: 'active'
  },
  message_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  sequelize,
  modelName: 'Topic',
  tableName: 'topics',
  hooks: {
    afterCreate: async (topic) => {
      // 自动更新统计等
    }
  }
})
```

**复杂查询示例：**

```javascript
// 使用 Sequelize 进行分页查询
const result = await Topic.findAndCountAll({
  where: {
    expert_id: filter.expert_id,
    status: { [Op.in]: filter.status_in },
    title: { [Op.like]: `%${filter.title_like}%` },
    created_at: { [Op.gte]: filter.created_at_from }
  },
  include: [{
    model: Expert,
    attributes: ['id', 'name']
  }],
  order: [[sort.by, sort.order]],
  limit: size,
  offset: (page - 1) * size
})

// 向量查询仍用原生 SQL
const vectorResults = await sequelize.query(`
  SELECT id, name,
    COSINE_SIMILARITY(embedding, ?) as similarity
  FROM skills
  WHERE COSINE_SIMILARITY(embedding, ?) > ?
  ORDER BY similarity DESC
  LIMIT ?
`, {
  replacements: [vector, vector, 0.7, 10],
  type: Sequelize.QueryTypes.SELECT
})
```

### 迁移策略

```
Phase 1: 安装 Sequelize，配置连接（与 mysql2 并存）
Phase 2: 定义核心模型（User, Expert, Topic, Message, Skill）
Phase 3: 新功能使用 Sequelize 实现
Phase 4: 渐进式迁移 db.js 中的方法
Phase 5: 移除 mysql2 依赖
```

### 备选方案：Knex.js

如果更看重灵活性和轻量级，Knex.js 仍是不错的选择：

```javascript
// Knex 方案
const searchSkills = async (queryVector, filters) => {
  const vectorCondition = knex.raw(
    'COSINE_SIMILARITY(embedding, ?) > ?',
    [JSON.stringify(queryVector), 0.7]
  )
  
  return knex('skills')
    .where('is_active', true)
    .where(filters.category ? { category: filters.category } : {})
    .where(vectorCondition)
    .orderByRaw('COSINE_SIMILARITY(embedding, ?) DESC', [JSON.stringify(queryVector)])
    .limit(10)
}
```

---

## 待决策

请选择：

1. **继续 mysql2** - 手动实现查询逻辑
2. **mysql2 + QueryBuilder** - 实现轻量级构建器
3. **引入 Knex.js** - 灵活的 Query Builder
4. **引入 Sequelize** - 推荐方案（完整 ORM，向量查询用原生 SQL）

---

*文档版本: v1.2*
*创建日期: 2026-02-20*
*更新日期: 2026-02-20*
