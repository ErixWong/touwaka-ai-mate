# 知识库系统设计

> 创建日期：2026-03-03
> 状态：⏳ 设计阶段

## 需求概述

构建一个知识库系统，支持用户管理和检索知识，为 RAG（检索增强生成）提供基础设施。

### 核心需求

1. **多知识库支持**：用户可创建多个独立的知识库
2. **文档导入技能**：提供一组技能将用户文档转换为知识
3. **向量检索**：支持语义相似度搜索（RAG）
4. **知识结构化**：知识 + 知识点的层级结构

---

## 概念模型（初步）

```
KnowledgeBase（知识库）
├── Knowledge（知识）- 相当于一篇论文/文档
│   ├── 摘要/概述
│   ├── 元数据（来源、作者、创建时间等）
│   └── KnowledgePoint[]（知识点）- 相当于章节
│       ├── 内容片段
│       ├── 向量嵌入
│       └── 关联知识点
```

### 实体关系

```
┌─────────────────────┐
│    KnowledgeBase    │
│    ─────────────    │
│  id (PK)            │
│  name               │
│  description        │
│  owner_id (FK)      │
│  embedding_model    │  ← 使用的嵌入模型
│  embedding_dim      │  ← 向量维度（如 1536）
│  is_public          │
│  created_at         │
│  updated_at         │
└──────────┬──────────┘
           │ 1:N
           ▼
┌─────────────────────┐
│     Knowledge       │
│    ─────────────    │
│  id (PK)            │
│  kb_id (FK)         │
│  title              │
│  summary            │  ← LLM 生成的摘要
│  source_type        │  ← 'file' | 'web' | 'manual'
│  source_url         │
│  file_path          │  ← 原始文件存储路径
│  status             │  ← 'pending' | 'processing' | 'ready' | 'failed'
│  created_at         │
│  updated_at         │
└──────────┬──────────┘
           │ 1:N
           ▼
┌─────────────────────┐
│   KnowledgePoint    │
│  ─────────────────  │
│  id (PK)            │
│  knowledge_id (FK)  │
│  parent_id (FK)     │  ← 自关联，支持树状结构
│  title              │
│  content            │  ← 实际内容
│  content_type       │  ← 'text' | 'code' | 'table' | 'image'
│  embedding          │  ← 向量字段（BLOB 或 VECTOR）
│  position           │  ← 同级排序
│  token_count        │  ← Token 数量（用于统计）
│  created_at         │
│  updated_at         │
└──────────┬──────────┘
           │
           │ N:M（语义关联）
           ▼
┌─────────────────────┐
│  KnowledgeRelation  │
│  ─────────────────  │
│  id (PK)            │
│  source_id (FK)     │
│  target_id (FK)     │
│  relation_type      │  ← 'references' | 'related_to' | 'depends_on'
│  confidence         │  ← LLM 置信度 (0-1)
│  created_by         │  ← 'llm' | 'manual'
│  created_at         │
└─────────────────────┘
```

### 表结构 SQL（草案）

```sql
-- 知识库表
CREATE TABLE knowledge_bases (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id INT NOT NULL,
    embedding_model VARCHAR(100) DEFAULT 'text-embedding-3-small',
    embedding_dim INT DEFAULT 1536,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- 知识表
CREATE TABLE knowledges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    kb_id INT NOT NULL,
    title VARCHAR(500) NOT NULL,
    summary TEXT,
    source_type ENUM('file', 'web', 'manual') DEFAULT 'manual',
    source_url VARCHAR(1000),
    file_path VARCHAR(500),
    status ENUM('pending', 'processing', 'ready', 'failed') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE
);

-- 知识点表
CREATE TABLE knowledge_points (
    id INT PRIMARY KEY AUTO_INCREMENT,
    knowledge_id INT NOT NULL,
    parent_id INT DEFAULT NULL,
    title VARCHAR(500),
    content MEDIUMTEXT NOT NULL,
    content_type ENUM('text', 'code', 'table', 'image') DEFAULT 'text',
    embedding BLOB,  -- 或使用 MySQL 向量扩展
    position INT DEFAULT 0,
    token_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (knowledge_id) REFERENCES knowledges(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES knowledge_points(id) ON DELETE CASCADE
);

-- 知识点关联表（语义关系）
CREATE TABLE knowledge_relations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    source_id INT NOT NULL,
    target_id INT NOT NULL,
    relation_type ENUM('references', 'related_to', 'depends_on', 'contradicts') NOT NULL,
    confidence DECIMAL(3,2) DEFAULT 1.00,
    created_by ENUM('llm', 'manual') DEFAULT 'llm',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
    UNIQUE KEY unique_relation (source_id, target_id, relation_type)
);

-- 索引
CREATE INDEX idx_kp_knowledge ON knowledge_points(knowledge_id);
CREATE INDEX idx_kp_parent ON knowledge_points(parent_id);
CREATE INDEX idx_kr_source ON knowledge_relations(source_id);
CREATE INDEX idx_kr_target ON knowledge_relations(target_id);
CREATE INDEX idx_kr_type ON knowledge_relations(relation_type);
```

