# 组织层级数据存储方案讨论

> Issue: #665
> 时间: 2026-04-29

## 核心问题

组织层级管理的数据放哪里？

---

## 方案对比

### ❌ 方案1：放在 mini_app_rows

**问题**：
- mini_app_rows 是用于合同记录（上传的文件）
- 组织节点不是合同记录，不应该放入 mini_app_rows
- 组织节点是独立的业务实体（集团、甲方、项目）
- 概念不匹配：组织节点 vs 合同记录

**示例**：
```
mini_app_rows:
  - row_id: abc123（合同版本）
  - data: { contract_number: "HT-001", ... }

❌ 不能这样：
mini_app_rows:
  - row_id: org001（组织节点）❌
  - data: { node_type: "group", name: "联想控股" }❌
```

---

### ❌ 方案2：放在 extension_tables

**问题**：
- extension_tables 是 mini_app_rows 的扩展表
- 每条记录必须有 row_id 外键关联 mini_app_rows
- 组织节点不需要关联 mini_app_rows
- 概念不匹配：扩展表依赖主表

**示例**：
```sql
❌ 不能这样：
CREATE TABLE app_contract_v2_org_nodes (
  row_id VARCHAR(32) PRIMARY KEY,  ❌ 不应该关联 mini_app_rows
  parent_id VARCHAR(32),
  ...
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id)  ❌
);
```

---

### ✅ 方案3：创建独立业务表（推荐）

**设计**：
- 组织节点表作为**独立业务表**
- 不属于 mini_app_rows 体系
- 有独立的API和CRUD操作
- 与合同记录分离

**表结构**：
```sql
CREATE TABLE contract_v2_org_nodes (
  id VARCHAR(32) PRIMARY KEY,  ✅ 独立主键，不依赖 mini_app_rows
  parent_id VARCHAR(32) NULL,
  node_type ENUM('group', 'party', 'project') NOT NULL,
  name VARCHAR(128) NOT NULL,
  code VARCHAR(64),
  description TEXT,
  metadata JSON,
  path VARCHAR(255),  ✅ 层级路径（如 /集团ID/甲方ID）
  level INT DEFAULT 1,  ✅ 层级深度（1=集团, 2=甲方, 3=项目）
  sort_order INT DEFAULT 0,
  is_active BIT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_path (path),
  INDEX idx_type (node_type),
  FOREIGN KEY (parent_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
);
```

**数据示例**：
```
contract_v2_org_nodes:
  - id: org001, parent_id: NULL, node_type: "group", name: "联想控股", level: 1
  - id: org002, parent_id: org001, node_type: "party", name: "联想北京", level: 2
  - id: org003, parent_id: org002, node_type: "project", name: "ThinkPad X1", level: 3
```

---

## 数据体系分离

### contract-mgr-v2 的数据体系

```
┌─────────────────────────────────────────┐
│ mini_app_rows 体系（合同记录）            │
│ - mini_app_rows（合同版本）               │
│ - app_contract_v2_content（扩展表）       │
│ - app_contract_v2_rows（扩展表）          │
│ → 通过 MiniAppService 管理                │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 独立业务表体系（组织管理）                 │
│ - contract_v2_org_nodes（组织树）         │
│ - contract_v2_main_records（合同主记录）  │
│ - contract_v2_versions（版本关联）        │
│ → 通过 ContractService 管理（新增）       │
└─────────────────────────────────────────┘
```

---

## API设计差异

### mini_app_rows API（现有）

```
GET    /api/mini-apps/:appId/data           合同版本列表
POST   /api/mini-apps/:appId/data           上传合同文件
PUT    /api/mini-apps/:appId/data/:rowId    更新合同版本
DELETE /api/mini-apps/:appId/data/:rowId    删除合同版本
```

**用途**：管理合同版本（OCR、提取、章节分析流程）

---

### 组织管理 API（新增）

```
POST   /api/contract-v2/org-nodes           创建组织节点
GET    /api/contract-v2/org-nodes/:id       获取节点详情
PUT    /api/contract-v2/org-nodes/:id       更新节点
DELETE /api/contract-v2/org-nodes/:id       删除节点（级联）
GET    /api/contract-v2/org-nodes/tree      获取完整树
GET    /api/contract-v2/org-nodes/:id/stats 统计节点合同数
```

**用途**：管理组织层级（集团、甲方、项目）

**路由归属**：
- 新增 `server/routes/contract-v2.routes.js`
- 新增 `server/controllers/contract-v2.controller.js`
- 新增 `server/services/contract-v2.service.js`

---

## 数据关联关系

### 组织节点 → 合同主记录

```sql
CREATE TABLE contract_v2_main_records (
  id VARCHAR(32) PRIMARY KEY,
  org_node_id VARCHAR(32) NOT NULL,  ✅ 关联组织节点
  contract_name VARCHAR(128),
  ...
  FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id)
);
```

### 合同主记录 → 合同版本

```sql
CREATE TABLE contract_v2_versions (
  id VARCHAR(32) PRIMARY KEY,
  contract_id VARCHAR(32) NOT NULL,  ✅ 关联合同主记录
  row_id VARCHAR(32) NOT NULL,       ✅ 关联 mini_app_rows（合同版本）
  version_number VARCHAR(16),
  ...
  FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id),
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id)
);
```

---

## 数据流转示例

### 用户操作流程

```
1. 创建组织节点
   POST /api/contract-v2/org-nodes
   → 创建 "联想控股"（集团）
   → 创建 "联想北京"（甲方，parent_id=集团ID）
   → 创建 "ThinkPad X1"（项目，parent_id=甲方ID）

2. 上传合同文件
   POST /api/mini-apps/contract-mgr-v2/data
   → mini_app_rows 创建一条记录（合同版本）
   → App Clock 触发 OCR → 提取 → 章节流程
   → 状态变为 pending_review

3. 关联到组织节点
   POST /api/contract-v2/contracts
   → 创建 contract_v2_main_records（合同主记录）
   → 创建 contract_v2_versions（版本关联）
   → org_node_id = "ThinkPad X1" 的 ID
   → row_id = mini_app_rows 的 ID

4. 查看合同清单
   GET /api/contract-v2/org-nodes/:nodeId/contracts
   → 返回该节点下的所有合同
```

---

## 表关系图

```
contract_v2_org_nodes（组织树，独立表）
├── id: org001（集团）
│   └── contract_v2_main_records（合同主记录）
│       └── contract_v2_versions（版本关联）
│           └── mini_app_rows.row_id（合同版本）
│               └── app_contract_v2_content（扩展表）
│               └── app_contract_v2_rows（扩展表）
├── id: org002（甲方，parent_id=org001）
│   └── contract_v2_main_records
└── id: org003（项目，parent_id=org002）
    └── contract_v2_main_records
```

---

## 总结

**组织层级数据存储方案**：

✅ **方案3：创建独立业务表 contract_v2_org_nodes**

**理由**：
1. 组织节点不是合同记录，不应放入 mini_app_rows
2. 组织节点不需要关联 mini_app_rows（概念不匹配）
3. 独立业务表支持树状结构（parent_id, path, level）
4. 独立API管理（不通过 MiniAppService）

**数据体系**：
- mini_app_rows体系：合同版本（OCR、提取流程）
- 独立业务表体系：组织节点、合同主记录、版本关联

**下一步**：
- 确认方案3
- 开始 Phase 1 开发（含 contract_v2_org_nodes 表）