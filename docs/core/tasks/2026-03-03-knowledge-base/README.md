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

### 3. 图片存储方案 ✅ 新增

**决策：本地文件系统 + 知识点引用**

```
┌─────────────────────────────────────────────────────────────────────┐
│                       图片存储架构                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   存储位置：data/kb-images/                                          │
│   文件命名：{knowledge_id}_{timestamp}_{hash}.png                    │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  knowledge_points 表（content_type = 'image'）               │   │
│   │  ─────────────────────────────────────────────────────────  │   │
│   │  content = JSON.stringify({                                  │   │
│   │    path: "/kb-images/123_1709123456_abc123.png",            │   │
│   │    alt: "React 组件生命周期图",    // LLM 生成的描述          │   │
│   │    ocr_text: "Mounting...",       // OCR 提取的文字（可选）   │   │
│   │    width: 800,                                               │   │
│   │    height: 600,                                              │   │
│   │    original_name: "lifecycle.png"                            │   │
│   │  })                                                          │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**图片处理流程**：

```javascript
async function processImage(imageBuffer, knowledgeId, originalName) {
  // 1. 生成唯一文件名
  const hash = createHash('md5').update(imageBuffer).digest('hex').slice(0, 8);
  const ext = path.extname(originalName) || '.png';
  const filename = `${knowledgeId}_${Date.now()}_${hash}${ext}`;
  
  // 2. 压缩优化（可选）
  const optimizedBuffer = await sharp(imageBuffer)
    .resize({ width: 1920, withoutEnlargement: true })  // 限制最大宽度
    .png({ quality: 80 })
    .toBuffer();
  
  // 3. 存储文件
  const filePath = path.join('data/kb-images', filename);
  await fs.writeFile(filePath, optimizedBuffer);
  
  // 4. 生成描述（LLM 或 OCR）
  const description = await generateImageDescription(imageBuffer);
  
  return {
    path: `/kb-images/${filename}`,
    alt: description.alt,
    ocr_text: description.ocr_text,
    width: description.width,
    height: description.height,
    original_name: originalName
  };
}
```

**图片检索策略**：

| 检索方式 | 实现方式 | 说明 |
|----------|----------|------|
| 文本检索 | 搜索 `alt` 和 `ocr_text` | 基于图片描述搜索 |
| 语义检索 | 对 `alt` 生成 embedding | 图片本身不做向量嵌入 |
| 上下文关联 | 关联到父知识点 | 随文档章节一起展示 |

**API 服务图片**：

```javascript
// 后端路由：静态文件服务
router.use('/kb-images', express.static(path.join(process.cwd(), 'data/kb-images')));

// 或通过 API 代理（可加权限控制）
router.get('/api/kb-images/:filename', auth, (req, res) => {
  const filePath = path.join(process.cwd(), 'data/kb-images', req.params.filename);
  res.sendFile(filePath);
});
```

**未来扩展**：

- 迁移到对象存储（S3/OSS）时，只需修改 `path` 字段为完整 URL
- 支持图片向量嵌入（CLIP 模型）实现"以图搜图"

### 4. 内容类型存储格式 ✅ 新增

**决策：统一使用 Markdown 格式**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    内容类型存储策略                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  content_type = 'text'                                              │
│  ─────────────────────                                              │
│  content = "普通文本内容，支持 **Markdown** 格式"                     │
│                                                                     │
│  content_type = 'code'                                              │
│  ─────────────────────                                              │
│  content = "```javascript\nconst x = 1;\n```"                       │
│  // 使用 Markdown 代码块，保留语言标识                                │
│                                                                     │
│  content_type = 'table'                                             │
│  ─────────────────────                                              │
│  content = "| 列1 | 列2 |\n|---|---|\n| A | B |"                     │
│  // 使用 Markdown 表格语法                                           │
│                                                                     │
│  content_type = 'image'                                             │
│  ─────────────────────                                              │
│  content = JSON.stringify({ path, alt, ... })                       │
│  // 图片特殊处理，存储元数据 JSON                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**关于代码入库的原则**：

| 场景 | 是否入库 | 说明 |
|------|----------|------|
| 教程中的代码片段 | ✅ 入库 | 作为知识点的一部分，有上下文说明 |
| 纯代码文件（无注释） | ❌ 不建议 | 缺乏语义上下文，检索效果差 |
| 带注释的代码 | ✅ 入库 | 注释提供语义信息 |
| API 文档示例 | ✅ 入库 | 有说明文字配合 |

**代码片段的向量化策略**：

```javascript
// 代码片段向量化时，拼接说明文字
const textForEmbedding = `
${point.title}

${point.content}  // 包含代码块

// 如果有父级上下文，也可以加入
${parentContext ? `上下文：${parentContext}` : ''}
`;
```

**为什么用 Markdown？**

1. **通用性**：所有 LLM 都能理解和生成 Markdown
2. **可读性**：人类和 AI 都容易阅读
3. **灵活性**：支持代码、表格、图片、公式等多种内容
4. **兼容性**：与现有文档格式（PDF、DOCX）转换容易
5. **渲染友好**：前端可直接用 Markdown 渲染器展示
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

### 技能分类

技能分为两类：
1. **管理技能**：用于知识库管理（导入、分块、向量化等），主要由"图书管理员"专家使用
2. **检索技能**：用于知识检索（搜索、读取等），供所有专家使用

---

### 管理技能（图书管理员专用）

| 技能名 | 功能 | 输入 | 输出 |
|--------|------|------|------|
| `kb-import-file` | 导入文件到知识库 | file_path, kb_id | knowledge_id |
| `kb-import-web` | 导入网页到知识库 | url, kb_id | knowledge_id |
| `kb-chunk` | 智能分块 | knowledge_id | point_ids[] |
| `kb-embed` | 生成向量嵌入 | kb_id 或 point_ids | 更新 embedding |
| `kb-relate` | LLM 分析知识点关联 | kb_id | 创建 relations |

---

### 检索技能（所有专家可用）

#### kb-list：获取知识库清单

```yaml
名称: kb-list
描述: 获取用户可访问的知识库列表
参数: 无（自动根据当前用户权限过滤）
输出:
  - id: 知识库ID
  - name: 知识库名称
  - description: 描述
  - point_count: 知识点数量
