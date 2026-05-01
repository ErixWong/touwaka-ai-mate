# 合同版本管理与差异比对设计

> Issue: #665
> 时间: 2026-04-29

## 问题背景

合同本身分多个版本：
- 草稿版（draft）
- 正式签署版（signed）
- 修订版（amendment）
- 补充协议（supplement）

不同版本之间需要差异比对。

---

## 表结构调整

### contract_v2_versions 表增强

```sql
CREATE TABLE contract_v2_versions (
  id VARCHAR(32) PRIMARY KEY COMMENT '版本ID',
  contract_id VARCHAR(32) NOT NULL COMMENT '合同主记录ID',
  row_id VARCHAR(32) NOT NULL COMMENT 'mini_app_rows ID（OCR数据）',
  
  -- 版本基本信息
  version_number VARCHAR(16) NOT NULL COMMENT '版本号（如 v1.0, v2.0）',
  version_name VARCHAR(64) COMMENT '版本名称（如 初签版、补充版）',
  version_type ENUM('draft', 'signed', 'amendment', 'supplement') NOT NULL COMMENT '版本类型',
  version_status ENUM('draft', 'reviewing', 'approved', 'rejected', 'archived') DEFAULT 'draft' COMMENT '版本状态',
  
  -- 版本时间信息
  effective_date DATE COMMENT '生效日期',
  expiry_date DATE COMMENT '失效日期',
  signed_at DATETIME COMMENT '签署时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  -- 版本说明
  change_summary TEXT COMMENT '版本变更说明',
  change_type ENUM('minor', 'major', 'critical') COMMENT '变更类型',
  changed_fields JSON COMMENT '变更字段列表（如 ["party_a", "contract_amount"]）',
  
  -- 版本状态
  is_current BIT(1) DEFAULT 0 COMMENT '是否当前生效版本',
  is_archived BIT(1) DEFAULT 0 COMMENT '是否已归档',
  is_compare_source BIT(1) DEFAULT 0 COMMENT '是否可作为比对基准',
  
  -- 签署信息
  signed_by VARCHAR(128) COMMENT '签署人',
  approved_by VARCHAR(32) COMMENT '审批人',
  approved_at DATETIME COMMENT '审批时间',
  
  -- 创建信息
  created_by VARCHAR(32) COMMENT '上传人',
  
  UNIQUE KEY uk_contract_version (contract_id, version_number),
  INDEX idx_contract (contract_id),
  INDEX idx_row (row_id),
  INDEX idx_current (is_current),
  INDEX idx_type (version_type),
  INDEX idx_status (version_status),
  
  FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id) ON DELETE CASCADE,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合同v2版本管理表';
```

---

## 版本类型说明

### version_type 枚举

| 类型 | 说明 | 示例场景 |
|------|------|---------|
| `draft` | 草稿版 | 内部起草，未正式签署 |
| `signed` | 正式签署版 | 双方签署生效 |
| `amendment` | 修订版 | 对原合同条款修订 |
| `supplement` | 补充协议 | 新增补充条款 |

---

### version_status 枚举

| 状态 | 说明 | 流转 |
|------|------|------|
| `draft` | 草稿 | 上传后的初始状态 |
| `reviewing` | 待审核 | 提交审核后 |
| `approved` | 已批准 | 审核通过 |
| `rejected` | 已驳回 | 审核拒绝 |
| `archived` | 已归档 | 历史版本归档 |

**状态流转**：
```
上传文件 → draft → reviewing → approved/rejected → archived
                                     ↓
                               is_current=1
```

---

## 版本管理流程

### 上传新版本

```
用户点击 [+上传新版本]
  ↓
上传合同文件
  ↓
mini_app_rows创建记录（row_id=abc123）
  ↓
OCR + 提取流程
  ↓
创建contract_v2_versions:
  contract_id = contract001
  row_id = abc123
  version_number = "v3.0"
  version_type = "amendment"
  version_status = "draft"
  is_current = 0
  ↓
用户提交审核
  ↓
version_status = "reviewing"
  ↓
管理员审核通过
  ↓
version_status = "approved"
  is_current = 1（设置为当前版本）
  旧版本 is_current = 0（取消旧版本）
```

---

## 差异比对设计

### 比对维度

| 比对维度 | 数据来源 | 比对方式 |
|---------|---------|---------|
| **元数据比对** | mini_app_row.data | 字段级对比（如金额、日期） |
| **条款比对** | app_contract_v2_content.filtered_text | 文本Diff算法 |
| **章节比对** | app_contract_v2_content.sections | LLM语义匹配 |
| **OCR原文比对** | app_contract_v2_content.ocr_text | 文本Diff算法 |

