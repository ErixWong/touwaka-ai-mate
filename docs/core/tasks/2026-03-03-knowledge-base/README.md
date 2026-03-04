# 知识库系统设计

> 创建日期：2026-03-03
> 最后更新：2026-03-04
> 状态：⏳ 设计完成，待实现

## 需求概述

构建一个知识库系统，支持用户管理和检索知识，为 RAG（检索增强生成）提供基础设施。

### 核心需求

1. **多知识库支持**：用户可创建多个独立的知识库
2. **文档导入技能**：提供一组技能将用户文档转换为知识
3. **向量检索**：支持语义相似度搜索（RAG）
4. **知识结构化**：知识 + 知识点的层级结构

---

## 概念模型（南瓜模型）

> **核心隐喻**：知识库像南瓜藤，藤蔓有很多分支，每个分支可以是花（待完善）或瓜（知识点）。路径很重要，通过路径可以实现漫游。枝蔓向上追溯可以获得更大图景，找到相邻知识。知识更多富集于末端。

```
KnowledgeBase（知识库）
└── Knowledge（文章，自关联形成树状结构）
    │   parent_id → 父文章（NULL 表示根文章）
    │   中间节点：目录 + 简略知识点（如模块介绍、版本、scope）
    │   叶子节点：详细知识点
    │
    └── KnowledgePoint（知识点，属于某篇文章）
            content → 原子化的知识点内容（Markdown）
            context → 上下文信息（用于向量化，提高检索精度）
```

### 示例结构

```
📚 SAP运维手册知识库
├── 📁 MM采购模块（文章，parent_id=NULL）
│   │   📖 知识点：模块介绍、当前版本、scope（简略）
│   │
│   ├── 📁 采购计划维护（文章，parent_id=MM采购模块）
│   │   │   📖 知识点：章节介绍（简略）
│   │   ├── 📖 段落1：采购计划类型说明（知识点，详细）
│   │   ├── 📖 段落2：创建采购计划步骤（知识点，详细）
│   │   └── 📖 段落3：修改采购计划（知识点，详细）
│   │
│   └── 📁 价格管理（文章，parent_id=MM采购模块）
│       └── ...
│
└── 📁 SD销售模块（文章，parent_id=NULL）
    └── ...
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
│  embedding_model_id │  ← 关联 ai_models 表
│  embedding_dim      │  ← 向量维度（如 1536）
│  is_public          │  ← 预留，暂不使用
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
│  parent_id (FK)     │  ← 自关联，形成树状结构 ⭐
│  title              │
│  summary            │  ← LLM 生成的摘要
│  source_type        │  ← 'file' | 'web' | 'manual'
│  source_url         │
│  file_path          │  ← 原始文件存储路径
│  status             │  ← 'pending' | 'processing' | 'ready' | 'failed'
│  position           │  ← 同级排序
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
│  title              │
│  content            │  ← 实际内容（Markdown，媒体用 URL 嵌入）
│  context            │  ← 上下文信息（纯文本，用于向量化）⭐
│  embedding          │  ← 向量字段（BLOB）
│  position           │  ← 同级排序
│  token_count        │  ← Token 数量（用于统计）
│  created_at         │
│  updated_at         │
└──────────┬──────────┘
           │
           │ N:M（语义关联，后期实现）
           ▼
┌─────────────────────┐
│  KnowledgeRelation  │
│  ─────────────────  │
│  id (PK)            │
│  source_id (FK)     │
│  target_id (FK)     │
│  relation_type      │  ← 'depends_on' | 'references' | 'related_to' | 'extends' | 'example_of'
│  confidence         │  ← LLM 置信度 (0-1)
│  created_by         │  ← 'llm' | 'manual'
│  created_at         │
└─────────────────────┘
```

### 表结构 SQL（最终版）