示例:
  [
    { "id": "kb-finance", "name": "财务知识库", "point_count": 156 },
    { "id": "kb-quality", "name": "质量知识库", "point_count": 89 },
    { "id": "kb-it", "name": "IT知识库", "point_count": 234 }
  ]
```

#### kb-search-vector：向量语义检索

```yaml
名称: kb-search-vector
描述: 使用向量相似度搜索知识点
参数:
  - query: 搜索查询（自然语言）
  - kb_id: 知识库ID（可选，不传则搜索全部）
  - top_k: 返回数量（默认10）
  - threshold: 相似度阈值（默认0.7）
输出:
  - point_id: 知识点ID
  - title: 标题
  - content_preview: 内容预览（前200字）
  - similarity: 相似度分数
  - knowledge_id: 所属知识ID
  - knowledge_title: 所属知识标题
示例:
  用户问："如何处理报销流程？"
  → 调用 kb-search-vector(query="报销流程", kb_id="kb-finance")
  → 返回相关知识点列表
```

#### kb-search-graph：知识图谱检索

```yaml
名称: kb-search-graph
描述: 基于知识图谱检索关联知识点
参数:
  - point_id: 起始知识点ID
  - relation_types: 关系类型列表（默认全部）
  - depth: 遍历深度（默认1，最大3）
  - direction: 方向（in/out/both）
输出:
  - points: 关联知识点列表
  - relations: 关系详情
示例:
  从"闭包"知识点出发，depth=2
  → 返回：作用域、函数、变量、高阶函数等相关知识点
```

#### kb-get-point：读取知识点详情

```yaml
名称: kb-get-point
描述: 获取知识点完整内容
参数:
  - point_id: 知识点ID
  - include_relations: 是否包含关联知识点（默认true）
输出:
  - id, title, content, content_type
  - parent_id, position, token_count
  - knowledge_id, knowledge_title
  - relations: 关联知识点列表
```

#### kb-get-knowledge：读取知识（文档）详情

```yaml
名称: kb-get-knowledge
描述: 获取知识（文档）的摘要和目录结构
参数:
  - knowledge_id: 知识ID
  - include_points: 是否包含知识点树（默认false）
输出:
  - id, title, summary, source_type
  - status, point_count, created_at
  - points_tree: 知识点目录树（可选）
```

#### kb-search-hybrid：混合检索（高级）

```yaml
名称: kb-search-hybrid
描述: 综合使用向量、关键词、图谱进行检索
参数:
  - query: 搜索查询
  - kb_id: 知识库ID
  - top_k: 返回数量
  - use_graph: 是否启用图谱扩展（默认true）
输出:
  - points: 知识点列表（综合排序）
  - graph_context: 图谱上下文
工作流程:
  1. 向量检索 → 找到最相关的知识点
  2. 图谱扩展 → 获取关联知识点（depends_on, related_to）
  3. 综合排序 → 按相关度和关联强度排序
```

---

### 专家使用场景

```
┌─────────────────────────────────────────────────────────────────────┐
│  场景1：用户问"财务报销流程是怎样的？"                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  专家调用流程：                                                       │
│  1. kb-list → 确认有"财务知识库"                                      │
│  2. kb-search-vector(query="报销流程", kb_id="kb-finance")           │
│  3. kb-get-point(point_id=返回的第一个) → 获取完整内容                 │
│  4. （可选）kb-search-graph → 获取相关知识点（如"发票要求"）           │
│  5. 组装回答 → 返回用户                                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  场景2：用户问"闭包是什么？有什么相关概念？"                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  专家调用流程：                                                       │
│  1. kb-search-vector(query="闭包") → 找到"闭包"知识点                 │
│  2. kb-search-graph(point_id=闭包ID, depth=2) → 获取关联概念          │
│     → 返回：作用域、函数、变量、高阶函数                               │
│  3. 组装回答 → "闭包是...，相关概念有：作用域、函数..."                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 检索结果过滤机制 ✅ 新增

### 问题背景

检索结果可能存在噪音问题：
1. **语义相似但实际无关**：向量相似度高，但内容与问题不相关
2. **信息过载**：检索结果太多，上下文被无关信息填满
3. **信噪比低**：有用信息太少，噪音太多

### 多层过滤策略

```
┌─────────────────────────────────────────────────────────────────────┐
│                    检索结果多层过滤机制                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Layer 1: 向量检索阶段（基础过滤）                                     │
│  ─────────────────────────────────                                  │
│  - 相似度阈值过滤（threshold=0.7）                                    │
│  - 限制返回数量（top_k=10）                                          │
│  → 减少明显无关的结果                                                 │
│                                                                     │
│  Layer 2: LLM 审阅阶段（智能过滤，可选）                               │
│  ─────────────────────────────────                                  │
│  - 触发条件：检索结果 > 5 条，或总 token 数 > 2000                    │
│  - LLM 快速判断每条结果与问题的相关性                                  │
│  - 输出：筛选后的结果ID列表 + 相关性评分                              │
│  → 去除语义相关但实际无关的噪音                                        │
│                                                                     │
│  Layer 3: 上下文压缩阶段（精简，可选）                                 │
│  ─────────────────────────────────                                  │
│  - 触发条件：过滤后内容仍超过 token 限制                               │
│  - LLM 提取每条结果中与问题相关的关键信息                              │
│  - 输出：压缩后的精简内容                                             │
│  → 保留核心信息，去除冗余                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### LLM 审阅 Prompt

```javascript
const RERANK_PROMPT = `
你是一个信息筛选专家。用户提出了一个问题，我们从知识库中检索到了一些可能相关的知识点。

## 用户问题
{{query}}

## 检索到的知识点
{{#each results}}
[{{id}}] 相似度: {{similarity}}
标题: {{title}}
内容摘要: {{content_preview}}
---
{{/each}}

## 任务
请判断每个知识点与用户问题的相关性，只保留真正有帮助的知识点。

## 输出格式
{
  "filtered_ids": ["id1", "id2", ...],  // 相关的知识点ID
  "reasons": {
    "id1": "为什么相关",
    "id2": "为什么相关"
  },
  "irrelevant": {
    "id3": "为什么无关"
  }
}

注意：
- 宁缺毋滥，只保留真正相关的知识点
- 考虑用户问题的实际意图，而不是字面相似
`;
```

### 上下文压缩 Prompt

```javascript
const COMPRESS_PROMPT = `
你是一个信息压缩专家。请从以下知识点中提取与用户问题最相关的关键信息。

## 用户问题
{{query}}

## 知识点内容
{{knowledge_content}}

## 任务
1. 提取与问题直接相关的关键信息
2. 去除冗余和无关内容
3. 保持信息的准确性和完整性

## 输出格式
{
  "compressed_content": "压缩后的关键信息...",
  "key_points": ["要点1", "要点2", ...],
  "token_saved": 估计节省的token数
}
`;
```

### 技能参数扩展

```yaml
# kb-search-vector 增加过滤参数
kb-search-vector:
  参数:
    - query: 搜索查询
    - kb_id: 知识库ID
    - top_k: 返回数量（默认10）
    - threshold: 相似度阈值（默认0.7）
    - use_rerank: 是否使用LLM重排序（默认false）
    - max_tokens: 最大返回token数（默认4000）
    - compress: 是否压缩结果（默认false）
