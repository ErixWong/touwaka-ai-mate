# 知识库图片存储方案设计（修订版）

> **⚠️ 已废弃**：本文档已整合到以下新文档，请参考新文档：
> - **通用附件服务**：[`docs/design/attachment-service-design.md`](../attachment-service-design.md)
> - **知识库召回**：[`docs/design/kb-recall-design.md`](../kb-recall-design.md)
>
> 本文档仅保留历史参考，不再更新。

## 1. 背景与需求

### 1.1 当前问题
- 专家调用技能解析图文时，图片未能持久化存储
- 图片仅存在于临时内存中，无法在后续查询中展示
- Markdown 文档中的图片引用无法正确显示

### 1.2 需求目标
1. 将解析出的图片存储到通用附件服务
2. 提供图片访问 API，支持通过 ID 获取图片
3. 在 Markdown 内容中嵌入图片引用
4. 图片随知识点一起存入 `kb_paragraphs` 表

## 2. 架构设计

### 2.1 整合 Attachment 服务

知识库图片不再使用独立的 `kb_article_images` 表，而是通过通用附件服务存储：

```
┌─────────────────────────────────────────────────────────┐
│                    Attachment Service                    │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
│  │ attachments │    │  Disk Storage│    │    API      │   │
│  │    表       │───▶│  2026/04/05 │◀───│  /api/attachments │   │
│  └─────────────┘    └─────────────┘    └─────────────┘   │
└─────────────────────────────────────────────────────────┘
                              │
                              │ source_tag='kb_article_image'
                              │
┌─────────────────────────────────────────────────────────┐
│                    Knowledge Base                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │kb_articles  │───▶│kb_sections  │───▶│kb_paragraphs│ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│       │                                               │
│       │ Markdown 引用: attach:abc123def456789012      │
│       └───────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────┘
```

### 2.2 数据关系

| 表/服务 | 角色 | 说明 |
|---------|------|------|
| `attachments` | 存储 | 通用附件表，图片以文件形式存储在磁盘 |
| `kb_articles` | 业务 | 文章表，通过 `source_tag='kb_article_image'` + `source_id=article_id` 关联图片 |
| `kb_paragraphs` | 引用 | 段落内容中的 Markdown 包含 `attach:id` 引用 |

## 3. 数据库设计

### 3.1 使用通用 attachments 表

知识库图片使用通用附件表，无需创建 `kb_article_images` 表：

```sql
-- 复用 attachments 表
-- source_tag = 'kb_article_image'
-- source_id = article_id
```

### 3.2 source_tag 定义

| source_tag | 用途 | source_id |
|------------|------|-----------|
| `kb_article_image` | 文章配图 | kb_articles.id |
| `kb_article_cover` | 文章封面 | kb_articles.id |

## 4. API 设计（简化版）

### 4.1 上传图片

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
  "file_name": "diagram.png",
  "mime_type": "image/png",
  "file_size": 12345,
  "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA...",
  "ref": "attach:abc123def456789012"
}
```

### 4.2 批量上传图片

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
    }
  ]
}
```

### 4.3 获取图片（返回 data_url）

```
GET /api/attachments/:id
```

**响应：**
```json
{
  "id": "abc123def456789012",
  "mime_type": "image/png",
  "file_size": 12345,
  "width": 800,
  "height": 600,
  "alt_text": "系统架构图",
  "data_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA..."
}
```

### 4.4 列出文章图片

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
      "ref": "attach:abc123def456789012"
    }
  ],
  "total": 1
}
```

### 4.5 删除图片

```
DELETE /api/attachments/:id
```

## 5. 工作流程

### 5.1 图片存储流程

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
│  调用附件API    │────▶│  attachments 表  │
│  上传图片       │     │  + 磁盘文件      │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐
│  获取 ref       │
│  attach:id      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│  创建段落       │────▶│  kb_paragraphs   │
│  嵌入Markdown   │     │  content含attach │
└─────────────────┘     └──────────────────┘
```

### 5.2 图片读取流程（优化版）

**关键洞察**：段落属于 section，section 属于 article，前端渲染时已知 `article_id`。

```
┌─────────────────┐
│  前端/聊天      │
│  请求显示文章   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  获取文章树     │
│  GET /tree      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐
│  获取文章附件   │────▶│  attachments 表  │
│  source_id=     │     │  WHERE source_id │
│  article_id     │     │  = article_id    │
└────────┬────────┘     └──────────────────┘
         │
         ▼
┌─────────────────┐
│  构建附件缓存   │
│  Map<id, info>  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  渲染段落       │
│  从缓存查找附件 │
│  根据 mime_type │
│  选择渲染器     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  按需加载图片   │
│  (懒加载)       │
│  GET /:id       │
└─────────────────┘
```

