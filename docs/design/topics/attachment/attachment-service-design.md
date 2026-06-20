# 通用附件服务设计文档

## 1. 设计目标

提供全系统统一的附件存储服务，支持图片、文档、导出文件等各类文件的存储和管理。

## 2. 数据库设计

### 2.1 attachments 表

```sql
CREATE TABLE `attachments` (
  `id` varchar(20) NOT NULL COMMENT '附件唯一ID（Utils.newID生成）',
  `source_tag` varchar(50) NOT NULL COMMENT '业务标识：kb_article_image, user_avatar, task_export 等',
  `source_id` varchar(20) NOT NULL COMMENT '关联资源ID',
  `file_name` varchar(255) DEFAULT NULL COMMENT '原始文件名',
  `ext_name` varchar(20) DEFAULT NULL COMMENT '扩展名（png, jpg, pdf等）',
  `mime_type` varchar(100) NOT NULL COMMENT 'MIME类型',
  `file_size` int DEFAULT 0 COMMENT '文件大小（字节）',
  `file_path` varchar(500) NOT NULL COMMENT '相对路径：2026/04/05/abc123.png',
  `width` int DEFAULT NULL COMMENT '图片宽度（仅图片类型）',
  `height` int DEFAULT NULL COMMENT '图片高度',
  `alt_text` varchar(500) DEFAULT NULL COMMENT '替代文本',
  `description` text DEFAULT NULL COMMENT '文件描述（VL模型生成）',
  `created_by` varchar(20) DEFAULT NULL COMMENT '上传者ID',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_source` (`source_tag`, `source_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通用附件表';
```

### 2.2 source_tag 规范

| source_tag | 用途 | source_id 指向 |
|------------|------|----------------|
| `kb_article_image` | 知识库文章配图 | kb_articles.id |
| `kb_article_cover` | 知识库文章封面 | kb_articles.id |
| `user_avatar` | 用户头像 | users.id |
| `expert_avatar` | 专家头像 | experts.id |
| `task_export` | 任务导出文件 | tasks.id |
| `solution_export` | 方案导出文件 | solutions.id |

## 3. 磁盘存储结构

```
{attachment_base_path}/
├── 2026/
│   ├── 04/
│   │   ├── 05/
│   │   │   ├── abc123def456789012.png
│   │   │   ├── xyz789abc123456789.jpg
│   │   │   └── ...
│   │   └── 06/
│   └── 05/
└── ...
```

**路径生成规则**：
- 基础路径：`process.env.ATTACHMENT_BASE_PATH || './data/attachments'`
- 子目录：`YYYY/MM/DD/`
- 文件名：`{attachment_id}.{ext_name}`

## 4. API 设计

### 4.1 上传附件

```
POST /api/attachments
```

**请求体：**
```json
{
  "source_tag": "kb_article_image",
  "source_id": "article_123456789",
  "file_name": "diagram.png",
  "mime_type": "image/png",
  "base64_data": "iVBORw0KGgoAAAANSUhEUgAAA...",
  "alt_text": "系统架构图"
}
```

**响应：**
```json
{
  "id": "abc123def456789012",
  "source_tag": "kb_article_image",
  "source_id": "article_123456789",
  "file_name": "diagram.png",
  "mime_type": "image/png",
  "file_size": 12345,
  "width": 800,
  "height": 600,
  "file_path": "2026/04/05/abc123def456789012.png",
  "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA...",
  "ref": "attach:abc123def456789012",
  "created_at": "2026-04-05T16:30:00.000Z"
}
```

### 4.2 批量上传附件

```
POST /api/attachments/batch
```

**请求体：**
```json
{
  "source_tag": "kb_article_image",
  "source_id": "article_123456789",
  "files": [
    {
      "file_name": "diagram1.png",
      "mime_type": "image/png",
      "base64_data": "iVBORw0KGgo...",
      "alt_text": "图1"
    },
    {
      "file_name": "diagram2.png",
      "mime_type": "image/png",
      "base64_data": "iVBORw0KGgo...",
      "alt_text": "图2"
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
      "file_name": "diagram1.png",
      "file_size": 12345,
      "data_url": "data:image/png;base64,...",
      "ref": "attach:abc123def456789012"
    }
  ],
  "total": 2
}
```

### 4.3 获取附件（返回 data_url）

```
GET /api/attachments/:id
```

**响应：**
```json
{
  "id": "abc123def456789012",
  "source_tag": "kb_article_image",
  "source_id": "article_123456789",
  "file_name": "diagram.png",
  "mime_type": "image/png",
  "file_size": 12345,
  "width": 800,
  "height": 600,
  "alt_text": "系统架构图",
  "description": "这是一张展示系统架构的图表...",
  "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA...",
  "created_at": "2026-04-05T16:30:00.000Z"
}
```

### 4.4 批量获取附件元信息（轻量级）

用于前端预渲染场景，快速获取多个附件的类型信息，无需加载完整数据：

```
POST /api/attachments/meta
```

**请求体：**
```json
{
  "ids": ["abc123def456789012", "xyz789abc123456789"]
}
```

**响应：**
```json
{
  "items": [
    {
      "id": "abc123def456789012",
      "mime_type": "image/png",
      "ext_name": "png",
      "file_size": 12345,
      "width": 800,
      "height": 600,
      "alt_text": "系统架构图"
    },
    {
      "id": "xyz789abc123456789",
      "mime_type": "video/mp4",
      "ext_name": "mp4",
      "file_size": 5000000,
      "width": 1920,
      "height": 1080,
      "alt_text": "演示视频"
    }
  ],
  "total": 2
}
```

**设计说明：**
- 不返回 `data_url`，仅返回元信息，响应轻量
- 前端可根据 `mime_type` 预先决定渲染器类型
- 适用于 Markdown 批量解析场景

### 4.5 列出某资源的所有附件

```
GET /api/attachments?source_tag=kb_article_image&source_id=article_123456789
```

**响应：**
```json
{
  "items": [
    {
      "id": "abc123def456789012",
      "file_name": "diagram.png",
      "mime_type": "image/png",
      "file_size": 12345,
      "width": 800,
      "height": 600,
      "alt_text": "系统架构图",
      "ref": "attach:abc123def456789012",
      "created_at": "2026-04-05T16:30:00.000Z"
    }
  ],
  "total": 1
}
```

**设计说明：**
- 通过 `source_tag` + `source_id` 一次查询获取某资源的所有附件
- 前端可缓存此结果，渲染段落时直接使用，无需额外查询

### 4.6 删除附件

```
DELETE /api/attachments/:id
```

**响应：** 204 No Content

## 5. 安全与权限

### 5.1 双模式访问设计

附件服务支持两种访问模式，适应不同场景：

| 模式 | 适用场景 | 认证方式 | URL 格式 |
|------|----------|----------|----------|
| **API 模式** | 获取元信息、上传、删除 | JWT Token (Authorization header) | `/api/attachments/:id` |
| **Token 模式** | `<img>` / `<video>` 等媒体元素 | URL 嵌入临时 Token | `/attach/t/:token/:id` |

**问题背景**：浏览器 `<img>` / `<video>` 等元素发起请求时不会携带 `Authorization` header，因此无法通过 JWT 验证权限。

**解决方案**：参考 task-static 模块，使用临时 Token 嵌入 URL 的方式实现权限验证。

### 5.2 临时 Token 方案

#### 5.2.1 资源级 Token 设计

**设计决策**：采用资源级 Token，而非附件级 Token。

| 维度 | 附件级 Token | 资源级 Token（采用） |
|------|-------------|---------------------|
| Token 数量 | N 个附件 = N 个 token | N 个附件 = 1 个 token |
| 数据库写入 | N 次 | 1 次 |
| 权限粒度 | 精细（单文件） | 粗粒度（整个资源） |

**理由**：
1. 用户访问文章时，通常需要查看所有图片
2. 性能优化明显：10 张图片从 10 次 DB 写入降到 1 次
3. 安全影响可控：Token 已与用户绑定 + 有过期时间限制

#### 5.2.2 attachment_token 表

```sql
CREATE TABLE `attachment_token` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `token` VARCHAR(64) NOT NULL UNIQUE COMMENT 'Token字符串(随机生成，非JWT)',
  `source_tag` VARCHAR(50) NOT NULL COMMENT '资源类型：kb_article_image, task_export 等',
  `source_id` VARCHAR(20) NOT NULL COMMENT '资源ID：article_id, task_id 等',
  `user_id` VARCHAR(32) NOT NULL COMMENT '创建Token的用户ID',
  `expires_at` DATETIME NOT NULL COMMENT '过期时间',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `last_access_at` DATETIME DEFAULT NULL COMMENT '最后访问时间（用于续期追踪）',
  INDEX `idx_token` (`token`),
  INDEX `idx_source` (`source_tag`, `source_id`),
  INDEX `idx_user_source` (`user_id`, `source_tag`, `source_id`),
  INDEX `idx_expires_at` (`expires_at`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='附件访问Token表';
```

**关键变化**：
- 移除 `attachment_id`，改为 `source_tag` + `source_id`
- 新增 `last_access_at` 用于续期追踪
- 移除对 `attachments` 表的外键依赖（改为逻辑关联）

#### 5.2.3 Token 生成 API

```
POST /api/attachments/token
```

**请求体：**
```json
{
  "source_tag": "kb_article_image",
  "source_id": "article_123456789"
}
```

**响应：**
```json
{
  "token": "abc123def456789012xyz",
  "url": "/attach/t/abc123def456789012xyz",
  "expires_at": "2026-04-05T17:30:00.000Z"
}
```

**Token 获取/创建流程**：
1. 验证用户 JWT Token（Authorization header）
2. 检查用户是否有权限访问该资源（通过 source_tag 分发）
3. 查找现有 Token：`WHERE source_tag=? AND source_id=? AND user_id=? AND expires_at > NOW()`
4. 如果存在且未过期，直接返回
5. 如果不存在或已过期，创建新 Token

#### 5.2.4 Token 访问路由

```
GET /attach/t/:token/:attachment_id
```

**验证流程**：
1. 查询 `attachment_token` 表验证 Token
2. 检查 Token 是否过期
3. 查询 `attachments` 表获取附件信息，验证 `source_tag` 和 `source_id` 匹配
4. 返回文件内容（设置正确的 Content-Type）

**常量定义**：
```javascript
const TOKEN_CONFIG = {
  EXPIRES_IN: 3600,  // 有效期：1 小时（秒）
  // 注意：不启用续期机制，Token 过期后需重新生成
};
```

#### 5.2.5 前端使用流程

```javascript
// 1. 获取文章附件元信息（使用 JWT Token）
const attachments = await fetch(
  `/api/attachments?source_tag=kb_article_image&source_id=${articleId}`,
  { headers: { 'Authorization': `Bearer ${jwtToken}` } }
);

// 2. 生成资源级 Token（一次请求，访问所有附件）
const { url } = await fetch('/api/attachments/token', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${jwtToken}` },
  body: JSON.stringify({
    source_tag: 'kb_article_image',
    source_id: articleId
  })
});