```

### 过滤流程示例

```
用户问："公司对差旅报销有什么规定？"

1. 向量检索 → 返回 15 条结果（top_k=15, threshold=0.6）
   - 其中 5 条是"差旅报销规定"
   - 3 条是"日常报销规定"（无关）
   - 4 条是"差旅预订流程"（部分相关）
   - 3 条是"国际差旅签证"（无关）

2. LLM 审阅 → 筛选出 8 条相关
   - 保留：5 条"差旅报销规定" + 3 条"差旅预订流程"
   - 过滤：日常报销、国际签证

3. 上下文压缩（总 token > 4000）
   - 提取每条的关键信息
   - 压缩后 token 数：2500

4. 注入 Prompt → 生成回答
```

### 成本控制

LLM 审阅和压缩会增加调用成本，需要权衡：

| 场景 | 是否启用过滤 | 说明 |
|------|-------------|------|
| 检索结果 ≤ 3 条 | 否 | 结果少，噪音影响小 |
| 检索结果 > 5 条 | 是（审阅） | 需要过滤噪音 |
| 内容 > 4000 token | 是（压缩） | 避免上下文溢出 |
| 高精度场景 | 是（全部） | 如法律、医疗知识库 |
| 快速响应场景 | 否 | 优先速度而非精度 |

---

### 导入流程（管理技能）

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
│  [知识库]    专家列表    对话    任务    设置              用户头像   │
├───────────────────┬─────────────────────────────────────────────────┤
│                   │                                                 │
│  📚 知识库列表     │           知识库内容区                           │
│  ─────────────    │                                                 │
│                   │  📖 SAP运维手册知识库                            │
│  🔰 公共知识库     │  ─────────────────────                          │
│  ├─ 📖 SAP运维    │                                                 │
│  ├─ 📖 质量体系   │     📁 MM采购模块                                │
│  └─ 📖 IT制度     │     ├── 📁 采购计划维护                          │
│                   │     │   ├── 📖 采购计划类型说明                   │
│  🔒 私有知识库     │     │   ├── 🔧 创建采购计划                      │
│  ├─ 📖 个人笔记   │     │   └── 🔧 修改采购计划                      │
│  └─ 📖 项目文档   │     ├── 📁 价格管理                              │
│                   │     │   └── ...                                  │
│                   │     └── 📁 供应商管理                            │
│                   │                                                 │
│                   │  ─────────────────────────────────────────────  │
│                   │  选中: 📖 采购计划类型说明                        │
│                   │  ─────────────────────────────────────────────  │
│                   │                                                 │
│                   │  SAP 支持以下几种采购计划类型：                   │
│                   │  1. 手工采购计划                                 │
│                   │  2. MRP 自动生成计划                             │
│                   │  3. ...                                         │
│                   │                                                 │
└───────────────────┴─────────────────────────────────────────────────┘
```

### 知识库列表（左侧面板）

```
┌─────────────────────┐
│ 📚 知识库            │
├─────────────────────┤
│ 🔰 公共知识库        │
│ ├─ 📖 SAP运维手册    │
│ ├─ 📖 质量体系文件   │
│ ├─ 📖 IT制度规范     │
│ └─ 📖 员工培训体系   │
├─────────────────────┤
│ 🔒 私有知识库        │
│ ├─ 📖 个人笔记       │
│ └─ 📖 项目文档       │
├─────────────────────┤
│ ➕ 新建知识库        │
└─────────────────────┘
```

### 知识库内容区（右侧主区域）

#### 树状结构视图

