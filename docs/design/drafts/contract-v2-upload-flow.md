# 合同上传流程：AI自动判断创建series

> Issue: #665
> 时间: 2026-04-29

## 业务场景

**用户在特定node下上传合同文件**：
- ✅ 需要通过AI判断是"新series"还是"已有series的新版本"
- ✅ 自动创建series或匹配到已有series
- ✅ 用户可确认或修正AI判断

---

## 上传流程设计

### 用户操作流程

```
1. 用户选择组织节点（如"联想控股"）
2. 点击[+上传合同]按钮
3. 上传合同文件（如"战略合作协议.pdf"）
4. 系统自动：
   ├─ 创建mini_app_rows（OCR流程开始）
   ├─ AI提取合同名称、甲方、类型
   ├─ AI匹配已有series（相似度计算）
   └─ 弹出确认对话框
5. 用户确认：
   ├─ 选择"创建新series"或
   ├─ 选择"加入已有series"或
   ├─ 手动修改AI判断
6. 系统创建series + version
```

---

## AI判断逻辑

### Step 1: AI提取合同基本信息

**LLM提取字段**：
```json
{
  "contract_title": "战略合作协议",
  "party_a": "联想控股",
  "contract_type": "strategy",
  "contract_number": "HT-2026-001",
  "keywords": ["战略合作", "框架合作", "长期合作"]
}
```

**提取时机**：
- ✅ OCR完成后，在handler-extract阶段提取
- ✅ 提取结果存入mini_app_row.data

---

### Step 2: AI匹配已有series

**匹配维度**：
| 维度 | 权重 | 说明 |
|------|------|------|
| `series_name相似度` | 50% | "战略合作协议" vs "联想控股战略合作协议"（语义相似） |
| `party_a匹配` | 30% | "联想控股" vs "联想控股"（完全匹配） |
| `series_type匹配` | 20% | "strategy" vs "strategy"（类型匹配） |

**相似度计算**：
```javascript
async matchExistingSeries(orgNodeId, extractedInfo) {
  const existingSeries = await this.models.ContractV2Series.findAll({
    where: { org_node_id: orgNodeId },
  });
  
  for (const series of existingSeries) {
    const similarity = await this.calculateSimilarity(
      series.series_name,
      extractedInfo.contract_title,
    );
    
    // 相似度阈值判断
    if (similarity > 0.8) {
      return {
        series_id: series.id,
        series_name: series.series_name,
        similarity: similarity,
        confidence: 'high',
      };
    } else if (similarity > 0.6) {
      return {
        series_id: series.id,
        series_name: series.series_name,
        similarity: similarity,
        confidence: 'medium',
      };
    }
  }
  
  return {
    series_id: null,
    series_name: extractedInfo.contract_title,
    similarity: 0,
    confidence: 'new',
  };
}
```

---

### Step 3: 判断规则

| 相似度 | 判断 | 处理 |
|--------|------|------|
| `>= 0.8` | 已有series的新版本 | 推荐"加入已有series" |
| `0.6-0.8` | 可能匹配 | 提示用户确认 |
| `< 0.6` | 新series | 推荐"创建新series" |

---

## 用户确认对话框设计

### 对话框内容

```
┌─────────────────────────────────────────────────────┐
│ 合同上传确认                                         │
│ [取消]                                              │
├─────────────────────────────────────────────────────┤
│ AI识别结果：                                         │
│ ┌─────────────────────────────────────────────────┐│
│ │ 合同名称：战略合作协议                            ││
│ │ 甲方：联想控股                                   ││
│ │ 合同类型：战略合作（strategy）                    ││
│ │ 合同编号：HT-2026-001                            ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ AI判断：                                             │
│ ┌─────────────────────────────────────────────────┐│
│ │ ✓ 已匹配到已有series：                            ││
│ │   "联想控股战略合作协议"（相似度92%）             ││
│ │                                                 ││
│ │ AI推荐：加入该series，创建v2.0版本               ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ 请确认：                                             │
│ ┌─────────────────────────────────────────────────┐│
│ │ ○ 加入已有series："联想控股战略合作协议" ⭐（推荐） ││
│ │                                                 ││
│ │ ○ 创建新series                                  ││
│ │   新series名称：[战略合作协议______]              ││
│ │                                                 ││
│ │ ○ 加入其他已有series：                           ││
│ │   选择series：[下拉列表▼]                        ││
│ └─────────────────────────────────────────────────┘│
│                                                     │
│ [确认上传]                                           │
└─────────────────────────────────────────────────────┘
```

