# Document Retrieval Skill Contract

> 本文档定义 `document_retrieval` 系统级 skill 的稳定协议。
> 所有实现必须对齐本文档。
>
> **当前版本：真原子化契约（round02 / feat-260719-01-atomic-document-retrieval）**
> 旧复合 tool 契约（answer_from_documents / find_document / verify_fact）与
> 中间态"6 原子名外显 + 统一 runAnswerQuestion 管线"均已废弃，见 §8 历史清理。

---

## 1. Skill 定义

| 属性 | 值 |
|------|-----|
| Skill Name | `document_retrieval` |
| 类型 | 系统级 skill（非专家私有） |
| 权限模型 | 基于 DocAccessService 的用户集合访问权限，不由 expert 配置控制 |
| 当前阶段 | Phase 1（真原子化：schema / 执行 / 数据交接三层原子） |
| 编排模型 | **无服务端语义编排器**。每个原子 tool 只执行其声明的最小能力；多步策略由 LLM 依据 system prompt 链路模板自行组合，上下游通过 handle 交接结果 |

### 真实原子化判定（本契约的不可妥协约束）

1. tool 名称与执行语义必须一一对应
2. 下游工具不得靠重新检索伪装消费上游结果（必须消费 handle 引用的真实上游产物）
3. `read_document_content` / `rank_chunks_for_question` / `resolve_documents_from_chunks` 不得使用统一 `query` 壳层

## 2. Tool 列表（当前形态）

### LLM 可见 Tool（6 个原子 tool）

| Tool Name | 职责 | 最小步骤（atomic_steps） |
|-----------|------|------------------------|
| `search_documents_by_metadata` | 按标题/元数据/附件文件名定位候选文档 | `metadata_search` |
| `read_document_content` | 读取指定文档正文（按 chunk seq 拼装） | `read_document` |
| `search_chunks_in_document` | 已知文档范围内 chunk 向量检索 | `scoped_chunk_recall` |
| `search_chunks_globally` | 全库 chunk 向量检索 | `global_chunk_recall` |
| `rank_chunks_for_question` | 已有 chunk 集多信号重排（纯函数，零检索） | `rank` |
| `resolve_documents_from_chunks` | chunk 命中反查所属文档并聚合 | `resolve` |

**名称-行为一致性强制闸门**：每个 tool 返回的 `atomic_steps` 必须是上表对应单元素集合的子集；`rank` / `resolve` 不得包含任何检索步骤。一致性由 `tests/document-atomic-dispatch.test.js` 强制断言。

### 参数签名（按职责差异化，user_id / session 由服务端 context 注入，不出现）

| Tool | required | optional |
|------|----------|----------|
| search_documents_by_metadata | `metadata_query` | `collection_id`, `doc_types`, `tag_ids`, `top_k=10`, `match_fields=['title','metadata']` |
| read_document_content | `document_id` | `max_chars=20000`, `include_chunks=false` |
| search_chunks_in_document | `content_query` + (`document_ids` \| `doc_ref`) | `revision_ids`, `top_k=5`, `threshold=0.1` |
| search_chunks_globally | `content_query` | `collection_id`, `doc_types`, `top_k=5`, `threshold=0.1` |
| rank_chunks_for_question | `question` + `chunkset` | `top_k`, `locked_document_ids` |
| resolve_documents_from_chunks | `chunkset`（chunkset 或 rankedset） | `aggregate=true` |

### 后续 Tool（Phase 3 评估）

| Tool Name | 职责 | 优先级 |
|-----------|------|--------|
| `compare_documents` | 比较多文档异同 | P2 |

## 3. 共享返回字段（所有 tool 通用）

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 执行是否成功。失败统一 `{ success: false, error, hint? }`，**不做降级伪装成功** |
| `tool_name` | `string` | LLM 实际调用的原子 tool 名 |
| `skill_namespace` | `string` | 固定 `document_retrieval`，chat-service 按此聚合消费 |
| `atomic_steps` | `string[]` | 实际执行的最小步骤（见 §2 表），供前端轨迹展示与一致性断言 |
| `toolId` / `toolName` / `duration` | - | 平台通用工具元数据 |

## 4. handle 交接协议（数据交接层）

上下游结果的交接**必须**通过 handle 引用，禁止 LLM 回填大块 JSON，禁止下游重新检索伪装消费。

| handle | 前缀 | 产生方 | 消费方 | payload |
|--------|------|--------|--------|---------|
| `doc_ref` | `docref:` | search_documents_by_metadata | search_chunks_in_document（可选，替代 document_ids） | document_ids + 文档摘要 |
| `chunkset` | `chunkset:` | search_chunks_in_document / search_chunks_globally | rank_chunks_for_question / resolve_documents_from_chunks | 归一化 chunk 数组 |
| `rankedset` | `rankedset:` | rank_chunks_for_question | resolve_documents_from_chunks | 同上 + rank_score / rank_signals |

