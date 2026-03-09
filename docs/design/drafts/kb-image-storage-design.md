# 知识库图片存储方案设计

## 1. 背景与需求

### 1.1 当前问题
- 专家调用技能解析图文时，图片未能持久化存储
- 图片仅存在于临时内存中，无法在后续查询中展示
- Markdown 文档中的图片引用无法正确显示

### 1.2 需求目标
1. 将解析出的图片以 Base64 格式存储到数据库
2. 提供图片访问 API，支持通过 ID 获取图片
3. 在 Markdown 内容中嵌入图片 URL 引用
4. 图片随知识点一起存入 `kb_paragraphs` 表

## 2. 数据库设计

### 2.1 新增表：`kb_article_images`

```sql
CREATE TABLE `kb_article_images` (
  `id` varchar(20) NOT NULL COMMENT '图片唯一ID（Utils.newID生成）',
  `article_id` varchar(20) NOT NULL COMMENT '所属文章ID',
  `image_name` varchar(255) DEFAULT NULL COMMENT '原始文件名',
  `mime_type` varchar(100) NOT NULL DEFAULT 'image/png' COMMENT 'MIME类型',
  `base64_data` LONGTEXT NOT NULL COMMENT 'Base64编码数据（不含前缀）',
  `size_bytes` int DEFAULT 0 COMMENT '图片大小（字节）',
  `width` int DEFAULT NULL COMMENT '图片宽度',
  `height` int DEFAULT NULL COMMENT '图片高度',
  `alt_text` varchar(500) DEFAULT NULL COMMENT '替代文本',
  `description` TEXT DEFAULT NULL COMMENT '图片描述（VL模型生成）',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_image_article` (`article_id`),
  CONSTRAINT `fk_image_article` FOREIGN KEY (`article_id`) 
    REFERENCES `kb_articles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### 2.2 设计考量

| 字段 | 说明 |
|------|------|
| `id` | 使用 `Utils.newID(20)` 生成，与其他表保持一致 |
| `base64_data` | 仅存储纯 Base64 数据，不含 `data:image/xxx;base64,` 前缀，减少冗余 |
| `mime_type` | 单独存储 MIME 类型，便于响应时设置 Content-Type |
| `article_id` | 外键关联文章，支持级联删除 |
| `description` | VL模型生成的图片描述，可用于搜索和无障碍访问 |
| `alt_text` | 用户指定的替代文本，优先于 description 显示 |

### 2.3 与现有表的关系

```
knowledge_bases (知识库)
    └── kb_articles (文章)
            ├── kb_sections (节)
            │       └── kb_paragraphs (段落/知识点) ← Markdown内容中引用图片
            └── kb_article_images (图片) ← 新增
