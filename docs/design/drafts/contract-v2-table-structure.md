# contract-mgr-v2 独立业务表结构设计

> Issue: #665
> 时间: 2026-04-29

## 表结构概览

```
独立业务表体系（新增）
├── contract_v2_org_nodes（组织树）✅ 独立表
├── contract_v2_main_records（合同主记录）✅ 独立表
└── contract_v2_versions（版本关联）✅ 独立表

mini_app_rows体系（复用现有）
├── mini_app_rows（合同版本数据）✅ 现有表
├── app_contract_v2_content（内容扩展）✅ Extension Table
└── app_contract_v2_rows（元数据扩展）✅ Extension Table
```

---

## 表1: contract_v2_org_nodes（组织树）

**用途**：管理组织层级（集团 → 甲方 → 项目）

**表结构**：
```sql
CREATE TABLE contract_v2_org_nodes (
  id VARCHAR(32) PRIMARY KEY COMMENT '节点ID',
  parent_id VARCHAR(32) NULL COMMENT '父节点ID（NULL表示顶级）',
  node_type ENUM('group', 'party', 'project') NOT NULL COMMENT '节点类型',
  name VARCHAR(128) NOT NULL COMMENT '节点名称',
  code VARCHAR(64) COMMENT '节点编码（如甲方简称）',
  full_name VARCHAR(255) COMMENT '完整路径名称（如：联想控股/联想北京/ThinkPad项目）',
  description TEXT COMMENT '节点描述',
  metadata JSON COMMENT '扩展信息',
  path VARCHAR(255) COMMENT '层级路径ID（如：/org001/org002/org003）',
  level INT DEFAULT 1 COMMENT '层级深度（1=集团, 2=甲方, 3=项目）',
  sort_order INT DEFAULT 0 COMMENT '同级排序',
  contract_count INT DEFAULT 0 COMMENT '合同数量（缓存）',
  is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
  created_by VARCHAR(32) COMMENT '创建人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_parent (parent_id),
  INDEX idx_type (node_type),
  INDEX idx_path (path),
  INDEX idx_level (level),
  INDEX idx_code (code),
  INDEX idx_active (is_active),
  
  FOREIGN KEY (parent_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同v2组织节点表';
```

**字段说明**：

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `id` | VARCHAR(32) | 节点唯一ID | org001 |
| `parent_id` | VARCHAR(32) | 父节点ID（树状结构） | NULL（顶级） |
| `node_type` | ENUM | 节点类型 | group/party/project |
| `name` | VARCHAR(128) | 节点名称 | 联想控股 |
| `code` | VARCHAR(64) | 节点编码 | LH001 |
| `full_name` | VARCHAR(255) | 完整路径名称 | 联想控股/联想北京/ThinkPad |
| `path` | VARCHAR(255) | 层级路径ID | /org001/org002/org003 |
| `level` | INT | 层级深度 | 1/2/3 |
| `contract_count` | INT | 合同数量（缓存） | 5 |

**数据示例**：
```
id=org001, parent_id=NULL, node_type=group, name="联想控股", level=1, path="/org001"
id=org002, parent_id=org001, node_type=party, name="联想北京", level=2, path="/org001/org002"
id=org003, parent_id=org002, node_type=project, name="ThinkPad X1", level=3, path="/org001/org002/org003"
```

---

## 表2: contract_v2_main_records（合同主记录）

**用途**：管理合同主记录（一个合同可能有多个版本）

