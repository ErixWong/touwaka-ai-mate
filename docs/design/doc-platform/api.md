# Doc Platform API

本文档总结当前代码里已经落地的文档平台接口。

## 路由入口

- 文档平台主路由：`server/routes/doc.routes.js`
- 文档集合路由：`server/routes/doc-collection.routes.js`
- 统一前缀：`/api/docs`

## 文档接口

### Intake / Documents

| 方法 | 路径 | 作用 |
|------|------|------|
| `POST` | `/api/docs/intakes` | 文档接入，启动固定处理流水线 |
| `GET` | `/api/docs/documents` | 文档列表 |
| `POST` | `/api/docs/documents` | 创建文档 |
| `GET` | `/api/docs/documents/:documentId` | 文档详情 |
| `GET` | `/api/docs/documents/:documentId/result` | 文档结果详情 |
| `PATCH` | `/api/docs/documents/:documentId` | 更新文档 |
| `DELETE` | `/api/docs/documents/:documentId` | 删除文档 |
| `GET` | `/api/docs/documents/:documentId/processing` | 查询处理状态 |
| `POST` | `/api/docs/documents/:documentId/retry` | 重试失败处理 |
| `GET` | `/api/docs/documents/:documentId/permissions` | 查询文档权限 |
| `POST` | `/api/docs/documents/:documentId/relocate` | 迁移文档集合 |

### OCR / Processing

| 方法 | 路径 | 作用 |
|------|------|------|
| `POST` | `/api/docs/documents/:documentId/ocr/submit` | 提交 OCR 任务 |
| `POST` | `/api/docs/documents/:documentId/ocr/sync` | 同步 OCR 任务状态 |

### Revision / Outline / Chunk

| 方法 | 路径 | 作用 |
|------|------|------|
| `GET` | `/api/docs/documents/:documentId/revisions` | 获取版本列表 |
| `POST` | `/api/docs/documents/:documentId/revisions` | 创建新版本 |
| `GET` | `/api/docs/documents/:documentId/revisions/:revisionId/content-tree` | 获取内容树 |
| `POST` | `/api/docs/revisions/:revisionId/set-current` | 设为当前版本 |
| `POST` | `/api/docs/revisions/:revisionId/transition` | 版本状态流转 |
| `GET` | `/api/docs/revisions/:revisionId/diff-status` | 查询差异状态 |
| `POST` | `/api/docs/revisions/:revisionId/outline/extract` | 提取章节大纲 |
| `POST` | `/api/docs/revisions/:revisionId/chunks/generate` | 生成文本分块 |

### Recall / Compare

| 方法 | 路径 | 作用 |
|------|------|------|
| `POST` | `/api/docs/recall` | 统一召回入口 |
| `POST` | `/api/docs/compare-runs` | 创建比对任务 |
| `GET` | `/api/docs/compare-runs/:runId` | 获取比对结果 |

## 集合接口

### Collection CRUD

| 方法 | 路径 | 作用 |
|------|------|------|
| `GET` | `/api/docs/collections` | 集合列表 |
| `POST` | `/api/docs/collections` | 创建集合 |
| `GET` | `/api/docs/collections/:id` | 集合详情 |
| `PATCH` | `/api/docs/collections/:id` | 更新集合 |
| `DELETE` | `/api/docs/collections/:id` | 删除集合 |

### 集合文档关联

| 方法 | 路径 | 作用 |
|------|------|------|
| `GET` | `/api/docs/collections/:id/documents` | 集合内文档列表 |
| `POST` | `/api/docs/collections/:id/documents` | 向集合中添加文档 |
| `DELETE` | `/api/docs/collections/:id/documents/:docId` | 从集合移除文档 |
| `POST` | `/api/docs/documents/:docId/move-collection` | 移动文档到其他集合 |
| `POST` | `/api/docs/collections/:id/revectorize` | 重新向量化集合 |

## 前端对应入口

| 文件 | 作用 |
|------|------|
| `frontend/src/api/docs.ts` | 前端 API 封装 |
| `frontend/src/views/CollectionListView.vue` | 文档/集合首页 |
| `frontend/src/views/CollectionDetailView.vue` | 集合详情页 |
| `frontend/src/views/DocDetailView.vue` | 文档详情页 |

---

*最后更新: 2026-06-21*
