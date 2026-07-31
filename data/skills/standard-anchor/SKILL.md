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
| `read_section_context` | 读指定 section 正文及上下文 | `outline_id`, `context_window` |
| `read_revision_content` | 读指定 revision 全文 | `revision_id` |
| `get_section_locator` | outline_id 反查 document/revision 定位 | `outline_id` |
| `find_documents_by_standard_code` | 按标准编号查找已纳管标准 | `standard_code` |
| `find_documents_by_standard_name` | 按标准名称查找已纳管标准 | `standard_name` |
| `get_document_revisions` | 获取文档版本列表 | `document_id` |
| `select_revision_candidate` | 按版本线索筛选最匹配 revision（纯函数） | `revisions`, `hints` |
| `find_section_candidates` | 按节号/标题查找候选 section | `document_id`, `revision_id`, `title_hint`, `seq_hint`, `query_text` |
| `list_reference_gaps` | 列出待回填引用缺口 | `standard_id` |
| `write_anchor_result` | 写入引用判断结果（幂等） | `standard_id`, `source_revision_id`, `source_outline_id`, `occurrence_index`, `source_text`, `ref_type`, `status`, `source` |

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

调用 `GET /api/docs/outlines/:outline_id/section` 获取 section 文本，可选前后相邻 section 对象作为上下文（由 `context_window` 控制前后各取几个相邻 outline）。

## read_revision_content

调用 `GET /api/docs/revisions/:revision_id/content?max_chars=20000`，返回 revision 全文。默认截断 20000 字符，传 `max_chars=0` 不截断。

## get_section_locator

调用 `GET /api/docs/outlines/:outline_id/locator`，返回 outline/revision/document 三元组定位信息。
