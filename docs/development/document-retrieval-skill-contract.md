# Document Retrieval Skill Contract

> 本文档定义 `document_retrieval` 系统级 skill/workflow 的稳定协议。
> 所有实现必须对齐本文档。
>
> **audit-round06 收口**：外部接口原子化完成。LLM 仅看到 1 个 `document_retrieval` tool，
> 内部由 DocumentRetrievalWorkflow 编排 6 个原子 tool，执行轨迹通过 `atomic_steps` 暴露。

---

## 1. Skill 定义

| 属性 | 值 |
|------|-----|
| Skill Name | `document_retrieval` |
| 类型 | 系统级 skill/workflow（非专家私有） |
| 权限模型 | 基于 DocAccessService 的用户集合访问权限，不由 expert 配置控制 |
| 当前阶段 | Phase 2（单一 LLM 入口 + 6 原子 tool 内部编排 + steps[] 轨迹暴露） |

## 2. LLM 可见 Tool

### 唯一入口：`document_retrieval`

| 属性 | 值 |
|------|-----|
| Tool Name | `document_retrieval` |
| 职责 | 从文档平台检索与用户问题相关的证据并返回结构化结果 |
| 覆盖场景 | 基于文档证据回答问题 / 定位可能相关文档 / 校验命题是否有文档依据 |
| skill_namespace | `document_retrieval` |

**参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | `string` | ✅ | 检索查询文本 |
| `collection_id` | `string` | ❌ | 限定文档集合ID（仅过滤，非授权） |
| `doc_types` | `string[]` | ❌ | 限定文档类型，如 `["contract", "invoice"]` |

### 内部原子 Tool（不暴露给 LLM）

以下 6 个原子 tool 仅由 DocumentRetrievalWorkflow 内部编排调用，LLM 不可见：

| Tool Name | 职责 |
|-----------|------|
| `search_documents_by_metadata` | 按标题/元数据检索文档候选 |
| `read_document_content` | 读取文档完整内容 |
| `search_chunks_in_document` | 在指定文档内搜索相关 chunk |
| `search_chunks_globally` | 全库 chunk 全局搜索（fallback） |
| `rank_chunks_for_question` | 对 chunk 按问题相关性重排序 |
| `resolve_documents_from_chunks` | 从 chunk 命中的文档ID解析文档信息 |

## 3. 标准返回字段

### 共享字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `tool_name` | `string` | 固定为 `"document_retrieval"` |
| `skill_namespace` | `string` | 固定为 `"document_retrieval"` |
| `workflow_action` | `string` | **主动作信号**。枚举见下方 |
| `strategy` | `string` | 实际检索策略：`document_first` / `chunk_first_fallback` / `degrade` |
| `evidence_sufficiency` | `string` | 证据充分性：`strong` / `medium` / `weak` / `none` |
| `reason_codes` | `string[]` | 原因代码列表 |
| `documents` | `object[]` | 候选文档列表（含 top_evidence） |
| `scoped_identity` | `object` | 文档身份确认信息 |
| `atomic_steps` | `string[]` | **原子 tool 执行轨迹**（audit-round06 新增），如 `["decision","search_documents_by_metadata","search_chunks_in_document","evidence_packing"]` |
| `duration` | `number` | 检索耗时（ms） |

### `workflow_action` 枚举

| 值 | 含义 | chat-service 行为 |
|----|------|-------------------|
| `answer_with_ranked_chunks` | 证据充分，LLM + 证据注入回答 | LLM + 证据注入（强证据附加引用约束） |
| `return_document_candidates` | 多候选冲突/弱证据多文档 | **短路 LLM**，直接格式化候选列表 |
| `ask_for_clarification` | 意图模糊或信息不足 | LLM + 澄清约束骨架 |
| `decline_due_to_insufficient_evidence` | 无任何可用证据 | LLM + 保守回答约束骨架 |

### `strategy` 枚举