```sql
-- 知识库表
CREATE TABLE knowledge_bases (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id INT NOT NULL,
    embedding_model_id VARCHAR(50),  -- 关联 ai_models 表
    embedding_dim INT DEFAULT 1536,
    is_public BOOLEAN DEFAULT FALSE,  -- 预留，暂不使用
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE INDEX idx_kb_owner ON knowledge_bases(owner_id);

-- 文章表（自关联形成树状结构）
CREATE TABLE knowledges (
    id INT PRIMARY KEY AUTO_INCREMENT,
    kb_id INT NOT NULL,
    parent_id INT DEFAULT NULL,  -- 自关联，形成树状结构
    title VARCHAR(500) NOT NULL,
    summary TEXT,
    source_type ENUM('file', 'web', 'manual') DEFAULT 'manual',
    source_url VARCHAR(1000),
    file_path VARCHAR(500),
    status ENUM('pending', 'processing', 'ready', 'failed') DEFAULT 'pending',
    position INT DEFAULT 0,  -- 同级排序
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES knowledges(id) ON DELETE CASCADE
);

CREATE INDEX idx_knowledge_kb ON knowledges(kb_id);
CREATE INDEX idx_knowledge_parent ON knowledges(parent_id);

-- 知识点表（属于某篇文章）
CREATE TABLE knowledge_points (
    id INT PRIMARY KEY AUTO_INCREMENT,
    knowledge_id INT NOT NULL,
    title VARCHAR(500),
    content MEDIUMTEXT NOT NULL,  -- Markdown 格式，媒体用 URL 嵌入
    context TEXT,  -- 上下文信息（纯文本，用于向量化）
    embedding BLOB,  -- 向量（JSON 序列化）
    position INT DEFAULT 0,
    token_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (knowledge_id) REFERENCES knowledges(id) ON DELETE CASCADE
);

CREATE INDEX idx_kp_knowledge ON knowledge_points(knowledge_id);

-- 知识点关联表（语义关系，后期实现）
CREATE TABLE knowledge_relations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    source_id INT NOT NULL,
    target_id INT NOT NULL,
    relation_type ENUM('depends_on', 'references', 'related_to', 'contradicts', 'extends', 'example_of') NOT NULL,
    confidence DECIMAL(3,2) DEFAULT 1.00,
    created_by ENUM('llm', 'manual') DEFAULT 'llm',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
    UNIQUE KEY unique_relation (source_id, target_id, relation_type)
);

CREATE INDEX idx_kr_source ON knowledge_relations(source_id);
CREATE INDEX idx_kr_target ON knowledge_relations(target_id);
CREATE INDEX idx_kr_type ON knowledge_relations(relation_type);
```

### 设计要点说明

1. **文章自关联（parent_id）**：文章通过 parent_id 形成树状结构，便于组织和漫游
2. **知识点属于文章**：知识点不再有层级，都属于某篇文章
3. **上下文字段（context）**：纯文本格式，用于向量化时提供语境，提高检索精度
4. **内容统一 Markdown**：媒体文件通过 URL 嵌入在 Markdown 中，不再区分 content_type

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
  // 语义关联（LLM 维护）
  REFERENCES: 'references',    // 引用关系
  RELATED_TO: 'related_to',    // 相关关系
  DEPENDS_ON: 'depends_on',    // 依赖关系
  CONTRADICTS: 'contradicts',  // 矛盾关系
  EXTENDS: 'extends',          // 扩展关系
  EXAMPLE_OF: 'example_of',    // 例证关系
}
```

> ⚠️ **注意**：物理层级关系通过 `knowledges` 表的 `parent_id` 字段实现，不需要在 `knowledge_relations` 表中存储。

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

| 关系类型        | 方向 | 含义                            | 示例                                           |
| --------------- | ---- | ------------------------------- | ---------------------------------------------- |
| `depends_on`  | 有向 | A 依赖 B（理解 A 需要先理解 B） | "闭包" depends_on "作用域"                     |
| `references`  | 有向 | A 引用/提及 B                   | "详见第三章" references "第三章"               |
| `related_to`  | 无向 | A 与 B 主题相关                 | "React Hooks" related_to "Vue Composition API" |
| `contradicts` | 无向 | A 与 B 观点矛盾                 | "地心说" contradicts "日心说"                  |
| `extends`     | 有向 | A 是 B 的扩展/深化              | "高级优化" extends "基础优化"                  |
| `example_of`  | 有向 | A 是 B 的例子                   | "快速排序代码" example_of "快速排序算法"       |

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

| 维度 | 传统知识库 | 知识图谱     |
| ---- | ---------- | ------------ |
| 结构 | 树状/扁平  | 网状图       |
| 关系 | 只有层级   | 多种语义关系 |
| 查询 | 按目录导航 | 按关系探索   |
| 发现 | 被动查找   | 主动推荐     |

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

**决策：本地文件系统 + Markdown 嵌入**

```
┌─────────────────────────────────────────────────────────────────────┐
│                       图片存储架构                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   存储位置：data/kb-images/                                          │
│   文件命名：{knowledge_id}_{timestamp}_{hash}.png                    │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │  knowledge_points 表（统一 Markdown 格式）                   │   │
│   │  ─────────────────────────────────────────────────────────  │   │
│   │  content = "![React 组件生命周期图](/kb-images/123_xxx.png)  │   │
│   │                                                          "    │   │
│   │  context = "本文档属于React教程 > 第三章 > 生命周期"          │   │
│   │                                                              │   │
│   │  图片元数据存储在关联的 media 表中（可选）：                   │   │
│   │  {                                                            │   │
│   │    path: "/kb-images/123_1709123456_abc123.png",            │   │
│   │    alt: "React 组件生命周期图",    // LLM 生成的描述          │   │
│   │    ocr_text: "Mounting...",       // OCR 提取的文字（可选）   │   │
│   │    width: 800,                                               │   │
│   │    height: 600,                                              │   │
│   │    original_name: "lifecycle.png"                            │   │
│   │  }                                                          │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