---

## 设计决策

### 1. 知识点关系模型 ✅ 已确定

采用 **混合模式**：物理层级 + 语义关联

```
┌─────────────────────────────────────────────────────┐
│                    知识点关系                        │
├─────────────────────────────────────────────────────┤
│  物理层级（parent_id）                               │
│  - 文档导入时自动建立                                │
│  - 章节 → 子章节 → 段落                              │
│  - 用于：导航、目录展示、层级查询                      │
├─────────────────────────────────────────────────────┤
│  语义关联（LLM 建立）                                │
│  - 导入后由 LLM 分析知识点内容                        │
│  - 自动发现知识点之间的引用、相关、依赖关系            │
│  - 用于：知识图谱、智能推荐、关联检索                  │
└─────────────────────────────────────────────────────┘
```

**关系类型枚举**：
```javascript
const RELATION_TYPES = {
  // 物理层级（系统维护）
  PARENT_CHILD: 'parent_child',
  
  // 语义关联（LLM 维护）
  REFERENCES: 'references',    // 引用关系
  RELATED_TO: 'related_to',    // 相关关系
  DEPENDS_ON: 'depends_on',    // 依赖关系
  CONTRADICTS: 'contradicts',  // 矛盾关系
}
```

---

## 知识点关系深度分析

### 两层结构

```
┌─────────────────────────────────────────────────────────────┐
│                     知识库层级结构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Knowledge（文章）                                          │
│   └── 树状结构：通过 parent_id 实现章节层级                    │
│       ├── 章节 1                                             │
│       │   ├── 1.1 子章节                                     │
│       │   └── 1.2 子章节                                     │
│       └── 章节 2                                             │
│           └── ...                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  知识点关系（文章内部/跨文章）                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   知识点之间可以有多种语义关系：                                │
│                                                             │
│   ┌─────────┐     depends_on     ┌─────────┐               │
│   │ Point A │ ──────────────────▶│ Point B │               │
│   └─────────┘                    └─────────┘               │
│       │                              ▲                      │
│       │ references                  │                      │
│       ▼                              │                      │
│   ┌─────────┐     related_to    ┌─────────┐               │
│   │ Point C │ ◀─────────────────│ Point D │               │
│   └─────────┘                   └─────────┘               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 关系类型详解

| 关系类型 | 方向 | 含义 | 示例 |
|---------|------|------|------|
| `depends_on` | 有向 | A 依赖 B（理解 A 需要先理解 B） | "闭包" depends_on "作用域" |
| `references` | 有向 | A 引用/提及 B | "详见第三章" references "第三章" |
| `related_to` | 无向 | A 与 B 主题相关 | "React Hooks" related_to "Vue Composition API" |
| `contradicts` | 无向 | A 与 B 观点矛盾 | "地心说" contradicts "日心说" |
| `extends` | 有向 | A 是 B 的扩展/深化 | "高级优化" extends "基础优化" |
| `example_of` | 有向 | A 是 B 的例子 | "快速排序代码" example_of "快速排序算法" |

### 关系存储设计

```sql
-- 扩展关系类型
ALTER TABLE knowledge_relations 
MODIFY relation_type ENUM(
  'depends_on',    -- 依赖关系
  'references',    -- 引用关系
  'related_to',    -- 相关关系
  'contradicts',   -- 矛盾关系
  'extends',       -- 扩展关系
  'example_of'     -- 例证关系
) NOT NULL;
```

### LLM 关系提取 Prompt

```javascript
const EXTRACT_RELATIONS_PROMPT = `
你是一个知识图谱构建助手。分析以下知识点，识别它们之间的关系。

知识点列表：
{{points}}

请识别以下类型的关系：
1. depends_on: A 依赖 B（理解 A 需要先理解 B）
2. references: A 引用/提及 B
3. related_to: A 与 B 主题相关
4. extends: A 是 B 的扩展/深化
5. example_of: A 是 B 的具体例子

输出 JSON 格式：
{
  "relations": [
    {
      "source_id": "知识点ID",
      "target_id": "知识点ID", 
      "relation_type": "关系类型",
      "confidence": 0.95,
      "reason": "判断依据"
    }
  ]
}
`;
```

### 关系的应用场景

1. **智能推荐**：阅读知识点 A 时，推荐相关的 B
2. **学习路径**：基于 `depends_on` 构建学习依赖图
3. **知识图谱可视化**：展示知识点网络
4. **检索增强**：检索时同时返回关联知识点

---

## 知识图谱概念说明

### 什么是知识图谱？

知识图谱（Knowledge Graph）是一种用**图结构**来表示知识的方式：

```
节点（Node）= 知识点
边（Edge）= 知识点之间的关系
```

### 与传统知识库的区别

| 维度 | 传统知识库 | 知识图谱 |
|------|-----------|---------|
| 结构 | 树状/扁平 | 网状图 |
| 关系 | 只有层级 | 多种语义关系 |
| 查询 | 按目录导航 | 按关系探索 |
| 发现 | 被动查找 | 主动推荐 |

### 可视化示例

```
                    ┌──────────┐
                    │ 闭包概念  │
                    └────┬─────┘
                         │ depends_on
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ 作用域    │   │ 函数     │   │ 变量     │
    └────┬─────┘   └────┬─────┘   └────┬─────┘
         │              │              │
         │ related_to   │ example_of   │
         ▼              ▼              ▼
    ┌──────────┐   ┌──────────┐   ┌──────────┐
    │ 全局变量  │   │回调函数   │   │局部变量   │
    └──────────┘   └──────────┘   └──────────┘