```
┌─────────────────────────────────────────────────────────────────────┐
│  📖 SAP运维手册知识库                              [导入] [搜索] [⋮] │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📁 MM 采购模块                                 45 知识点           │
│  ├── 📁 采购计划维护                            12 知识点           │
│  │   ├── 📖 采购计划类型说明                                        │
│  │   ├── 🔧 创建手工采购计划                                        │
│  │   ├── 🔧 修改采购计划                                            │
│  │   └── ❓ 采购计划常见问题                                        │
│  ├── 📁 价格管理                                8 知识点            │
│  │   └── ...                                                        │
│  └── 📁 供应商管理                              10 知识点           │
│                                                                     │
│  📁 SD 销售模块                                 38 知识点           │
│  ├── 📁 客户管理                                15 知识点           │
│  └── 📁 销售订单                                23 知识点           │
│                                                                     │
│  📁 FI 财务模块                                 52 知识点           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 知识点详情视图

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← 返回    📖 采购计划类型说明                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  📍 位置：SAP运维手册 > MM采购模块 > 采购计划维护                    │
│  📅 更新：2026-03-01                                               │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  ## 概述                                                            │
│                                                                     │
│  SAP 系统支持多种采购计划类型，根据业务需求选择：                     │
│                                                                     │
│  | 计划类型 | 代码 | 适用场景 |                                      │
│  |---------|------|---------|                                      │
│  | 手工采购计划 | UB | 临时性采购 |                                  │
│  | MRP 计划 | PD | 常规物料 |                                       │
│  | 预测计划 | VB | 季节性物料 |                                     │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  🔗 相关操作                                                         │
│  ├─ 🔧 创建手工采购计划 →                                           │
│  ├─ 🔧 修改采购计划 →                                               │
│  └─ ❓ 采购计划常见问题 →                                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 知识库案例参考

不同类型的知识库有不同的结构特点，详见 [案例集](./cases/README.md)：

| 案例 | 类型 | 结构特点 |
|------|------|---------|
| [SAP运维手册](./cases/case-sap-operations.md) | 系统操作手册 | 模块→功能→操作，三级结构 |
| [AI论文库](./cases/case-ai-papers.md) | 学术论文 | 主题分类+引用关系图谱 |
| [员工培训体系](./cases/case-employee-training.md) | 培训/SOP | 岗位→流程→操作，三级结构 |

---

## 知识库构建流程 ✅ 新增

### 整体流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    知识库构建完整流程                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  用户上传文档                                                        │
│       │                                                             │
│       ▼                                                             │
│  ┌─────────────────┐                                                │
│  │ 阶段1: 数据清洗  │  ← 文档清洗专家 + VL模型                        │
│  │   - 格式转换    │                                                │
│  │   - OCR/描述    │                                                │
│  │   - 媒体上传    │                                                │
│  └────────┬────────┘                                                │
│           │ 输出：Markdown + 媒体链接                                │
│           ▼                                                         │
│  ┌─────────────────┐                                                │
│  │ 阶段2: 知识构造  │  ← 知识整理专家 + LLM                           │
│  │   - 归属判断    │                                                │
│  │   - 智能分段    │                                                │
│  │   - 上下文补充  │                                                │
│  │   - 创建知识点  │                                                │
│  └────────┬────────┘                                                │
│           │ 输出：知识点记录（含 parent_id）                         │
│           ▼                                                         │
│  ┌─────────────────┐                                                │
│  │ 阶段3: 向量化   │  ← 后台异步                                     │
│  │   - 生成嵌入    │                                                │
│  └────────┬────────┘                                                │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────┐                                                │
│  │ 阶段4: 图谱构建  │  ← 后台异步                                     │
│  │   - 关系分析    │                                                │
│  └────────┬────────┘                                                │
│           │                                                         │
│           ▼                                                         │
│      知识入库完成                                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 阶段1：数据清洗

### 负责专家

**文档清洗专家** 🧹

```yaml
名称: 文档清洗专家
描述: 专门负责将各类文档转换为结构化的 Markdown 格式
能力:
  - 解析各类文档（PDF、DOCX、HTML、图片）
  - 使用 VL 模型进行 OCR 和图片描述
  - 提取媒体文件并上传到对象存储
  - 输出干净的 Markdown 文本
```

### 输入输出

```
输入：原始文档（PDF/DOCX/图片/HTML/Markdown）
输出：{
  markdown: "清洗后的 Markdown 文本（媒体链接已替换）",
  media: [
    { original_path: "img1.png", storage_url: "https://...", type: "image", alt: "图片描述" }
  ]
}
```

### 处理流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    数据清洗阶段详细流程                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: 格式识别                                                   │
│  ─────────────────                                                  │
│  - PDF → 提取文本 + 图片 + 表格                                     │
│  - DOCX → 提取文本 + 图片 + 表格                                    │
│  - 图片 → VL模型 OCR + 描述                                         │
│  - HTML → 提取正文 + 图片                                           │
│  - Markdown → 直接进入 Step 3                                       │
│                                                                     │
│  Step 2: VL模型处理                                                 │
│  ─────────────────                                                  │
│  - OCR：图片中的文字提取                                            │
│  - 图片描述：生成 alt 文本（用于检索和可访问性）                      │
│  - 表格识别：图片表格 → Markdown 表格                               │
│  - 公式识别：图片公式 → LaTeX                                       │
│                                                                     │
│  Step 3: 媒体处理                                                   │
│  ─────────────────                                                  │
│  - 上传到对象存储（本地/S3/OSS）                                    │
│  - 生成唯一 URL                                                    │
│  - 在 Markdown 中替换为链接                                         │
│  - 记录媒体元数据（alt、尺寸、类型）                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 技能清单

| 技能名 | 功能 | 输入 | 输出 |
|--------|------|------|------|
| `kb-clean-file` | 解析文件，提取文本和媒体 | file_path | { markdown, media[] } |
| `kb-ocr-image` | VL模型 OCR + 描述 | image_data | { text, alt, ocr_text } |
| `kb-upload-media` | 上传媒体到对象存储 | image_data, filename | { url, path } |

### VL模型调用示例

```javascript
// 图片处理流程
async function processImage(imageBuffer, context) {
  // 1. 调用 VL 模型（如 GPT-4V、Claude 3）
  const vlResult = await callVLModel({
    image: imageBuffer,
    tasks: ['ocr', 'describe', 'classify']
  });
  
  // 2. 生成描述和 OCR 文本
  const alt = vlResult.description;  // "React 组件生命周期图"
  const ocrText = vlResult.ocr;      // "Mounting → Updating → Unmounting..."
  
  // 3. 上传到对象存储
  const mediaUrl = await uploadToStorage(imageBuffer, generateFileName());
  
  return {
    url: mediaUrl,
    alt,
    ocr_text: ocrText,
    type: 'image'
  };
}
```

---

## 阶段2：知识构造

### 负责专家

**知识整理专家** 📚

```yaml
名称: 知识整理专家
描述: 专门负责将清洗后的文档整理成知识点并入库
能力:
  - 分析文档主题，判断归属
  - 智能分段，保持语义完整性
  - 补充上下文，确保知识点可独立理解
  - 创建知识点记录，建立层级关系