---

### 元数据比对（字段级）

**示例**：
```
v1.0 vs v2.0 元数据对比：

合同编号：HT-2026-001（无变化）
甲方：联想控股（无变化）
合同金额：1,000,000 → 1,200,000（+20%）⚠️ 变化
签订日期：2026-01-01 → 2026-01-15（推迟）⚠️ 变化
生效日期：2026-02-01（无变化）
失效日期：2026-12-31 → 2027-06-30（延长）⚠️ 变化
```

**实现**：
```javascript
async compareMetadata(versionId1, versionId2) {
  const v1 = await this.getVersionWithData(versionId1);
  const v2 = await this.getVersionWithData(versionId2);
  
  const diff = {};
  
  // 提取字段列表
  const fields = ['contract_number', 'party_a', 'contract_amount', 
                  'contract_date', 'effective_date', 'expiry_date'];
  
  for (const field of fields) {
    if (v1.data[field] !== v2.data[field]) {
      diff[field] = {
        old: v1.data[field],
        new: v2.data[field],
        changed: true,
      };
    } else {
      diff[field] = {
        old: v1.data[field],
        new: v2.data[field],
        changed: false,
      };
    }
  }
  
  return diff;
}
```

---

### 文本比对（Diff算法）

**实现**：
```javascript
import Diff from 'diff';

async compareText(versionId1, versionId2) {
  const v1 = await this.getVersionContent(versionId1);
  const v2 = await this.getVersionContent(versionId2);
  
  // 使用diff库进行文本比对
  const diffResult = Diff.diffWords(v1.filtered_text, v2.filtered_text);
  
  // 标记变化部分
  const html = diffResult.map(part => {
    if (part.added) {
      return `<span class="added">${part.value}</span>`;
    } else if (part.removed) {
      return `<span class="removed">${part.value}</span>`;
    } else {
      return `<span class="unchanged">${part.value}</span>`;
    }
  }).join('');
  
  return {
    diff: diffResult,
    html: html,
    added_count: diffResult.filter(p => p.added).length,
    removed_count: diffResult.filter(p => p.removed).length,
  };
}
```

---

### 章节比对（LLM语义匹配）

**复用现有比对功能**（PR #662已实现）：

```javascript
async compareSections(versionId1, versionId2) {
  const v1 = await this.getVersionSections(versionId1);
  const v2 = await this.getVersionSections(versionId2);
  
  // 调用现有的章节比对服务
  const result = await this.miniAppService.compareRecords({
    version1_row_id: v1.row_id,
    version2_row_id: v2.row_id,
  });
  
  return result;
}
```

---

## 比对结果存储

### contract_v2_compare_results 表（可选）

```sql
CREATE TABLE contract_v2_compare_results (
  id VARCHAR(32) PRIMARY KEY,
  contract_id VARCHAR(32) NOT NULL,
  version_id_1 VARCHAR(32) NOT NULL COMMENT '基准版本ID',
  version_id_2 VARCHAR(32) NOT NULL COMMENT '比对版本ID',
  
  -- 比对结果
  metadata_diff JSON COMMENT '元数据差异（字段级）',
  text_diff LONGTEXT COMMENT '文本差异（HTML格式）',
  section_diff JSON COMMENT '章节差异（语义匹配）',
  
  -- 统计信息
  changed_fields_count INT DEFAULT 0 COMMENT '变更字段数',
  added_words_count INT DEFAULT 0 COMMENT '新增词汇数',
  removed_words_count INT DEFAULT 0 COMMENT '删除词汇数',
  similarity_score DECIMAL(5,2) COMMENT '相似度评分（0-100）',
  
  -- 创建信息
  created_by VARCHAR(32),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_contract (contract_id),
  INDEX idx_versions (version_id_1, version_id_2),
  
  FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id),
  FOREIGN KEY (version_id_1) REFERENCES contract_v2_versions(id),
  FOREIGN KEY (version_id_2) REFERENCES contract_v2_versions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合同版本比对结果表';
```

---

## UI呈现设计

### 版本管理界面

