# 合同类目与版本管理表结构调整

> Issue: #665
> 时间: 2026-04-29

## 用户观察

**核心问题**：
- contract_v2_main_records更像是一个"类目"或"容器"
- 例如："联想控股战略合作协议"是一个类目，下面有v1.0草稿、v1.1正式版、v2.0修订版
- 每个版本才是真正的"合同文件"

---

## 当前表结构问题

### 问题命名混淆

**contract_v2_main_records（合同主记录）**：
- ❌ 名称暗示是"一份合同"
- ❌ 实际是"一个合同类目/系列"
- ❌ 字段混淆：contract_name（类目名称）vs contract_number（版本编号）

**contract_v2_versions（版本关联）**：
- ✅ 每个版本才是真正的"合同文件"
- ✅ 关联mini_app_rows（OCR、提取数据）

---

## UI交互分析

**主界面合同清单**：
```
□ ThinkPad供货协议 ← 这是一个"类目"
  ├─ v1.0 草稿    ← 这是一个"版本"（真正的合同文件）
  ├─ v1.1 已批准⭐ ← 当前版本
  └─ v2.0 待审核
```

**用户操作**：
1. 点击类目名称 → 进入版本详情页
2. 展开版本列表 → 选择具体版本
3. 选择具体版本 → [加入分析]

**AI工具**：
- 选择"类目"（如ThinkPad供货协议）→ 默认选择当前版本（v1.1）
- 选择"版本"（如v1.0）→ 选择该版本加入分析

---

## 表结构调整方案

### 方案A：改名 + 字段调整（推荐）

**表名调整**：
- `contract_v2_main_records` → `contract_v2_series`（合同系列/类目）
- `contract_v2_versions` 保持不变（合同版本）

---

### contract_v2_series（合同系列/类目）

**表结构**：
```sql
CREATE TABLE contract_v2_series (
  id VARCHAR(32) PRIMARY KEY COMMENT '系列ID',
  org_node_id VARCHAR(32) NOT NULL COMMENT '所属组织节点',
  
  -- 系列基本信息（类目层面）
  series_name VARCHAR(128) NOT NULL COMMENT '系列名称（如：ThinkPad供货协议）',
  series_type ENUM('strategy', 'framework', 'development', 'supply', 'quality', 'nda', 'other') COMMENT '系列类型',
  
  -- 当前版本引用
  current_version_id VARCHAR(32) COMMENT '当前生效版本ID',
  version_count INT DEFAULT 0 COMMENT '版本总数',
  
  -- 系列状态（类目层面）
  series_status ENUM('active', 'archived', 'terminated') DEFAULT 'active' COMMENT '系列状态',
  
  -- 系列描述
  series_description TEXT COMMENT '系列说明（如：与联想北京ThinkPad项目的供货合作）',
  
  -- 创建信息
  created_by VARCHAR(32) COMMENT '创建人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_org_node (org_node_id),
  INDEX idx_type (series_type),
  INDEX idx_status (series_status),
  INDEX idx_current_version (current_version_id),
  
  FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (current_version_id) REFERENCES contract_v2_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合同系列/类目表';
```

**字段调整说明**：
- ✅ `series_name`（系列名称）vs `contract_name`（合同名称）- 明确语义
- ✅ `series_type`（系列类型）- 类目层面类型
- ✅ `series_status`（系列状态）- 类目层面状态（active/archived/terminated）
- ✅ `series_description`（系列说明）- 类目层面描述

---

### contract_v2_versions（合同版本）- 保持不变

