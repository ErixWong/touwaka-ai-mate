# 合同上传确认流程设计：立即确认 vs 缓存区

> Issue: #665
> 时间: 2026-04-29

## 问题：用户确认放在哪里？

**场景：AI判断为"可能匹配"（相似度0.6-0.8）**
- 用户需要确认是加入已有series还是创建新series
- 用户可能还没看完OCR结果，无法准确判断
- 需要设计合理的确认流程

---

## 方案对比

### 方案A：立即弹出对话框（推荐）

**流程**：
```
上传合同 → OCR + 提取 → AI匹配 → 立即弹出对话框
                                      ↓
                                  用户确认
                                      ↓
                                  创建series/version
```

**优点**：
- ✅ 流程流畅（一气呵成）
- ✅ 用户无需额外操作
- ✅ 符合常见UI交互模式

**缺点**：
- ❌ 用户可能还没看完OCR原文
- ❌ 无法详细比对已有series的内容

**适用场景**：
- ✅ AI判断明确（相似度>=0.8或<0.6）
- ✅ 用户对合同内容熟悉

---

### 方案B：放入缓存区（待确认列表）

**流程**：
```
上传合同 → OCR + 提取 → AI匹配 → 放入缓存区
                                      ↓
                                  用户查看详情
                                      ↓
                                  从缓存区确认
                                      ↓
                                  创建series/version
```

**优点**：
- ✅ 用户可先查看OCR原文
- ✅ 用户可详细比对已有series
- ✅ 可批量确认多个上传

**缺点**：
- ❌ 流程中断（用户需主动去缓存区）
- ❌ 增加用户操作步骤
- ❌ 可能遗忘确认（合同堆积在缓存区）

**适用场景**：
- ✅ AI判断模糊（相似度0.6-0.8）
- ✅ 用户需要详细比对才能决策

---

### 方案C：混合方案（最佳）

**流程**：
```
上传合同 → OCR + 提取 → AI匹配
                          ↓
        ┌─────────────────┼─────────────────┐
        │                 │                 │
    相似度>=0.8       相似度0.6-0.8      相似度<0.6
        │                 │                 │
    立即弹出对话框     放入缓存区         立即弹出对话框
        │                 │                 │
    用户快速确认     用户查看详情后确认   用户快速确认
        │                 │                 │
    创建series       创建series          创建series
```

**优点**：
- ✅ AI判断明确时立即确认（流程流畅）
- ✅ AI判断模糊时放入缓存区（用户可详细比对）
- ✅ 兼顾效率和准确性

**缺点**：
- ❌ 流程分两种模式（可能让用户困惑）

---

## 推荐：方案C（混合方案）

**判断逻辑**：

| 相似度 | 处理方式 | 界面位置 |
|--------|---------|---------|
| `>= 0.8` | 立即弹出对话框 | 模态对话框 |
| `0.6-0.8` | 放入缓存区 | 主界面"待确认"Tab |
| `< 0.6` | 立即弹出对话框 | 模态对话框 |

---

## 缓存区设计（待确认列表）

### 主界面增加"待确认"Tab

```
┌──────────┬──────────────────────────────────────────┐
│ 组织树   │ [合同清单] [待确认（3份）] [已归档]        │
├──────────┼──────────────────────────────────────────┤
│          │                                          │
│          │ 待确认合同（3份）：                        │
│          │                                          │
│          │ □ 战略合作协议修订版.pdf                  │
│          │   AI判断：可能匹配（相似度65%）            │
│          │   已匹配series："联想控股战略合作协议"      │
│          │   [查看OCR原文] [查看已有series] [确认]   │
│          │                                          │
│          │ □ 框架合作协议.pdf                        │
│          │   AI判断：可能匹配（相似度72%）            │
│          │   已匹配series："联想控股战略合作协议"      │
│          │   [查看OCR原文] [查看已有series] [确认]   │
│          │                                          │
│          │ □ 技术合作协议.pdf                        │
│          │   AI判断：可能匹配（相似度68%）            │
│          │   已匹配series："联想控股战略合作协议"      │
│          │   [查看OCR原文] [查看已有series] [确认]   │
│          │                                          │
└──────────┴──────────────────────────────────────────┘
```

---