```
┌─────────────────────────────────────────────────────┐
│  合同详情：ThinkPad供货协议                            │
├─────────────────────────────────────────────────────┤
│  [基本信息] [版本历史] [差异比对] [原文内容]            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  版本历史（5个版本）：                                 │
│  ┌───────────────────────────────────────────────┐ │
│  │ v1.0 草稿      2026-01-01  草稿   [查看] [比对] │ │
│  │ v1.1 正式版 ⭐ 2026-01-15  已批准 [查看] [比对] │ │ ⭐ 当前版本
│  │ v2.0 修订版    2026-03-01  已批准 [查看] [比对] │ │
│  │ v2.1 补充版    2026-04-01  草稿   [查看] [比对] │ │
│  │ v3.0 修订版    2026-04-15  待审核 [查看] [比对] │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  [+上传新版本]                                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

### 差异比对界面

```
┌─────────────────────────────────────────────────────┐
│  版本比对：v1.1（基准）vs v2.0（对比）                 │
├─────────────────────────────────────────────────────┤
│  [元数据对比] [条款对比] [章节对比] [原文对比]          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  元数据对比（3处变化）：                               │
│  ┌───────────────────────────────────────────────┐ │
│  │ 合同金额：1,000,000 → 1,200,000（+20%）⚠️      │ │
│  │ 签订日期：2026-01-15 → 2026-03-01（推迟）⚠️    │ │
│  │ 失效日期：2026-12-31 → 2027-06-30（延长）⚠️    │ │
│  │ 其他字段：无变化 ✓                            │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  条款对比（文本差异）：                                │
│  ┌───────────────────────────────────────────────┐ │
│  │ 第5.2条 质量标准：                             │ │
│  │ "产品合格率应不低于95%"                        │ │
│  │               ↓                                │ │
│  │ "产品合格率应不低于98%" ← 新增                 │ │
│  │                                               │ │
│  │ 新增条款：                                     │ │
│  │ "第5.3条 交货周期..." ← 新增                   │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  相似度：85.2%                                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## API设计

### 版本管理API

```
POST   /api/contract-v2/contracts/:id/versions       上传新版本
GET    /api/contract-v2/contracts/:id/versions       获取版本列表
PUT    /api/contract-v2/versions/:versionId          更新版本信息
DELETE /api/contract-v2/versions/:versionId          删除版本
PUT    /api/contract-v2/versions/:versionId/approve  审批通过
PUT    /api/contract-v2/versions/:versionId/reject   审批驳回
PUT    /api/contract-v2/versions/:versionId/current  设置为当前版本
```

---

### 差异比对API

```
POST   /api/contract-v2/versions/compare            创建比对任务
GET    /api/contract-v2/compare/:compareId          获取比对结果
GET    /api/contract-v2/versions/:id1/compare/:id2  快速比对（返回结果）
```

**比对API示例**：

```javascript
// POST /api/contract-v2/versions/compare
{
  version_id_1: "version001",  // 基准版本
  version_id_2: "version002",  // 对比版本
  compare_type: "all"          // all/metadata/text/section
}

// 返回
{
  compare_id: "compare001",
  metadata_diff: {
    contract_amount: { old: 1000000, new: 1200000, changed: true },
    contract_date: { old: "2026-01-15", new: "2026-03-01", changed: true },
    ...
  },
  text_diff: "<span class='added'>新增条款...</span>",
  section_diff: {
    matched: [...],
    only_in_v1: [...],
    only_in_v2: [...]
  },
  similarity_score: 85.2
}
```

---

## 前端组件设计

### VersionList.vue（版本列表）

**功能**：
- 显示所有版本列表
- 版本状态标识（草稿、待审核、已批准、已归档）
- 当前版本标识（⭐）
- 比对按钮

**Props**：
```typescript
interface VersionListProps {
  contractId: string;
  versions: Version[];
  currentVersionId: string;
}
```

---

### VersionCompare.vue（版本比对）

**功能**：
- 选择基准版本和对比版本
- 多维度比对（元数据、条款、章节）
- Diff高亮显示
- 相似度评分

**Props**：
```typescript
interface VersionCompareProps {
  versionId1: string;
  versionId2: string;
  compareType: 'all' | 'metadata' | 'text' | 'section';
}
```

---

## 版本状态标识设计

**UI标识**：
- 草稿（draft）：灰色标签
- 待审核（reviewing）：黄色标签 + 审核按钮
- 已批准（approved）：绿色标签 + ⭐（如果是当前版本）
- 已驳回（rejected）：红色标签
- 已归档（archived）：灰色标签 + 锁定图标

---

## 总结

**版本管理设计**：
- ✅ 版本类型：draft/signed/amendment/supplement
- ✅ 版本状态：draft/reviewing/approved/rejected/archived
- ✅ 版本流程：上传 → 审核 → 批准 → 设置当前版本

**差异比对设计**：
- ✅ 四维度比对：元数据、条款、章节、原文
- ✅ Diff算法：文本比对 + LLM语义匹配
- ✅ 结果存储：contract_v2_compare_results表
- ✅ UI呈现：多Tab显示 + Diff高亮

**下一步**：
- 确认版本管理设计
- 确认差异比对方案
- 开始实现