**表结构**：
```sql
CREATE TABLE contract_v2_versions (
  id VARCHAR(32) PRIMARY KEY COMMENT '版本ID',
  series_id VARCHAR(32) NOT NULL COMMENT '所属系列ID',
  row_id VARCHAR(32) NOT NULL COMMENT 'mini_app_rows ID（合同文件数据）',
  
  -- 版本基本信息
  version_number VARCHAR(16) NOT NULL COMMENT '版本号（如 v1.0）',
  version_name VARCHAR(64) COMMENT '版本名称（如 初签版）',
  version_type ENUM('draft', 'signed', 'amendment', 'supplement') COMMENT '版本类型',
  version_status ENUM('draft', 'reviewing', 'approved', 'rejected', 'archived') COMMENT '版本状态',
  
  -- 版本时间信息
  effective_date DATE COMMENT '生效日期',
  expiry_date DATE COMMENT '失效日期',
  signed_at DATETIME COMMENT '签署时间',
  
  -- 版本元数据（真正的合同文件数据）
  contract_number VARCHAR(64) COMMENT '合同编号（如 HT-2026-001）',
  party_a VARCHAR(128) COMMENT '甲方',
  party_b VARCHAR(128) COMMENT '乙方',
  total_amount DECIMAL(15,2) COMMENT '合同金额',
  
  -- 版本说明
  change_summary TEXT COMMENT '版本变更说明',
  
  -- 版本状态标识
  is_current BIT(1) DEFAULT 0 COMMENT '是否当前版本',
  is_archived BIT(1) DEFAULT 0 COMMENT '是否已归档',
  
  -- 创建信息
  created_by VARCHAR(32) COMMENT '上传人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_series_version (series_id, version_number),
  INDEX idx_series (series_id),
  INDEX idx_row (row_id),
  INDEX idx_current (is_current),
  INDEX idx_status (version_status),
  
  FOREIGN KEY (series_id) REFERENCES contract_v2_series(id) ON DELETE CASCADE,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='合同版本表';
```

**关键字段调整**：
- ✅ `series_id`（系列ID）vs `contract_id`（合同ID）- 明确引用关系
- ✅ **版本层面字段**：
  - `contract_number`（合同编号）- 每个版本有自己的编号
  - `party_a`（甲方）- 每个版本可能甲方不同
  - `party_b`（乙方）- 每个版本可能乙方不同
  - `total_amount`（合同金额）- 每个版本金额可能不同

---

## 数据层级关系

### 三层结构

```
组织节点（contract_v2_org_nodes）
│
└── 合同系列（contract_v2_series）← 类目层面
    │   series_name = "ThinkPad供货协议"
    │   series_type = "supply"
    │   current_version_id = version002
    │
    └── 合同版本（contract_v2_versions）← 文件层面
        │
        ├── version001（v1.0 草稿）
        │   contract_number = "HT-2026-001"
        │   party_a = "联想北京"
        │   total_amount = 1,000,000
        │   row_id = mini_app_rows.id（OCR数据）
        │
        ├── version002（v1.1 已批准）⭐ 当前版本
        │   contract_number = "HT-2026-001-A"
        │   party_a = "联想北京"
        │   total_amount = 1,200,000
        │   row_id = mini_app_rows.id（OCR数据）
        │
        └── version003（v2.0 待审核）
            contract_number = "HT-2026-001-B"
            party_a = "联想控股"
            total_amount = 1,500,000
            row_id = mini_app_rows.id（OCR数据）
```

---

## 元数据归属调整

### 原方案问题

**contract_v2_main_records存放元数据**：
- ❌ 合同编号（contract_number）- 应该是版本层面的字段
- ❌ 甲方（party_a）- 应该是版本层面的字段
- ❌ 合同金额（total_amount）- 应该是版本层面的字段

**问题**：
- ❌ 不同版本的合同编号可能不同（如 HT-001-A vs HT-001-B）
- ❌ 不同版本的甲方可能不同（如 联想北京 vs 联想控股）
- ❌ 不同版本的金额可能不同（如 v1.0 = 100万 vs v1.1 = 120万）

---

### 新方案：元数据归属清晰化

**系列层面（contract_v2_series）**：
- ✅ `series_name`（系列名称）- 类目名称（如"ThinkPad供货协议"）
- ✅ `series_type`（系列类型）- 类目类型（如 supply）
- ✅ `series_description`（系列说明）- 类目说明
- ✅ `version_count`（版本总数）- 类目统计

