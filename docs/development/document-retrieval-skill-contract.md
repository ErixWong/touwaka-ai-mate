# Document Retrieval Skill Contract

> 本文档定义 `document_retrieval` 系统级 skill 的稳定协议。
> 所有实现必须对齐本文档。

---

## 1. Skill 定义

| 属性 | 值 |
|------|-----|
| Skill Name | `document_retrieval` |
| 类型 | 系统级 skill（非专家私有） |
| 权限模型 | 基于 DocAccessService 的用户集合访问权限，不由 expert 配置控制 |
| 当前阶段 | Phase 1（纯多 tool 模式，旧 document_retrieval 单入口已删除） |

## 2. Tool 列表（当前形态）

### 当前 LLM 可见 Tool

| Tool Name | 职责 | 用户任务 |
|-----------|------|----------|
| `answer_from_documents` | 基于文档证据回答问题 | "根据制度说明某个规定"、"文档里对某问题如何描述" |
| `find_document` | 定位可能相关的文档 | "帮我找某份合同"、"哪个文档提到某项规则" |
| `verify_fact` | 校验命题是否得到文档支持 | "文档里是不是这么写"、"某说法是否有依据" |

三个 tool 通过 `skill_namespace: 'document_retrieval'` 聚合，chat-service 消费层按命名空间统一消费。

### 后续 Tool

| Tool Name | 职责 | 优先级 |
|-----------|------|--------|
| `compare_documents` | 比较多文档异同 | P2 |
| `search_within_document` | 已知文档范围内定点检索 | P1/P2 |

### 历史说明

旧 `document_retrieval` 单入口 tool（含 `goal` 参数做内部分流）已于 Round 04 删除。
`executeDocumentRetrieval()` 兼容壳层同步删除。

## 3. 共享返回字段（所有 tool 通用）

以下元数据字段在所有 tool 的返回中保持一致语义：

| 字段 | 类型 | 说明 |
|------|------|------|
| `strategy` | `string` | 检索策略：`document_first` / `chunk_first_fallback` / `degrade` |
| `evidence_sufficiency` | `string` | 证据充分性：`strong` / `medium` / `weak` / `none` |
| `reason_codes` | `string[]` | 原因代码列表（如 `no_candidates`、`weak_evidence_degrade`） |
| `should_clarify` | `boolean` | 是否应向用户澄清问题 |
| `should_answer_conservatively` | `boolean` | 是否应保守回答 |
| `suggested_response_mode` | `string` | 建议回答模式（见下方枚举） |
| `duration` | `number` | 检索耗时（ms） |

### `suggested_response_mode` 枚举

| 值 | 含义 | chat-service 行为 | 适用 tool |
|----|------|-------------------|-----------|
| `direct_answer` | 证据充分，可直接回答 | LLM + 证据注入 | answer_from_documents |
| `answer_with_citation` | 有明确来源，回答时引用出处 | LLM + 证据注入 + 引用约束 | answer_from_documents |
| `candidate_list` | 多候选，列出候选供用户确认 | **短路 LLM**，直接格式化候选列表 | answer_from_documents / find_document |
| `single_document` | 单候选文档，直接展示文档信息 | LLM + 证据注入（find_document 语义） | find_document |
| `clarify` | 意图模糊或信息不足，应澄清问题 | LLM + 澄清约束骨架 | 所有 tool |
| `conservative_answer` | 证据不足，保守回答 | LLM + 保守回答约束骨架 | answer_from_documents |

### `strategy` 枚举

| 值 | 含义 |
|----|------|
| `document_first` | 标准 document-first 检索链路（文档候选 → chunk 证据） |
| `chunk_first_fallback` | document-first 无结果后回退到 chunk-first 全库搜索 |
| `degrade` | 所有路径失败，返回空证据包 |

## 4. 各 Tool 独立返回字段

### `answer_from_documents`

```json
{
  // ...共享字段...
  "documents": [{
    "document_id": "string",
    "document_title": "string",
    "doc_type": "string",
    "collection_name": "string",
    "relevance_score": "number",
    "candidate_confidence": "high|low",
    "evidence_count": "number",
    "top_evidence": [{
      "content": "string (truncated 500 chars)",
      "score": "number"
    }]
  }]
}
```

### `find_document`

```json
{
  // ...共享字段...
  "candidates": [{
    "document_id": "string",
    "document_title": "string",
    "doc_type": "string",
    "collection_name": "string",
    "relevance_score": "number",
    "candidate_confidence": "high|low",
    "match_reason": "string"  // 匹配原因简述
  }],
  "total_candidates": "number"
}
```

注：`find_document` 不返回 chunk 级 evidence，仅返回文档级候选。

### `verify_fact`

```json
{
  // ...共享字段...
  "verdict": "supported|insufficient_evidence",
  "contradicted_available": false,
  "supporting_evidence": [{ "content": "string", "document_id": "string", "score": "number" }],
  "contradicting_evidence": [],
  "related_documents": ["..."]
}
```

**能力诚实性说明**：
- 当前版本仅稳定支持 `supported` / `insufficient_evidence` 判定
- `contradicted` 判定需要独立的"反驳证据检测"链路，目前尚未实现
- `contradicted_available: false` 明确告知消费方当前不支持真正反驳判定
- `contradicting_evidence` 字段保留但当前恒为空数组（schema 预留）

## 5. 内部服务分层（不暴露给 LLM）

以下服务是 skill 内部实现，不应作为 tool 直接暴露：

| 服务 | 职责 | 文件 |
|------|------|------|
| `DocumentQueryDecisionService` | 查询意图决策（规则引擎） | `lib/document-query-decision-service.js` |
| `DocumentSearchService` | 文档级候选检索 | `lib/document-search-service.js` |
| `DocRecallService` | chunk 级证据召回 | `lib/doc-recall-service.js` |
| `DocumentEvidencePacker` | 证据打包与元数据生成 | `lib/document-evidence-packer.js` |
| `DocAccessService` | 统一权限判定 | `lib/doc-access-service.js` |

## 6. 可观测性要求

每次 tool 调用必须记录以下观测字段：

| 字段 | 来源 | 用途 |
|------|------|------|
| `tool_name` | 实际执行的 tool | 区分不同 tool 的调用分布 |
| `strategy` | 返回结果 | 检索路径分布 |
| `duration_ms` | 计时 | 性能监控 |
| `evidence_sufficiency` | 返回结果 | 质量监控 |
| `reason_codes` | 返回结果 | 失败原因分析 |
| `document_count` | 返回结果 | 召回量监控 |
| `should_clarify` | 返回结果 | 降级率监控 |
| `suggested_response_mode` | 返回结果 | 回答模式分布 |

## 7. 演进路线图

```
Phase 1（当前 Round 04）: 纯多 tool 外显 + 删除 document_retrieval 单入口 ✅
    ↓
Phase 2（下一迭代）: verify_fact 反驳链路设计 + single_document 产品形态评估
    ↓
Phase 3: compare_documents / search_within_document
```

## 8. 历史命名清理清单

| 旧名称 | 状态 | 处理方式 |
|--------|------|----------|
| `RAGService` (`lib/rag-service.js`) | ✅ 已删除 (Round 04) | 无需处理 |
| `ragContext` | ✅ 已清除 | 无需处理 |
| `knowledge_config` | ⚠️ 历史兼容读取 | expert.controller 保留读取，标注 `@deprecated` |
| "知识策略开关" | ✅ 已清除 | 无需处理 |
| "builtin tool" | ⚠️ 过渡态 | 内部实现保留，文档统一用 "系统级 skill" |
