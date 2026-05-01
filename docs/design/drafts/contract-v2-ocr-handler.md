# OCR阶段专用handler讨论

> Issue: #665
> 时间: 2026-04-29

## 用户需求

希望在OCR阶段也能有专用handler，把OCR内容一步到位存到扩展表中。

---

## 当前流程（方案A）

```
上传合同文件
  ↓
pending_ocr（等待OCR）
  ↓ handler-submit-ocr（通用）
  → 提交OCR任务到MCP服务
  ↓
ocr_submitted（OCR处理中）
  ↓ handler-check-ocr（通用）
  → 检查OCR状态，获取结果
  → 写入 mini_app_row.data._ocr_text
  ↓
pending_persist_ocr（持久化OCR结果）❌ 当前没有
  ↓ ❌ 需要新增专用handler
  → 从 mini_app_row.data 读取，写入 app_contract_v2_content
  ↓
pending_filter（等待过滤）
  ↓ handler-text-filter（通用）
  → 读取 mini_app_row.data._ocr_text，清洗后写入 data._filtered_text
  ↓
后续流程...
```

**问题**：
- ❌ OCR结果需要两步：通用handler写data → 专用handler读data写扩展表
- ❌ 数据流转环节多，效率低
- ❌ OCR内容存储延迟，用户查看原文需等待

---

## 新方案：OCR阶段专用handler（方案B）

```
上传合同文件
  ↓
pending_ocr（等待OCR）
  ↓ handler-submit-ocr（通用）
  → 提交OCR任务到MCP服务
  ↓
ocr_submitted（OCR处理中）
  ↓ contract-v2-check-ocr（专用）⭐ 新增
  → 检查OCR状态，获取结果
  → **直接写入 app_contract_v2_content.ocr_text**
  → 同时写入 mini_app_row.data._ocr_text（供后续handler使用）
  ↓
pending_filter（等待过滤）
  ↓ handler-text-filter（通用）
  → 读取 mini_app_row.data._ocr_text，清洗后写入 data._filtered_text
  ↓
pending_persist_filter（持久化过滤结果）⭐ 新增
  ↓ contract-v2-filter（专用）
  → 从 mini_app_row.data 读取，写入 app_contract_v2_content.filtered_text
  ↓
pending_extract（等待提取）
  ↓ handler-extract（通用）
  → 读取 mini_app_row.data._filtered_text，提取字段写入 data
  ↓
pending_persist_extract（持久化提取结果）
  ↓ contract-v2-extract（专用）
  → 从 mini_app_row.data 读取，写入 app_contract_v2_rows
  ↓
pending_section（等待章节分析）
  ↓ handler-text-section（通用）
  → 读取 mini_app_row.data._filtered_text，分析章节写入 data._sections
  ↓
pending_persist_section（持久化章节结果）
  ↓ contract-v2-section（专用）
  → 从 mini_app_row.data 读取，写入 app_contract_v2_content.sections
  ↓
pending_review（等待确认）
```

**优势**：
- ✅ OCR结果一步到位存入扩展表
- ✅ 用户可立即查看OCR原文（无需等待后续流程）
- ✅ 数据流转环节减少（效率提升）
- ✅ 每个阶段都有专用handler负责持久化

---

## 方案对比

### 方案A：只在提取和章节阶段用专用handler（当前）

| 阶段 | Handler | 数据流向 | 持久化 |
|------|---------|---------|--------|
| OCR提交 | handler-submit-ocr（通用） | 提交任务 | ❌ 无 |
| OCR检查 | handler-check-ocr（通用） | 写入 data._ocr_text | ❌ 无 |
| 过滤 | handler-text-filter（通用） | 写入 data._filtered_text | ❌ 无 |
| 提取 | handler-extract（通用） | 写入 data.提取字段 | ❌ 无 |
| **持久化提取** | contract-v2-extract（专用） | 从 data 读，写扩展表 | ✅ 有 |
| 章节 | handler-text-section（通用） | 写入 data._sections | ❌ 无 |
| **持久化章节** | contract-v2-section（专用） | 从 data 读，写扩展表 | ✅ 有 |

**持久化阶段**：2个（提取、章节）

---

### 方案B：每个阶段都有专用handler持久化

| 阶段 | Handler | 数据流向 | 持久化 |
|------|---------|---------|--------|
| OCR提交 | handler-submit-ocr（通用） | 提交任务 | ❌ 无 |
| **OCR检查** | contract-v2-check-ocr（专用）⭐ | 直接写扩展表 + data | ✅ 有 |
| 过滤 | handler-text-filter（通用） | 写入 data._filtered_text | ❌ 无 |
| **持久化过滤** | contract-v2-filter（专用）⭐ | 从 data 读，写扩展表 | ✅ 有 |
| 提取 | handler-extract（通用） | 写入 data.提取字段 | ❌ 无 |
| **持久化提取** | contract-v2-extract（专用） | 从 data 读，写扩展表 | ✅ 有 |
| 章节 | handler-text-section（通用） | 写入 data._sections | ❌ 无 |
| **持久化章节** | contract-v2-section（专用） | 从 data 读，写扩展表 | ✅ 有 |