> ⚠️ **设计决策 #4 说明**：所有知识点内容统一使用 Markdown 格式，媒体通过 URL 嵌入。不再区分 `content_type`。

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

| 检索方式   | 实现方式                     | 说明                 |
| ---------- | ---------------------------- | -------------------- |
| 文本检索   | 搜索 `alt` 和 `ocr_text` | 基于图片描述搜索     |
| 语义检索   | 对 `alt` 生成 embedding    | 图片本身不做向量嵌入 |
| 上下文关联 | 关联到父知识点               | 随文档章节一起展示   |

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

### 4. 内容存储格式 ✅ 确定

**决策：统一使用 Markdown 格式**

- 所有知识点内容统一用 Markdown 格式存储
- 媒体文件（图片、视频）通过 URL 嵌入在 Markdown 中
- 不再区分 content_type，简化存储结构

**为什么用 Markdown？**

1. **通用性**：所有 LLM 都能理解和生成 Markdown
2. **可读性**：人类和 AI 都容易阅读
3. **灵活性**：支持代码、表格、图片、公式等多种内容
4. **兼容性**：与现有文档格式（PDF、DOCX）转换容易
5. **渲染友好**：前端可直接用 Markdown 渲染器展示

### 5. 上下文字段（context）✅ 确定

**决策：添加 context 字段，纯文本格式**

**问题**：知识点原子化后，检索时缺乏语境，容易误判

**解决方案**：

- 存储时保持原子化（content 是纯净的知识点）
- 添加 `context` 字段存储上下文信息（纯文本）
- 向量化时拼接 `context + content`

**context 内容示例**：

```
本文档属于"SAP运维手册 > MM采购模块 > 采购计划维护"章节。
本章介绍 SAP 采购计划的创建和维护流程，适用于采购员角色。
```

**向量化时的拼接**：

```javascript
const textForEmbedding = `
[上下文] ${context}

[内容] ${title}
${content}
`;
```

### 6. 向量存储方案 ✅ 确定

| 阶段 | 方案                       | 说明                                          |
| ---- | -------------------------- | --------------------------------------------- |
| MVP  | MySQL BLOB + 内存计算      | 向量存为 BLOB，检索时加载到内存计算余弦相似度 |
| 优化 | MySQL HeatWave 或 pgvector | 数据量大时迁移                                |
| 生产 | Milvus/Qdrant              | 百万级向量时考虑                              |

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

技能分为三类：

| 类别                     | 说明                              | 使用者       | 命名前缀 |
| ------------------------ | --------------------------------- | ------------ | -------- |
| **通用技能**       | 文档处理、OCR、媒体上传等基础能力 | 所有专家     | 无前缀   |
| **知识库管理技能** | 知识库的创建、导入、整理等        | 知识整理专家 | `kb-`  |
| **知识库检索技能** | 知识检索、读取等                  | 所有专家     | `kb-`  |

---

### 通用技能（非知识库专用）

> ⚠️ 这些技能是通用的文档处理能力，不仅限于知识库使用。它们应该放在 `data/skills/` 目录下作为独立技能存在。

| 技能名           | 功能             | 输入                 | 输出                         | 说明                           |
| ---------------- | ---------------- | -------------------- | ---------------------------- | ------------------------------ |
| `file-parse`   | 解析各类文件格式 | file_path            | { markdown, media[] }        | 支持 PDF、DOCX、HTML、Markdown |
| `ocr-image`    | 图片 OCR + 描述  | image_data           | { text, alt, ocr_text }      | 调用 VL 模型                   |
| `media-upload` | 上传媒体到存储   | image_data, filename | { url, path }                | 支持本地/S3/OSS                |
| `web-fetch`    | 抓取网页内容     | url                  | { title, content, markdown } | 网页内容提取                   |

**通用技能位置**：`data/skills/file-operations/`, `data/skills/http-client/` 等