**API 调用次数**：
| 步骤 | API | 次数 |
|------|-----|------|
| 获取文章树 | `GET /api/kb/:kb_id/articles/:article_id/tree` | 1 次 |
| 获取文章所有附件元信息 | `GET /api/attachments?source_tag=kb_article_image&source_id=article_id` | 1 次 |
| 按需加载图片数据 | `GET /api/attachments/:id` | N 次（懒加载） |

**总计：2 次 API 调用**（获取元信息）+ 按需加载数据

### 5.3 Markdown 图片引用格式

**引用语法：**
```markdown
![系统架构图](attach:abc123def456789012)
```

**设计说明：**
- 保持简洁，仅包含附件 ID
- 扩展名/媒体类型由后端根据 ID 查询后返回
- 前端根据 API 返回的 `mime_type` 决定渲染方式
- 为未来支持视频、音频预留扩展空间

**前端渲染：**
后端直接返回 `data_url`，前端可直接使用：

```html
<img src="data:image/png;base64,iVBORw0KGgo..." alt="系统架构图" />
```

或调用 API 获取完整信息（含 `mime_type`）：

```javascript
const response = await fetch('/api/attachments/abc123def456789012');
const { data_url, alt_text, mime_type } = await response.json();

// 根据 mime_type 选择渲染器
if (mime_type.startsWith('image/')) {
  return `<img src="${data_url}" alt="${alt_text}" />`;
} else if (mime_type.startsWith('video/')) {
  return `<video controls src="${data_url}">${alt_text}</video>`;
}
```

## 6. Skill 工具扩展

### 6.1 kb-editor skill 新增工具

```javascript
// 上传图片
{
  name: 'upload_article_image',
  description: '上传图片到文章，返回可在Markdown中使用的引用',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID',
    file_name: '图片文件名',
    mime_type: 'MIME类型',
    base64_data: 'Base64编码数据',
    alt_text: '替代文本（可选）'
  },
  returns: {
    id: '图片ID',
    ref: 'Markdown引用，如 attach:abc123def456789012',
    data_url: '可直接使用的data URL'
  }
}

// 批量上传图片
{
  name: 'upload_article_images_batch',
  description: '批量上传图片到文章',
  parameters: {
    kb_id: '知识库ID',
    article_id: '文章ID',
    files: [{ file_name, mime_type, base64_data, alt_text }]
  },
  returns: {
    items: [{ id, ref, data_url }],
    total: '数量'
  }
}

// 获取图片
{
  name: 'get_article_image',
  description: '获取图片的data_url',
  parameters: {
    image_id: '图片ID'
  },
  returns: {
    data_url: '可直接使用的data URL',
    alt_text: '替代文本'
  }
}

// 列出文章图片
{
  name: 'list_article_images',
  description: '列出文章中的所有图片',
  parameters: {
    article_id: '文章ID'
  }
}

// 删除图片
{
  name: 'delete_article_image',
  description: '删除文章中的图片',
  parameters: {
    image_id: '图片ID'
  }
}
```

## 7. 安全考虑

### 7.1 问题背景

**浏览器 `<img>` / `<video>` 等媒体元素发起请求时不会携带 `Authorization` header**

这意味着：
- 前端无法直接使用 `/api/attachments/:id` 作为 `<img src>`
- 原设计要求前端先获取 `data_url`，然后使用 Base64 数据作为图片源
- 但对于大文件（> 100KB），Base64 编码会导致内存膨胀和性能问题

### 7.2 解决方案：临时 Token 嵌入 URL

参考 task-static 模块（`server/routes/task-static.routes.js`）的设计，使用临时 Token 嵌入 URL 的方式实现权限验证。

**核心思路**：
1. Token 嵌入 URL 路径中，浏览器请求自动携带
2. Token 随机生成（非 JWT），无法伪造
3. Token 有过期时间，限制暴露窗口
4. Token 与用户绑定，可追溯访问来源

### 7.3 与 Attachment 系统的结合方式

#### 7.3.1 资源级 Token 设计

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

#### 7.3.2 attachment_token 表

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

#### 7.3.3 双模式访问设计

| 模式 | 适用场景 | 认证方式 | URL 格式 |
|------|----------|----------|----------|
| **API 模式** | 获取元信息、上传、删除 | JWT Token (Authorization header) | `/api/attachments/:id` |
| **Token 模式** | `<img>` / `<video>` 等媒体元素 | URL 嵌入临时 Token | `/attach/t/:token/:attachment_id` |

#### 7.3.4 Token 生成 API

```
POST /api/attachments/token
```

**请求体：**
```json
{
  "source_tag": "kb_article_image",
  "source_id": "article_123456789",
  "expires_in": 3600  // 有效期（秒），默认 1 小时，最大 24 小时
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

#### 7.3.5 Token 访问路由

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
  DEFAULT_EXPIRES_IN: 3600,      // 默认有效期：1 小时（秒）
  MAX_EXPIRES_IN: 86400,         // 最大有效期：24 小时（秒）
  // 注意：不启用续期机制，Token 过期后需重新生成
};
```