**表结构**：
```sql
CREATE TABLE contract_v2_main_records (
  id VARCHAR(32) PRIMARY KEY COMMENT '合同主记录ID',
  org_node_id VARCHAR(32) NOT NULL COMMENT '所属组织节点',
  contract_name VARCHAR(128) NOT NULL COMMENT '合同名称',
  contract_type ENUM('strategy', 'development', 'supply', 'quality', 'nda', 'other') COMMENT '合同类型',
  contract_number VARCHAR(64) COMMENT '合同编号（主版本编号）',
  party_a VARCHAR(128) COMMENT '甲方',
  party_b VARCHAR(128) COMMENT '乙方（我方）',
  current_version_id VARCHAR(32) COMMENT '当前生效版本ID',
  version_count INT DEFAULT 0 COMMENT '版本总数',
  status ENUM('draft', 'active', 'expired', 'terminated') DEFAULT 'active' COMMENT '合同状态',
  effective_date DATE COMMENT '生效日期',
  expiry_date DATE COMMENT '失效日期',
  total_amount DECIMAL(15,2) COMMENT '合同总金额',
  currency VARCHAR(16) DEFAULT 'CNY' COMMENT '币种',
  keywords JSON COMMENT '关键词数组（用于检索）',
  tags JSON COMMENT '标签数组',
  metadata JSON COMMENT '扩展信息',
  created_by VARCHAR(32) COMMENT '创建人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_org_node (org_node_id),
  INDEX idx_type (contract_type),
  INDEX idx_status (status),
  INDEX idx_contract_number (contract_number),
  INDEX idx_party_a (party_a),
  INDEX idx_party_b (party_b),
  INDEX idx_effective_date (effective_date),
  INDEX idx_expiry_date (expiry_date),
  
  FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (current_version_id) REFERENCES contract_v2_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同v2主记录表';
```

**字段说明**：

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `id` | VARCHAR(32) | 合同主记录ID | contract001 |
| `org_node_id` | VARCHAR(32) | 所属组织节点 | org003（项目） |
| `contract_name` | VARCHAR(128) | 合同名称 | ThinkPad X1供货协议 |
| `contract_type` | ENUM | 合同类型 | supply |
| `current_version_id` | VARCHAR(32) | 当前版本ID | version002 |
| `version_count` | INT | 版本总数 | 2 |
| `status` | ENUM | 合同状态 | active |

**合同类型枚举说明**：

| 类型 | 说明 | 示例 |
|------|------|------|
| `strategy` | 战略合作协议 | 集团层级 |
| `development` | 共同开发协议 | 甲方层级 |
| `supply` | 供货协议 | 项目层级 |
| `quality` | 质量保证协议 | 甲方层级 |
| `nda` | 保密协议 | 任意层级 |
| `other` | 其他协议 | 任意层级 |

**数据示例**：
```
id=contract001, org_node_id=org003, contract_name="ThinkPad X1供货协议", 
contract_type="supply", version_count=2, status="active"
```

---

## 表3: contract_v2_versions（版本关联）

**用途**：管理合同版本（同一合同的多个版本）

**表结构**：
```sql
CREATE TABLE contract_v2_versions (
  id VARCHAR(32) PRIMARY KEY COMMENT '版本ID',
  contract_id VARCHAR(32) NOT NULL COMMENT '合同主记录ID',
  row_id VARCHAR(32) NOT NULL COMMENT 'mini_app_rows ID（合同版本数据）',
  version_number VARCHAR(16) NOT NULL COMMENT '版本号（如 v1.0, v2.0）',
  version_name VARCHAR(64) COMMENT '版本名称（如 初签版、补充版）',
  version_type ENUM('draft', 'signed', 'amendment', 'supplement') COMMENT '版本类型',
  effective_date DATE COMMENT '生效日期',
  expiry_date DATE COMMENT '失效日期',
  change_summary TEXT COMMENT '版本变更说明',
  is_current BIT(1) DEFAULT 0 COMMENT '是否当前生效版本',
  is_archived BIT(1) DEFAULT 0 COMMENT '是否已归档',
  signed_by VARCHAR(128) COMMENT '签署人',
  signed_at DATETIME COMMENT '签署时间',
  created_by VARCHAR(32) COMMENT '上传人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_contract_version (contract_id, version_number),
  INDEX idx_contract (contract_id),
  INDEX idx_row (row_id),
  INDEX idx_current (is_current),
  INDEX idx_effective_date (effective_date),
  
  FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id) ON DELETE CASCADE,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同v2版本关联表';
```

**字段说明**：

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `id` | VARCHAR(32) | 版本ID | version001 |
| `contract_id` | VARCHAR(32) | 合同主记录ID | contract001 |
| `row_id` | VARCHAR(32) | mini_app_rows ID | abc123（OCR数据） |
| `version_number` | VARCHAR(16) | 版本号 | v1.0 |
| `is_current` | BIT(1) | 是否当前版本 | 1 |