---

### 知识库管理技能（知识整理专家专用）

| 技能名              | 功能               | 输入                                  | 输出           | 依赖       |
| ------------------- | ------------------ | ------------------------------------- | -------------- | ---------- |
| `kb-create`       | 创建知识库         | name, description, embedding_model_id | kb_id          | -          |
| `kb-import-file`  | 导入文件到知识库   | file_path, kb_id                      | knowledge_id   | file-parse |
| `kb-import-web`   | 导入网页到知识库   | url, kb_id                            | knowledge_id   | web-fetch  |
| `kb-chunk`        | 智能分块           | knowledge_id                          | point_ids[]    | -          |
| `kb-embed`        | 生成向量嵌入       | kb_id 或 point_ids                    | 更新 embedding | -          |
| `kb-relate`       | LLM 分析知识点关联 | kb_id                                 | 创建 relations | -          |
| `kb-update-point` | 更新知识点         | point_id, content                     | 更新结果       | -          |
| `kb-delete-point` | 删除知识点         | point_id                              | 删除结果       | -          |
| `kb-merge-points` | 合并知识点         | point_ids[]                           | new_point_id   | -          |

---

### 知识库检索技能（所有专家可用）

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
  - id, title, content          # content 为 Markdown 格式
  - context                      # 上下文信息（用于向量化）
  - position, token_count
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

| 场景              | 是否启用过滤 | 说明               |
| ----------------- | ------------ | ------------------ |
| 检索结果 ≤ 3 条  | 否           | 结果少，噪音影响小 |
| 检索结果 > 5 条   | 是（审阅）   | 需要过滤噪音       |
| 内容 > 4000 token | 是（压缩）   | 避免上下文溢出     |
| 高精度场景        | 是（全部）   | 如法律、医疗知识库 |
| 快速响应场景      | 否           | 优先速度而非精度   |

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

### 复杂度问题

**朴素方法**：每个知识点与所有其他知识点比较

- 100 个知识点 → 100 × 100 = 10,000 次 LLM 调用
- 1000 个知识点 → 1,000,000 次 LLM 调用
- **不可接受！**

### 优化策略：向量预筛选 + 批量分析

```
┌─────────────────────────────────────────────────────────────────────┐
│                    知识图谱构建优化策略                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  新知识点入库                                                        │
│       │                                                             │
│       ▼                                                             │
│  Step 1: 向量检索 Top-K 相似知识点（K=10）                           │
│       │                                                             │
│       ▼                                                             │
│  Step 2: 批量 LLM 分析（一次调用分析多个关系）                        │
│       │                                                             │
│       ▼                                                             │
│  Step 3: 写入 knowledge_relations 表                                │
│       │                                                             │
│       ▼                                                             │
│  完成（O(1) 复杂度，而不是 O(n²)）                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**成本估算**：

- 每个新知识点：1 次向量检索 + 1 次 LLM 调用
- 1000 个知识点 → 1000 次 LLM 调用（而不是 1,000,000 次）

### 完整流程图

```
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
│  Step 3: 向量化 │  为每个知识点生成 Embedding（context + content）
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 4: 图谱构建（增量，优化后）                                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  4a. 向量检索：找出与新知识点相似的现有知识点（Top-10）         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                        │
│                          ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  4b. 批量 LLM 分析：一次调用分析新知识点与所有候选的关系        │   │
│  │                                                              │   │
│  │  Prompt: "分析新知识点与以下候选知识点的关系：                 │   │
│  │           候选1: [p-001] 作用域的概念                         │   │
│  │           候选2: [p-002] 函数的定义                           │   │
│  │           ...                                                │   │
│  │           输出每个候选与新知识点的关系（或无关系）。"           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                          │                                        │
│                          ▼                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  4c. 建立关系：将判断结果写入 knowledge_relations 表          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
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

## 用户界面设计 ✅ 已确定

### 入口位置

新增顶部 Tab，与"专家列表"、"对话"并列：

```
[专家列表]    [对话]    [知识库]    [任务]    [设置]
```

### 页面结构

#### 知识库列表页（大图标卡片布局）

类似 macOS Launchpad 或 Windows 开始菜单的风格：