// 3. 使用带 Token 的 URL 作为 img src
attachments.items.forEach(attach => {
  const img = document.createElement('img');
  img.src = `${url}/${attach.id}`;  // /attach/t/abc123xyz/att_123
  img.alt = attach.alt_text;
});
```

**关键点**：
- 一个 Token 可访问该资源的所有附件
- Token 生成需要 JWT 认证，确保只有授权用户才能获取
- Token 嵌入 URL 后，浏览器 `<img>` 请求自动携带
- Token 过期后需重新生成（不启用续期机制）

### 5.3 权限检查实现

#### 5.3.1 基础权限检查

```javascript
async function checkAttachmentPermission(ctx, attachment) {
  const { source_tag, source_id } = attachment;
  
  switch (source_tag) {
    case 'kb_article_image':
    case 'kb_article_cover':
      // 检查用户是否有权限访问该知识库文章
      return await checkKbArticlePermission(ctx.user, source_id);
    
    case 'user_avatar':
      // 头像公开可见，或检查是否本人
      return true;
    
    case 'expert_avatar':
      // 专家头像公开可见
      return true;
    
    case 'task_export':
      // 检查任务权限
      return await checkTaskPermission(ctx.user, source_id);
    
    default:
      // 未知类型默认拒绝
      return false;
  }
}
```

#### 5.3.2 专家召回场景的权限设计

**场景描述**：用户通过专家对话，召回知识库内容时，需要展示图片。

**设计方案**：
1. 召回 API 在后端执行，已知当前用户和召回的知识库
2. 后端生成 Token 并嵌入返回的 Markdown 中
3. Token 与当前对话用户绑定

```javascript
// 知识库召回 API
async function recallKnowledge(ctx) {
  const { kb_id, query } = ctx.request.body;
  const userId = ctx.user.id;
  
  // 1. 执行召回逻辑
  const results = await searchKnowledge(kb_id, query);
  
  // 2. 为召回结果生成 Token
  const token = await getOrCreateToken({
    source_tag: 'kb_article_image',
    source_id: results.article_id,
    user_id: userId
  });
  
  // 3. 替换 Markdown 中的图片引用
  results.paragraphs.forEach(p => {
    p.content = p.content.replace(
      /!\[([^\]]*)\]\(attach:([a-zA-Z0-9]+)\)/g,
      (match, altText, attachId) => {
        return `![${altText}](/attach/t/${token.token}/${attachId})`;
      }
    );
  });
  
  return results;
}
```

**关键点**：
- Token 在后端生成，前端无需额外请求
- Token 与用户绑定，确保权限正确
- Markdown 中的图片 URL 已包含 Token，可直接使用

### 5.4 MIME 类型验证

#### 5.4.1 上传时验证

**问题**：用户上传时声明 `mime_type: "image/png"`，但实际可能上传恶意文件。

**解决方案**：通过文件魔数（Magic Number）验证真实类型。

```javascript
const MAGIC_NUMBERS = {
  'image/png':  [0x89, 0x50, 0x4E, 0x47],  // \x89PNG
  'image/jpeg': [0xFF, 0xD8, 0xFF],         // \xFF\xD8\xFF
  'image/gif':  [0x47, 0x49, 0x46],         // GIF
  'image/webp': [0x52, 0x49, 0x46, 0x46],   // RIFF (WebP)
  'image/svg+xml': null,                     // SVG 是文本，需特殊处理
};