**版本类型枚举说明**：

| 类型 | 说明 |
|------|------|
| `draft` | 草案版本 |
| `signed` | 正式签署版 |
| `amendment` | 修订版 |
| `supplement` | 补充协议 |

**数据示例**：
```
id=version001, contract_id=contract001, row_id=abc123, version_number="v1.0", is_current=0
id=version002, contract_id=contract001, row_id=def456, version_number="v2.0", is_current=1
```

---

## 表关系图

```
contract_v2_org_nodes（组织树）
│
├── id=org001（集团）
│   └── contract_v2_main_records（合同主记录）
│       ├── id=contract001, org_node_id=org001
│       │   └── contract_v2_versions（版本）
│       │       ├── id=version001, contract_id=contract001, row_id=abc123, version="v1.0"
│       │       └── id=version002, contract_id=contract001, row_id=def456, version="v2.0"
│       │           └── mini_app_rows.id=def456（合同版本数据）
│       │               ├── data: { contract_number, party_a, ... }
│       │               └── app_contract_v2_content（内容扩展）
│       │                   └── row_id=def456, ocr_text, filtered_text, sections
│       │               └── app_contract_v2_rows（元数据扩展）
│       │                   └── row_id=def456, contract_number, party_a, amount
│
├── id=org002（甲方，parent_id=org001）
│   └── contract_v2_main_records
│       └── ...
│
└── id=org003（项目，parent_id=org002）
    └── contract_v2_main_records
        └── ...
```

---

## mini_app_rows体系（复用现有）

### 表4: mini_app_rows（合同版本数据）

**用途**：存储合同版本的OCR、提取、章节数据（现有表）

**关键字段**：
```sql
-- 现有表，不修改
CREATE TABLE mini_app_rows (
  id VARCHAR(32) PRIMARY KEY,
  app_id VARCHAR(32) NOT NULL,
  user_id VARCHAR(32),
  data JSON COMMENT '合同数据：contract_number, party_a, _ocr_text, _filtered_text, _sections',
  title VARCHAR(255),
  status VARCHAR(64) COMMENT 'pending_ocr, pending_extract, pending_review, confirmed',
  ...
);
```

**data字段内容**：
```json
{
  "contract_number": "HT-2026-001",
  "party_a": "联想控股",
  "party_b": "供应商A",
  "contract_amount": 1200000.00,
  "contract_date": "2026-01-15",
  "_ocr_text": "原始OCR文本...",
  "_filtered_text": "清洗后文本...",
  "_sections": [
    { "id": "sec-1", "title": "总则", "start_line": 0, "end_line": 50 }
  ]
}
```

---

### 表5: app_contract_v2_content（内容扩展表）

**用途**：存储合同版本的详细内容（Extension Table）

**表结构**：
```sql
CREATE TABLE app_contract_v2_content (
  row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
  ocr_text LONGTEXT COMMENT 'OCR 原文',
  filtered_text LONGTEXT COMMENT '过滤后文本',
  sections JSON COMMENT '章节结构数组',
  extract_prompt TEXT COMMENT '提取提示词',
  extract_json LONGTEXT COMMENT '提取的原始 JSON',
  extract_model VARCHAR(64) COMMENT '使用的模型',
  extract_temperature DECIMAL(3,2) COMMENT '模型温度',
  extract_at DATETIME COMMENT '提取时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同v2内容扩展表';
```

**说明**：
- Extension Table，必须关联 mini_app_rows
- 由专用handler `contract-v2-section` 写入
- 存储OCR原文、清洗文本、章节结构

---

### 表6: app_contract_v2_rows（元数据扩展表）

**用途**：存储合同版本的提取元数据（Extension Table）

