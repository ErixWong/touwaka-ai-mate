# 销售合同管理 v2

> App ID: `contract-mgr-v2`
> 版本: 2.0.0
> 关联 Issue: #661

## 功能特性

- **组织层级管理**：三层树状结构（集团 → 甲方 → 项目）
- **多版本管理**：同一合同支持多个版本上传和对比
- **4层持久化**：OCR → 过滤 → 提取 → 章节，每层数据独立持久化
- **Dashboard**：统计概览

## Handler 流程

```
pending_ocr → ocr_submitted → pending_filter → pending_extract
→ pending_section → pending_review → confirmed
```

| Handler | 读 | 写 |
|---------|----|----|
| handler-submit-ocr | record.data | MCP |
| contract-v2-check-ocr | MCP结果 | app_contract_mgr_v2_content.ocr_text |
| contract-v2-text-filter | app_contract_mgr_v2_content.ocr_text | app_contract_mgr_v2_content.filtered_text |
| contract-v2-llm-extract | app_contract_mgr_v2_content.filtered_text | app_contract_mgr_v2_rows + app_contract_mgr_v2_content |
| contract-v2-text-section | app_contract_mgr_v2_content.filtered_text | app_contract_mgr_v2_content.sections |

> **设计原则**：业务数据直接读写扩展表，不经过 `record.data`（`mini_app_rows.data`）中转。

## 数据库表

| 表名 | 类型 | 说明 |
|------|------|------|
| contract_v2_org_nodes | 独立表 | 组织树 |
| contract_v2_main_records | 独立表 | 合同主记录 |
| contract_v2_versions | 独立表 | 合同版本 |
| app_contract_mgr_v2_content | 扩展表 | 内容数据 |
| app_contract_mgr_v2_rows | 扩展表 | 元数据 |