async function validateMimeType(base64Data, declaredMimeType) {
  // 1. 解码 Base64
  const buffer = Buffer.from(base64Data, 'base64');
  
  // 2. 获取文件魔数
  const magicNumber = MAGIC_NUMBERS[declaredMimeType];
  if (!magicNumber) {
    // SVG 等文本类型，检查开头是否为 <svg
    if (declaredMimeType === 'image/svg+xml') {
      const content = buffer.toString('utf-8').trim();
      if (!content.startsWith('<svg') && !content.startsWith('<?xml')) {
        throw new Error('Invalid SVG file');
      }
      return true;
    }
    throw new Error(`Unsupported MIME type: ${declaredMimeType}`);
  }
  
  // 3. 验证魔数
  for (let i = 0; i < magicNumber.length; i++) {
    if (buffer[i] !== magicNumber[i]) {
      throw new Error(`File content does not match declared MIME type: ${declaredMimeType}`);
    }
  }
  
  return true;
}
```

#### 5.4.2 白名单验证

```javascript
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

function validateMimeTypeWhitelist(mimeType) {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`MIME type not allowed: ${mimeType}`);
  }
}
```

### 5.5 孤儿附件清理机制

#### 5.5.1 问题定义

**孤儿附件**：`attachments` 表中存在记录，但 `source_id` 对应的资源已被删除。

**产生场景**：
1. 知识库文章删除后，关联的图片附件未清理
2. 用户删除后，头像附件未清理
3. 任务删除后，导出文件未清理

#### 5.5.2 清理策略

**方案**：定期检查任务 + 标记删除

```javascript
// 孤儿附件检查任务（每日执行）
async function checkOrphanAttachments() {
  const BATCH_SIZE = 100;
  let offset = 0;
  
  while (true) {
    // 1. 分批获取附件
    const attachments = await db.query(`
      SELECT id, source_tag, source_id, file_path
      FROM attachments
      WHERE source_tag IN ('kb_article_image', 'kb_article_cover', 'task_export')
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `);
    
    if (attachments.length === 0) break;
    
    // 2. 检查每个附件的资源是否存在
    for (const attach of attachments) {
      const resourceExists = await checkResourceExists(attach.source_tag, attach.source_id);
      
      if (!resourceExists) {
        // 3. 标记为孤儿（可选：直接删除）
        await markAsOrphan(attach.id);
        // 或直接删除
        // await deleteAttachment(attach.id);
      }
    }
    
    offset += BATCH_SIZE;
  }
}