**持久化阶段**：4个（OCR、过滤、提取、章节）

---

## 专用handler职责对比

### 方案A（当前）

| Handler | 职责 | 输入 | 输出 |
|---------|------|------|------|
| contract-v2-extract | 持久化提取结果 | mini_app_row.data | app_contract_v2_rows |
| contract-v2-section | 持久化章节结构 | mini_app_row.data._sections | app_contract_v2_content.sections |

---

### 方案B（新增）

| Handler | 职责 | 输入 | 输出 |
|---------|------|------|------|
| **contract-v2-check-ocr** ⭐ | OCR检查 + 持久化OCR | OCR任务ID | app_contract_v2_content.ocr_text + data._ocr_text |
| **contract-v2-filter** ⭐ | 持久化过滤结果 | data._filtered_text | app_contract_v2_content.filtered_text |
| contract-v2-extract | 持久化提取结果 | data.提取字段 | app_contract_v2_rows |
| contract-v2-section | 持久化章节结构 | data._sections | app_contract_v2_content.sections |

---

## contract-v2-check-ocr 实现示例

```javascript
// apps/contract-mgr-v2/handlers/contract-v2-check-ocr/index.js

import logger from '../../../lib/logger.js';
import MCPOCRService from '../../../lib/mcp-ocr-service.js';

export const availableOutputs = [
  { key: 'ocr_text', label: 'OCR原文', type: 'string' },
  { key: 'ocr_status', label: 'OCR状态', type: 'string' },
];

export default {
  availableOutputs,
  
  async process(context) {
    const { record, services, app } = context;
    
    logger.info(`[contract-v2-check-ocr] Processing record ${record.id}`);
    
    const data = record.data || {};
    const taskId = data._ocr_task_id;
    
    if (!taskId) {
      logger.error(`[contract-v2-check-ocr] No OCR task ID found`);
      return { success: false, error: 'No OCR task ID' };
    }
    
    try {
      // 1. 检查OCR状态（调用MCP服务）
      const ocrResult = await MCPOCRService.checkOCRStatus(taskId);
      
      if (ocrResult.status !== 'completed') {
        logger.info(`[contract-v2-check-ocr] OCR still processing: ${ocrResult.status}`);
        return { 
          success: false, 
          retry: true,  // 触发重试
          error: `OCR status: ${ocrResult.status}` 
        };
      }
      
      // 2. 获取OCR文本
      const ocrText = ocrResult.text || '';
      
      logger.info(`[contract-v2-check-ocr] OCR completed, text length: ${ocrText.length}`);
      
      // 3. 写入扩展表（一步到位）
      const extTables = app?.config?.extension_tables || [];
      const contentTable = extTables.find(t => t.name === 'app_contract_v2_content');
      
      if (contentTable) {
        await services.callExtension('app_contract_v2_content', 'upsert', {
          row_id: record.id,
          ocr_text: ocrText,
        });
        logger.info(`[contract-v2-check-ocr] OCR text written to app_contract_v2_content`);
      }
      
      // 4. 同时写入data字段（供后续handler使用）
      return {
        success: true,
        data: {
          _ocr_text: ocrText,
          _ocr_status: 'completed',
          _ocr_completed_at: new Date().toISOString(),
        },
      };
      
    } catch (e) {
      logger.error(`[contract-v2-check-ocr] Error: ${e.message}`);
      return { success: false, error: e.message };
    }
  },
};
```

**关键设计**：
- ✅ 调用MCP服务检查OCR状态（复用现有逻辑）
- ✅ 直接写入扩展表 `app_contract_v2_content.ocr_text`
- ✅ 同时写入 `mini_app_row.data._ocr_text`（供后续handler使用）
- ✅ 支持重试（OCR未完成时）

---

## contract-v2-filter 实现示例