```

### 输入输出

```
输入：{
  markdown: "清洗后的 Markdown",
  media: [...],
  kb_id: "目标知识库ID"
}
输出：{
  knowledge_id: "创建的知识ID",
  points: [
    { id, title, content, parent_id, context }
  ]
}
```

### 处理流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    知识构造阶段详细流程                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Step 1: 归属判断                                                   │
│  ─────────────────                                                  │
│  - 分析文档主题和关键词                                             │
│  - 与知识库现有内容对比                                             │
│  - 决策：                                                          │
│    ✅ 放入现有分支（指定 parent_id）                                │
│    ✅ 创建新分支                                                    │
│    ❌ 拒绝（不属于本知识库）→ 返回错误信息                           │
│                                                                     │
│  Step 2: 智能分段                                                   │
│  ─────────────────                                                  │
│  - 按语义边界分段（不是按字数机械切分）                              │
│  - 保持媒体链接完整性（不切断图片引用）                              │
│  - 保持代码块完整性                                                 │
│  - 保持表格完整性                                                   │
│  - 每段大小：200-500 tokens（可配置）                               │
│                                                                     │
│  Step 3: 上下文补充 ⭐ 关键                                          │
│  ─────────────────                                                  │
│  每个分段补充：                                                      │
│  - 文档标题                                                         │
│  - 章节路径（如：第三章 > 3.2节 > 3.2.1）                           │
│  - 前文摘要（100字以内）                                            │
│  - 关键术语解释（可选）                                             │
│                                                                     │
│  Step 4: 创建知识点                                                 │
│  ─────────────────                                                  │
│  - 写入 knowledge_points 表                                         │
│  - 建立 parent_id 关系                                              │
│  - 记录 token_count                                                │
│  - 触发后续：向量化 + 图谱构建（异步）                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 上下文补充示例

```markdown
## 问题示例

### 原文（分段前）
---
## 第三章：闭包

闭包是 JavaScript 中的一个重要概念。它允许函数访问其词法作用域外的变量。

### 3.1 闭包的定义
闭包是指有权访问另一个函数作用域中变量的函数...
---

### ❌ 错误分段（缺乏上下文）
知识点 #42：
"闭包是指有权访问另一个函数作用域中变量的函数..."

→ 问题：用户检索到这条时，不知道"闭包"是什么领域的

### ✅ 正确分段（补充上下文）
知识点 #42：
---
> 📖 **文档**：JavaScript 高级程序设计
> 📍 **章节**：第三章 > 3.1 闭包的定义
> 📝 **前文**：本章介绍 JavaScript 中的闭包概念，它是函数式编程的重要特性。

闭包是指有权访问另一个函数作用域中变量的函数...
---

→ 优点：即使单独命中，也能理解上下文
```

### 技能清单

| 技能名 | 功能 | 输入 | 输出 |
|--------|------|------|------|
| `kb-analyze-topic` | 分析文档主题，判断归属 | markdown, kb_id | { topic, suggested_parent, is_relevant } |
| `kb-chunk-smart` | 智能分段 + 上下文补充 | markdown, options | { chunks[] } |
| `kb-create-point` | 创建知识点记录 | chunk, parent_id | { point_id } |
| `kb-create-knowledge` | 创建知识记录 | title, summary, kb_id | { knowledge_id } |

### 智能分段 Prompt

```javascript
const CHUNK_PROMPT = `
你是一个知识整理专家。请将以下文档内容分段，要求：

## 分段原则
1. 按语义边界分段，不要机械按字数切分
2. 每段大小 200-500 tokens
3. 保持代码块、表格、图片链接的完整性
4. 每段应该是一个独立可理解的知识单元

## 上下文补充
为每个分段添加：
- 文档标题
- 章节路径
- 前文摘要（100字以内）

## 输出格式
{
  "chunks": [
    {
      "title": "分段标题",
      "content": "分段内容",
      "context": {
        "document": "文档标题",
        "path": "章节路径",
        "summary": "前文摘要"
      }
    }
  ]
}

## 文档内容
{{markdown}}
`;
```

---

## 阶段3：向量化（后台异步）

### 处理流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    向量化阶段                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  触发条件：知识点创建后自动触发                                       │
│                                                                     │
│  Step 1: 准备文本                                                   │
│  ─────────────────                                                  │
│  拼接：标题 + 上下文 + 内容                                         │
│  const textForEmbedding = `                                         │
│    ${point.context.document}                                        │
│    ${point.context.path}                                           │
│    ${point.title}                                                  │
│    ${point.content}                                                │
│  `;                                                                │
│                                                                     │
│  Step 2: 调用 Embedding API                                         │
│  ─────────────────                                                  │
│  - 使用知识库配置的 embedding_model                                 │
│  - 生成向量（如 1536 维）                                           │
│                                                                     │
│  Step 3: 存储                                                       │
│  ─────────────────                                                  │
│  - 写入 knowledge_points.embedding 字段                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 技能清单

| 技能名 | 功能 | 执行方式 |
|--------|------|----------|
| `kb-embed` | 生成向量嵌入 | 后台异步 |

---

## 阶段4：知识图谱构建（后台异步）

### 处理流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                    知识图谱构建阶段                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  触发条件：知识点向量化完成后触发                                     │
│                                                                     │
│  Step 1: 向量检索                                                   │
│  ─────────────────                                                  │
│  - 找出与新知识点相似的现有知识点（Top-K）                           │
│  - 相似度阈值：0.7                                                  │
│                                                                     │
│  Step 2: LLM 关系分析                                               │
│  ─────────────────                                                  │
│  - 对比新知识点与候选知识点                                         │
│  - 判断关系类型：depends_on / related_to / references / extends    │
│  - 输出置信度                                                       │
│                                                                     │
│  Step 3: 建立关系                                                   │
│  ─────────────────                                                  │
│  - 写入 knowledge_relations 表                                      │
│  - 记录 confidence 和 created_by = 'llm'                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 技能清单

| 技能名 | 功能 | 执行方式 |
|--------|------|----------|
| `kb-relate` | 分析知识点关联，建立关系 | 后台异步 |

---

## 专家技能汇总

### 文档清洗专家技能

| 技能名 | 功能 | 阶段 |
|--------|------|------|
| `kb-clean-file` | 解析文件，提取文本和媒体 | 清洗 |
| `kb-ocr-image` | VL模型 OCR + 描述 | 清洗 |
| `kb-upload-media` | 上传媒体到对象存储 | 清洗 |

### 知识整理专家技能

| 技能名 | 功能 | 阶段 |
|--------|------|------|
| `kb-analyze-topic` | 分析文档主题，判断归属 | 构造 |
| `kb-chunk-smart` | 智能分段 + 上下文补充 | 构造 |
| `kb-create-point` | 创建知识点记录 | 构造 |
| `kb-create-knowledge` | 创建知识记录 | 构造 |

### 后台异步技能

| 技能名 | 功能 | 阶段 |
|--------|------|------|
| `kb-embed` | 生成向量嵌入 | 向量化 |
| `kb-relate` | 分析知识点关联 | 图谱构建 |

---

## 对话式导入流程示例

```
┌─────────────────────────────────────────────────────────────────────┐
│  用户: 帮我把这份 React 教程导入到技术文档库                          │
│        [📎 React基础教程.pdf]                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  文档清洗专家 🧹:                                                    │
│  ─────────────                                                      │
│  好的，我来处理这份 React 教程。                                     │
│                                                                     │
│  📊 **文档清洗中...**                                               │
│  - 解析 PDF 结构...                                                │
│  - 提取图片 12 张，正在 OCR 处理...                                 │
│  - 上传媒体到对象存储...                                            │
│                                                                     │
│  ✅ **清洗完成！**                                                  │
│  - 生成 Markdown：约 15000 字                                       │
│  - 媒体文件：12 张图片已上传                                        │
│                                                                     │
│  现在转交给知识整理专家处理...                                       │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  知识整理专家 📚:                                                    │
│  ─────────────                                                      │
│  我来分析这份文档。                                                 │
│                                                                     │
│  📋 **文档分析**                                                    │
│  - 主题：React 前端框架                                             │
│  - 建议归属：技术文档库 > 前端开发 > React                          │
│  - 识别到 5 个主要章节                                              │
│  - 预计拆分为 23 个知识点                                           │
│                                                                     │
│  📖 **章节预览：**                                                  │
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
│  知识整理专家 📚:                                                    │
│  ─────────────                                                      │
│  明白了！正在导入...                                                │
│                                                                     │
│  ✅ **导入完成！**                                                  │
│  - 创建知识：React基础教程                                          │
│  - 创建知识点：23 个（已补充上下文）                                 │
│  - 正在后台生成向量...                                              │
│  - 正在后台构建知识图谱...                                          │
│                                                                     │
│  📖 现在可以在知识库中查看这份教程了。                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 专家 System Prompt