---

### 对话框逻辑

**AI判断：已有series（相似度>=0.8）**：
```
AI推荐：加入已有series（默认选项）
├─ ○ 加入已有series："联想控股战略合作协议" ⭐（推荐）
├─ ○ 创建新series
└─ ○ 加入其他已有series
```

**AI判断：可能匹配（相似度0.6-0.8）**：
```
AI提示：可能匹配，请确认
├─ ○ 加入已有series："联想控股战略合作协议"（相似度65%）
├─ ○ 创建新series ⭐（推荐）
└─ ○ 加入其他已有series
```

**AI判断：新series（相似度<0.6）**：
```
AI推荐：创建新series（默认选项）
├─ ○ 创建新series ⭐（推荐）
│   新series名称：[战略合作协议______]
├─ ○ 加入已有series（选择列表）
└─ ○ 加入其他已有series
```

---

## 用户确认后的处理流程

### 选择1：加入已有series

```javascript
async addToExistingSeries(seriesId, rowId, versionNumber) {
  // 1. 创建version
  const version = await this.models.ContractV2Version.create({
    id: generateId(),
    series_id: seriesId,
    row_id: rowId,
    version_number: versionNumber,  // 如"v2.0"
    version_type: 'signed',
    version_status: 'draft',
    is_current: false,
  });
  
  // 2. 更新series统计
  await this.models.ContractV2Series.update({
    version_count: series.version_count + 1,
  }, { where: { id: seriesId } });
  
  return version;
}
```

---

### 选择2：创建新series

```javascript
async createNewSeries(orgNodeId, rowId, seriesName, versionNumber) {
  // 1. 创建series
  const series = await this.models.ContractV2Series.create({
    id: generateId(),
    org_node_id: orgNodeId,
    series_name: seriesName,  // 如"联想控股战略合作协议"
    series_type: 'strategy',
    version_count: 1,
  });
  
  // 2. 创建version（第一个版本）
  const version = await this.models.ContractV2Version.create({
    id: generateId(),
    series_id: series.id,
    row_id: rowId,
    version_number: versionNumber,  // 如"v1.0"
    version_type: 'signed',
    version_status: 'draft',
    is_current: true,  // 第一个版本默认为当前版本
  });
  
  // 3. 更新series.current_version_id
  await this.models.ContractV2Series.update({
    current_version_id: version.id,
  }, { where: { id: series.id } });
  
  return { series, version };
}
```

---

### 选择3：加入其他已有series

```javascript
async addToOtherSeries(seriesId, rowId, versionNumber) {
  // 同"加入已有series"流程
  return await this.addToExistingSeries(seriesId, rowId, versionNumber);
}
```

---

## 版本号自动生成规则

### 规则1：已有series的新版本

```javascript
generateVersionNumberForExistingSeries(seriesId) {
  const versions = await this.models.ContractV2Version.findAll({
    where: { series_id: seriesId },
    order: [['version_number', 'DESC']],
  });
  
  if (versions.length === 0) {
    return 'v1.0';
  }
  
  // 最新版本号
  const latestVersion = versions[0].version_number;  // 如"v1.1"
  
  // 提取版本号数字
  const versionNum = parseFloat(latestVersion.replace('v', ''));  // 1.1
  
  // 新版本号
  const newVersionNum = versionNum + 0.1;  // 1.2
  
  return `v${newVersionNum.toFixed(1)}`;  // "v1.2"
}
```

---

### 规则2：新series的第一个版本

```javascript
generateVersionNumberForNewSeries() {
  return 'v1.0';  // 新series默认v1.0
}
```

---

## 上传流程完整示例

### 场景1：首次上传合同（创建新series）

```
用户上传：战略合作协议.pdf
AI提取：
  contract_title: "战略合作协议"
  party_a: "联想控股"
  
AI匹配：无匹配series（相似度0）

确认对话框：
  ○ 创建新series ⭐（推荐）
    新series名称：[联想控股战略合作协议]
  ○ 加入已有series（列表空）

用户确认：创建新series

系统创建：
  ├─ series: "联想控股战略合作协议"
  ├─ version: "v1.0"
  └─ mini_app_rows: OCR + 提取流程
```

---

### 场景2：上传已有series的新版本