```
┌─────────────────────────────────────────────────────────────────────┐
│  [专家列表]    [对话]    [知识库]    [任务]    [设置]      用户头像   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   📚             │  │   📖             │  │   📁             │     │
│  │   SAP运维手册    │  │   质量体系文件   │  │   IT制度规范     │     │
│  │   156 知识点     │  │   89 知识点      │  │   234 知识点     │     │
│  │   更新于 3天前   │  │   更新于 1周前   │  │   更新于 2天前   │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   📝             │  │   🔧             │  │   ➕             │     │
│  │   个人笔记       │  │   项目文档       │  │   新建知识库     │     │
│  │   45 知识点      │  │   12 知识点      │  │                  │     │
│  │   更新于 今天    │  │   更新于 1月前   │  │                  │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**卡片内容**：

- 图标（可自定义或自动生成）
- 知识库名称
- 知识点数量
- 最后更新时间

**交互**：

- 点击卡片 → 进入知识库详情页
- 右键卡片 → 编辑、删除、导出等操作
- 点击"新建知识库"卡片 → 创建新知识库

#### 知识库详情页（左侧树 + 右侧内容）

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← 返回    📖 SAP运维手册知识库                    [导入] [搜索] [⋮] │
├───────────────────────┬─────────────────────────────────────────────┤
│                       │                                             │
│  📁 MM 采购模块       │  📖 采购计划类型说明                         │
│  ├── 📁 采购计划维护   │  ─────────────────────────                 │
│  │   ├── 📖 类型说明   │                                             │
│  │   ├── 📖 创建计划   │  **位置**：MM采购模块 > 采购计划维护         │
│  │   └── 📖 修改计划   │  **更新**：2026-03-01                       │
│  ├── 📁 价格管理       │                                             │
│  │   └── ...          │  ---                                        │
│  └── 📁 供应商管理     │                                             │
│                       │  SAP 系统支持多种采购计划类型：               │
│  📁 SD 销售模块       │                                             │
│  ├── 📁 客户管理       │  | 计划类型 | 代码 | 适用场景 |              │
│  └── 📁 销售订单       │  |---------|------|---------|              │
│                       │  | 手工采购计划 | UB | 临时性采购 |          │
│  📁 FI 财务模块       │  | MRP 计划 | PD | 常规物料 |               │
│                       │  | 预测计划 | VB | 季节性物料 |             │
│                       │                                             │
│                       │  ![流程图](/kb-images/flow.png)              │
│                       │                                             │
└───────────────────────┴─────────────────────────────────────────────┘
```

**左侧导航树**：

- 使用 Element Plus Tree 组件
- 显示文章的树状结构
- 点击文章节点 → 右侧显示该文章的知识点列表
- 点击知识点 → 右侧显示知识点详情

**右侧内容区**：

- 文章节点：显示文章摘要 + 知识点列表
- 知识点：显示 Markdown 渲染后的内容

### 交互说明

| 操作           | 效果                         |
| -------------- | ---------------------------- |
| 点击知识库卡片 | 进入知识库详情页             |
| 点击左侧树节点 | 右侧显示对应内容             |
| 点击"导入"按钮 | 打开导入对话框（上传文件）   |
| 点击"搜索"按钮 | 打开搜索面板（支持语义搜索） |
| 右键树节点     | 编辑、删除、新增子节点等操作 |

### 知识库案例参考

不同类型的知识库有不同的结构特点，详见 [案例集](./cases/README.md)：

| 案例                                           | 类型         | 结构特点                   |
| ---------------------------------------------- | ------------ | -------------------------- |
| [SAP运维手册](./cases/case-sap-operations.md)     | 系统操作手册 | 模块→功能→操作，三级结构 |
| [AI论文库](./cases/case-ai-papers.md)             | 学术论文     | 主题分类+引用关系图谱      |
| [员工培训体系](./cases/case-employee-training.md) | 培训/SOP     | 岗位→流程→操作，三级结构 |

---

## 知识图谱可视化 ✅ 已确定

### 入口位置

在左侧树状结构导航栏底部添加"知识图谱"面板入口：

```
┌───────────────────────┐
│  📁 MM 采购模块       │
│  ├── 📁 采购计划维护   │
│  ├── 📁 价格管理       │
│  └── 📁 供应商管理     │
│                       │
│  📁 SD 销售模块       │
│  └── ...              │
│                       │
├───────────────────────┤
│  📊 知识图谱           │  ← 底部面板入口
└───────────────────────┘
```

### 右侧展示