```

### 在我们系统中的体现

1. **物理存储**：知识点 + 关系表
2. **LLM 构建**：自动分析知识点，提取关系
3. **可视化展示**：前端用 D3.js / Cytoscape.js 展示图谱
4. **智能应用**：
   - 检索时返回关联知识点
   - 学习路径规划
   - 知识缺口发现

### 知识图谱 vs 文章树

```
文章树（结构化组织）          知识图谱（语义关联）
     │                            │
     ▼                            ▼
  目录导航                     关系探索
     │                            │
     ▼                            ▼
按章节顺序阅读              按关联跳转学习
```

**两者结合**：
- 文章树提供**组织结构**（方便管理）
- 知识图谱提供**语义关联**（方便发现）

### 2. 向量存储方案

**决策：先用 MySQL BLOB 存储，后期可迁移**

| 阶段 | 方案 | 说明 |
|------|------|------|
| MVP | MySQL BLOB + 内存计算 | 向量存为 BLOB，检索时加载到内存计算余弦相似度 |
| 优化 | MySQL HeatWave 或 pgvector | 数据量大时迁移 |
| 生产 | Milvus/Qdrant | 百万级向量时考虑 |

**MVP 实现思路**：
```javascript
// 向量存储（序列化为 JSON）
async function saveEmbedding(pointId, embedding) {
  const embeddingJson = JSON.stringify(embedding);
  await db.query('UPDATE knowledge_points SET embedding = ? WHERE id = ?', [embeddingJson, pointId]);
}

// 向量检索（内存计算）
async function searchSimilar(embedding, limit = 10) {
  // 1. 获取所有有向量的知识点
  const [points] = await db.query('SELECT id, content, embedding FROM knowledge_points WHERE embedding IS NOT NULL');
  
  // 2. 计算余弦相似度
  const results = points.map(p => ({
    ...p,
    similarity: cosineSimilarity(embedding, JSON.parse(p.embedding))
  }));
  
  // 3. 排序返回 Top-K
  return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}
```

---

## 技能设计

### 技能列表

| 技能名 | 功能 | 输入 | 输出 |
|--------|------|------|------|
| `kb-import-file` | 导入文件到知识库 | file_path, kb_id | knowledge_id |
| `kb-import-web` | 导入网页到知识库 | url, kb_id | knowledge_id |
| `kb-chunk` | 智能分块 | knowledge_id | point_ids[] |
| `kb-embed` | 生成向量嵌入 | kb_id 或 point_ids | 更新 embedding |
| `kb-relate` | LLM 分析知识点关联 | kb_id | 创建 relations |
| `kb-search` | 语义检索 | query, kb_id, top_k | points[] |

### 导入流程

```
用户上传文件
    │
    ▼