### 缓存区表设计

**contract_v2_upload_temp（上传临时表）**

```sql
CREATE TABLE contract_v2_upload_temp (
  id VARCHAR(32) PRIMARY KEY,
  row_id VARCHAR(32) NOT NULL COMMENT 'mini_app_rows.id',
  org_node_id VARCHAR(32) NOT NULL COMMENT '组织节点ID',
  
  -- AI提取信息
  extracted_info JSON COMMENT 'AI提取的合同信息',
  
  -- AI匹配结果
  match_result JSON COMMENT 'AI匹配结果（series_id, similarity）',
  match_status ENUM('matched', 'ambiguous', 'new') COMMENT '匹配状态',
  
  -- 用户确认状态
  confirm_status ENUM('pending', 'confirmed', 'rejected') DEFAULT 'pending',
  
  -- 创建信息
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME COMMENT '确认时间',
  
  INDEX idx_org_node (org_node_id),
  INDEX idx_status (confirm_status),
  
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE,
  FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合同上传临时表（缓存区）';
```

---

### extracted_info JSON结构

```json
{
  "contract_title": "战略合作协议修订版",
  "party_a": "联想控股",
  "contract_type": "strategy",
  "contract_number": "HT-2026-001-B",
  "keywords": ["战略合作", "框架合作"]
}
```

---

### match_result JSON结构

```json
{
  "series_id": "series001",
  "series_name": "联想控股战略合作协议",
  "similarity": 0.65,
  "confidence": "medium"
}
```

---

## 缓存区确认流程

### Step 1: 用户查看OCR原文

```
点击[查看OCR原文] → 弹出详情对话框

┌─────────────────────────────────────────────────────┐
│ OCR原文预览                                         │
│ [关闭]                                              │
├─────────────────────────────────────────────────────┤
│ 合同名称：战略合作协议修订版                          │
│ 甲方：联想控股                                       │
│ 合同编号：HT-2026-001-B                              │
│                                                     │
│ OCR原文（左侧章节 + 右侧原文）：                      │
│ ...                                                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### Step 2: 用户查看已有series

```
点击[查看已有series] → 弹出series详情对话框

┌─────────────────────────────────────────────────────┐
│ 已有series详情                                       │
│ [关闭]                                              │
├─────────────────────────────────────────────────────┤
│ Series名称：联想控股战略合作协议                      │
│ 版本数：2个                                          │
│ 当前版本：v1.1（已批准）                             │
│                                                     │
│ 版本列表：                                           │
│ ├─ v1.0 草稿    合同编号：HT-2026-001                │
│ └─ v1.1 已批准⭐ 合同编号：HT-2026-001-A              │
│                                                     │
│ 当前版本元数据：                                     │
│ 合同编号：HT-2026-001-A                              │
│ 甲方：联想控股                                       │
│ 金额：1,200,000元                                    │
│                                                     │
│ [查看v1.1原文]                                       │
└─────────────────────────────────────────────────────┘
```

---

### Step 3: 用户确认

```
点击[确认] → 弹出确认对话框

┌─────────────────────────────────────────────────────┐
│ 确认上传                                             │
│ [取消]                                              │
├─────────────────────────────────────────────────────┤
│ 已上传合同：                                         │
│ 合同名称：战略合作协议修订版                          │
│ 合同编号：HT-2026-001-B                              │
│                                                     │
│ AI匹配的已有series：                                 │
│ "联想控股战略合作协议"（相似度65%）                    │
│                                                     │
│ 请确认：                                             │
│ ○ 加入已有series："联想控股战略合作协议"               │
│   将创建版本：v1.2                                   │
│                                                     │
│ ○ 创建新series                                       │
│   新series名称：[联想控股战略合作协议修订版_______]    │
│   将创建版本：v1.0                                   │
│                                                     │
│ ○ 加入其他已有series                                 │
│   选择series：[下拉列表▼]                            │
│                                                     │
│ [确认]                                               │
└─────────────────────────────────────────────────────┘
```

---

## State流程调整

### 完整流程

```
pending_ocr → handler-submit-ocr（通用）
ocr_submitted → contract-v2-check-ocr（专用）
pending_filter → handler-text-filter（通用）
pending_persist_filter → contract-v2-filter（专用）
pending_extract → handler-extract（通用）
pending_upload_confirm → contract-v2-upload-handler（专用）⭐
  ├─ 相似度>=0.8 → 立即弹出对话框 → pending_review
  ├─ 相似度0.6-0.8 → 写入contract_v2_upload_temp → pending_user_confirm
  └─ 相似度<0.6 → 立即弹出对话框 → pending_review
  
