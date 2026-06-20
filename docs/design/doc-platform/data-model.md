# Doc Platform 数据模型

本文档描述当前代码中已经落地的文档平台核心数据模型。

## 核心对象

### 1. `document_collections`

对应模型：`models/document_collection.js`

作用：

- 文档集合
- 控制可见性、所属部门、默认 embedding 模型

关键字段：

| 字段 | 说明 |
|------|------|
| `id` | 集合 ID |
| `name` | 集合名称 |
| `description` | 集合描述 |
| `owner_id` | 所有者 |
| `created_by` | 创建者 |
| `department_id` | 所属部门 |
| `visibility` | `private` / `department` / `public` |
| `department_scope` | 部门可见范围 |
| `embedding_model_id` | 默认向量模型 |
| `metadata` | 扩展字段 |

### 2. `documents`

对应模型：`models/document.js`

作用：

- 文档主记录
- 绑定集合、类型、来源、当前处理状态、当前版本

关键字段：

| 字段 | 说明 |
|------|------|
| `id` | 文档 ID |
| `collection_id` | 所属集合 |
| `current_revision_id` | 当前版本 ID |
| `doc_type` | `knowledge` / `contract` / `department_doc` / `standard` |
| `source_system` | 来源系统 |
| `source_ref_id` | 来源记录 ID |
| `title` | 文档标题 |
| `processing_status` | 当前处理状态 |
| `processing_error_code` | 错误码 |
| `processing_error_message` | 错误信息 |
| `processing_retry_count` | 重试次数 |
| `processing_updated_at` | 状态更新时间 |
| `metadata` | 扩展字段 |

### 3. `document_revisions`

对应模型：`models/document_revision.js`

作用：

- 文档版本管理
- 管理版本号、版本状态、当前版本标记、差异状态

关键字段：

| 字段 | 说明 |
|------|------|
| `id` | 版本 ID |
| `document_id` | 所属文档 |
| `revision_no` | 机器版号 |
| `revision_label` | 展示版号，如 `v1.0` |
| `revision_status` | `draft/review/approved/effective/expired/archived` |
| `is_current` | 是否当前版本 |
| `effective_from` | 生效日期 |
| `effective_to` | 失效日期 |
| `change_summary` | 变更摘要 |
| `diff_status` | 差异状态 |

### 4. `document_outlines`

对应模型：`models/document_outline.js`

作用：

- 保存某个版本 OCR 文本抽取出的章节结构
- 作为 `document_chunks` 的上游结构来源

关键字段：

| 字段 | 说明 |
|------|------|
| `id` | 大纲记录 ID |
| `revision_id` | 所属版本 |
| `title` | 章节标题 |
| `description` | 章节摘要 |
| `seq` | 顺序号 |
| `from_line` | 起始行号 |
| `to_line` | 结束行号 |
| `original_text` | 对应原文片段 |
| `text_hash` | 文本哈希 |
| `byte_count` | 字节数 |
| `token_count` | token 数 |

### 5. `document_chunks`

对应模型：`models/document_chunk.js`

作用：

- 文档向量化与召回的最小处理单元
- 与版本、章节结构绑定

关键字段：

| 字段 | 说明 |
|------|------|
| `id` | chunk ID |
| `revision_id` | 所属版本 |
| `outline_id` | 所属章节 |
| `title` | chunk 标题 |
| `content` | chunk 内容 |
| `seq` | 顺序号 |
| `from_line` | 起始行号 |
| `to_line` | 结束行号 |
| `text_hash` | 文本哈希 |
| `byte_count` | 字节数 |
| `token_count` | token 数 |
| `embedding_vector` | 向量数据 |
| `embedding_status` | `pending/processing/ready/error` |
| `embedding_model_id` | 向量模型 ID |
| `embedded_at` | 向量生成时间 |

## 模型关系

```text
document_collections
  -> documents
    -> document_revisions
      -> doc_ocr_results
      -> document_outlines
      -> document_chunks
```

补充说明：

- `documents.current_revision_id` 指向当前使用中的版本
- `document_chunks.outline_id` 指向章节结构
- embedding 基于 chunk 生成，不直接落在 outline 上

---

*最后更新: 2026-06-21*