```

## 3. API 设计

### 3.1 访问控制
- 所有图片 API 需要 Token 认证（与其他 API 一致）
- 需要提供正确的 `kb_id` 和 `article_id` 才能访问图片
- 不知道 article_id 的情况下无法访问图片

### 3.2 单张图片上传

```
POST /api/kb/:kb_id/articles/:article_id/images
```

**请求体：**
```json
{
  "image_name": "diagram.png",
  "mime_type": "image/png",
  "base64_data": "iVBORw0KGgoAAAANSUhEUgAAA...",
  "alt_text": "系统架构图"
}
```

**响应：**
```json
{
  "id": "abc123def456789012",
  "article_id": "art_123456789",
  "image_name": "diagram.png",
  "mime_type": "image/png",
  "size_bytes": 12345,
  "ref": "kb-img:abc123def456789012"
}
```

### 3.3 批量图片上传

```
POST /api/kb/:kb_id/articles/:article_id/images/batch
```

**请求体：**
```json
{
  "images": [
    {
      "image_name": "diagram1.png",
      "mime_type": "image/png",
      "base64_data": "iVBORw0KGgoAAAANSUhEUgAAA...",
      "alt_text": "系统架构图"
    },
    {
      "image_name": "flowchart.png",
      "mime_type": "image/png",
      "base64_data": "iVBORw0KGgoAAAANSUhEUgBBB...",
      "alt_text": "流程图"
    }
  ]
}
```

**响应：**
```json
{
  "items": [
    {
      "id": "abc123def456789012",
      "image_name": "diagram1.png",
      "mime_type": "image/png",
      "size_bytes": 12345,
      "ref": "kb-img:abc123def456789012"
    },
    {
      "id": "def456789012abc",
      "image_name": "flowchart.png",
      "mime_type": "image/png",
      "size_bytes": 23456,
      "ref": "kb-img:def456789012abc"
    }
  ],
  "total": 2
}
```

**设计说明：**
- 批量上传一次请求可提交多张图片
- 每张图片独立处理，部分失败不影响其他图片
- 响应中 `ref` 字段用于 Markdown 引用

### 3.3 获取图片（返回 Base64 数据）

```
GET /api/kb/:kb_id/articles/:article_id/images/:image_id
```

**响应：**
```json
{
  "id": "abc123def456789012",
  "mime_type": "image/png",
  "base64_data": "iVBORw0KGgoAAAANSUhEUgAAA...",
  "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA..."
}
```

**设计说明：**
- 返回 Base64 数据而非二进制图像，避免图床化
- `data_url` 字段可直接用于 `<img src="...">` 或 Markdown 渲染
- 前端可通过 API 获取数据后拼装成页面组件

### 3.5 获取图片元信息

```
GET /api/kb/:kb_id/articles/:article_id/images/:image_id/info
```

**响应：**
```json
{
  "id": "abc123def456789012",
  "article_id": "art_123456789",
  "image_name": "diagram.png",
  "mime_type": "image/png",
  "size_bytes": 12345,
  "width": 800,
  "height": 600,
  "alt_text": "系统架构图",
  "description": "这是一张展示系统架构的图表...",
  "ref": "kb-img:abc123def456789012"
}
```

### 3.6 获取图片列表

```
GET /api/kb/:kb_id/articles/:article_id/images
```

**响应：**
```json
{
  "items": [
    {
      "id": "abc123def456789012",
      "image_name": "diagram.png",
      "mime_type": "image/png",
      "size_bytes": 12345,
      "ref": "kb-img:abc123def456789012"
    }
  ],
  "total": 1
}
```

### 3.6 更新图片信息

```
PUT /api/kb/:kb_id/articles/:article_id/images/:image_id
```

**请求体：**
```json
{
  "alt_text": "新的替代文本",
  "description": "新的描述"
}
```

### 3.7 删除图片

```
DELETE /api/kb/:kb_id/articles/:article_id/images/:image_id
```

## 4. 工作流程

### 4.1 图片存储流程

```
┌─────────────────┐
│  专家技能解析    │
│  图文内容       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  提取图片       │
│  转换为Base64   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│  调用图片API    │────▶│  kb_article_images│
│  存储图片       │     │  表存储Base64    │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐
│  获取图片ref    │
│  嵌入Markdown   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│  创建段落       │────▶│  kb_paragraphs   │
│  存储知识点     │     │  content含图片ref│
└─────────────────┘     └──────────────────┘
```

### 4.2 图片读取流程

```
┌─────────────────┐
│  前端/聊天      │
│  请求显示内容   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  获取段落内容   │
│  Markdown渲染   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  解析图片引用   │
│  提取image_id   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│  调用图片API    │────▶│  验证权限        │
│  (带Token)      │     │  查询Base64      │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐
│  返回Base64     │
│  和 data_url    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  前端拼装组件   │
│  <img src=      │
│  "data_url">    │
└─────────────────┘
```

### 4.3 Markdown 图片引用格式

**自定义引用语法：**
```markdown
![系统架构图](kb-img:abc123def456789012)
```

**格式说明：**
- `kb-img:` 是自定义协议前缀，标识这是知识库图片引用
- 后面跟图片 ID
- `alt_text` 部分保持标准 Markdown 语法

**前端渲染流程：**
1. 解析 Markdown，识别 `kb-img:` 前缀的图片引用
2. 提取 `image_id`
3. 调用 API 获取 `data_url`（需要 `kb_id` 和 `article_id` 从上下文获取）
4. 将 `data_url` 设置为 `<img>` 的 `src` 属性

**示例渲染代码：**
```javascript
// Markdown 解析时的正则匹配
const KB_IMAGE_REGEX = /!\[([^\]]*)\]\(kb-img:([a-zA-Z0-9]+)\)/g;