┌─────────────────┐
│ kb-import-file  │  ← 解析文件，创建 Knowledge 记录
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   kb-chunk      │  ← 智能分块，创建 KnowledgePoints（树状结构）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   kb-embed      │  ← 调用 Embedding API，生成向量
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   kb-relate     │  ← LLM 分析，建立语义关联（可选，异步）
└────────┬────────┘
         │
         ▼
    知识入库完成
```

---

## 知识图谱生成流程（核心）

### 完整流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        知识入库 + 图谱构建                            │
└─────────────────────────────────────────────────────────────────────┘

用户上传 PDF/DOCX
         │
         ▼
┌─────────────────┐
│  Step 1: 解析   │  提取文本、识别章节结构
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Step 2: 分块   │  LLM 将文档拆解为知识点（保持层级）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Step 3: 向量化 │  为每个知识点生成 Embedding
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 4: 定位（关键步骤）                                            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  4a. 向量检索：找出与新知识点相似的现有知识点（Top-K）          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                        │
│                          ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  4b. LLM 分析：对比新知识点与候选知识点，判断关系类型          │   │
│  │                                                              │   │
│  │  Prompt: "新知识点 A 与现有知识点 B 是什么关系？               │   │
│  │           - A 是 B 的子概念？(extends)                       │   │
│  │           - A 依赖 B？(depends_on)                           │   │
│  │           - A 与 B 相关？(related_to)                        │   │
│  │           - A 是 B 的例子？(example_of)                      │   │
│  │           - 无关系？"                                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                        │
│                          ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  4c. 建立关系：将判断结果写入 knowledge_relations 表          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Step 5: 入库   │  知识点 + 关系持久化
└─────────────────┘
         │
         ▼
    知识图谱更新完成
```

### Step 4 详细设计：知识点定位

```javascript
async function locateKnowledgePoint(newPoint, kbId) {
  // 4a. 向量检索：找相似知识点
  const candidates = await searchSimilar(newPoint.embedding, {
    kbId,
    topK: 10,
    threshold: 0.7  // 相似度阈值
  });
  
  if (candidates.length === 0) {
    // 没有相似知识点，这是全新的知识
    return { isNew: true, relations: [] };
  }
  
  // 4b. LLM 分析：判断与候选知识点的关系
  const relations = await llmAnalyzeRelations({
    newPoint: {
      title: newPoint.title,
      content: newPoint.content
    },
    candidates: candidates.map(c => ({
      id: c.id,
      title: c.title,
      content: c.content.substring(0, 500)  // 截断
    }))
  });
  
  // 4c. 返回关系列表
  return {
    isNew: false,
    relations: relations.filter(r => r.type !== 'none')
  };
}
```

### LLM 关系分析 Prompt

```javascript
const RELATION_ANALYSIS_PROMPT = `
你是一个知识图谱构建专家。

## 新知识点
标题：{{newPoint.title}}
内容：{{newPoint.content}}

