# 销售合同管理 v2.0 设计方案

> 创建时间：2026-04-29
> 作者：Maria
> Issue：#662（待创建）

## 一、需求分析

### 1.1 核心需求

| 需求项 | 当前版本 | v2.0目标 |
|--------|---------|---------|
| 组织层级 | 无（扁平化） | 三层树状：集团 → 甲方 → 项目 |
| 合同版本 | 单版本 | 多版本支持（同一合同可上传多个版本） |
| UI布局 | 单页列表 | 左侧树状导航 + 右侧清单 |
| 问答功能 | 无 | 支持多合同问答（跨合同检索） |

### 1.2 业务场景

**层级关系示例**：

```
联想控股（集团）
├── 联想北京（甲方）
│   ├── ThinkPad X1项目（项目）
│   │   └── 供货协议 v1.0
│   │   └── 供货协议 v2.0（补充版）
│   └── 共同开发协议 v1.0
├── 联想深圳（甲方）
│   └── 质量保证协议 v1.0
└── 战略合作协议 v1.0（集团层级）
```

**合同类型分布**：
- **集团层级**：战略合作协议、框架协议
- **甲方层级**：共同开发协议、质量保证协议、保密协议
- **项目层级**：供货协议、采购协议、技术协议

### 1.3 用户操作流程

```
用户 → 创建组织节点（集团/甲方/项目）
     → 在节点下上传合同
     → 系统自动OCR + 清洗 + 提取元数据
     → 用户确认入库
     → 可在节点下上传新版本（v2.0, v3.0...）
     → 选择多份合同进行问答
```

---

## 二、数据模型设计

### 2.1 新增表结构

#### 组织节点表 `contract_org_nodes`

```sql
CREATE TABLE contract_org_nodes (
  id VARCHAR(32) PRIMARY KEY,
  parent_id VARCHAR(32) NULL COMMENT '父节点ID（NULL表示顶级）',
  node_type ENUM('group', 'party', 'project') NOT NULL COMMENT '节点类型',
  name VARCHAR(128) NOT NULL COMMENT '节点名称',
  code VARCHAR(64) COMMENT '节点编码（如甲方简称）',
  description TEXT COMMENT '节点描述',
  metadata JSON COMMENT '扩展信息（如项目编号、甲方联系人）',
  path VARCHAR(255) COMMENT '层级路径（如 /集团ID/甲方ID）',
  level INT DEFAULT 1 COMMENT '层级深度（1=集团, 2=甲方, 3=项目）',
  sort_order INT DEFAULT 0 COMMENT '同级排序',
  is_active BIT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_parent (parent_id),
  INDEX idx_type (node_type),
  INDEX idx_path (path),
  FOREIGN KEY (parent_id) REFERENCES contract_org_nodes(id) ON DELETE CASCADE
);
```

#### 合同版本表 `contract_versions`