点击"知识图谱"后，右侧切换为图谱视图：

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← 返回    📊 SAP运维手册知识库 - 知识图谱                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                     ┌──────────┐                                   │
│                     │ 闭包概念  │                                   │
│                     └────┬─────┘                                   │
│                          │ depends_on                              │
│           ┌──────────────┼──────────────┐                          │
│           ▼              ▼              ▼                          │
│     ┌──────────┐   ┌──────────┐   ┌──────────┐                    │
│     │ 作用域    │   │ 函数     │   │ 变量     │                    │
│     └────┬─────┘   └────┬─────┘   └────┬─────┘                    │
│          │              │              │                            │
│          │ related_to   │ example_of   │                            │
│          ▼              ▼              ▼                          │
│     ┌──────────┐   ┌──────────┐   ┌──────────┐                    │
│     │ 全局变量  │   │回调函数   │   │局部变量   │                    │
│     └──────────┘   └──────────┘   └──────────┘                    │
│                                                                     │
│  ─────────────────────────────────────────────────────────────────  │
│  点击节点查看详情 | 拖拽节点重新布局 | 双击节点跳转             │
└─────────────────────────────────────────────────────────────────────┘
```

### 技术选型（待定）

> ⚠️ **开放问题**：最终选择哪个控件需要在实现时确定，以下是各控件的详细对比。

#### 方案对比

| 库                     | 特点                   | 包体积 | 学习曲线 | 性能 | 推荐场景     |
| ---------------------- | ---------------------- | ------ | -------- | ---- | ------------ |
| **vis-network**  | 简单易用，开箱即用     | ~200KB | 低       | 中   | MVP 快速实现 |
| **D3.js**        | 最灵活，可定制性强     | ~500KB | 高       | 高   | 复杂定制需求 |
| **Cytoscape.js** | 专为图分析设计         | ~1MB   | 中       | 高   | 大规模图谱   |
| **AntV G6**      | 中文文档友好，功能丰富 | ~800KB | 中       | 高   | 企业级应用   |

#### 详细分析

##### 1. vis-network（推荐 MVP 使用）

**优点**：

- ✅ 开箱即用，上手快
- ✅ 文档友好，示例丰富
- ✅ 支持拖拽、缩放、点击等交互
- ✅ 轻量级（~200KB）

**缺点**：

- ❌ 定制性一般
- ❌ 复杂布局算法有限

**代码示例**：

```javascript
import { Network } from 'vis-network';

const nodes = [
  { id: 1, label: '闭包概念' },
  { id: 2, label: '作用域' },
  { id: 3, label: '函数' }
];

const edges = [
  { from: 1, to: 2, label: 'depends_on' },
  { from: 1, to: 3, label: 'depends_on' }
];