pending_user_confirm → 等待用户从缓存区确认
  → 用户确认 → 创建series/version → pending_review

pending_review → 等待用户最终审核
confirmed → 完成
```

---

### manifest.json states调整

```json
{
  "states": [
    {
      "name": "pending_ocr",
      "handler": "handler-submit-ocr",
      "success_next": "ocr_submitted"
    },
    {
      "name": "ocr_submitted",
      "handler": "contract-v2-check-ocr",
      "success_next": "pending_filter"
    },
    {
      "name": "pending_filter",
      "handler": "handler-text-filter",
      "success_next": "pending_persist_filter"
    },
    {
      "name": "pending_persist_filter",
      "handler": "contract-v2-filter",
      "success_next": "pending_extract"
    },
    {
      "name": "pending_extract",
      "handler": "handler-extract",
      "success_next": "pending_upload_confirm"
    },
    {
      "name": "pending_upload_confirm",  // ⭐ 新增
      "handler": "contract-v2-upload-handler",
      "success_next": "pending_review",  // 或 pending_user_confirm
      "failure_next": "upload_failed"
    },
    {
      "name": "pending_user_confirm",  // ⭐ 新增（缓存区）
      "handler": null,
      "success_next": null,
      "failure_next": null
    },
    {
      "name": "pending_review",
      "handler": null,
      "success_next": "confirmed"
    },
    {
      "name": "confirmed",
      "handler": null,
      "success_next": null,
      "is_terminal": true
    }
  ]
}
```

---

## 前端组件设计

### UploadTempList.vue（缓存区清单）

**功能**：
- 显示待确认合同列表
- 每项显示AI判断结果
- 提供查看OCR原文、查看已有series按钮
- 提供确认按钮

**Props**：
```typescript
interface UploadTempListProps {
  uploads: UploadTempItem[];
}

interface UploadTempItem {
  id: string;
  row_id: string;
  org_node_id: string;
  extracted_info: ExtractedInfo;
  match_result: MatchResult;
  match_status: 'matched' | 'ambiguous' | 'new';
  confirm_status: 'pending' | 'confirmed' | 'rejected';
}
```

---

## API设计

### 缓存区查询API

```javascript
// GET /api/contract-v2/upload-temp?org_node_id=org001&status=pending
{
  uploads: [
    {
      id: "temp001",
      row_id: "abc123",
      extracted_info: {...},
      match_result: {...},
      match_status: "ambiguous",
    }
  ]
}
```

---

### 缓存区确认API

```javascript
// POST /api/contract-v2/upload-temp/:tempId/confirm
{
  action: "create_new_series",
  series_name: "联想控股战略合作协议修订版",
}

// 返回
{
  series_id: "series002",
  version_id: "version001",
  version_number: "v1.0",
}
```

---

## 总结

**推荐方案：混合方案（方案C）**

| 相似度 | 处理方式 | 界面位置 |
|--------|---------|---------|
| `>= 0.8` | 立即弹出对话框 | 模态对话框 |
| `0.6-0.8` | 放入缓存区 | 主界面"待确认"Tab |
| `< 0.6` | 立即弹出对话框 | 模态对话框 |

**缓存区设计**：
- ✅ contract_v2_upload_temp表
- ✅ 主界面增加"待确认"Tab
- ✅ 提供查看OCR原文、查看已有series功能
- ✅ 用户可详细比对后确认

**State流程调整**：
- ✅ pending_upload_confirm（AI判断）
- ✅ pending_user_confirm（缓存区等待用户确认）

**核心优势**：
- ✅ AI判断明确时立即确认（效率）
- ✅ AI判断模糊时放入缓存区（准确性）
- ✅ 兼顾流畅性和用户控制权

**下一步**：
- 确认混合方案
- 更新表结构设计（增加contract_v2_upload_temp）
- 更新manifest.json