### 文档清洗专家

```markdown
你是文档清洗专家，专门负责将各类文档转换为结构化的 Markdown 格式。

## 你的职责

1. **格式转换**：解析 PDF、DOCX、HTML 等格式
2. **媒体处理**：提取图片、表格，使用 VL 模型进行 OCR 和描述
3. **存储管理**：将媒体文件上传到对象存储

## 工作方式

- 自动识别文档格式
- 对于图片，调用 VL 模型生成描述和 OCR
- 保持原始文档的结构（标题、章节、列表）
- 输出干净的 Markdown 文本

## 可用技能

- kb-clean-file: 解析文件
- kb-ocr-image: VL模型处理图片
- kb-upload-media: 上传媒体文件
```

### 知识整理专家

```markdown
你是知识整理专家，专门负责将清洗后的文档整理成知识点并入库。

## 你的职责

1. **归属判断**：分析文档主题，判断应该放入知识库的哪个位置
2. **智能分段**：按语义边界分段，保持内容完整性
3. **上下文补充**：为每个分段补充文档标题、章节路径、前文摘要
4. **入库管理**：创建知识点记录，建立层级关系

## 工作方式

- 导入前先展示预览，让用户确认
- 如果文档明显不属于目标知识库，及时返回错误
- 分段时保持媒体链接、代码块、表格的完整性
- 每个知识点都应该能独立理解

## 可用技能

- kb-analyze-topic: 分析文档主题
- kb-chunk-smart: 智能分段
- kb-create-point: 创建知识点
- kb-create-knowledge: 创建知识
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

1. ~~**Embedding 模型选择**~~ → 已解决，见下方设计决策 #5
2. ~~**专家集成方式**~~ → 已解决，见下方 RAG 集成方案
   - 知识库如何与专家对话结合？
   - 检索结果如何注入到 Prompt？

3. **多租户隔离**
   - 知识库是否需要支持团队/组织级别？

---

## RAG 集成方案 ✅ 新增

### 问题背景

检索结果如何注入到 LLM 的 Prompt 中？这是 RAG 系统的核心问题。

### 方案对比

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RAG 集成方案对比                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  方案1: System Prompt 注入                                           │
│  ─────────────────────                                              │
│  将检索结果作为系统提示的一部分，在对话开始时注入                        │
│  优点：上下文稳定，LLM 始终能看到                                      │
│  缺点：占用 System Prompt 空间，不适合动态检索                         │
│                                                                     │
│  方案2: User Message 注入                                            │
│  ─────────────────────                                              │
│  将检索结果作为用户消息的上下文，每次查询时注入                          │
│  优点：灵活，支持动态检索                                             │
│  缺点：每次都要携带，可能重复                                          │
│                                                                     │
│  方案3: 工具调用结果                                                  │
│  ─────────────────────                                              │
│  LLM 主动调用检索工具，自己决定如何使用检索结果                         │
│ 优点：最灵活，LLM 自主决定何时检索、如何使用                            │
│  缺点：需要多次 LLM 调用，延迟较高                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 决策：工具调用模式（Tool-based RAG）✅ 已确定

**选择方案3：LLM 主动调用检索工具，自己决定如何使用检索结果**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    RAG 集成：工具调用模式                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  核心理念                                                            │
│  ─────────                                                          │
│  - LLM 是智能体，有能力自主决定"何时检索"、"检索什么"、"如何使用"      │
│  - 检索技能是 LLM 的工具，而不是系统自动注入的上下文                    │
│  - LLM 可以多轮检索、深度分析、交叉验证                                │
│                                                                     │
│  优势                                                                │
│  ─────────                                                          │
│  ✅ 最灵活：LLM 自主决定检索时机和策略                                 │
│  ✅ 可解释：检索行为是显式的工具调用，可追踪                            │
│  ✅ 可控：LLM 可以判断检索结果是否相关，决定是否使用                    │
│  ✅ 可扩展：支持多轮检索、多知识库检索、混合检索                        │
│                                                                     │
│  劣势                                                                │
│  ─────────                                                          │
│  ❌ 延迟较高：需要多次 LLM 调用                                       │
│  ❌ 成本较高：每次检索都是一次 LLM 交互                                │
│  ❌ 依赖 LLM 能力：需要 LLM 有良好的工具调用能力                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 工具调用流程

专家通过技能调用主动检索知识：

```javascript
// 专家 System Prompt 中包含检索技能
const expertSystemPrompt = `
你是财务专家，可以帮助用户解答财务相关问题。

## 可用技能
- kb-list: 获取可访问的知识库列表
- kb-search-vector: 在知识库中搜索相关知识
- kb-get-point: 获取知识点详情
- kb-search-graph: 获取关联知识

## 工作方式
1. 当用户提问时，先判断是否需要检索知识库
2. 如果不确定有哪些知识库，先调用 kb-list 查看
3. 如果需要检索，调用 kb-search-vector 搜索相关知识
4. 根据搜索结果，调用 kb-get-point 获取完整内容
5. 基于检索到的知识，回答用户问题
6. 如果检索结果不相关，可以忽略或重新检索
`;
```

**对话流程示例**：

```
┌─────────────────────────────────────────────────────────────────────┐
│  用户: 公司的差旅报销标准是什么？                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LLM 思考:                                                           │
│  - 用户问的是公司内部规定，需要检索知识库                              │
│  - 调用 kb-search-vector(query="差旅报销标准")                       │
│                                                                     │
│  Tool Call: kb-search-vector                                        │
│  Arguments: { query: "差旅报销标准", kb_id: "kb-finance" }           │
│                                                                     │
│  Tool Result:                                                       │
│  [                                                                  │
│    { point_id: "p-001", title: "差旅报销标准", similarity: 0.92 },  │
│    { point_id: "p-002", title: "住宿标准", similarity: 0.85 }       │
│  ]                                                                  │
│                                                                     │
│  LLM 思考:                                                           │
│  - 找到了相关知识点，需要获取完整内容                                  │
│  - 调用 kb-get-point(point_id="p-001")                              │
│                                                                     │
│  Tool Call: kb-get-point                                            │
│  Arguments: { point_id: "p-001" }                                   │
│                                                                     │
│  Tool Result:                                                       │
│  {                                                                  │
│    title: "差旅报销标准",                                            │
│    content: "1. 交通费：实报实销...\n2. 住宿费：一线城市500元/天..."  │
│  }                                                                  │
│                                                                     │
│  LLM 回复:                                                           │
│  根据公司规定，差旅报销标准如下：                                      │
│  1. 交通费：实报实销，需提供正规发票                                   │
│  2. 住宿费：一线城市500元/天，二线城市400元/天...                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 多轮检索示例

