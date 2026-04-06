# 知识库召回设计文档

> **依赖**：本设计依赖通用附件服务（Attachment Service），需先完成附件服务实现。

## 1. 背景与需求

### 1.1 当前问题

- 专家对话时需要召回知识库内容，但召回结果中的图片无法正确展示
- 现有搜索 API（`/api/kb/:kb_id/search`）仅返回原始 Markdown，未处理图片引用
- 图片引用格式 `attach:id` 无法直接在浏览器 `<img>` 中使用

### 1.2 需求目标

1. 提供知识库召回 API，支持向量语义搜索
2. 自动处理召回结果中的图片引用，生成可访问的 Token URL
3. 返回可直接渲染的 Markdown 内容
4. 支持与专家对话系统集成

## 2. 架构设计

### 2.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Expert Conversation                      │
│  ┌─────────────────┐    ┌─────────────────┐                  │
│  │  专家对话       │───▶│  kb-recall API  │                  │
│  │  (LLM 调用)     │    │  /api/kb/:id/   │                  │
│  └─────────────────┘    │    recall       │                  │
│                         └────────┬────────┘                  │
└─────────────────────────────────│────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                      Knowledge Base                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│  │kb_paragraphs│    │ kb_sections │    │ kb_articles │       │
│  │  (向量搜索) │───▶│  (层级路径) │───▶│  (文章信息) │       │
│  └─────────────┘    └─────────────┘    └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Attachment Service                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│  │ attachments │    │attachment_  │    │  Token API  │       │
│  │    表       │───▶│   token 表   │───▶│  生成 Token │       │
│  └─────────────┘    └─────────────┘    └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户查询 (query)
    │
    ▼
向量搜索 (kb_paragraphs.embedding)
    │
    ▼
获取匹配段落 (top_k 结果)
    │
    ▼
解析图片引用 (attach:id)
    │
    ▼
生成资源级 Token (attachment_token)
    │
    ▼
替换 Markdown 引用 (attach:id → /attach/t/:token/:id)
    │
    ▼
返回处理后的结果
```

## 3. API 设计

### 3.1 知识库召回 API

```
POST /api/kb/:kb_id/recall
```

**请求体：**
```json
{
  "query": "如何设计 API 接口",
  "top_k": 5,
  "threshold": 0.1,
  "article_id": "可选，限定在特定文章内搜索",
  "min_tokens": 200,
  "context_mode": "auto"
}
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `query` | string | 必填 | 搜索查询文本 |
| `top_k` | int | 5 | 返回结果数量 |
| `threshold` | float | 0.1 | 相似度阈值（0-1） |
| `article_id` | string | null | 限定在特定文章内搜索 |
| `min_tokens` | int | 200 | 最小 Token 数量，不足时自动扩展上下文 |
| `context_mode` | string | "auto" | 上下文模式：`none`/`auto`/`section`/`article` |

**context_mode 模式说明：**

| 模式 | 行为 | 适用场景 |
|------|------|----------|
| `none` | 仅返回匹配段落，不扩展上下文 | 精确问答 |
| `auto` | 自动扩展相邻段落，直到满足 `min_tokens` | 默认模式，平衡精确性和上下文 |
| `section` | 返回匹配段落所在节的全部段落 | 需要完整章节上下文 |
| `article` | 返回匹配段落所在文章的全部段落 | LLM 需要完整文档理解 |

**响应：**
```json
{
  "items": [
    {
      "score": 0.85,
      "paragraph": {
        "id": "para_123",
        "title": "API 设计原则",
        "content": "![架构图](/attach/t/abc123xyz/img_456)\n\nAPI 设计应遵循 RESTful 规范...",
        "is_knowledge_point": true,
        "token_count": 150
      },
      "section": {
        "id": "sec_456",
        "title": "第二章 API 设计",
        "level": 1,
        "path": "第一章 > 1.2 API 设计"
      },
      "article": {
        "id": "art_789",
        "title": "系统设计指南"
      },
      "knowledge_base": {
        "id": "kb_001",
        "name": "技术文档库"
      }
    }
  ],
  "total": 5,
  "query": "如何设计 API 接口",
  "token": {
    "url": "/attach/t/abc123xyz",
    "expires_at": "2026-04-05T17:30:00.000Z"
  }
}
```

**关键设计点：**
- `content` 中的图片引用已替换为带 Token 的 URL
- `token` 字段返回资源级 Token 信息，可用于访问该文章的所有附件
- `section.path` 提供完整的层级路径，便于用户理解上下文