// 检查资源是否存在
async function checkResourceExists(source_tag, source_id) {
  switch (source_tag) {
    case 'kb_article_image':
    case 'kb_article_cover':
      const article = await db.query('SELECT id FROM kb_articles WHERE id = ?', [source_id]);
      return article.length > 0;
    
    case 'task_export':
      const task = await db.query('SELECT id FROM tasks WHERE id = ?', [source_id]);
      return task.length > 0;
    
    default:
      return true; // 未知类型默认认为存在
  }
}
```

#### 5.5.3 清理时机

| 方案 | 优点 | 缺点 |
|------|------|------|
| **资源删除时同步清理** | 即时清理，无孤儿产生 | 需要在各删除 API 中添加清理逻辑 |
| **定期检查清理** | 解耦，不影响删除 API 性能 | 有延迟，可能产生临时孤儿 |
| **混合方案** | 即时清理 + 定期兜底 | 实现复杂 |

**推荐**：定期检查清理（每日执行），简单可靠。

#### 5.5.4 孤儿附件表（可选）

如需保留孤儿附件记录供审计，可添加 `orphan_attachments` 表：

```sql
CREATE TABLE `orphan_attachments` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `attachment_id` VARCHAR(20) NOT NULL,
  `source_tag` VARCHAR(50) NOT NULL,
  `source_id` VARCHAR(20) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `detected_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `cleaned_at` DATETIME DEFAULT NULL,
  INDEX `idx_attachment_id` (`attachment_id`),
  INDEX `idx_detected_at` (`detected_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='孤儿附件记录表';