对于复杂问题，LLM 可以进行多轮检索：

```
┌─────────────────────────────────────────────────────────────────────┐
│  用户: 我想了解公司的休假制度，特别是年假和病假的规定                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LLM 思考:                                                           │
│  - 用户问的是休假制度，涉及多个方面                                    │
│  - 先检索年假相关规定                                                │
│                                                                     │
│  Tool Call: kb-search-vector                                        │
│  Arguments: { query: "年假规定", kb_id: "kb-hr" }                    │
│                                                                     │
│  Tool Result:                                                       │
│  [                                                                  │
│    { point_id: "p-101", title: "年假制度", similarity: 0.95 }       │
│  ]                                                                  │
│                                                                     │
│  LLM 思考:                                                           │
│  - 获取年假详情                                                      │
│  - 然后检索病假相关规定                                              │
│                                                                     │
│  Tool Call: kb-get-point                                            │
│  Arguments: { point_id: "p-101" }                                   │
│                                                                     │
│  Tool Call: kb-search-vector                                        │
│  Arguments: { query: "病假规定", kb_id: "kb-hr" }                    │
│                                                                     │
│  Tool Result (parallel):                                            │
│  1. { title: "年假制度", content: "..." }                            │
│  2. [ { point_id: "p-102", title: "病假制度", similarity: 0.93 } ]  │
│                                                                     │
│  LLM 思考:                                                           │
│  - 获取病假详情                                                      │
│                                                                     │
│  Tool Call: kb-get-point                                            │
│  Arguments: { point_id: "p-102" }                                   │
│                                                                     │
│  LLM 回复:                                                           │
│  根据公司休假制度：                                                   │
│  【年假】                                                            │
│  - 工龄满1年：5天                                                    │
│  - 工龄满10年：10天                                                  │
│  ...                                                                │
│  【病假】                                                            │
│  - 有薪病假：每年12天                                                │
│  - 需提供医院证明                                                    │
│  ...                                                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 专家配置：知识库权限

在专家配置中指定可访问的知识库：

```javascript
// 专家配置示例
const expertConfig = {
  id: 'finance-expert',
  name: '财务专家',
  description: '负责解答财务相关问题',
  
  // 知识库权限配置
  knowledge_bases: {
    // 允许访问的知识库ID列表
    allowed: ['kb-finance', 'kb-company-policy'],
    
    // 默认知识库（可选，用于简化调用）
    default: 'kb-finance'
  },
  
  // 可用的检索技能
  skills: [
    'kb-list',              // 列出可访问的知识库
    'kb-search-vector',     // 向量检索
    'kb-search-graph',      // 图谱检索
    'kb-get-point',         // 获取知识点详情
    'kb-get-knowledge'      // 获取知识（文档）详情
  ]
};
```

### 技能权限控制

检索技能会根据专家配置过滤可访问的知识库：

```javascript
// kb-search-vector 技能实现
async function kbSearchVector(params, context) {
  const { query, kb_id, top_k = 10, threshold = 0.7 } = params;
  const { expert } = context;
  
  // 权限检查：专家是否有权访问该知识库
  const allowedKbIds = expert.knowledge_bases?.allowed || [];
  
  if (kb_id && !allowedKbIds.includes(kb_id)) {
    return { error: '无权访问该知识库' };
  }
  
  // 如果没有指定 kb_id，搜索所有允许的知识库
  const searchKbIds = kb_id ? [kb_id] : allowedKbIds;
  
  // 执行检索...
  const results = await searchInKnowledgeBases(query, searchKbIds, { top_k, threshold });
  
  return results;
}