### 3.2 全局召回 API

```
POST /api/kb/recall
```

搜索用户所有可访问的知识库：

**请求体：**
```json
{
  "query": "如何设计 API 接口",
  "top_k": 10,
  "threshold": 0.1,
  "kb_ids": ["可选，限定知识库 ID 数组"]
}
```

**响应格式同上。**

## 4. 图片处理流程

### 4.1 图片引用解析

**原始 Markdown：**
```markdown
![系统架构图](attach:img_123456789)
```

**处理后 Markdown：**
```markdown
![系统架构图](/attach/t/abc123def456/img_123456789)
```

### 4.2 Token 生成策略

**资源级 Token 设计：**
- 一个文章生成一个 Token
- Token 可访问该文章的所有附件
- Token 与用户绑定，确保权限正确

**生成时机：**
- 召回 API 调用时，检查是否存在有效 Token
- 存在且未过期：直接使用
- 不存在或已过期：生成新 Token

### 4.3 实现代码

```javascript
/**
 * 处理段落内容中的图片引用
 * @param {string} content - 段落原始内容
 * @param {string} articleId - 文章 ID
 * @param {string} userId - 用户 ID
 * @returns {Promise<{content: string, token: object}>}
 */
async _processImageReferences(content, articleId, userId) {
  // 1. 检查是否有图片引用
  const attachPattern = /!\[([^\]]*)\]\(attach:([a-zA-Z0-9]+)\)/g;
  const matches = [...content.matchAll(attachPattern)];
  
  if (matches.length === 0) {
    return { content, token: null };
  }
  
  // 2. 获取或生成资源级 Token
  const tokenInfo = await this._getOrCreateAttachmentToken(
    'kb_article_image',
    articleId,
    userId
  );
  
  // 3. 替换图片引用
  const processedContent = content.replace(
    attachPattern,
    (match, altText, attachId) => {
      return `![${altText}](/attach/t/${tokenInfo.token}/${attachId})`;
    }
  );
  
  return {
    content: processedContent,
    token: tokenInfo
  };
}

/**
 * 获取或生成附件访问 Token
 * @param {string} sourceTag - 资源类型
 * @param {string} sourceId - 资源 ID
 * @param {string} userId - 用户 ID
 * @returns {Promise<{token: string, url: string, expires_at: string}>}
 */
async _getOrCreateAttachmentToken(sourceTag, sourceId, userId) {
  const AttachmentToken = this.db.getModel('attachment_token');
  
  // 1. 查找现有有效 Token
  const existingToken = await AttachmentToken.findOne({
    where: {
      source_tag: sourceTag,
      source_id: sourceId,
      user_id: userId,
      expires_at: { [Op.gt]: new Date() }
    }
  });
  
  if (existingToken) {
    return {
      token: existingToken.token,
      url: `/attach/t/${existingToken.token}`,
      expires_at: existingToken.expires_at
    };
  }
  
  // 2. 生成新 Token
  const token = Utils.newID(32);
  const expiresAt = new Date(Date.now() + TOKEN_CONFIG.EXPIRES_IN * 1000);
  
  await AttachmentToken.create({
    token,
    source_tag: sourceTag,
    source_id: sourceId,
    user_id: userId,
    expires_at: expiresAt
  });
  
  return {
    token,
    url: `/attach/t/${token}`,
    expires_at: expiresAt.toISOString()
  };
}
```

## 5. 上下文增强召回

### 5.1 问题背景

**场景示例**：用户查询"高层次人才申办户口条件"

| 方案 | 召回结果 | 问题 |
|------|----------|------|
| 单段落召回 | 只返回"第五条（一）高层次人才" | 缺少上下文（不知道"第五条"的前提条件） |
| 合并召回 | 返回"第五条（申办条件）- 总则" + "第五条（一）高层次人才" | 提供完整上下文 |

### 5.2 自动扩展策略

**核心思路**：当召回段落的 Token 数量不足时，自动扩展相邻段落。

