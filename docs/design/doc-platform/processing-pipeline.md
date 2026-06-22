# Doc Platform 处理流水线

本文档描述当前代码中真实落地的文档处理流水线。

## 状态推进

`documents.processing_status` 当前使用以下状态：

1. `pending_ocr`
2. `ocr_processing`
3. `pending_clean`
4. `pending_outline`
5. `pending_chunk`
6. `pending_embedding`
7. `ready`
8. `error`

## 流水线阶段

### 1. OCR

入口：

- `POST /api/docs/documents/:documentId/ocr/submit`
- `POST /api/docs/documents/:documentId/ocr/sync`

主要职责：

- 提交 OCR 任务
- 同步 OCR 状态
- 生成 markdown 结果附件

### 2. Outline 提取

入口：

- `POST /api/docs/revisions/:revisionId/outline/extract`

实现：

- `lib/document-outline-service.js`

主要职责：

- 读取 OCR 产出的 markdown 文本
- 调用 LLM 进行章节提取
- 写入 `document_outlines`
- 将文档状态推进到 `pending_chunk`

### 3. Chunk 生成

入口：

- `POST /api/docs/revisions/:revisionId/chunks/generate`

实现：

- `lib/document-chunk-service.js`

主要职责：

- 读取 `document_outlines`
- 按章节结构切分文本
- 写入 `document_chunks`
- 将文档状态推进到 `pending_embedding`

### 4. Embedding

实现：

- `lib/document-embedding-service.js`

主要职责：

- 读取待处理 `document_chunks`
- 结合文档标题与章节标题拼装 embedding 文本
- 调用 `EmbeddingClient`
- 写入 `document_chunks.embedding_vector`
- 成功后将文档状态推进到 `ready`

## 关键关系

```text
OCR markdown
  -> document_outlines
  -> document_chunks
  -> embeddings
```

这意味着当前实现的 chunk 不是直接从 OCR 文本粗切出来，而是经过章节抽取后再生成。

## 前端体现

在 `frontend/src/views/DocDetailView.vue` 中，当前实现已暴露：

- 处理状态显示
- OCR 进度显示
- 手动触发 outline 提取
- 手动触发 chunk 生成
- chunk 列表预览

---

*最后更新: 2026-06-21*
