---
name: standard-anchor
description: "标准锚点识别工具集：解析锚点、读取文档章节/全文、定位引用目标。"
argument-hint: "[parse_anchor|list_revision_sections|read_section_context|read_revision_content|get_section_locator] [params]"
user-invocable: false
---

# Standard Anchor - 标准锚点识别工具集

为标准管理 App 的"锚点识别 agent"（引用清洗 agent）提供最小工具集。

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `parse_anchor` | 解析锚点串 | `anchor` |
| `list_revision_sections` | 按 revision_id 列出章节列表 | `revision_id` |
| `read_section_context` | 读指定 section 正文及上下文（按 chunk 翻页） | `outline_id`, `context_window`, `page`, `max_page_chars` |
| `read_revision_content` | 读指定 revision 全文（支持字符分页） | `revision_id`, `max_chars`, `offset_chars` |
| `get_section_locator` | outline_id 反查 document/revision 定位 | `outline_id` |
| `find_documents_by_standard_code` | 按标准编号查找已纳管标准 | `standard_code` |
| `find_documents_by_standard_name` | 按标准名称查找已纳管标准 | `standard_name` |
| `get_document_revisions` | 获取文档版本列表 | `document_id` |
| `select_revision_candidate` | 按版本线索筛选最匹配 revision（纯函数） | `revisions`, `hints` |
| `find_section_candidates` | 按节号/标题查找候选 section | `document_id`, `revision_id`, `title_hint`, `seq_hint`, `query_text` |
| `list_reference_gaps` | 列出待回填引用缺口 | `standard_id` |
| `write_anchor_result` | 写入引用判断结果（幂等） | `standard_id`, `source_revision_id`, `source_outline_id`, `occurrence_index`, `source_text`（必须是原文逐字连续子串），`ref_type`, `status`, `source` |

## 数据访问路径

工具运行在 VM 沙箱子进程，无数据库连接。读取业务数据通过 HTTP 回调文档平台 API：
- `API_BASE` + `USER_ACCESS_TOKEN` 由 skill-runner 自动注入
- 请求头：`Authorization: Bearer ${process.env.USER_ACCESS_TOKEN}`

## parse_anchor

解析锚点字符串 `<document_id+revision_id(+outline_id)>`，返回结构化对象。

输入示例：
- `<doc123+rev456+out789>` → `{ document_id, revision_id, outline_id }`
- `<doc123+rev456>` → `{ document_id, revision_id, outline_id: null }`

## list_revision_sections

调用 `GET /api/docs/revisions/:revision_id/outlines`，返回章节列表（title, seq, from_line, to_line, outline_id）。

## read_section_context

调用 `GET /api/docs/outlines/:outline_id/section?page=0&max_page_chars=4000` 获取 section 文本，可选前后相邻 section 对象作为上下文（由 `context_window` 控制前后各取几个相邻 outline）。

**分页（R16-2，按 chunk 翻页）**：服务端把该 outline 下的 `document_chunks` 展平成页，每页 1 个 chunk（默认 ≤4000 字符，低于摘要阈值 5000）。返回的 `section.page_has_more=true` 时，必须用 `section.page_next_offset` 作为下次调用的 `page` 继续翻页，直到 `page_has_more=false`。翻页期间 `outline_id` 不变，`occurrence_index` 跨页累计递增。**禁止**只读第一页就跳过剩余内容——工具结果超过 5000 字符会被上下文管理摘要化，agent 只能看到摘要，必须用小页读完大节。

返回还含 `chunk_id` / `chunk_seq` / `from_line` / `to_line` / `overlap_lines`：`overlap_lines>0` 表示本页与上一 chunk 有行重叠（embedding 上下文连续性设计），写锚点时按 `from_line` 去重，**不要把重叠处的引用写两遍**。

## read_revision_content

调用 `GET /api/docs/revisions/:revision_id/content?max_chars=20000&offset_chars=0`，返回 revision 全文。默认截断 20000 字符，传 `max_chars=0` 不截断。

**分页（R16-2）**：长文返回 `content_has_more=true` 时，用 `offset_chars` 继续翻页直到 `content_has_more=false`。清洗场景建议单页 `max_chars=4000`，避免工具结果超过 5000 字符摘要阈值被上下文管理摘要化。

## get_section_locator

调用 `GET /api/docs/outlines/:outline_id/locator`，返回 outline/revision/document 三元组定位信息。