```javascript
/**
 * 上下文增强召回
 * @param {Object} paragraph - 匹配的段落
 * @param {number} minTokens - 最小 Token 数量
 * @param {string} contextMode - 上下文模式
 * @returns {Promise<{paragraphs: Array, total_tokens: number}>}
 */
async _expandContext(paragraph, minTokens, contextMode) {
  const result = {
    paragraphs: [paragraph],
    total_tokens: paragraph.token_count || 0
  };
  
  // 模式 1: none - 不扩展
  if (contextMode === 'none') {
    return result;
  }
  
  // 模式 2: article - 返回整篇文章
  if (contextMode === 'article') {
    return await this._getFullArticle(paragraph);
  }
  
  // 模式 3: section - 返回整个节
  if (contextMode === 'section') {
    return await this._getFullSection(paragraph);
  }
  
  // 模式 4: auto - 自动扩展直到满足 minTokens
  if (contextMode === 'auto') {
    // 如果已经满足最小 Token 数量，不扩展
    if (result.total_tokens >= minTokens) {
      return result;
    }
    
    // 获取相邻段落
    const neighbors = await this._getNeighborParagraphs(
      paragraph.section_id,
      paragraph.position,
      'both'  // 前后都获取
    );
    
    // 按位置排序，优先扩展前面的段落（提供上下文）
    neighbors.sort((a, b) => a.position - b.position);
    
    for (const neighbor of neighbors) {
      result.paragraphs.push(neighbor);
      result.total_tokens += neighbor.token_count || 0;
      
      if (result.total_tokens >= minTokens) {
        break;
      }
    }
    
    // 按 position 排序最终结果
    result.paragraphs.sort((a, b) => a.position - b.position);
  }
  
  return result;
}

/**
 * 获取相邻段落
 * @param {string} sectionId - 节 ID
 * @param {number} position - 当前段落位置
 * @param {string} direction - 方向：'before'/'after'/'both'
 */
async _getNeighborParagraphs(sectionId, position, direction = 'both') {
  const where = { section_id: sectionId };
  
  if (direction === 'before') {
    where.position = { [Op.lt]: position };
  } else if (direction === 'after') {
    where.position = { [Op.gt]: position };
  } else {
    where.position = { [Op.ne]: position };
  }
  
  return await this.KbParagraph.findAll({
    where,
    order: [['position', 'ASC']],
    raw: true
  });
}

/**
 * 获取完整节的所有段落
 */
async _getFullSection(paragraph) {
  const paragraphs = await this.KbParagraph.findAll({
    where: { section_id: paragraph.section_id },
    order: [['position', 'ASC']],
    raw: true
  });
  
  return {
    paragraphs,
    total_tokens: paragraphs.reduce((sum, p) => sum + (p.token_count || 0), 0)
  };
}

/**
 * 获取完整文章的所有段落
 */
async _getFullArticle(paragraph) {
  // 1. 获取段落所属的节
  const section = await this.KbSection.findByPk(paragraph.section_id);
  
  // 2. 获取文章的所有节
  const sections = await this.KbSection.findAll({
    where: { article_id: section.article_id },
    attributes: ['id'],
    raw: true
  });
  
  const sectionIds = sections.map(s => s.id);
  
  // 3. 获取所有段落
  const paragraphs = await this.KbParagraph.findAll({
    where: { section_id: { [Op.in]: sectionIds } },
    order: [['position', 'ASC']],
    raw: true
  });
  
  return {
    paragraphs,
    total_tokens: paragraphs.reduce((sum, p) => sum + (p.token_count || 0), 0)
  };
}
```

### 5.3 LLM 控制的上下文扩展

**场景**：LLM 根据召回结果的质量，决定是否需要更多上下文。

**实现方案**：召回 API 返回元信息，LLM 可发起二次请求。

```json
// 第一次召回响应
{
  "items": [
    {
      "score": 0.85,
      "paragraph": {
        "id": "para_123",
        "title": "第五条（一）高层次人才",
        "content": "1．具有博士研究生学历...",
        "token_count": 190
      },
      "context_info": {
        "has_more_before": true,
        "has_more_after": true,
        "section_id": "sec_456",
        "article_id": "art_789"
      }
    }
  ]
}
```

**LLM 可发起扩展请求**：

```json
// 扩展上下文请求
POST /api/kb/:kb_id/recall/expand
{
  "paragraph_id": "para_123",
  "expand_mode": "section",  // 或 "before:2" / "after:2" / "article"
}
```

### 5.4 Token 数量阈值建议

| 场景 | 建议 min_tokens | 说明 |
|------|-----------------|------|
| 精确问答 | 0 | 只返回匹配段落 |
| 一般查询 | 200 | 提供基本上下文 |
| 复杂分析 | 500-1000 | 提供充足上下文 |
| 文档理解 | 使用 `context_mode: "article"` | 返回完整文档 |