```sql
CREATE TABLE contract_versions (
  id VARCHAR(32) PRIMARY KEY,
  contract_id VARCHAR(32) NOT NULL COMMENT '合同主记录ID',
  version_number VARCHAR(16) NOT NULL COMMENT '版本号（如 v1.0, v2.0）',
  version_name VARCHAR(64) COMMENT '版本名称（如 初签版、补充版）',
  file_id VARCHAR(32) NOT NULL COMMENT '文件ID（mini_app_files.id）',
  row_id VARCHAR(32) NOT NULL COMMENT '行记录ID（mini_app_rows.id）',
  effective_date DATE COMMENT '生效日期',
  expiry_date DATE COMMENT '失效日期',
  change_summary TEXT COMMENT '版本变更说明',
  is_current BIT(1) DEFAULT 0 COMMENT '是否当前生效版本',
  created_by VARCHAR(32) COMMENT '上传人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_contract_version (contract_id, version_number),
  INDEX idx_contract (contract_id),
  INDEX idx_current (is_current),
  FOREIGN KEY (contract_id) REFERENCES contract_main_records(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES mini_app_files(id) ON DELETE CASCADE,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

#### 合同主记录表 `contract_main_records`

```sql
CREATE TABLE contract_main_records (
  id VARCHAR(32) PRIMARY KEY,
  org_node_id VARCHAR(32) NOT NULL COMMENT '所属组织节点',
  contract_name VARCHAR(128) NOT NULL COMMENT '合同名称',
  contract_type ENUM('strategy', 'development', 'supply', 'quality', 'nda', 'other') COMMENT '合同类型',
  party_b VARCHAR(128) COMMENT '乙方（我方）',
  current_version_id VARCHAR(32) COMMENT '当前生效版本ID',
  version_count INT DEFAULT 0 COMMENT '版本总数',
  status ENUM('draft', 'active', 'expired', 'terminated') DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_org_node (org_node_id),
  INDEX idx_type (contract_type),
  INDEX idx_status (status),
  FOREIGN KEY (org_node_id) REFERENCES contract_org_nodes(id) ON DELETE CASCADE
);
```

### 2.2 表关系图

```
contract_org_nodes (组织树)
├── contract_main_records (合同主记录)
│   └── contract_versions (版本列表)
│       └── mini_app_rows (行记录，含OCR/提取数据)
│           └── app_contract_mgr_content (内容详情)
│           └── app_contract_mgr_rows (提取元数据)
└── contract_qa_sessions (问答会话，未来功能)
```

---

## 三、功能模块拆解

### 3.1 组织管理模块

**功能**：
- 创建/编辑/删除组织节点（集团、甲方、项目）
- 拖拽调整层级关系
- 节点搜索与过滤
- 节点统计（合同数、版本数）

**API设计**：

```
POST   /api/contract/org-nodes           创建节点
GET    /api/contract/org-nodes/:id       获取节点详情
PUT    /api/contract/org-nodes/:id       更新节点
DELETE /api/contract/org-nodes/:id       删除节点（级联删除下级）
GET    /api/contract/org-nodes/tree      获取完整树状结构
GET    /api/contract/org-nodes/:id/stats 获取节点统计
```

### 3.2 合同管理模块（增强版）

**功能**：
- 在指定节点下创建合同
- 上传合同文件（触发OCR流程）
- 版本管理（添加新版本、切换当前版本）
- 合同列表查询（按节点、按类型、按状态）
- 合同详情查看（包含所有版本）

**API设计**：

```
POST   /api/contract/contracts                    创建合同
GET    /api/contract/contracts/:id                获取合同详情
PUT    /api/contract/contracts/:id                更新合同元数据
DELETE /api/contract/contracts/:id                删除合同（级联删除版本）
POST   /api/contract/contracts/:id/versions       添加新版本
GET    /api/contract/contracts/:id/versions       获取版本列表
PUT    /api/contract/contracts/:id/versions/:vid  设置当前版本
GET    /api/contract/contracts                    合同列表（支持节点过滤）
```

### 3.3 问答模块（新增）

**功能**：
- 选择多份合同（跨节点选择）
- 创建问答会话
- 对选定合同进行问答
- 问答历史记录
- 支持引用具体合同条款

**技术方案**：
- 使用知识库检索（向量搜索）
- 支持多合同上下文拼接
- 可选择问答模式（精准模式 vs 概括模式）

**API设计**：

```
POST   /api/contract/qa/sessions                  创建问答会话
GET    /api/contract/qa/sessions/:id              获取会话详情
POST   /api/contract/qa/sessions/:id/ask          提问
GET    /api/contract/qa/sessions/:id/history      获取问答历史
DELETE /api/contract/qa/sessions/:id              删除会话
```

---

## 四、UI设计方案

### 4.1 主界面布局

```
┌─────────────────────────────────────────────────────┐
│  [组织树]            [合同清单]                       │
├──────────────┬──────────────────────────────────────┤
│              │                                      │
│ □ 联想控股    │  合同列表（当前节点）                  │
│ ├─□ 北京基地  │  ┌─────────────────────────────────┐│
│ │ ├ ThinkPad │  │ 供货协议 v2.0  [查看] [问答]     ││
│ │ └ 质保协议  │  │ 共同开发协议 v1.0 [查看] [问答]  ││
│ ├─□ 深圳基地  │  │ 战略合作协议 v1.0 [查看] [问答]  ││
│ │ └...       │  └─────────────────────────────────┘│
│ └ 战略协议    │                                      │
│              │  [+新建合同] [+新建节点]               │
│              │                                      │
│              │  [多选问答] ← 选中多份合同后激活       │
├──────────────┴──────────────────────────────────────┤
│  状态栏：当前节点：联想控股 → 北京基地 → ThinkPad     │
└─────────────────────────────────────────────────────┘
```

### 4.2 详情页面

```
┌─────────────────────────────────────────────────────┐
│  合同详情：供货协议（ThinkPad项目）                    │
├─────────────────────────────────────────────────────┤
│  [基本信息] [版本历史] [原文内容] [问答记录]          │
├─────────────────────────────────────────────────────┤
│  版本列表：                                          │
│  ┌───────────────────────────────────────────────┐ │
│  │ v2.0（当前） 2026-01-15 生效  [查看原文]       │ │
│  │ v1.0         2025-12-01 历史  [查看原文]       │ │
│  │ v1.0草案     2025-11-15 草案  [查看原文]       │ │
│  └───────────────────────────────────────────────┘ │
│                                                     │
│  提取元数据：                                        │
│  合同编号：HT-2026-001                              │
│  甲方：联想北京                                      │
│  合同金额：1,200,000.00 元                           │
│  签订日期：2026-01-15                                │
│  开始日期：2026-02-01                                │
│  结束日期：2026-12-31                                │
│                                                     │
│  [+上传新版本]                                       │
└─────────────────────────────────────────────────────┘
```

### 4.3 问答界面

```
┌─────────────────────────────────────────────────────┐
│  合同问答（已选3份合同）                              │
│  ✅ 供货协议 v2.0                                    │
│  ✅ 质量保证协议 v1.0                                │
│  ✅ 共同开发协议 v1.0                                │
├─────────────────────────────────────────────────────┤
│  [精准模式] [概括模式]                               │
├─────────────────────────────────────────────────────┤
│  用户：这三份合同中关于质量标准的要求有什么不同？       │
│                                                     │
│  AI：根据分析，三份合同的质量标准要求差异如下：        │
│  - 供货协议 v2.0：要求产品合格率≥98%                  │
│  - 质量保证协议 v1.0：要求过程检验覆盖率≥95%          │
│  - 共同开发协议 v1.0：要求研发阶段测试通过率≥90%      │
│                                                     │
│  [引用：供货协议 v2.0 第5.2条]                        │
│  [引用：质量保证协议 v1.0 第3.1条]                    │
│                                                     │
│  [继续提问]                                          │
└─────────────────────────────────────────────────────┘
```

---

## 五、技术方案

### 5.1 前端组件

| 组件 | 用途 | 技术栈 |
|------|------|--------|
| OrgTree.vue | 组织树状导航 | Vue3 + Tree组件 |
| ContractList.vue | 合同清单 | Vue3 + Table组件 |
| ContractDetail.vue | 合同详情页 | Vue3 + Tab组件 |
| VersionManager.vue | 版本管理 | Vue3 + Upload组件 |
| QAInterface.vue | 问答界面 | Vue3 + Chat组件 |

### 5.2 后端架构

```
┌─────────────────────────────────────────┐
│ MiniAppService（现有）                    │
│ - 文件上传                                │
│ - OCR流程                                 │
│ - Handler调度                             │
├─────────────────────────────────────────┤
│ ContractService（新增）                   │
│ - 组织节点CRUD                            │
│ - 合同版本管理                            │
│ - 合同查询                                │
├─────────────────────────────────────────┤
│ ContractQAService（新增）                 │
│ - 多合同检索                              │
│ - 问答会话管理                            │
│ - 知识库集成                              │
└─────────────────────────────────────────┘
```

### 5.3 Handler调整

**现有Handler**（保持不变）：
- `handler-submit-ocr`
- `handler-check-ocr`
- `handler-text-filter`
- `handler-text-section`

**新增专用Handler**：
- `contract-extract`（已创建）
- `contract-section`（已创建）
- `contract-version-handler`（管理版本状态）

---

## 六、开发计划

### 6.1 阶段划分

| 阶段 | 内容 | 工期 |
|------|------|------|
| Phase 1 | 数据模型 + 组织管理API | 2天 |
| Phase 2 | 合同版本管理 + 现有流程集成 | 3天 |
| Phase 3 | UI组件开发（树状导航 + 清单） | 4天 |
| Phase 4 | 问答功能开发 | 3天 |
| Phase 5 | 测试 + 优化 + 文档 | 2天 |

**总计**：14天

### 6.2 优先级排序

1. **P0**：组织节点表 + 合同版本表（数据模型）
2. **P0**：组织管理API + 合同版本API
3. **P1**：前端树状导航组件
4. **P1**：前端合同详情页（含版本切换）
5. **P2**：问答功能（可后续迭代）

---

## 七、遗留问题

### 7.1 待确认事项

- [ ] 是否需要导入现有合同数据？（迁移脚本）
- [ ] 版本号命名规则？（v1.0 还是 2026-001）
- [ ] 是否需要合同模板功能？
- [ ] 问答是否需要保存历史？（会话持久化）
- [ ] 是否需要合同审批流程？

### 7.2 技术风险

- **树状结构性能**：节点数超过1000时查询性能（需索引优化）
- **多合同问答**：Token限制（需分块检索 + 摘要策略）
- **版本对比**：是否需要版本对比功能（Diff算法）

---

## 八、命名约定

### 8.1 数据库命名

- 表名：`contract_org_nodes`, `contract_versions`, `contract_main_records`
- 字段：snake_case（如 `org_node_id`, `version_number`）

### 8.2 API命名

- 路径：kebab-case（如 `/api/contract/org-nodes`）
- 参数：snake_case（如 `contract_type`）

### 8.3 前端组件

- 文件：PascalCase（如 `OrgTree.vue`）
- 变量：camelCase（如 `orgNodeId`）

---

## 九、下一步行动

1. 创建 Issue #662（v2.0需求）
2. 创建设计文档分支 `feature/662-contract-v2-design`
3. 提交设计文档评审
4. 确认遗留问题答案
5. 开始 Phase 1 开发

---

✌Bazinga！亲爱的