## 现有知识点候选
{{#each candidates}}
[{{id}}] {{title}}
内容摘要：{{content}}
---
{{/each}}

## 任务
分析新知识点与每个候选知识点的关系，选择最合适的关系类型：
- extends: 新知识点是候选的扩展/深化
- depends_on: 理解新知识点需要先理解候选
- related_to: 两者主题相关
- example_of: 新知识点是候选的具体例子
- none: 没有明显关系

## 输出格式
{
  "relations": [
    {
      "target_id": "候选ID",
      "type": "关系类型",
      "confidence": 0.95,
      "reason": "判断理由"
    }
  ]
}
`;
```

### 增量更新策略

当新文档入库时，知识图谱如何更新？

```
┌─────────────────────────────────────────────────────────────┐
│                    增量更新策略                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 新知识点 → 检索相似 → LLM 分析 → 建立关系                 │
│                                                             │
│  2. 批量导入时：                                             │
│     - 先处理所有新知识点（生成向量）                          │
│     - 再批量分析关系（减少 LLM 调用次数）                     │
│                                                             │
│  3. 定期重算（可选）：                                        │
│     - 每周重新分析低置信度的关系                              │
│     - 发现新的跨文档关联                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 分块策略

```javascript
const CHUNK_STRATEGIES = {
  // 按标题层级分块（适合 Markdown、Word）
  hierarchical: {
    detect: (content) => extractHeadings(content),
    chunk: (content, headings) => splitByHeadings(content, headings)
  },
  
  // 按段落分块（适合纯文本）
  paragraph: {
    detect: (content) => content.split(/\n\n+/),
    chunk: (paragraphs, maxSize = 500) => mergeSmallParagraphs(paragraphs, maxSize)
  },
  
  // 语义分块（LLM 辅助）
  semantic: {
    detect: async (content) => await llmDetectBoundaries(content),
    chunk: (content, boundaries) => splitByBoundaries(content, boundaries)
  }
};
```

---

## API 设计（草案）

### 知识库管理

```
POST   /api/knowledge-bases              创建知识库
GET    /api/knowledge-bases              列出知识库
GET    /api/knowledge-bases/:id          获取知识库详情
PUT    /api/knowledge-bases/:id          更新知识库
DELETE /api/knowledge-bases/:id          删除知识库
```

### 知识管理

```
POST   /api/knowledge-bases/:kbId/knowledges       添加知识
GET    /api/knowledge-bases/:kbId/knowledges       列出知识
GET    /api/knowledges/:id                         获取知识详情
DELETE /api/knowledges/:id                         删除知识
POST   /api/knowledges/:id/reindex                 重新索引
```

### 知识点操作

```
GET    /api/knowledges/:knowledgeId/points         获取知识点树
GET    /api/knowledge-points/:id                   获取知识点详情
PUT    /api/knowledge-points/:id                   更新知识点
DELETE /api/knowledge-points/:id                   删除知识点
GET    /api/knowledge-points/:id/relations         获取关联知识点
```

### 检索

```
POST   /api/knowledge-bases/:kbId/search           语义检索
GET    /api/knowledge-bases/:kbId/graph            获取知识图谱
```

---

## 用户界面设计

### 整体布局

```
┌─────────────────────────────────────────────────────────────────────┐
│  Logo    专家列表    [知识库 ▼]    任务    设置         用户头像    │
│                      ──────────                                   │
│                      │ 知识库 A │                                  │
│                      │ 知识库 B │                                  │
│                      │ + 新建   │                                  │
│                      └──────────                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                        主内容区域                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 知识库下拉菜单

点击顶部"知识库"菜单后：

```
┌─────────────────────┐
│ 📚 我的知识库        │
├─────────────────────┤
│ 📖 技术文档库        │
│ 📖 产品知识库        │
│ 📖 个人笔记          │
├─────────────────────┤
│ ➕ 新建知识库        │
│ ⚙️ 管理知识库        │
└─────────────────────┘
```

### 知识库详情页（树状结构）

```
┌─────────────────────────────────────────────────────────────────────┐
│  📖 技术文档库                              [导入文档] [搜索] [⋮]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📁 JavaScript 基础                              12 知识点          │
│  ├── 📄 变量与作用域                              3 知识点          │
│  │   ├── 📝 var/let/const 区别                                     │
│  │   ├── 📝 作用域链                                               │
│  │   └── 📝 闭包                                                   │
│  ├── 📄 原型与继承                                4 知识点          │
│  │   ├── 📝 原型链                                                 │
│  │   ├── 📝 class 语法                                             │
│  │   └── ...                                                       │
│  └── 📄 异步编程                                  5 知识点          │
│                                                                     │
│  📁 React 框架                                   20 知识点          │
│  ├── 📄 Hooks 基础                                6 知识点          │
│  └── ...                                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 知识点详情页

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← 返回    📝 闭包                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📖 内容                                                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 闭包是指有权访问另一个函数作用域中变量的函数...                  │   │
│  │ ...                                                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  🔗 关联知识点                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ← depends_on    作用域链                                     │   │
│  │ ← depends_on    函数                                         │   │
│  │ → example_of    计数器工厂                                   │   │
│  │ ↔ related_to   高阶函数                                      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  📄 来源：JavaScript 高级程序设计 第7章                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## "图书管理员"专家设计

### 角色定位

一个专门负责知识库管理的专家，用户通过**对话方式**完成知识导入。

### 专家人设

```yaml
名称: 图书管理员 📚
描述: 专门帮助用户整理、导入和管理知识的专家
能力:
  - 解析各类文档（PDF、DOCX、Markdown）
  - 智能拆分知识点
  - 自动分类归档
  - 回答知识库相关问题
```

### 对话式导入流程

```
┌─────────────────────────────────────────────────────────────────────┐
│  用户: 帮我把这份 React 教程导入到技术文档库                          │
│        [📎 React基础教程.pdf]                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  图书管理员 📚:                                                      │
│  ─────────────                                                      │
│  好的，我来处理这份 React 教程。                                     │
│                                                                     │
│  📊 **文档分析中...**                                               │
│  - 识别到 5 个主要章节                                              │
│  - 预计拆分为 23 个知识点                                           │
│                                                                     │
│  📋 **章节预览：**                                                  │
│  1. React 简介                                                      │
│  2. JSX 语法                                                        │
│  3. 组件基础                                                        │
│  4. Hooks 入门                                                      │
│  5. 状态管理                                                        │
│                                                                     │
│  请确认导入，或者告诉我需要调整哪些部分？                            │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  用户: 导入吧，把 Hooks 部分单独分成一个章节                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  图书管理员 📚:                                                      │
│  ─────────────                                                      │
│  明白了！正在导入...                                                │
│                                                                     │
│  ✅ **导入完成！**                                                  │
│  - 创建知识：React基础教程                                          │
│  - 创建知识点：23 个                                                │
│  - 建立关联：与现有 5 个知识点建立了关联                             │
│                                                                     │
│  📖 现在可以在知识库中查看这份教程了。                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 专家技能

| 技能 | 功能 |
|------|------|
| `kb-import` | 导入文档到知识库（解析 + 分块 + 向量化） |
| `kb-search` | 在知识库中搜索 |
| `kb-organize` | 整理知识库结构 |
| `kb-merge` | 合并重复知识点 |
| `kb-question` | 回答知识库相关问题 |

### 专家 System Prompt（草案）

```markdown
你是图书管理员，一个专门帮助用户管理知识库的专家。

## 你的职责

1. **知识导入**：帮助用户将各类文档（PDF、DOCX、Markdown）导入知识库
2. **智能分类**：自动识别文档结构，拆分为知识点
3. **关联发现**：发现新知识与现有知识的关联
4. **知识检索**：帮助用户在知识库中查找信息

## 工作方式

- 导入前先展示预览，让用户确认
- 对于大型文档，询问用户是否需要调整分块策略
- 导入完成后，汇报导入结果和发现的关联

## 可用技能

- kb-import: 导入文档
- kb-search: 搜索知识库
- kb-organize: 整理知识库
```

### Phase 1: 基础架构（MVP）

| 任务 | 预估工时 | 依赖 |
|------|----------|------|
| 创建数据库表 | 1h | - |
| 知识库 CRUD API | 2h | 数据库表 |
| 知识 CRUD API | 2h | 知识库 API |
| 知识点 CRUD API | 2h | 知识 API |
| kb-import-file 技能 | 3h | 知识点 API |
| kb-chunk 技能 | 2h | kb-import-file |
| kb-embed 技能 | 2h | kb-chunk |
| kb-search 技能 | 2h | kb-embed |

**MVP 目标**：能导入文档、分块、生成向量、进行语义检索

### Phase 2: 智能化

| 任务 | 预估工时 | 依赖 |
|------|----------|------|
| kb-relate 技能（LLM 关联分析） | 4h | Phase 1 |
| kb-import-web 技能 | 2h | kb-import-file |
| 知识图谱可视化 | 4h | kb-relate |
| 混合检索（向量 + 关键词） | 3h | kb-search |

### Phase 3: 优化

| 任务 | 预估工时 | 依赖 |
|------|----------|------|
| 向量数据库迁移 | 4h | Phase 2 |
| 增量更新机制 | 2h | - |
| 知识库权限控制 | 2h | - |

---

## 开放问题

1. **Embedding 模型选择**
   - OpenAI `text-embedding-3-small`（便宜，1536 维）
   - OpenAI `text-embedding-3-large`（更准，3072 维）
   - 本地模型（如 BGE、M3E）

2. **专家集成方式**
   - 知识库如何与专家对话结合？
   - 检索结果如何注入到 Prompt？

3. **多租户隔离**
   - 知识库是否需要支持团队/组织级别？

---

*此文档持续更新中...*