// 替换为 data_url
function renderKbImages(markdown, kbId, articleId) {
  return markdown.replace(KB_IMAGE_REGEX, async (match, altText, imageId) => {
    const response = await fetch(`/api/kb/${kbId}/articles/${articleId}/images/${imageId}`);
    const { data_url } = await response.json();
    return `<img src="${data_url}" alt="${altText}" />`;
  });
}
```

**优点：**
- 引用格式简洁，仅包含图片 ID
- 前端可控制图片加载时机和错误处理
- Token 认证自然集成，无需签名 URL

## 5. Skill 工具扩展

### 5.1 kb-editor skill 新增工具

```javascript
// 上传单张图片
{
  name: 'upload_article_image',
  description: '上传图片到文章，返回可在Markdown中使用的引用',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID',
    image_name: '图片文件名',
    mime_type: 'MIME类型 (image/png, image/jpeg, image/gif, image/svg+xml, image/webp)',
    base64_data: 'Base64编码数据（不含data:image/xxx;base64,前缀）',
    alt_text: '替代文本（可选）'
  },
  returns: {
    ref: 'Markdown引用，如 kb-img:abc123def456789012'
  }
}

// 批量上传图片
{
  name: 'upload_article_images_batch',
  description: '批量上传图片到文章，返回引用列表',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID',
    images: [{
      image_name: '图片文件名',
      mime_type: 'MIME类型',
      base64_data: 'Base64编码数据',
      alt_text: '替代文本（可选）'
    }]
  },
  returns: {
    items: [{ id: '图片ID', ref: 'Markdown引用' }],
    total: '数量'
  }
}

// 获取图片数据
{
  name: 'get_article_image',
  description: '获取图片的Base64数据',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID',
    image_id: '图片ID'
  },
  returns: {
    data_url: '可直接用于img src的data URL'
  }
}

// 列出文章图片
{
  name: 'list_article_images',
  description: '列出文章中的所有图片',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID'
  }
}

// 更新图片信息
{
  name: 'update_article_image',
  description: '更新图片的替代文本或描述',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID',
    image_id: '图片ID',
    alt_text: '新的替代文本',
    description: '新的描述'
  }
}

// 删除图片
{
  name: 'delete_article_image',
  description: '删除文章中的图片',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID',
    image_id: '图片ID'
  }
}
```

## 6. 安全考虑

### 6.1 认证与授权
- 所有图片 API 需要 Token 认证
- 验证用户对知识库的访问权限
- 需要提供正确的 kb_id 和 article_id 才能访问

### 6.2 大小限制
- 单张图片限制：**5MB**
- API 层校验 base64_data 长度（约 6.7M 字符 = 5MB）

### 6.3 MIME 类型白名单
```javascript
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp'
];
```

## 7. 性能考虑

### 7.1 数据库存储
- LONGTEXT 最大支持 4GB，足够存储大图片
- 5MB 限制确保单张图片不会过大
- 后续可迁移到对象存储

### 7.2 图片压缩

**Base64 本身不压缩数据**，反而会增大约 33%（每 3 字节变成 4 字符）。

**压缩策略**：在转 Base64 **之前**压缩图片

| 格式 | 压缩方式 | 压缩率 | 适用场景 |
|------|----------|--------|----------|
| PNG | 无损压缩 | 20-50% | 图表、截图、图标 |
| JPEG | 有损压缩 | 50-90% | 照片、复杂图像 |
| WebP | 有损/无损 | 比 PNG 小 26%，比 JPEG 小 25-34% | 通用 |
| SVG | 文本压缩（gzip） | 50-80% | 矢量图 |

**实现方式**：
```javascript
const sharp = require('sharp');

