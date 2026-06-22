# Doc Platform 实现入口

本目录用于记录当前项目中**已经落地**的文档平台实现。

## 当前实现边界

当前项目中已经落地的文档平台由以下实现链路组成：

- 路由前缀：`/api/docs`
- 集合模型：`document_collections`
- 文档主表：`documents`
- 版本表：`document_revisions`
- OCR 结果表：`doc_ocr_results`
- 章节大纲表：`document_outlines`
- 文本分块表：`document_chunks`
- 差异比对：`doc_compare_runs` / `doc_compare_items`

## 文档索引

| 文档 | 说明 |
|------|------|
| [data-model.md](./data-model.md) | 集合、文档、版本、outline、chunk 的当前数据模型 |
| [api.md](./api.md) | `/api/docs` 与 `/api/docs/collections` 当前接口摘要 |
| [processing-pipeline.md](./processing-pipeline.md) | OCR -> outline -> chunk -> embedding 当前流水线 |

## 代码入口

### 后端

| 文件 | 作用 |
|------|------|
| `server/routes/doc.routes.js` | 文档平台主路由，前缀 `/api/docs` |
| `server/routes/doc-collection.routes.js` | 集合 CRUD、集合文档关联、revectorize |
| `server/controllers/doc.controller.js` | 文档、版本、OCR、outline、chunk、recall、compare 控制器 |
| `server/controllers/doc-collection.controller.js` | 文档集合控制器 |
| `lib/document-outline-service.js` | 章节大纲提取服务 |
| `lib/document-chunk-service.js` | 文本分块服务 |
| `lib/document-embedding-service.js` | 向量生成服务 |

### 前端

| 文件 | 作用 |
|------|------|
| `frontend/src/views/CollectionListView.vue` | 文档平台首页，文档/集合双视图 |
| `frontend/src/views/CollectionDetailView.vue` | 集合详情页 |
| `frontend/src/views/DocDetailView.vue` | 文档详情页，预览、处理状态、outline/chunk 操作 |
| `frontend/src/api/docs.ts` | `/api/docs` 前端 API 封装 |

## 当前实现摘要

- 集合与文档是两层结构：`document_collections` -> `documents`
- 文档有独立版本：`document_revisions`
- 文档处理链包含 OCR、章节提取、chunk 生成、embedding
- 章节提取结果落在 `document_outlines`
- 文本分块结果落在 `document_chunks`
- 前端当前入口是 `/docs`、集合详情页和文档详情页

## 相关文档

- 实现说明：本目录文档
- 相关草稿：`docs/design/drafts/document-intelligence-scenarios.md`（文档智能场景设想，当前代码中无直接对应模块）

当前文档平台的实现说明以本目录和实际代码为准。

---

*最后更新: 2026-06-21*