## 6. 与专家对话集成

### 6.1 调用场景

专家对话中，LLM 可能需要召回知识库内容：

```
用户：请介绍一下系统架构设计
专家：我需要查询知识库中的相关内容...
      → 调用 kb-recall API
      → 获取处理后的 Markdown
      → 直接展示给用户（图片可正常显示）
```

### 6.2 技能工具设计（可选）

如需封装为技能工具，供 LLM 直接调用：

```javascript
// data/skills/kb-recall/index.js
{
  name: 'kb_recall',
  description: '从知识库召回相关内容，返回可直接渲染的 Markdown（图片已处理）',
  parameters: {
    kb_id: '知识库 ID（可选，不提供则全局搜索）',
    query: '搜索查询文本',
    top_k: '返回结果数量，默认 5'
  },
  returns: {
    items: '召回结果数组',
    total: '结果总数',
    token: '图片访问 Token 信息'
  }
}
```

### 6.3 System Prompt 示例

```
你拥有知识库召回能力。当用户询问专业知识时，可使用 kb-recall 工具：

- kb_recall: 从知识库召回相关内容
  - 参数：query（必需），kb_id（可选），top_k（可选）
  - 返回：处理后的 Markdown，图片可直接显示

使用建议：
- 用户询问专业问题时，优先召回知识库内容
- 召回结果中的图片 URL 已包含 Token，可直接使用
```

## 7. 权限设计

### 7.1 权限检查流程

```
1. 检查用户是否有权限访问知识库（canAccessKb）
2. 检查用户是否有权限访问文章（通过知识库权限）
3. Token 与用户绑定，确保只有授权用户才能访问图片
```

### 7.2 Token 安全

- Token 与用户 ID 绑定
- Token 有过期时间（默认 1 小时）
- Token 仅用于访问特定资源（source_tag + source_id）
- 不启用续期机制，过期后需重新生成

## 8. 向量搜索实现

### 8.1 向量计算流程

召回功能复用现有的向量搜索实现（[`kb.controller.js`](server/controllers/kb.controller.js:1429)）：

```
用户查询文本 (query)
       │
       ▼
┌─────────────────────────────────────────┐
│  1. 调用 Embedding API 生成查询向量      │
│     _generateEmbedding(query, modelId)   │
│                                          │
│     请求: POST /embeddings               │
│     { input: query, model: "..." }       │
│                                          │
│     响应: { data: [{ embedding: [...] }] }│
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  2. 调整向量维度                         │
│     adjustVectorDimension(embedding)     │
│                                          │
│     - 模型输出维度可能与数据库不一致       │
│     - 自动填充或截断到 DB_VECTOR_DIM      │
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  3. 执行向量搜索（MariaDB VECTOR）       │
│     VEC_DISTANCE_COSINE(                 │
│       p.embedding,                       │
│       VEC_FromText(queryVector)          │
│     )                                    │
└─────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────┐
│  4. 过滤和排序                           │
│     - 过滤：score >= threshold           │
│     - 排序：distance ASC                 │
│     - 限制：LIMIT top_k                  │
└─────────────────────────────────────────┘
```

### 8.2 向量比对算法

使用 **余弦相似度（Cosine Similarity）**：

```sql
-- MariaDB VECTOR 查询
SELECT
  p.id, p.title, p.content,
  VEC_DISTANCE_COSINE(p.embedding, VEC_FromText(?)) as distance
FROM kb_paragraphs p
WHERE p.embedding IS NOT NULL
  AND p.is_knowledge_point = 1
ORDER BY distance ASC  -- 距离越小越相似
LIMIT ?
```

**距离与相似度的关系：**
- `distance` = 余弦距离 = 1 - 余弦相似度
- `score` = 1 - distance = 余弦相似度
- `score` 范围：[0, 1]，越大越相似

**阈值过滤：**
```javascript
// 只保留相似度 >= threshold 的结果
const filteredResults = results.filter(r => (1 - r.distance) >= threshold);
```

### 8.3 Embedding API 调用

```javascript
// server/controllers/kb.controller.js:1640
async _generateEmbedding(text, modelId) {
  // 1. 获取模型配置
  const model = await AiModel.findOne({
    where: { id: modelId },
    include: [{ model: Provider, as: 'provider' }]
  });

  // 2. 调用 Embedding API
  const response = await fetch(model.provider.base_url + '/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${model.provider.api_key}`,
    },
    body: JSON.stringify({
      input: text,
      model: model.model_name || 'text-embedding-3-small',
    }),
  });

  // 3. 返回向量
  const data = await response.json();
  return data.data?.[0]?.embedding || null;
}
```

### 8.4 向量维度处理

```javascript
// server/lib/vector-utils.js
const DB_VECTOR_DIM = 384;  // 数据库向量维度