```javascript
// apps/contract-mgr-v2/handlers/contract-v2-filter/index.js

import logger from '../../../lib/logger.js';

export const availableOutputs = [
  { key: 'filtered_text', label: '过滤后文本', type: 'string' },
];

export default {
  availableOutputs,
  
  async process(context) {
    const { record, services, app } = context;
    
    logger.info(`[contract-v2-filter] Processing record ${record.id}`);
    
    const data = record.data || {};
    const filteredText = data._filtered_text;
    
    if (!filteredText) {
      logger.error(`[contract-v2-filter] No filtered text found`);
      return { success: false, error: 'No filtered text found' };
    }
    
    try {
      // 写入扩展表
      await services.callExtension('app_contract_v2_content', 'upsert', {
        row_id: record.id,
        filtered_text: filteredText,
      });
      
      logger.info(`[contract-v2-filter] Filtered text written to app_contract_v2_content`);
      
      return {
        success: true,
        data: {
          _filter_persisted: true,
          _filter_persisted_at: new Date().toISOString(),
        },
      };
      
    } catch (e) {
      logger.error(`[contract-v2-filter] Error: ${e.message}`);
      return { success: false, error: e.message };
    }
  },
};
```

---

## manifest.json调整

### 方案A（当前）

```json
{
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
      "success_next": "pending_persist_extract"
    },
    {
      "name": "pending_persist_extract",  // ⭐ 持久化
      "handler": "contract-v2-extract",  // 专用
      "success_next": "pending_section"
    },
    {
      "name": "pending_section",
      "handler": "handler-text-section",  // 通用
      "success_next": "pending_persist_section"
    },
    {
      "name": "pending_persist_section",  // ⭐ 持久化
      "handler": "contract-v2-section",  // 专用
      "success_next": "pending_review"
    }
  ]
}
```

---

### 方案B（新增OCR + 过滤专用handler）

```json
{
  "states": [
    {
      "name": "pending_ocr",
      "handler": "handler-submit-ocr",  // 通用
      "success_next": "ocr_submitted"
    },
    {
      "name": "ocr_submitted",
      "handler": "contract-v2-check-ocr",  // 🔧 专用（替代通用）
      "success_next": "pending_filter"
    },
    {
      "name": "pending_filter",
      "handler": "handler-text-filter",  // 通用
      "success_next": "pending_persist_filter"  // ⭐ 新增
    },
    {
      "name": "pending_persist_filter",  // ⭐ 新增
      "handler": "contract-v2-filter",  // 🔧 专用
      "success_next": "pending_extract"
    },
    {
      "name": "pending_extract",
      "handler": "handler-extract",  // 通用
      "success_next": "pending_persist_extract"
    },
    {
      "name": "pending_persist_extract",
      "handler": "contract-v2-extract",  // 🔧 专用
      "success_next": "pending_section"
    },
    {
      "name": "pending_section",
      "handler": "handler-text-section",  // 通用
      "success_next": "pending_persist_section"
    },
    {
      "name": "pending_persist_section",
      "handler": "contract-v2-section",  // 🔧 专用
      "success_next": "pending_review"
    }
  ]
}
```

**新增2个state**：
- `pending_persist_filter`（持久化过滤结果）
- 修改 `ocr_submitted` handler：`handler-check-ocr` → `contract-v2-check-ocr`

---

## 方案选择建议

### 推荐方案B（每个阶段都有专用handler）

**理由**：

1. **一步到位**：
   - ✅ OCR结果直接写入扩展表，用户可立即查看原文
   - ✅ 减少数据流转环节（效率提升）

2. **一致性**：
   - ✅ 每个阶段都有专用handler负责持久化
   - ✅ 统一的架构模式（通用handler处理 → 专用handler持久化）

3. **灵活性**：
   - ✅ 未来其他App也可采用此模式（OCR阶段专用handler）
   - ✅ 便于扩展（如OCR阶段添加额外处理逻辑）

4. **用户体验**：
   - ✅ OCR完成后用户可立即查看原文（无需等待后续流程）
   - ✅ 进度更透明（每个阶段都有持久化动作）

---

## 缺点分析

**增加的复杂度**：
- ❌ 新增2个专用handler（contract-v2-check-ocr、contract-v2-filter）
- ❌ manifest.json增加2个state
- ❌ 开发工作量增加（2个handler + 2个state）

**但复杂度可控**：
- ✅ 专用handler逻辑简单（主要是持久化）
- ✅ 复用现有OCR逻辑（调用MCP服务）
- ✅ 开发工作量约增加0.5天（可接受）

---

## 总结

**推荐方案B**：每个阶段都有专用handler持久化

**新增专用handler**：
1. ✅ contract-v2-check-ocr（OCR检查 + 持久化OCR）
2. ✅ contract-v2-filter（持久化过滤结果）

**新增state**：
1. ✅ pending_persist_filter

**修改state**：
1. ✅ ocr_submitted handler：handler-check-ocr → contract-v2-check-ocr

**优势**：
- ✅ OCR一步到位存入扩展表
- ✅ 用户可立即查看OCR原文
- ✅ 每个阶段都有持久化动作（一致性）
- ✅ 数据流转环节减少（效率提升）

**下一步**：
- 确认方案B
- 更新表结构设计（app_contract_v2_content字段调整）
- 开始编写专用handler