```

### 5.6 安全分析

| 攻击场景 | 防护措施 |
|----------|----------|
| 用户 A 分享 Token URL 给用户 B | Token 与 A 绑定，B 使用时仍记录为 A 的访问；Token 过期后失效 |
| 暴力枚举 Token | Token 使用 64 位随机字符，不可枚举 |
| Token 泄露 | 有过期时间限制暴露窗口；可配置一次性使用 |
| 暴力枚举附件 ID | ID 使用 Utils.newID(20)，有 62^20 种可能，不可枚举 |

### 5.5 大小限制

- 单文件限制：**10MB**
- 批量上传单次最多 **10 个文件**

### 5.6 MIME 类型白名单

```javascript
const ALLOWED_MIME_TYPES = [
  // 图片
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp',
  // 文档
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/json',
  // 压缩包
  'application/zip',
  'application/x-zip-compressed'
];
```

## 6. 前端引用格式

### 6.1 Markdown 引用

```markdown
![替代文本](attach:abc123def456789012)
```

**设计说明：**
- 保持简洁，仅包含附件 ID
- 扩展名/媒体类型由后端根据 ID 查询后返回
- 前端根据 API 返回的 `mime_type` 决定渲染方式

### 6.2 知识库文章渲染流程（Token 模式）

**关键洞察**：段落属于 section，section 属于 article，前端渲染时已知 `article_id`。

```javascript
// 1. 获取文章树（含所有段落）
const articleTree = await fetch(`/api/kb/${kbId}/articles/${articleId}/tree`);