**版本层面（contract_v2_versions）**：
- ✅ `contract_number`（合同编号）- 每个版本有自己的编号
- ✅ `party_a`（甲方）- 每个版本可能甲方不同
- ✅ `party_b`（乙方）- 每个版本可能乙方不同
- ✅ `total_amount`（合同金额）- 每个版本金额可能不同
- ✅ `effective_date`（生效日期）- 每个版本生效日期不同
- ✅ `expiry_date`（失效日期）- 每个版本失效日期不同

---

## UI展示逻辑

### 合同清单（类目展示）

```
□ ThinkPad供货协议（系列）← 类目层面
  类型：供货协议  版本：3个  当前版本：v1.1已批准⭐
  
  版本列表（展开）：
  ├─ v1.0 草稿    合同编号：HT-2026-001     金额：1,000,000
  ├─ v1.1 已批准⭐ 合同编号：HT-2026-001-A   金额：1,200,000 ← 当前版本
  └─ v2.0 待审核  合同编号：HT-2026-001-B   金额：1,500,000
```

---

### 版本详情页

```
┌─────────────────────────────────────────────────────┐
│ ThinkPad供货协议（系列）                             │
│ 类型：供货协议  版本：3个                             │
├─────────────────────────────────────────────────────┤
│ 当前查看版本：v1.1（已批准）⭐ [切换版本▼]             │
├─────────────────────────────────────────────────────┤
│ 版本元数据：                                         │
│ 合同编号：HT-2026-001-A                              │
│ 甲方：联想北京                                       │
│ 乙方：供应商A                                        │
│ 合同金额：1,200,000元                                │
│ 生效日期：2026-01-15                                 │
│ 失效日期：2026-12-31                                 │
│                                                     │
│ 原文内容：左侧章节 + 右侧原文                         │
└─────────────────────────────────────────────────────┘
```

---

## AI工具选择逻辑

### 选择类目（系列）

```
□ ThinkPad供货协议 ← 选择类目
```

**默认行为**：
- ✅ 自动选择当前版本（is_current=1的版本）
- ✅ 加入AI工具Panel："ThinkPad供货协议（v1.1）"

---

### 选择版本

```
版本列表（展开）：
├─ v1.0 草稿    [加入分析] ← 选择具体版本
├─ v1.1 已批准⭐ [加入分析]
└─ v2.0 待审核  [加入分析]
```

**行为**：
- ✅ 选择具体版本加入AI工具Panel："ThinkPad供货协议（v1.0）"
- ✅ 用户可选择同一系列的不同版本进行比对（如v1.0 vs v1.1）

---

## 同系列版本比对场景

**用户可能需求**：
- ✅ 比对同一系列的不同版本（如v1.0 vs v1.1）
- ✅ 查看版本演进过程（金额变化、甲方变化）

**AI比对逻辑**：
```
选择版本：
├─ ThinkPad供货协议（v1.0）
└─ ThinkPad供货协议（v1.1）

AI比对：
合同编号：HT-2026-001 vs HT-2026-001-A（编号变更）
甲方：联想北京 vs 联想北京（无变化）
金额：1,000,000 vs 1,200,000（+20%）
```

---

## 总结

**表名调整**：
- ✅ contract_v2_main_records → contract_v2_series（合同系列/类目）
- ✅ contract_v2_versions 保持不变（合同版本）

**字段调整**：
- ✅ 系列层面：series_name, series_type, series_description
- ✅ 版本层面：contract_number, party_a, total_amount, effective_date, expiry_date

**数据层级**：
```
组织节点 → 合同系列（类目）→ 合同版本（文件）→ mini_app_rows（OCR数据）
```

**UI交互**：
- ✅ 主界面显示系列（类目）
- ✅ 展开显示版本列表
- ✅ 选择版本加入AI分析
- ✅ 版本详情页显示版本元数据

**优势**：
- ✅ 语义清晰（系列 vs 版本）
- ✅ 元数据归属正确（版本层面）
- ✅ 支持同系列版本比对

**下一步**：
- 确认表结构调整
- 更新主设计文档