function adjustVectorDimension(embedding) {
  const originalDim = embedding.length;
  
  if (originalDim === DB_VECTOR_DIM) {
    return { vector: embedding, adjusted: false };
  }
  
  if (originalDim < DB_VECTOR_DIM) {
    // 填充零
    return {
      vector: [...embedding, ...new Array(DB_VECTOR_DIM - originalDim).fill(0)],
      adjusted: true,
      message: `Padded ${originalDim} -> ${DB_VECTOR_DIM}`
    };
  }
  
  // 截断
  return {
    vector: embedding.slice(0, DB_VECTOR_DIM),
    adjusted: true,
    message: `Truncated ${originalDim} -> ${DB_VECTOR_DIM}`
  };
}

function vectorToJson(vector) {
  return JSON.stringify(vector);
}
```

### 8.5 现有代码复用

召回 API 直接复用现有的搜索逻辑：

| 功能 | 现有方法 | 代码位置 |
|------|----------|----------|
| 单知识库搜索 | `searchInKnowledgeBase` | [kb.controller.js:1429](server/controllers/kb.controller.js:1429) |
| 全局搜索 | `globalSearch` | [kb.controller.js:1535](server/controllers/kb.controller.js:1535) |
| 生成 Embedding | `_generateEmbedding` | [kb.controller.js:1640](server/controllers/kb.controller.js:1640) |
| 维度调整 | `adjustVectorDimension` | [vector-utils.js](server/lib/vector-utils.js) |

**召回 API 与现有搜索 API 的区别：**

| 对比项 | 搜索 API (`/search`) | 召回 API (`/recall`) |
|--------|---------------------|---------------------|
| 返回内容 | 原始 Markdown | 处理后的 Markdown（图片 URL 已替换） |
| Token 生成 | 无 | 自动生成资源级 Token |
| 用途 | 管理界面展示 | 专家对话集成 |
| 图片展示 | 需前端额外处理 | 可直接渲染 |

## 9. 性能考虑

### 9.1 Token 缓存

- 同一用户访问同一文章，复用有效 Token
- 减少 Token 生成次数（避免频繁 DB 写入）

### 9.2 批量处理

- 多个段落属于同一文章时，共享一个 Token
- 避免为每个段落单独生成 Token

### 9.3 向量搜索优化

- 复用现有向量搜索逻辑（`searchInKnowledgeBase`）
- 使用 MariaDB VECTOR 索引加速搜索

## 10. 实施计划

### Phase 1：附件服务实现（前置依赖）

1. 创建 `attachments` 表
2. 创建 `attachment_token` 表
3. 实现 Token 生成 API
4. 实现附件访问路由 `/attach/t/:token/:id`

### Phase 2：召回 API 实现

1. 在 `kb.controller.js` 中添加 `recallKnowledge` 方法
2. 实现 `_processImageReferences` 图片处理方法
3. 实现 `_getOrCreateAttachmentToken` Token 生成方法
4. 添加路由配置

### Phase 3：技能工具封装（可选）

1. 创建 `kb-recall` 技能目录
2. 实现 `kb_recall` 工具
3. 注册技能到系统
4. 更新专家 System Prompt

## 11. 决策记录

| 事项 | 决策 | 理由 |
|------|------|------|
| API 路径 | `/api/kb/:kb_id/recall` | 与现有搜索 API 保持一致的命名风格 |
| Token 粒度 | 资源级（文章级） | 多段落共享 Token，减少 DB 写入 |
| Token 有效期 | 固定 1 小时（不续期） | 简化实现，平衡安全性和用户体验 |
| 图片处理时机 | 召回时处理 | 返回即可用，前端无需额外处理 |
| 技能工具 | 可选实现 | 先实现 API，后续按需封装 |
| 全局召回 | 支持 | 用户可能需要跨知识库搜索 |
| 向量搜索 | 复用现有实现 | `searchInKnowledgeBase` 已成熟，直接复用 |
| 相似度算法 | 余弦相似度 | MariaDB VECTOR 原生支持，性能好 |

---

*文档版本：v1.2*