new Network(container, { nodes, edges }, {
  nodes: { shape: 'box' },
  edges: { arrows: 'to' }
});
```

##### 2. D3.js（推荐后期迁移）

**优点**：

- ✅ 最灵活，完全可控
- ✅ 社区活跃，生态丰富
- ✅ 可以实现任何自定义效果

**缺点**：

- ❌ 学习曲线陡峭
- ❌ 需要自己实现很多功能
- ❌ 代码量大

**适用场景**：需要高度定制化的知识图谱可视化，如自定义节点样式、复杂动画、特殊布局等。

##### 3. Cytoscape.js

**优点**：

- ✅ 专为图分析设计
- ✅ 性能好，支持大规模图谱（10000+ 节点）
- ✅ 内置多种布局算法（力导向、层次、圆形等）
- ✅ 支持图分析算法（最短路径、聚类等）

**缺点**：

- ❌ 包体积较大（~1MB）
- ❌ 对于简单场景有点重

**适用场景**：知识库规模大（1000+ 知识点），需要进行图分析（如社区发现、关键路径分析）。

##### 4. AntV G6（蚂蚁集团）

**优点**：

- ✅ 中文文档友好
- ✅ 功能丰富（图分析、树图、流程图等）
- ✅ 企业级方案，经过大规模验证
- ✅ 内置多种布局和分析算法

**缺点**：

- ❌ 包体积大（~800KB）
- ❌ 某些高级功能需要配置

**适用场景**：国内团队，需要中文支持，企业级应用。

#### 推荐方案

| 阶段           | 推荐控件              | 理由                             |
| -------------- | --------------------- | -------------------------------- |
| **MVP**  | vis-network           | 快速实现，满足基本需求           |
| **后期** | D3.js 或 Cytoscape.js | 需要更复杂的定制或分析功能时迁移 |

#### 决策因素

选择时需要考虑：

1. **知识库规模**：100 个知识点以内用 vis-network，1000+ 考虑 Cytoscape.js
2. **定制需求**：简单展示用 vis-network，复杂交互用 D3.js
3. **团队熟悉度**：D3.js 需要学习成本
4. **性能要求**：大规模图谱优先 Cytoscape.js

### 交互功能

| 功能      | 说明                        |
| --------- | --------------------------- |
| 节点点击  | 显示节点详情预览（Tooltip） |
| 节点双击  | 跳转到该知识点详情页        |
| 拖拽节点  | 重新布局                    |
| 缩放/平移 | 浏览大型图谱                |
| 关系高亮  | 悬停时高亮相关关系          |
| 筛选      | 按关系类型筛选显示          |

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

> 💡 **注意**：数据清洗阶段使用的是**通用技能**，不属于知识库专用技能，因此不带 `kb-` 前缀。

| 技能名           | 功能                     | 输入                 | 输出                    | 说明               |
| ---------------- | ------------------------ | -------------------- | ----------------------- | ------------------ |
| `file-parse`   | 解析文件，提取文本和媒体 | file_path            | { markdown, media[] }   | PDF/DOCX/HTML 解析 |
| `ocr-image`    | VL模型 OCR + 描述        | image_data           | { text, alt, ocr_text } | 调用 VL 模型       |
| `media-upload` | 上传媒体到对象存储       | image_data, filename | { url, path }           | 本地/S3/OSS        |

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

> 💡 **说明**：以下技能是知识构造阶段的内部实现步骤，属于 [`kb-import-file`](#知识库管理技能知识整理专家专用) 和 [`kb-chunk`](#知识库管理技能知识整理专家专用) 的子流程。

| 技能名                  | 功能                   | 输入                  | 输出                                     | 对应主技能        |
| ----------------------- | ---------------------- | --------------------- | ---------------------------------------- | ----------------- |
| `kb-analyze-topic`    | 分析文档主题，判断归属 | markdown, kb_id       | { topic, suggested_parent, is_relevant } | kb-import-file    |
| `kb-chunk`            | 智能分段 + 上下文补充  | markdown, options     | { chunks[] }                             | kb-chunk          |
| `kb-create-point`     | 创建知识点记录         | chunk, parent_id      | { point_id }                             | kb-import-file    |
| `kb-create-knowledge` | 创建知识记录           | title, summary, kb_id | { knowledge_id }                         | kb-import-file    |

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

| 技能名       | 功能         | 执行方式 |
| ------------ | ------------ | -------- |
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

| 技能名        | 功能                     | 执行方式 |
| ------------- | ------------------------ | -------- |
| `kb-relate` | 分析知识点关联，建立关系 | 后台异步 |

---

## 专家技能汇总

### 技能分类总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         技能分类总览                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  通用技能（所有专家可用）                                              │
│  ─────────────────────                                              │
│  - file-parse: 文件解析（PDF/DOCX/HTML/Markdown）                    │
│  - ocr-image: 图片 OCR + 描述（VL 模型）                             │
│  - media-upload: 媒体上传（本地/S3/OSS）                             │
│  - web-fetch: 网页抓取                                              │
│                                                                     │
│  知识库管理技能（知识整理专家专用）                                     │
│  ─────────────────────────────────                                  │
│  - kb-create: 创建知识库                                            │
│  - kb-import-file: 导入文件                                         │
│  - kb-import-web: 导入网页                                          │
│  - kb-chunk: 智能分块                                               │
│  - kb-embed: 向量化                                                 │
│  - kb-relate: 关系分析                                              │
│  - kb-update-point: 更新知识点                                      │
│  - kb-delete-point: 删除知识点                                      │
│  - kb-merge-points: 合并知识点                                      │
│                                                                     │
│  知识库检索技能（所有专家可用）                                        │
│  ─────────────────────────────────                                  │
│  - kb-list: 列出知识库                                              │
│  - kb-search-vector: 向量检索                                       │
│  - kb-search-graph: 图谱检索                                        │
│  - kb-get-point: 获取知识点                                         │
│  - kb-get-knowledge: 获取知识                                       │
│  - kb-search-hybrid: 混合检索                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 通用技能详情

| 技能名           | 功能             | 输入                 | 输出                         | 实现位置                     |
| ---------------- | ---------------- | -------------------- | ---------------------------- | ---------------------------- |
| `file-parse`   | 解析各类文件格式 | file_path            | { markdown, media[] }        | data/skills/file-operations/ |
| `ocr-image`    | 图片 OCR + 描述  | image_data           | { text, alt, ocr_text }      | 调用 VL 模型 API             |
| `media-upload` | 上传媒体到存储   | image_data, filename | { url, path }                | data/skills/file-operations/ |
| `web-fetch`    | 抓取网页内容     | url                  | { title, content, markdown } | data/skills/http-client/     |

### 知识库管理技能详情

| 技能名              | 功能       | 输入                                  | 输出         | 执行方式 |
| ------------------- | ---------- | ------------------------------------- | ------------ | -------- |
| `kb-create`       | 创建知识库 | name, description, embedding_model_id | kb_id        | 同步     |
| `kb-import-file`  | 导入文件   | file_path, kb_id                      | knowledge_id | 同步     |
| `kb-import-web`   | 导入网页   | url, kb_id                            | knowledge_id | 同步     |
| `kb-chunk`        | 智能分块   | knowledge_id                          | point_ids[]  | 同步     |
| `kb-embed`        | 向量化     | kb_id 或 point_ids                    | -            | 异步     |
| `kb-relate`       | 关系分析   | kb_id                                 | -            | 异步     |
| `kb-update-point` | 更新知识点 | point_id, content                     | -            | 同步     |
| `kb-delete-point` | 删除知识点 | point_id                              | -            | 同步     |
| `kb-merge-points` | 合并知识点 | point_ids[]                           | new_point_id | 同步     |

### 知识库检索技能详情

| 技能名               | 功能       | 输入                | 输出                  |
| -------------------- | ---------- | ------------------- | --------------------- |
| `kb-list`          | 列出知识库 | -                   | kb[]                  |
| `kb-search-vector` | 向量检索   | query, kb_id, top_k | points[]              |
| `kb-search-graph`  | 图谱检索   | point_id, depth     | points[], relations[] |
| `kb-get-point`     | 获取知识点 | point_id            | point                 |
| `kb-get-knowledge` | 获取知识   | knowledge_id        | knowledge             |
| `kb-search-hybrid` | 混合检索   | query, kb_id        | points[]              |

### 后台异步技能

| 技能名        | 功能           | 触发条件             |
| ------------- | -------------- | -------------------- |
| `kb-embed`  | 生成向量嵌入   | 知识点创建后自动触发 |
| `kb-relate` | 分析知识点关联 | 向量化完成后自动触发 |

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

> ⚠️ 注意：以下为通用技能，不带 `kb-` 前缀。

- file-parse: 解析文件（PDF/DOCX/HTML/Markdown）
- ocr-image: VL模型处理图片（OCR + 描述）
- media-upload: 上传媒体文件（本地/S3/OSS）
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

| 任务                | 预估工时 | 依赖           |
| ------------------- | -------- | -------------- |
| 创建数据库表        | 1h       | -              |
| 知识库 CRUD API     | 2h       | 数据库表       |
| 知识 CRUD API       | 2h       | 知识库 API     |
| 知识点 CRUD API     | 2h       | 知识 API       |
| kb-import-file 技能 | 3h       | 知识点 API     |
| kb-chunk 技能       | 2h       | kb-import-file |
| kb-embed 技能       | 2h       | kb-chunk       |
| kb-search 技能      | 2h       | kb-embed       |

**MVP 目标**：能导入文档、分块、生成向量、进行语义检索

### Phase 2: 智能化

| 任务                           | 预估工时 | 依赖           |
| ------------------------------ | -------- | -------------- |
| kb-relate 技能（LLM 关联分析） | 4h       | Phase 1        |
| kb-import-web 技能             | 2h       | kb-import-file |
| 知识图谱可视化                 | 4h       | kb-relate      |
| 混合检索（向量 + 关键词）      | 3h       | kb-search      |

### Phase 3: 优化

| 任务           | 预估工时 | 依赖    |
| -------------- | -------- | ------- |
| 向量数据库迁移 | 4h       | Phase 2 |
| 增量更新机制   | 2h       | -       |
| 知识库权限控制 | 2h       | -       |

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

| 优先级 | 功能             | 说明                                    |
| ------ | ---------------- | --------------------------------------- |
| P0     | 检索技能实现     | kb-list, kb-search-vector, kb-get-point |
| P1     | 专家知识库配置   | 专家配置中设置可访问的知识库            |
| P1     | 技能权限控制     | 根据专家配置过滤可访问的知识库          |
| P2     | kb-search-graph  | 知识图谱检索                            |
| P2     | kb-search-hybrid | 混合检索                                |

---

## 设计决策（补充）

### 6. 模型类型扩展 ✅ 新增

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

| 类型           | 说明                        | 示例                         |
| -------------- | --------------------------- | ---------------------------- |
| `text`       | 文字模型（用于对话/生成）   | GPT-4, DeepSeek Chat, Claude |
| `multimodal` | 多模态模型（支持图片/音频） | GPT-4V, Claude 3, Gemini     |
| `embedding`  | 嵌入式模型（用于向量化）    | text-embedding-3-small, BGE  |

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
