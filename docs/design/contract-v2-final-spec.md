# 合同管理 v2 最终设计规格

> 创建时间：2026-05-03
> 作者：Maria
> 状态：已定稿

## 决策记录

| # | 决策项 | 结论 | 理由 |
|---|--------|------|------|
| 1 | 表名 | `contract_v2_main_records` | 用户确认 |
| 2 | Handler 层数 | 4层（ocr + filter + extract + section） | 每层都有持久化 |
| 3 | 上传流程 | 直接处理，无AI匹配 | 谁上传谁处理 |
| 4 | Dashboard | 纳入 Phase 1 | 用户确认 |
| 5 | contract_type 枚举 | 9种（strategy/framework/development/supply/purchase/quality/nda/technical/other） | 完整覆盖 |
| 6 | 元数据归属 | main_records 存类目信息，version 存版本级字段，extension 存提取数据 | 三层分离 |

---

## 数据库表（5张）

### 1. contract_v2_org_nodes（组织树）

```sql
CREATE TABLE contract_v2_org_nodes (
  id VARCHAR(32) PRIMARY KEY,
  parent_id VARCHAR(32) NULL,
  node_type ENUM('group', 'party', 'project') NOT NULL,
  name VARCHAR(128) NOT NULL,
  path VARCHAR(255),
  level INT DEFAULT 1,
  sort_order INT DEFAULT 0,
  is_active BIT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_type (node_type),
  INDEX idx_path (path),
  INDEX idx_level (level),
  FOREIGN KEY (parent_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
);
```

### 2. contract_v2_main_records（合同主记录/类目）

```sql
CREATE TABLE contract_v2_main_records (
  id VARCHAR(32) PRIMARY KEY,
  org_node_id VARCHAR(32) NOT NULL,
  contract_name VARCHAR(128) NOT NULL,
  contract_type ENUM('strategy','framework','development','supply','purchase','quality','nda','technical','other'),
  current_version_id VARCHAR(32),
  version_count INT DEFAULT 0,
  status ENUM('draft','active','expired','terminated') DEFAULT 'active',
  created_by VARCHAR(32),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_org_node (org_node_id),
  INDEX idx_type (contract_type),
  INDEX idx_status (status),
  FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
);
```

### 3. contract_v2_versions（合同版本）

```sql
CREATE TABLE contract_v2_versions (
  id VARCHAR(32) PRIMARY KEY,
  contract_id VARCHAR(32) NOT NULL,
  row_id VARCHAR(32) NOT NULL,
  file_id VARCHAR(32),
  version_number VARCHAR(16) NOT NULL,
  version_name VARCHAR(64),
  version_type ENUM('draft','signed','amendment','supplement'),
  version_status ENUM('draft','reviewing','approved','rejected','archived') DEFAULT 'draft',
  effective_date DATE,
  expiry_date DATE,
  contract_number VARCHAR(64),
  party_a VARCHAR(128),
  party_b VARCHAR(128),
  total_amount DECIMAL(15,2),
  change_summary TEXT,
  is_current BIT(1) DEFAULT 0,
  created_by VARCHAR(32),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_contract_version (contract_id, version_number),
  INDEX idx_contract (contract_id),
  INDEX idx_row (row_id),
  INDEX idx_current (is_current),
  INDEX idx_status (version_status),
  FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id) ON DELETE CASCADE,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

### 4. app_contract_v2_content（Extension Table）

```sql
CREATE TABLE app_contract_v2_content (
  row_id VARCHAR(32) PRIMARY KEY,
  ocr_text LONGTEXT,
  ocr_service VARCHAR(64),
  ocr_at DATETIME,
  filtered_text LONGTEXT,
  filter_at DATETIME,
  sections JSON,
  extract_prompt TEXT,
  extract_json LONGTEXT,
  extract_model VARCHAR(64),
  extract_temperature DECIMAL(3,2),
  extract_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

### 5. app_contract_v2_rows（Extension Table）

```sql
CREATE TABLE app_contract_v2_rows (
  row_id VARCHAR(32) PRIMARY KEY,
  contract_number VARCHAR(64),
  party_a VARCHAR(128),
  parent_company VARCHAR(128),
  contract_amount DECIMAL(15,2),
  contract_date DATE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contract_number (contract_number),
  INDEX idx_party_a (party_a),
  INDEX idx_contract_amount (contract_amount),
  INDEX idx_contract_date (contract_date),
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

---

## 状态机（5个处理状态 + 2个终态 + 错误状态）

```
pending_ocr → handler-submit-ocr → ocr_submitted
ocr_submitted → contract-v2-check-ocr → pending_filter
pending_filter → contract-v2-text-filter → pending_extract
pending_extract → contract-v2-llm-extract → pending_section
pending_section → contract-v2-text-section → pending_review
pending_review → (用户确认) → confirmed

错误状态: ocr_failed, filter_failed, extract_failed, section_failed
```

> **设计原则**：每个 handler 直接读写扩展表，业务数据不经过 `record.data`（`mini_app_rows.data`）中转。
> `record.data` 仅存小标记（`_ocr_done`, `_filter_done` 等）。

---

## Handler 分工

| Handler | 类型 | 读 | 写 |
|---------|------|----|----|
| handler-submit-ocr | 共享 | record.data | MCP提交 |
| contract-v2-check-ocr | v2专用 | MCP结果 | app_contract_v2_content.ocr_text |
| contract-v2-text-filter | v2专用 | app_contract_v2_content.ocr_text | app_contract_v2_content.filtered_text |
| contract-v2-llm-extract | v2专用 | app_contract_v2_content.filtered_text | app_contract_v2_rows + app_contract_v2_content |
| contract-v2-text-section | v2专用 | app_contract_v2_content.filtered_text | app_contract_v2_content.sections |

---

## API 端点

### 组织管理
- `POST   /api/contract-v2/org-nodes` 创建节点
- `GET    /api/contract-v2/org-nodes/tree` 获取完整树
- `GET    /api/contract-v2/org-nodes/:id` 获取节点详情
- `PUT    /api/contract-v2/org-nodes/:id` 更新节点
- `DELETE /api/contract-v2/org-nodes/:id` 删除节点
- `GET    /api/contract-v2/org-nodes/:id/stats` 节点统计

### 合同管理
- `POST   /api/contract-v2/contracts` 创建合同
- `GET    /api/contract-v2/contracts` 合同列表（支持org_node_id过滤）
- `GET    /api/contract-v2/contracts/:id` 合同详情（含版本列表）
- `PUT    /api/contract-v2/contracts/:id` 更新合同
- `DELETE /api/contract-v2/contracts/:id` 删除合同

### 版本管理
- `POST   /api/contract-v2/contracts/:id/versions` 上传新版本
- `GET    /api/contract-v2/contracts/:id/versions` 版本列表
- `PUT    /api/contract-v2/versions/:versionId` 更新版本
- `PUT    /api/contract-v2/versions/:versionId/approve` 审批通过
- `PUT    /api/contract-v2/versions/:versionId/current` 设为当前版本
- `DELETE /api/contract-v2/versions/:versionId` 删除版本

### Dashboard
- `GET    /api/contract-v2/dashboard` Dashboard统计数据

---

## Phase 1 实施范围

1. App 结构 + manifest.json（5个处理状态 + 2个终态 + 4个错误状态）
2. 数据库迁移（5张表）
3. 5个v2专用Handler（每个直接读写扩展表）
4. 后端API路由（组织 + 合同 + 版本 + Dashboard，写操作 requireAdmin）
5. 前端组件（组织树 + 合同列表 + 合同详情 + Dashboard）
