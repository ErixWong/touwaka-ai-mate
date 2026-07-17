# Document Retrieval Skill Contract

> 本文档定义 `document_retrieval` 系统级 skill/workflow 的稳定协议。
> 所有实现必须对齐本文档。
>
> **audit-round07 收口**：6 个原子 tool 对外暴露给 LLM，内部由 DocumentRetrievalWorkflow
> 统一编排管线。`tool_name` 日志与前端展示均为 LLM 实际调用的原子 tool 名。

---

## 1. Skill 定义

| 属性 | 值 |
|------|-----|
| Skill Name | `document_retrieval` |
| 类型 | 系统级 skill/workflow（非专家私有） |
| 权限模型 | 基于 DocAccessService 的用户集合访问权限 |
| 当前阶段 | Phase 2（6 原子 tool 外显 + workflow 内编排 + atomic_steps 轨迹） |

## 2. LLM 可见 Tool（6 个原子 tool）

| Tool Name | 职责 | 典型场景 |
|-----------|------|----------|
| `search_documents_by_metadata` | 按标题/文件名/元数据检索文档 | "帮我找XX合同"、"标准号是多少" |
| `read_document_content` | 读取指定文档内容/章节 | "合同第三条怎么写的" |
| `search_chunks_in_document` | 在已定位文档内搜索段落 | 已有候选文档，需找具体条款 |
| `search_chunks_globally` | 全库内容级 chunk 搜索 | 不知道在哪个文档里，按内容搜 |
| `rank_chunks_for_question` | 对 chunk 结果精排 | 多候选需选最相关的 |
| `resolve_documents_from_chunks` | 从 chunk 命中反查文档信息 | 搜到内容片段但不知道属于哪个文档 |

**所有 6 个 tool 共享相同参数签名**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | `string` | ✅ | 检索查询文本 |
| `collection_id` | `string` | ❌ | 限定文档集合ID（仅过滤，非授权） |
| `doc_types` | `string[]` | ❌ | 限定文档类型 |

**`skill_namespace`** 统一为 `"document_retrieval"`，chat-service 按此聚合消费。

## 3. 标准返回字段

所有 6 个 tool 返回统一结构，`tool_name` 字段为 LLM 实际调用的原子 tool 名：

| 字段 | 类型 | 说明 |
|------|------|------|
| `tool_name` | `string` | LLM 实际调用的原子 tool 名（`search_documents_by_metadata` 等） |
| `skill_namespace` | `string` | 固定 `"document_retrieval"` |
| `workflow_action` | `string` | 主动作信号 |
| `strategy` | `string` | 实际检索策略：`document_first` / `chunk_first_fallback` / `degrade` |
| `evidence_sufficiency` | `string` | 证据充分性：`strong` / `medium` / `weak` / `none` |
| `reason_codes` | `string[]` | 原因代码 |
| `documents` | `object[]` | 候选文档列表（含 top_evidence） |
| `scoped_identity` | `object` | 文档身份确认信息 |
| `atomic_steps` | `string[]` | 内部 workflow 编排的原子 tool 执行轨迹（审计可观测） |
| `duration` | `number` | 耗时（ms） |

### `workflow_action` 枚举

| 值 | 含义 | chat-service 行为 |
|----|------|-------------------|
| `answer_with_ranked_chunks` | 证据充分 | LLM + 证据注入 |
| `return_document_candidates` | 多候选冲突 | 短路 LLM，直接格式化候选列表 |
| `ask_for_clarification` | 意图模糊 | LLM + 澄清约束 |
| `decline_due_to_insufficient_evidence` | 无可用证据 | LLM + 保守回答约束 |

## 4. 内部服务分层（不暴露给 LLM）

| 服务 | 职责 | 文件 |
|------|------|------|
| `DocumentRetrievalWorkflow` | 编排 6 原子 tool 的检索管线 | `lib/document-retrieval-workflow.js` |
| `DocumentAtomicTools` | 6 个原子 tool 的内部实现 | `lib/document-atomic-tools.js` |
| `DocumentQueryDecisionService` | 查询意图决策 | `lib/document-query-decision-service.js` |
| `DocumentEvidencePacker` | 证据打包 | `lib/document-evidence-packer.js` |
| `DocAccessService` | 权限判定 | `lib/doc-access-service.js` |

## 5. 可观测性

| 字段 | 说明 |
|------|------|
| `tool_name` | LLM 实际调用的原子 tool 名 |
| `strategy` / `duration_ms` | 检索路径分布 / 性能 |
| `evidence_sufficiency` / `reason_codes` | 质量监控 / 失败分析 |
| `workflow_action` | 回答动作分布 |
| `atomic_steps` | 内部编排轨迹 |

## 6. 演进路线图

```
Phase 1（Round 03-04）: 3 复合 tool + 内部原子化 ✅
Phase 2（Round 06-07）: 6 原子 tool 外显 + workflow 内编排 ✅
Phase 3（下一迭代）: 反驳证据链路 + compare_documents / search_within_document
```

## 7. 历史清理

| 旧名称 | 状态 |
|--------|------|
| `answer_from_documents` | ❌ round06 删除 |
| `find_document` | ❌ round06 删除 |
| `verify_fact` | ❌ round06 删除 |
| `document_retrieval`（单复合入口） | ❌ round07 撤销（改为 6 原子外显） |
| `suggested_response_mode` | ❌ round04 删除 |
| `should_clarify` / `should_answer_conservatively` | ❌ round04 删除 |

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
