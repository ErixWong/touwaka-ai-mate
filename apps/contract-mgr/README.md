# 销售合同管理 App

**ID**: `contract-manager`

## 功能描述

上传合同文件，AI自动提取合同元数据，支持批量处理和确认入库。

## 处理流程

```
上传文件 → [待OCR] → OCR识别 → [待提取] → LLM提取 → [待确认] → 用户确认 → [已确认]
                ↓                      ↓
           [OCR失败]              [提取失败]
```

## 字段定义

| 字段名 | 标签 | 类型 | 必填 | AI提取 |
|--------|------|------|------|--------|
| contract_number | 合同编号 | text | ✅ | ✅ |
| contract_date | 签订日期 | date | ✅ | ✅ |
| party_a | 甲方 | text | ✅ | ✅ |
| party_b | 乙方 | text | ✅ | ✅ |
| contract_amount | 合同金额 | number | ✅ | ✅ |
| start_date | 开始日期 | date | ❌ | ✅ |
| end_date | 结束日期 | date | ❌ | ✅ |
| payment_terms | 付款条款 | textarea | ❌ | ✅ |
| status | 状态 | select | ❌ | ❌ |
| contract_file | 合同文件 | file | ❌ | ❌ |

## 处理脚本

- **ocr-service**: 调用 markitdown/mineru 进行 OCR 识别
- **llm-extract**: 调用 LLM 从 OCR 文本中提取结构化元数据

## 依赖

- MCP 服务: `markitdown`, `mineru`
- 平台版本: >= 2.0.0