| 值 | 含义 |
|----|------|
| `document_first` | 标准 document-first 检索链路（文档候选 → chunk 证据） |
| `chunk_first_fallback` | document-first 无结果后回退到 chunk-first 全库搜索 |
| `degrade` | 所有路径失败，返回空证据包 |

### `documents[]` 结构

```json
[{
  "document_id": "string",
  "document_title": "string",
  "doc_type": "string",
  "collection_name": "string",
  "relevance_score": "number",
  "candidate_confidence": "high|low",
  "identity_confidence": "confirmed|probable|unknown",
  "identity_source": "search_match|evidence_backfill|fallback|inferred",
  "evidence_count": "number",
  "top_evidence": [{
    "content": "string (truncated 500 chars)",
    "score": "number"
  }]
}]
```

## 4. 内部服务分层（不暴露给 LLM）

| 服务 | 职责 | 文件 |
|------|------|------|
| `DocumentRetrievalWorkflow` | 显式编排 6 原子 tool 的检索管线 | `lib/document-retrieval-workflow.js` |
| `DocumentAtomicTools` | 6 个原子 tool 的实现 | `lib/document-atomic-tools.js` |
| `DocumentQueryDecisionService` | 查询意图决策（规则引擎） | `lib/document-query-decision-service.js` |
| `DocumentEvidencePacker` | 证据打包与元数据生成 | `lib/document-evidence-packer.js` |
| `DocAccessService` | 统一权限判定 | `lib/doc-access-service.js` |

## 5. 可观测性要求

每次 tool 调用必须记录以下观测字段：

| 字段 | 来源 | 用途 |
|------|------|------|
| `tool_name` | 固定 `"document_retrieval"` | 调用分布 |
| `strategy` | 返回结果 | 检索路径分布 |
| `duration_ms` | 计时 | 性能监控 |
| `evidence_sufficiency` | 返回结果 | 质量监控 |
| `reason_codes` | 返回结果 | 失败原因分析 |
| `document_count` | 返回结果 | 召回量监控 |
| `workflow_action` | 返回结果 | 回答动作分布 |
| `atomic_steps` | 返回结果 | 原子工具调用轨迹（audit-round06 新增） |

## 6. 演进路线图

```
Phase 1（Round 03-04）: 3 复合 tool 模式 + 内部原子化 ✅
    ↓
Phase 2（Round 06 当前）: 外部接口原子化 — 单一 document_retrieval 入口 + 6 原子编排 ✅
    ↓
Phase 3（下一迭代）: 反驳证据链路 + compare_documents / search_within_document 新能力
```

## 7. 历史命名清理

| 旧名称 | 状态 | 说明 |
|--------|------|------|
| `answer_from_documents` | ❌ 已删除（round06） | 合并为 `document_retrieval` |
| `find_document` | ❌ 已删除（round06） | 合并为 `document_retrieval` |
| `verify_fact` | ❌ 已删除（round06） | 合并为 `document_retrieval` |
| `suggested_response_mode` | ❌ 已删除（round04） | 由 `workflow_action` 替代 |
| `should_clarify` / `should_answer_conservatively` | ❌ 已删除（round04） | 由 `workflow_action` 替代 |
| `document_retrieval`（旧单入口含 goal 参数） | ❌ 已删除（round04） | 已被纯多 tool 模式替代 |

| 旧名称 | 状态 | 处理方式 |
|--------|------|----------|
| `RAGService` (`lib/rag-service.js`) | ✅ 已删除 (Round 04) | 无需处理 |
| `ragContext` | ✅ 已清除 | 无需处理 |
| `knowledge_config` | ⚠️ 历史兼容读取 | expert.controller 保留读取，标注 `@deprecated` |
| "知识策略开关" | ✅ 已清除 | 无需处理 |
| `suggested_response_mode` / `should_clarify` / `should_answer_conservatively` | ✅ 已删除 (Round 04) | 统一由 `workflow_action` 替代 |
| "builtin tool" | ⚠️ 过渡态 | 内部实现保留，文档统一用 "系统级 skill" |