// 2. 一次请求获取该文章的所有附件元信息
const attachments = await fetch(
  `/api/attachments?source_tag=kb_article_image&source_id=${articleId}`,
  { headers: { 'Authorization': `Bearer ${jwtToken}` } }
);
// 返回: { items: [{ id, mime_type, ext_name, ... }], total }

// 3. 构建附件 ID -> 附件信息的映射（缓存）
const attachmentMap = new Map(
  attachments.items.map(item => [item.id, item])
);

// 4. 批量生成 Token（用于 img src）
// 优化：一次请求生成所有附件的 Token
const tokenResponse = await fetch('/api/attachments/tokens', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${jwtToken}` },
  body: JSON.stringify({
    ids: attachments.items.map(a => a.id),
    expires_in: 3600  // 1 小时
  })
});
const tokens = tokenResponse.json();
// 返回: { items: [{ id, url, expires_at }], total }

// 5. 构建附件 ID -> Token URL 的映射
const tokenUrlMap = new Map(
  tokens.items.map(item => [item.id, item.url])
);

// 6. 渲染段落时，从缓存中查找附件信息和 Token URL
function renderParagraph(paragraph) {
  return paragraph.content.replace(
    /!\[([^\]]*)\]\(attach:([a-zA-Z0-9]+)\)/g,
    (match, altText, attachId) => {
      const attach = attachmentMap.get(attachId);
      const tokenUrl = tokenUrlMap.get(attachId);
      if (!attach || !tokenUrl) return match;
      
      // 使用 Token URL 作为 img src
      return `<img src="${tokenUrl}" alt="${altText}" loading="lazy" />`;
    }
  );
}
```

**API 调用次数**：
| 步骤 | 次数 |
|------|------|
| 获取文章树 | 1 次 |
| 获取文章所有附件元信息 | 1 次 |
| 批量生成 Token | 1 次 |

**总计：3 次 API 调用**，无需按需加载

### 6.3 多媒体类型支持（Token 模式）

前端根据 `mime_type` 选择渲染器，使用 Token URL：

```javascript
function renderAttachment(attachment, tokenUrl, altText) {
  const { mime_type } = attachment;
  
  if (mime_type.startsWith('image/')) {
    return `<img src="${tokenUrl}" alt="${altText}" loading="lazy" />`;
  } else if (mime_type.startsWith('video/')) {
    return `<video controls src="${tokenUrl}">${altText}</video>`;
  } else if (mime_type.startsWith('audio/')) {
    return `<audio controls src="${tokenUrl}">${altText}</audio>`;
  } else {
    return `<a href="${tokenUrl}" download>${altText}</a>`;
  }
}
```

**优点：**
- 引用格式简洁，不暴露内部细节
- 前端可灵活扩展支持新类型
- 类型信息来自权威数据源（数据库），而非用户输入的扩展名
- **一次查询获取所有附件元信息，无需逐个请求**
- **Token URL 可直接用于 `<img src>`，浏览器自动携带**

### 6.4 小文件场景：data_url 模式

对于小文件（< 100KB），可使用 data_url 模式，减少 Token 生成开销：

```javascript
// 获取附件（返回 data_url）
const response = await fetch('/api/attachments/abc123def456789012', {
  headers: { 'Authorization': `Bearer ${jwtToken}` }
});
const { data_url, alt_text, mime_type, file_size } = await response.json();

// 小文件直接使用 data_url
if (file_size < 100 * 1024) {
  imgElement.src = data_url;
} else {
  // 大文件使用 Token 模式
  const { url } = await fetch('/api/attachments/abc123def456789012/token', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwtToken}` }
  });
  imgElement.src = url;
}
```

**模式选择建议**：
| 文件大小 | 推荐模式 | 理由 |
|----------|----------|------|
| < 100KB | data_url | 减少 Token 生成开销，直接嵌入 |
| > 100KB | Token | 避免 Base64 编码膨胀，减少内存占用 |

## 7. Skill 工具扩展

### 7.1 attachment skill（新增）

```javascript
// 上传附件
{
  name: 'upload_attachment',
  description: '上传附件到指定资源',
  parameters: {
    source_tag: '业务标识',
    source_id: '资源ID',
    file_name: '文件名',
    mime_type: 'MIME类型',
    base64_data: 'Base64数据',
    alt_text: '替代文本（可选）'
  },
  returns: {
    id: '附件ID',
    ref: '引用格式 attach:id',
    data_url: '可直接使用的data URL'
  }
}