**表结构**：
```sql
CREATE TABLE app_contract_v2_rows (
  row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
  contract_number VARCHAR(64) COMMENT '合同编号',
  party_a VARCHAR(128) COMMENT '甲方',
  parent_company VARCHAR(128) COMMENT '上级公司',
  contract_amount DECIMAL(15,2) COMMENT '合同金额',
  contract_date DATE COMMENT '签订日期',
  start_date DATE COMMENT '开始日期',
  end_date DATE COMMENT '结束日期',
  payment_terms TEXT COMMENT '付款条款',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_contract_number (contract_number),
  INDEX idx_party_a (party_a),
  INDEX idx_contract_amount (contract_amount),
  INDEX idx_contract_date (contract_date),
  
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同v2元数据扩展表';
```

**说明**：
- Extension Table，必须关联 mini_app_rows
- 由专用handler `contract-v2-extract` 写入
- 存储提取的结构化元数据

---

## 数据流转示例

### 用户上传合同版本

```
1. 上传合同文件
   POST /api/mini-apps/contract-mgr-v2/data
   → mini_app_rows 创建记录（row_id=abc123, status=pending_ocr）
   
2. App Clock自动处理
   pending_ocr → handler-submit-ocr（通用）
   ocr_submitted → handler-check-ocr（通用）
   pending_filter → handler-text-filter（通用）
   pending_extract → handler-extract（通用）
     → data字段写入：contract_number, party_a, ...
   pending_persist_extract → contract-v2-extract（专用）
     → app_contract_v2_rows 创建（row_id=abc123）
   pending_section → handler-text-section（通用）
     → data字段写入：_sections
   pending_persist_section → contract-v2-section（专用）
     → app_contract_v2_content 创建（row_id=abc123）
   pending_review → 等待用户确认
   
3. 用户关联到组织节点
   POST /api/contract-v2/contracts
   → contract_v2_main_records 创建（contract_id=contract001）
   → contract_v2_versions 创建（version_id=version001, row_id=abc123）
   
4. 上传第二个版本
   POST /api/mini-apps/contract-mgr-v2/data
   → mini_app_rows 创建（row_id=def456）
   → 重复步骤2
   → contract_v2_versions 创建（version_id=version002, row_id=def456）
   
5. 切换当前版本
   PUT /api/contract-v2/versions/version002
   → is_current=1（version002）
   → is_current=0（version001）
   → contract_v2_main_records.current_version_id=version002
```

---

## 索引设计要点

### 组织节点表索引

```sql
INDEX idx_parent (parent_id)      -- 查询子节点
INDEX idx_path (path)             -- 查询完整路径
INDEX idx_level (level)           -- 查询特定层级
INDEX idx_type (node_type)        -- 查询特定类型
INDEX idx_code (code)             -- 查询编码
```

### 合同主记录表索引

```sql
INDEX idx_org_node (org_node_id)      -- 查询节点下合同
INDEX idx_contract_number             -- 查询合同编号
INDEX idx_party_a (party_a)           -- 查询甲方
INDEX idx_status (status)             -- 查询状态
INDEX idx_effective_date              -- 查询生效日期
INDEX idx_expiry_date                 -- 查询失效日期
```

### 版本表索引

```sql
UNIQUE KEY uk_contract_version       -- 防止重复版本号
INDEX idx_contract (contract_id)      -- 查询合同版本列表
INDEX idx_row (row_id)                -- 查询row_id关联
INDEX idx_current (is_current)        -- 查询当前版本
```

---

## 总结

**表结构组织**：

**独立业务表**（3个）：
1. ✅ `contract_v2_org_nodes`（组织树）
2. ✅ `contract_v2_main_records`（合同主记录）
3. ✅ `contract_v2_versions`（版本关联）

**Extension Tables**（2个）：
4. ✅ `app_contract_v2_content`（内容扩展，关联mini_app_rows）
5. ✅ `app_contract_v2_rows`（元数据扩展，关联mini_app_rows）

**现有表复用**：
6. ✅ `mini_app_rows`（合同版本数据）

**数据体系分离**：
- 独立业务表：组织管理、合同主记录、版本管理
- Extension Tables：合同版本内容、元数据
- mini_app_rows体系：OCR、提取、章节流程

**下一步**：
- 确认表结构设计
- 开始编写 migrations/install.js