// kb-list 技能实现
async function kbList(params, context) {
  const { expert } = context;
  
  // 只返回专家有权访问的知识库
  const allowedKbIds = expert.knowledge_bases?.allowed || [];
  
  const knowledgeBases = await db.query(`
    SELECT id, name, description, point_count
    FROM knowledge_bases
    WHERE id IN (?) AND (owner_id = ? OR is_public = true)
  `, [allowedKbIds, context.userId]);
  
  return knowledgeBases;
}
```

### Prompt 模板设计

#### 专家 System Prompt 模板（带知识库能力）

```javascript
const EXPERT_SYSTEM_PROMPT_TEMPLATE = `
你是{{expert_name}}，{{expert_description}}。

## 知识库能力

你可以访问以下知识库：
{{#each knowledge_bases}}
- {{name}}：{{description}}
{{/each}}

## 检索技能

你可以使用以下技能检索知识：
- kb-list: 列出可访问的知识库
- kb-search-vector: 语义搜索，根据问题找到相关知识
- kb-get-point: 获取知识点完整内容
- kb-search-graph: 获取关联知识

## 使用建议

1. 对于简单问题，可以直接回答
2. 对于需要公司/组织内部信息的问题，请先检索知识库
3. 检索后请判断结果是否相关，不相关则忽略或重新检索
4. 回答时请注明信息来源（如"根据财务管理制度..."）
5. 如果需要更深入的信息，可以使用 kb-search-graph 获取关联知识
`;
```

### 实现优先级

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 检索技能实现 | kb-list, kb-search-vector, kb-get-point |
| P1 | 专家知识库配置 | 专家配置中设置可访问的知识库 |
| P1 | 技能权限控制 | 根据专家配置过滤可访问的知识库 |
| P2 | kb-search-graph | 知识图谱检索 |
| P2 | kb-search-hybrid | 混合检索 |

---

## 设计决策（补充）

### 5. 模型类型扩展 ✅ 新增

**背景**：当前 `ai_models` 表没有区分模型类型，无法在创建知识库时选择 Embedding 模型。

**决策**：扩展 `ai_models` 表，增加 `model_type` 字段

```sql
-- 扩展 ai_models 表
ALTER TABLE ai_models
ADD COLUMN model_type ENUM('text', 'multimodal', 'embedding') DEFAULT 'text'
COMMENT '模型类型：text=文字模型, multimodal=多模态模型, embedding=嵌入式模型'
AFTER model_name;

-- 添加索引
CREATE INDEX idx_model_type ON ai_models(model_type);
```

**模型类型说明**：

| 类型 | 说明 | 示例 |
|------|------|------|
| `text` | 文字模型（用于对话/生成） | GPT-4, DeepSeek Chat, Claude |
| `multimodal` | 多模态模型（支持图片/音频） | GPT-4V, Claude 3, Gemini |
| `embedding` | 嵌入式模型（用于向量化） | text-embedding-3-small, BGE |

**初始 Embedding 模型数据**：

```javascript
const embeddingModels = [
  {
    id: 'emb-openai-small',
    name: 'OpenAI Embedding Small',
    model_name: 'text-embedding-3-small',
    provider_id: providerIds.openai,
    model_type: 'embedding',
    max_tokens: 8191,
    description: 'OpenAI 最新嵌入模型，1536 维，性价比高'
  },
  {
    id: 'emb-openai-large',
    name: 'OpenAI Embedding Large',
    model_name: 'text-embedding-3-large',
    provider_id: providerIds.openai,
    model_type: 'embedding',
    max_tokens: 8191,
    description: 'OpenAI 最新嵌入模型，3072 维，精度更高'
  },
  {
    id: 'emb-bge-local',
    name: 'BGE Large (Local)',
    model_name: 'bge-large-zh-v1.5',
    provider_id: providerIds.ollama,  // 或本地服务
    model_type: 'embedding',
    max_tokens: 512,
    description: '本地部署的中文嵌入模型，1024 维'
  }
];
```

**前端选择器**：

创建知识库时，只显示 `model_type = 'embedding'` 的模型：

```javascript
// 获取可用的 Embedding 模型列表
const embeddingModels = await api.get('/api/models', {
  params: { model_type: 'embedding' }
});

// 创建知识库时选择
<form>
  <Select v-model="kb.embedding_model_id" :options="embeddingModels" />
  <Input v-model="kb.name" label="知识库名称" />
  ...
</form>
```

**API 扩展**：

```
GET /api/models?model_type=embedding    获取指定类型的模型列表
```

**影响范围**：

1. 数据库：`ai_models` 表新增 `model_type` 字段
2. 后端：`model.controller.js` 支持按类型筛选
3. 前端：模型管理界面显示模型类型标签
4. 知识库：创建时选择 Embedding 模型

---

*此文档持续更新中...*