// 批量上传
{
  name: 'upload_attachments_batch',
  description: '批量上传附件',
  parameters: {
    source_tag: '业务标识',
    source_id: '资源ID',
    files: [{ file_name, mime_type, base64_data, alt_text }]
  }
}

// 获取附件
{
  name: 'get_attachment',
  description: '获取附件的data_url',
  parameters: {
    id: '附件ID'
  },
  returns: {
    data_url: '可直接使用的data URL',
    alt_text: '替代文本'
  }
}

// 列出资源附件
{
  name: 'list_attachments',
  description: '列出某资源的所有附件',
  parameters: {
    source_tag: '业务标识',
    source_id: '资源ID'
  }
}

// 删除附件
{
  name: 'delete_attachment',
  description: '删除附件',
  parameters: {
    id: '附件ID'
  }
}
```

## 8. 实施计划

### Phase 1：核心功能
1. 创建 `attachments` 表
2. 创建 Model 文件
3. 实现附件 CRUD API
4. 创建 attachment skill

### Phase 2：业务集成
1. 知识库图片迁移到 attachment 服务
2. 用户头像支持
3. 任务导出文件支持

### Phase 3：增强功能
1. 图片压缩（上传前使用 sharp）
2. VL 模型生成图片描述
3. 文件预览功能

## 9. 决策记录

| 事项 | 决策 | 理由 |
|------|------|------|
| 表设计 | 通用 attachments 表 | 全系统复用，避免多表维护 |
| 存储路径 | 按日期分层目录 | 避免单目录文件过多，便于管理 |
| API 返回 | 包含 data_url | 前端可直接使用，无需二次请求 |
| 权限检查 | source_tag 分发到各模块 | 各业务模块自行实现权限逻辑 |
| 批量上传 | 支持 | 提高效率，一次提交多个文件 |
| 图片压缩 | Phase 2 实现 | 使用 sharp 库，上传前压缩 |
| 媒体类型 | 后端返回 mime_type | 类型信息来自权威数据源，前端根据类型选择渲染器 |
| 引用格式 | `attach:id` 不含扩展名 | 保持简洁，扩展名由后端根据 ID 查询返回 |
| 批量元信息 API | 支持 | 前端预渲染场景可快速获取类型，无需加载完整数据 |
| **媒体元素访问** | 临时 Token 方案 | 浏览器 `<img>` 不携带 Authorization header，参考 task-static 模块设计 |
| **Token 粒度** | 资源级 Token（source_tag + source_id） | N 个附件 = 1 个 token，减少 DB 写入次数 |
| **Token 续期** | 不启用续期机制 | 简化实现，Token 过期后重新生成；常量定义 DEFAULT_EXPIRES_IN: 3600, MAX_EXPIRES_IN: 86400 |
| **Token 有效期** | 固定 1 小时 | 简化实现，平衡安全性和用户体验 |
| **task_token 与 attachment_token** | 保持独立表 | 权限模型不同，生命周期不同，访问模式不同 |
| **小文件策略** | < 100KB 使用 data_url | 减少 Token 生成开销，直接嵌入 |
| **MIME 验证** | 文件魔数验证 | 不信任用户声明的 MIME 类型，通过文件头魔数验证真实类型 |
| **专家召回场景** | 后端生成 Token 嵌入 Markdown | 召回 API 在后端执行，Token 与当前用户绑定，前端无需额外请求 |
| **source_tag 扩展** | 暂不实现，由调用方决定 | 保持简单，后续根据需求扩展 |
| **孤儿附件清理** | 定期检查清理任务 | 检查 source_id 对应的资源是否存在，不存在则标记为孤儿 |

---

*文档版本：v1.4*
