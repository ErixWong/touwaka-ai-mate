# 合同管理 v2.0 Handler架构讨论

> Issue: #665
> 时间: 2026-04-29

## 核心问题

contract-mgr-v2 是否使用通用handler？

**答案**：是的，v2.0仍然使用通用handler处理基础流程（OCR、清洗、提取、章节分析），仅在持久化阶段使用v2专用handler。

---

## 完整流程设计

### State流转（v2.0）

```
上传合同文件
  ↓
pending_ocr（等待OCR）
  ↓ handler-submit-ocr（通用） ✅
ocr_submitted（OCR处理中）
  ↓ handler-check-ocr（通用） ✅
pending_filter（等待过滤）
  ↓ handler-text-filter（通用） ✅
  → 结果写入 mini_app_row.data._filtered_text
  ↓
pending_extract（等待提取）
  ↓ handler-extract（通用） ✅
  → 结果写入 mini_app_row.data（提取字段）
  ↓
pending_persist_extract（持久化提取结果）⭐ 新增
  ↓ contract-v2-extract（v2专用） 🔧
  → 从 mini_app_row.data 读取，写入 app_contract_v2_rows
  ↓
pending_section（等待章节分析）
  ↓ handler-text-section（通用） ✅
  → 结果写入 mini_app_row.data._sections
  ↓
pending_persist_section（持久化章节结果）⭐ 新增
  ↓ contract-v2-section（v2专用） 🔧
  → 从 mini_app_row.data 读取，写入 app_contract_v2_content
  ↓
pending_review（等待确认）
  ↓ 用户确认
confirmed（已确认）
```

---

## Handler分类

### 通用Handler（复用现有）

| Handler | 职责 | 数据流向 | 是否修改 |
|---------|------|---------|---------|
| `handler-submit-ocr` | 提交OCR任务 | 调用MCP服务 | ❌ 不修改 |
| `handler-check-ocr` | 检查OCR状态 | 获取OCR结果 → `mini_app_row.data._ocr_text` | ❌ 不修改 |
| `handler-text-filter` | 清洗文本 | `_ocr_text` → `_filtered_text` | ❌ 不修改 |
| `handler-extract` | 提取元数据 | `_filtered_text` → 提取字段（`contract_number`, `party_a`...） | ❌ 不修改 |
| `handler-text-section` | 章节分析 | `_filtered_text` → `_sections` | ❌ 不修改 |

**关键设计**：通用handler只读写 `mini_app_row.data` 字段，**不触碰extension_tables**。

### v2专用Handler（新增）

| Handler | 职责 | 数据流向 | 写入表 |
|---------|------|---------|--------|
| `contract-v2-extract` | 持久化提取结果 | 从 `mini_app_row.data` 读取 → `app_contract_v2_rows` | ✅ v2专用表 |
| `contract-v2-section` | 持久化章节结构 | 从 `mini_app_row.data` 读取 → `app_contract_v2_content` | ✅ v2专用表 |
| `contract-v2-version` | 版本管理（未来） | 管理 `contract_v2_versions` 表 | ✅ v2专用表 |
| `contract-v2-qa` | 问答检索（未来） | 从知识库召回合同内容 | ✅ 知识库 |

---

## 数据流转详解

### mini_app_row.data 的作用

`mini_app_row.data` 是通用handler和专用handler之间的**桥梁**：

```json
{
  "_ocr_text": "原始OCR文本...",
  "_filtered_text": "清洗后的文本...",
  "_sections": [
    { "id": "sec-1", "title": "总则", "start_line": 0, "end_line": 50 },
    { "id": "sec-2", "title": "合同标的", "start_line": 51, "end_line": 120 }
  ],
  "contract_number": "HT-2026-001",
  "party_a": "联想控股",
  "party_b": "供应商A",
  "contract_amount": 1200000.00,
  "contract_date": "2026-01-15"
}
```

**流转过程**：

1. **OCR阶段**（通用handler）：
   - `handler-submit-ocr` → 提交任务
   - `handler-check-ocr` → 获取结果，写入 `data._ocr_text`