```
用户上传：战略合作协议修订版.pdf
AI提取：
  contract_title: "战略合作协议（修订版）"
  party_a: "联想控股"
  
AI匹配：
  已有series: "联想控股战略合作协议"
  相似度: 92%

确认对话框：
  ○ 加入已有series："联想控股战略合作协议" ⭐（推荐）
  ○ 创建新series
  ○ 加入其他已有series

用户确认：加入已有series

系统创建：
  ├─ version: "v1.1"（已有series的新版本）
  ├─ series.version_count: 1 → 2
  └─ mini_app_rows: OCR + 提取流程
```

---

### 场景3：上传相似但不同的合同（可能匹配）

```
用户上传：框架合作协议.pdf
AI提取：
  contract_title: "框架合作协议"
  party_a: "联想控股"
  
AI匹配：
  已有series: "联想控股战略合作协议"
  相似度: 65%

确认对话框：
  ○ 加入已有series："联想控股战略合作协议"（相似度65%）
  ○ 创建新series ⭐（推荐）
    新series名称：[联想控股框架合作协议]
  ○ 加入其他已有series

用户确认：创建新series

系统创建：
  ├─ series: "联想控股框架合作协议"（新series）
  ├─ version: "v1.0"
  └─ mini_app_rows: OCR + 提取流程
```

---

## Handler设计

### contract-v2-upload-handler（新增）

**职责**：
- ✅ 监听mini_app_rows的OCR + 提取完成事件
- ✅ AI提取合同基本信息
- ✅ AI匹配已有series
- ✅ 触发用户确认对话框
- ✅ 创建series + version

**触发时机**：
- ✅ handler-extract完成后
- ✅ 进入pending_upload_confirm状态

**State流程调整**：
```
pending_extract → handler-extract（通用）
pending_upload_confirm → contract-v2-upload-handler（专用）⭐
  → 用户确认对话框
  → 创建series + version
pending_review → 等待用户确认
```

---

## API设计

### 上传确认API

```javascript
// POST /api/contract-v2/upload/confirm
{
  row_id: "abc123",  // mini_app_rows.id
  org_node_id: "org001",
  action: "create_new_series",  // 或 "add_to_existing_series"
  series_id: null,  // 如选择加入已有series，填写series_id
  series_name: "联想控股战略合作协议",  // 如创建新series，填写series_name
}

// 返回
{
  series_id: "series001",
  version_id: "version001",
  version_number: "v1.0",
}
```

---

### AI匹配结果查询API

```javascript
// GET /api/contract-v2/upload/match-result?row_id=abc123
{
  extracted_info: {
    contract_title: "战略合作协议",
    party_a: "联想控股",
    contract_type: "strategy",
  },
  match_result: {
    series_id: "series001",
    series_name: "联想控股战略合作协议",
    similarity: 0.92,
    confidence: "high",
  },
  recommendation: "add_to_existing_series",
}
```

---

## 前端组件

### UploadConfirmDialog.vue

**功能**：
- 显示AI提取信息
- 显示AI匹配结果
- 用户选择（加入已有series / 创建新series）
- 确认上传

**Props**：
```typescript
interface UploadConfirmDialogProps {
  rowId: string;
  orgNodeId: string;
  extractedInfo: ExtractedInfo;
  matchResult: MatchResult;
  visible: boolean;
}
```

---

## 总结

**上传流程设计**：
- ✅ 用户在特定node下上传合同文件
- ✅ AI提取合同名称、甲方、类型
- ✅ AI匹配已有series（相似度计算）
- ✅ 用户确认对话框（AI推荐 + 用户修正）
- ✅ 创建series + version

**AI判断规则**：
- ✅ 相似度>=0.8：推荐加入已有series
- ✅ 相似度0.6-0.8：提示用户确认
- ✅ 相似度<0.6：推荐创建新series

**用户选择**：
- ✅ 加入已有series（AI推荐）
- ✅ 创建新series（可修改series名称）
- ✅ 加入其他已有series（手动选择）

**版本号自动生成**：
- ✅ 已有series的新版本：v1.0 → v1.1 → v1.2
- ✅ 新series的第一个版本：v1.0

**Handler设计**：
- ✅ contract-v2-upload-handler（专用）
- ✅ 监听OCR + 提取完成事件
- ✅ 触发用户确认对话框

**下一步**：
- 确认上传流程设计
- 更新manifest.json增加state
- 开始实现handler