async function compressImage(base64Data, mimeType, options = {}) {
  const buffer = Buffer.from(base64Data, 'base64');
  
  let compressed;
  if (mimeType === 'image/png') {
    compressed = await sharp(buffer)
      .png({ compressionLevel: 9, quality: options.quality || 80 })
      .toBuffer();
  } else if (mimeType === 'image/jpeg') {
    compressed = await sharp(buffer)
      .jpeg({ quality: options.quality || 80 })
      .toBuffer();
  } else if (mimeType === 'image/webp') {
    compressed = await sharp(buffer)
      .webp({ quality: options.quality || 80 })
      .toBuffer();
  } else {
    return base64Data; // 不支持的格式直接返回
  }
  
  return compressed.toString('base64');
}
```

**压缩时机**：
- 上传时自动压缩（可选配置）
- 默认质量 80%，平衡画质与体积
- SVG 使用文本压缩，不通过 sharp 处理

**建议**：Phase 2 实现自动压缩功能

### 7.3 缓存策略
- 图片响应设置 `Cache-Control: public, max-age=86400`
- 浏览器可缓存已加载的图片 24 小时

### 7.4 延迟加载
- Markdown 渲染时图片按需加载
- 列表 API 不返回 base64_data，仅返回元信息

## 8. VL 模型生成描述

### 8.1 触发时机
- 图片上传后，异步调用 VL 模型生成描述
- 不阻塞上传响应

### 8.2 实现方式
```javascript
async function generateImageDescription(base64Data, mimeType) {
  // 调用视觉语言模型
  const response = await fetch(VL_MODEL_API, {
    method: 'POST',
    body: JSON.stringify({
      image: `data:${mimeType};base64,${base64Data}`,
      prompt: '请用简洁的语言描述这张图片的内容，用于搜索和辅助阅读。'
    })
  });
  return response.json().description;
}
```

## 9. 实施计划

### Phase 1：核心功能
1. ✅ 创建设计文档
2. 创建 `kb_article_images` 表
3. 创建 Model 文件
4. 实现图片 CRUD API
5. 更新 kb-editor skill

### Phase 2：集成优化
1. 更新专家技能调用流程
2. 前端图片显示支持
3. 添加缓存策略

### Phase 3：增强功能
1. VL 模型生成图片描述
2. 图片压缩（可选）
3. 迁移到对象存储（可选）

## 10. 设计讨论与待确认事项

### 10.1 图片去重策略
**问题**：同一张图片可能在文章中被多次引用（如 logo 图标），是否需要去重？

**方案 A**：不去重，每次上传都创建新记录
- 优点：实现简单，每张图片独立
- 缺点：可能存储重复数据

**方案 B**：按 Base64 哈希去重
- 优点：节省存储空间
- 缺点：需要增加引用计数机制，删除逻辑复杂

**建议**：先采用方案 A，后续按需优化

### 10.2 孤立图片清理
**问题**：当 Markdown 内容更新删除了图片引用，但图片记录仍存在于数据库中

**方案**：
1. 增加 `reference_count` 字段，跟踪引用次数
2. 或提供 `cleanup_orphan_images` 工具，定期清理

**建议**：Phase 2 实现清理工具，手动触发

### 10.3 kb_id 在 URL 中的必要性
**问题**：URL 中包含 kb_id，但 article_id 已能确定知识库

**分析**：
- 优点：URL 语义清晰，便于日志追踪
- 缺点：URL 较长

**建议**：保持当前设计，URL 语义化更重要

### 10.4 图片与段落的关系
**问题**：当前图片只关联 article，未关联具体 paragraph

**考虑**：
- 如果关联 paragraph，段落删除时需要处理图片
- 当前设计图片属于文章，段落只是引用图片 URL

**建议**：保持当前设计，图片属于文章级别资源

### 10.5 批量上传支持
**问题**：一篇文档可能包含多张图片，逐个上传效率低

**方案**：增加批量上传 API
```
POST /api/kb/:kb_id/articles/:article_id/images/batch
```

**建议**：Phase 2 实现

### 10.6 Markdown 图片引用语法
**当前方案**：标准 Markdown 语法
```markdown
![alt_text](/api/kb/kb001/articles/art_123/images/img_456)
```

**可选方案**：自定义引用语法（类似 Hugo shortcode）
```markdown
{{< kb-image id="img_456" alt="描述" >}}
```

**建议**：使用标准 Markdown 语法，兼容性更好

### 10.7 前端认证与图片渲染
**问题**：如何避免图床化，同时解决认证问题？

**方案**：API 返回 Base64，前端拼装组件
1. 图片 API 返回 JSON 格式的 Base64 数据
2. 前端通过 API 获取数据（自然携带 Token）
3. 使用 `data_url` 直接作为 `<img src>` 或组件属性

**优点**：
- 图片数据始终通过认证 API 获取，不是公开图床
- 无需签名 URL 或 Cookie 方案
- 前端可控制加载时机、错误处理、缓存策略

**已采用此方案**，见 3.3 和 4.3 节

---

## 11. 决策记录

| 事项 | 决策 | 理由 |
|------|------|------|
| 图片去重 | 不去重 | 实现简单，避免引用计数复杂度 |
| 孤立图片 | Phase 2 提供清理工具 | 手动触发，用户可控 |
| 图片归属 | 文章级别 | 避免段落删除时处理图片 |
| API 返回格式 | Base64 JSON | 避免图床化，前端拼装组件 |
| Markdown 引用 | `kb-img:id` 格式 | 简洁，仅包含图片 ID |
| 批量上传 | Phase 1 实现 | 提高效率，一次提交多张图片 |
| 图片压缩 | Phase 2 实现 | 上传前压缩，使用 sharp 库 |

---

✌Bazinga！