2. **清洗阶段**（通用handler）：
   - `handler-text-filter` → 读取 `data._ocr_text`，处理后写入 `data._filtered_text`

3. **提取阶段**（通用handler）：
   - `handler-extract` → 读取 `data._filtered_text`，提取字段写入 `data.contract_number`, `data.party_a`...

4. **持久化阶段**（v2专用handler）：
   - `contract-v2-extract` → 从 `data` 读取提取字段，写入 `app_contract_v2_rows`

5. **章节阶段**（通用handler）：
   - `handler-text-section` → 读取 `data._filtered_text`，分析章节写入 `data._sections`

6. **持久化阶段**（v2专用handler）：
   - `contract-v2-section` → 从 `data._sections` 读取，写入 `app_contract_v2_content`

---

## manifest.json 配置示例

```json
{
  "id": "contract-mgr-v2",
  "states": [
    {
      "name": "pending_ocr",
      "handler": "handler-submit-ocr",  // 通用
      "success_next": "ocr_submitted"
    },
    {
      "name": "ocr_submitted",
      "handler": "handler-check-ocr",  // 通用
      "success_next": "pending_filter"
    },
    {
      "name": "pending_filter",
      "handler": "handler-text-filter",  // 通用
      "success_next": "pending_extract"
    },
    {
      "name": "pending_extract",
      "handler": "handler-extract",  // 通用
      "success_next": "pending_persist_extract"  // ⭐ 新增
    },
    {
      "name": "pending_persist_extract",  // ⭐ 新增
      "handler": "contract-v2-extract",  // 🔧 v2专用
      "success_next": "pending_section"
    },
    {
      "name": "pending_section",
      "handler": "handler-text-section",  // 通用
      "success_next": "pending_persist_section"  // ⭐ 新增
    },
    {
      "name": "pending_persist_section",  // ⭐ 新增
      "handler": "contract-v2-section",  // 🔧 v2专用
      "success_next": "pending_review"
    },
    {
      "name": "pending_review",
      "handler": null,
      "success_next": null
    },
    {
      "name": "confirmed",
      "handler": null,
      "success_next": null,
      "is_terminal": true
    }
  ],
  "extension_tables": [
    {
      "name": "app_contract_v2_content",
      "type": "content",
      "fields": [...]
    },
    {
      "name": "app_contract_v2_rows",
      "type": "primary",
      "fields": [...]
    }
  ]
}
```

---

## 与v1.0的区别

### v1.0（contract-mgr）

```
handler-extract → 直接写入 app_contract_mgr_rows ❌
handler-text-section → 直接写入 app_contract_mgr_content ❌
```

**问题**：通用handler直接写extension_tables，其他App也会写入合同表。

### v2.0（contract-mgr-v2）

```
handler-extract → 只写 mini_app_row.data ✅
contract-v2-extract → 从data读取，写入 app_contract_v2_rows ✅

handler-text-section → 只写 mini_app_row.data ✅
contract-v2-section → 从data读取，写入 app_contract_v2_content ✅
```

**优势**：
- ✅ 通用handler不触碰extension_tables
- ✅ 专用handler负责数据持久化
- ✅ 各App数据完全隔离

---

## Handler注册方式

### 通用Handler（已注册）

已在数据库 `app_row_handlers` 表注册：
- `handler-submit-ocr`
- `handler-check-ocr`
- `handler-text-filter`
- `handler-extract`
- `handler-text-section`

### v2专用Handler（App安装时注册）

通过 `AppMarketService.installApp()` 自动注册：
- ID: `contract-mgr-v2-handler-v2-extract`
- 路径: `apps/contract-mgr-v2/handlers/contract-v2-extract`

---

## 总结

**v2.0复用通用handler，仅在持久化阶段使用专用handler**：

1. ✅ 复用通用handler（OCR、清洗、提取、章节）- 降低开发成本
2. ✅ 专用handler只负责持久化 - 数据隔离
3. ✅ mini_app_row.data 作为桥梁 - 通用handler写，专用handler读
4. ✅ extension_tables 完全隔离 - v1.0和v2.0各自独立

**下一步**：补充设计文档，明确handler架构和数据流转。