### 生命周期与权限判据（实现：`lib/document-handle-store.js`）

| 判据 | 取值 |
|------|------|
| 存储介质 | 进程内存 Map（无 Redis 依赖；MySQL 持久化为 Phase 3 可选项） |
| 重启语义 | 全部失效；消费方收到统一错误 + 修复提示 |
| TTL | 会话绑定（topicId）+ 30 分钟滑动过期（按 last_accessed 续期）；会话删除联动清理 |
| 权限 | 生成时绑定 user_id + session_key，消费时双重校验 |
| 越权/过期/伪造 | 统一返回 `handle_not_found_or_expired` + `hint`（指引重新调用哪个上游 tool）；**不泄露 handle 存在性** |
| 数据量上限 | 单 chunkset ≤ 50 chunks；单 chunk content ≤ 2000 字符（截断标记） |
| GC | 创建时摊销扫描；全局 > 10000 按最旧访问时间强制淘汰 |
| 职责红线 | handle 只做引用/生命周期/trace，不内嵌任何"建议下一步"字段，不自动触发下游调用 |

### LLM 可见形态

tool 响应中 handle 伴随摘要出现（如 chunk 预览、rank_score 分布、文档标题），LLM 凭摘要规划、凭 handle 交接；`read_document_content` 的正文**不 handle 化**（链路终点产物，直接返回，`max_chars` 有界）。

## 5. 各 Tool 独立返回字段

### `search_documents_by_metadata`
`documents[]`（document_id / document_title / doc_type / collection_name / relevance_score / matched_by）、`total`、`doc_ref`（有命中时）

### `read_document_content`
`document`、`content`、`content_truncated`、`total_chunks`、可选 `chunks`

### `search_chunks_in_document` / `search_chunks_globally`
`chunks[]`（chunk_id / document_id / document_title / doc_type / score / content_preview ≤300 字符）、`total`、`chunkset`（有命中时）、scoped 版另含 `searched_document_ids`

### `rank_chunks_for_question`
`chunks[]`（同上 + `rank_score` / `rank_signals`）、`total`、`rankedset`（有命中时）

### `resolve_documents_from_chunks`
`documents[]`（文档信息 + chunk_count / max_chunk_score / top_chunk 预览）、`total`

## 6. 消费层契约（chat-service）

**数据驱动，无系统动作信号。** 旧 `suggested_response_mode` / `workflow_action` / 候选短路已删除。

- `_collectDocRetrievalResults()`：按 `skill_namespace` **聚合一轮中全部**原子结果（非只取第一个）
- `buildEvidenceInjection()`：静态「证据使用规则」（前置，不占预算）+ read 正文（最高优先级）/ chunk 片段（按 rank_score 降序 top5，按 chunk_id 去重）/ 候选元信息；token 预算只约束证据内容
- `_detectChainPattern()`：链路形态纯观测（`content_chain` / `meta_only` / `unranked_chunks`），仅记日志供 prompt 调优，**不干预 LLM 行为**
- 链未闭合 / handle 失效的修复：经 tool 响应的 `hint` 回流 LLM 自主修复；**无自动服务端编排逃生门**

## 7. 内部服务分层（不暴露给 LLM）

```
LLM ⇄ 6 原子 tool（tool-manager dispatch 一一分派）
        ↓ 复用（正当服务层复用，非 tool 层复合入口）
DocumentAtomicTools（lib/document-atomic-tools.js）
        ↓
DocumentSearchService / DocRecallService / DocAccessService / DocumentHandleStore
```

`DocumentRetrievalWorkflow` / `DocumentRetrievalService` 语义编排层已废弃删除。

## 8. 历史清理清单

| 清理项 | 状态 |
|--------|------|
| 复合 tool：`answer_from_documents` / `find_document` / `verify_fact` | 已删除（round02） |
| 中间态：6 原子名外显但统一走 `runAnswerQuestion()` | 已废弃（round02 一一分派） |
| `DocumentRetrievalService` / `document-retrieval-service.js` | 已删除 |
| `DocumentRetrievalWorkflow`（含 runFindDocument / runVerifyFact 死代码） | 未引入整合分支，废弃 |
| 消费信号：`suggested_response_mode` / `should_clarify` / `should_answer_conservatively` / `workflow_action` | 已删除（数据驱动替代） |
| 候选列表短路（`_buildCandidateListResponse` 短路 LLM） | 已删除（候选数据注入，LLM 按规则组织） |

## 9. 演进路线图

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 真原子 schema + handle 基础设施 + 消费层数据驱动 + 一致性测试 | ✅ 本契约版本 |
| Phase 2 | 吸收查询解析锚点识别、四维混合 rerank、证据打包增强 | 规划中 |
| Phase 3 | 重评跨文档桥接、多候选 mergeable、候选条件化短路、handle MySQL 持久化 | 待 Phase 1/2 运行数据裁决 |