#### 7.3.6 前端使用流程

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

### 7.4 与 task-static 模块的对比

| 对比项 | task-static | attachment |
|--------|-------------|------------|
| Token 表 | `task_token` | `attachment_token` |
| 资源类型 | 任务工作空间文件 | 通用附件 |
| URL 格式 | `/task-static/t/:token/p/*filePath` | `/attach/t/:token/:id` |
| 权限检查 | 任务归属用户检查 | source_tag 分发到各模块 |

### 7.5 安全分析

| 攻击场景 | 防护措施 |
|----------|----------|
| 用户 A 分享 Token URL 给用户 B | Token 与 A 绑定，过期后失效 |
| 暴力枚举 Token | Token 使用 64 位随机字符，不可枚举 |
| Token 泄露 | 有过期时间限制暴露窗口 |

### 7.6 认证与授权
- 所有图片 API 需要 Token 认证
- 通过 `source_tag` 分发到各业务模块检查权限
- `kb_article_image` 类型检查用户对知识库的访问权限

### 7.7 大小限制
- 单张图片限制：**10MB**
- 批量上传单次最多 **10 个文件**

### 7.8 MIME 类型白名单
```javascript
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'image/webp'
];
```

## 8. 性能考虑

### 8.1 磁盘存储
- 文件按 `YYYY/MM/DD/` 分层存储，避免单目录文件过多
- 图片响应设置 `Cache-Control: public, max-age=86400`

### 8.2 图片压缩（Phase 2）
上传前使用 sharp 库压缩：
- PNG: compressionLevel 9
- JPEG: quality 80
- WebP: quality 80

### 8.3 延迟加载
- Markdown 渲染时图片按需加载
- 列表 API 不返回 data_url，仅返回元信息

## 9. 实施计划

### Phase 1：核心功能
1. 创建 `attachments` 表（通用附件服务）
2. 创建 Attachment Model
3. 实现附件 CRUD API
4. 更新 kb-editor skill，添加图片工具

### Phase 2：集成优化
1. 更新专家技能调用流程，支持图片解析
2. 前端 Markdown 图片渲染支持
3. 图片压缩功能

### Phase 3：增强功能
1. VL 模型生成图片描述
2. 图片预览功能
3. 迁移到对象存储（可选）

## 10. 决策记录

| 事项 | 决策 | 理由 |
|------|------|------|
| 表设计 | 使用通用 attachments 表 | 全系统复用，避免重复设计 |
| 存储方式 | 磁盘文件 + 数据库存路径 | 性能好，易扩展 |
| API 数量 | 5 个（上传/批量/获取/列表/删除） | 合并元信息到获取接口，简化设计 |
| Markdown 引用 | `attach:id` 格式 | 简洁，与通用附件服务一致 |
| 前端渲染 | 后端返回 data_url | 前端直接使用，无需二次处理 |
| 权限检查 | source_tag 分发 | 各业务模块自行实现权限逻辑 |
| 媒体类型 | 后端返回 mime_type | 类型信息来自权威数据源，前端根据类型选择渲染器 |
| API 调用优化 | 通过 source_id 批量查询 | 一次请求获取文章所有附件元信息，无需逐个请求 |
| **Token 粒度** | 资源级 Token（source_tag + source_id） | N 个附件 = 1 个 token，减少 DB 写入次数 |
| **Token 续期** | 不启用续期机制 | 简化实现，Token 过期后重新生成；常量定义 DEFAULT_EXPIRES_IN: 3600, MAX_EXPIRES_IN: 86400 |
| **task_token 与 attachment_token** | 保持独立表 | 权限模型不同，生命周期不同，访问模式不同 |
| **MIME 验证** | 文件魔数验证 | 不信任用户声明的 MIME 类型，通过文件头魔数验证真实类型 |
| **专家召回场景** | 后端生成 Token 嵌入 Markdown | 召回 API 在后端执行，Token 与当前用户绑定，前端无需额外请求 |

## 11. 与原版方案对比

| 对比项 | 原版方案 | 修订版方案 |
|--------|----------|------------|
| 数据库表 | `kb_article_images` 专用表 | 复用 `attachments` 通用表 |
| API 数量 | 6 个（含 update/info） | 5 个（删除 update，合并 info） |
| URL 层级 | `/kb/:kb_id/articles/:article_id/images` | `/api/attachments`（统一路由） |
| 存储方式 | Base64 存数据库 | 磁盘文件 + 数据库存路径 |
| 前端渲染 | 正则匹配→API调用→拼装 | 后端直接返回 data_url |
| 扩展性 | 仅知识库可用 | 全系统通用 |

---

*修订版本：v2.0（整合 Attachment Service）*

