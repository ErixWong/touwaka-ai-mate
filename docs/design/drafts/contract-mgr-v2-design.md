# 销售合同管理 v2.0 设计方案

> 创建时间：2026-04-29
> 作者：Maria
> Issue：#661
> App ID：`contract-mgr-v2`（新App，并行开发）

## 部署策略

**保持现有 App 不变**：
- `contract-mgr`（v1.0）继续运行，服务现有用户
- 现有 handler 不修改（`handler-text-filter`、`handler-extract` 等）

**创建新升级版 App**：
- `contract-mgr-v2` 作为独立 App 开发
- 使用专用 handler（`contract-v2-extract`、`contract-v2-section`）
- 完成测试后，用户可选择迁移或并行使用

**优势**：
- ✅ 无破坏性变更，现有业务不受影响
- ✅ 可并行测试，稳定后再推广
- ✅ 支持渐进式迁移（用户可自主选择）
- ✅ 失败可回滚（v1.0 仍然可用）

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

**注意**：以下表为 `contract-mgr-v2` App 专用，不影响现有 `contract-mgr` 的表。

#### 组织节点表 `contract_v2_org_nodes`

```sql
CREATE TABLE contract_v2_org_nodes (
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
  FOREIGN KEY (parent_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
);
```

#### 合同版本表 `contract_v2_versions`

```sql
CREATE TABLE contract_v2_versions (
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
  FOREIGN KEY (contract_id) REFERENCES contract_v2_main_records(id) ON DELETE CASCADE,
  FOREIGN KEY (file_id) REFERENCES mini_app_files(id) ON DELETE CASCADE,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

#### 合同主记录表 `contract_v2_main_records`

```sql
CREATE TABLE contract_v2_main_records (
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
  FOREIGN KEY (org_node_id) REFERENCES contract_v2_org_nodes(id) ON DELETE CASCADE
);
```

#### 合同内容扩展表 `app_contract_v2_content`（Extension Table）

```sql
CREATE TABLE app_contract_v2_content (
  row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
  ocr_text LONGTEXT COMMENT 'OCR 原文',
  filtered_text LONGTEXT COMMENT '过滤后文本',
  sections JSON COMMENT '章节结构数组',
  extract_prompt TEXT COMMENT '提取提示词',
  extract_json LONGTEXT COMMENT '提取的原始 JSON',
  extract_model VARCHAR(64) COMMENT '使用的模型',
  extract_at DATETIME COMMENT '提取时间',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

#### 合同元数据扩展表 `app_contract_v2_rows`（Extension Table）

```sql
CREATE TABLE app_contract_v2_rows (
  row_id VARCHAR(32) PRIMARY KEY COMMENT '关联 mini_app_rows.id',
  contract_number VARCHAR(64) COMMENT '合同编号',
  party_a VARCHAR(128) COMMENT '甲方',
  parent_company VARCHAR(128) COMMENT '上级公司',
  contract_amount DECIMAL(15,2) COMMENT '合同金额',
  contract_date DATE COMMENT '签订日期',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contract_number (contract_number),
  INDEX idx_party_a (party_a),
  INDEX idx_contract_amount (contract_amount),
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

### 2.2 表关系图

```
contract_v2_org_nodes (组织树)
├── contract_v2_main_records (合同主记录)
│   └── contract_v2_versions (版本列表)
│       └── mini_app_rows (行记录，含OCR/提取数据)
│           └── app_contract_v2_content (内容详情，v2专用)
│           └── app_contract_v2_rows (提取元数据，v2专用)
└── contract_v2_qa_sessions (问答会话，未来功能)
```

**与 v1.0 的表隔离**：
- `contract-mgr` 使用：`app_contract_mgr_content`、`app_contract_mgr_rows`
- `contract-mgr-v2` 使用：`app_contract_v2_content`、`app_contract_v2_rows`
- 组织管理表：`contract_v2_org_nodes`（v2独有）

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

**通用Handler**（保持不变，供 v1.0 使用）：
- `handler-submit-ocr`
- `handler-check-ocr`
- `handler-text-filter`
- `handler-extract`
- `handler-text-section`

**v2.0专用Handler**（新增，注册为新App专属）：
- `contract-v2-extract`：从 `mini_app_row.data` 读取提取结果，写入 `app_contract_v2_rows`
- `contract-v2-section`：从 `mini_app_row.data` 读取章节结构，写入 `app_contract_v2_content`
- `contract-v2-version`：管理版本状态（上传新版本、切换当前版本）
- `contract-v2-qa`：多合同问答检索（知识库召回）

**Handler注册方式**：
- App专属handler，通过安装流程自动注册
- ID格式：`contract-mgr-v2-handler-v2-extract`
- 路径：`apps/contract-mgr-v2/handlers/contract-v2-extract`

---

## 六、开发计划

### 6.1 App结构设计

**创建新 App**：`apps/contract-mgr-v2/`

**目录结构**：
```
apps/contract-mgr-v2/
├── manifest.json              # App配置（states、handlers、extension_tables）
├── handlers/                  # App专用handler
│   ├── contract-v2-extract/   # 提取数据持久化
│   ├── contract-v2-section/   # 章节结构持久化
│   ├── contract-v2-version/   # 版本管理
│   └── contract-v2-qa/        # 问答检索
├── migrations/                # 数据库迁移
│   ├── install.js             # 安装时创建表
│   └── uninstall.js           # 卸载时删除表
├── frontend/                  # 前端组件（可选）
│   └── OrgTreeView.vue        # 组织树组件
└── README.md                  # App说明
```

### 6.2 阶段划分

| 阶段 | 内容 | 工期 | App组件 |
|------|------|------|---------|
| Phase 1 | 数据模型 + 组织管理API | 2天 | migrations/install.js + backend API |
| Phase 2 | App manifest + 专用handler | 3天 | manifest.json + handlers/* |
| Phase 3 | 前端组件开发（树状导航 + 清单） | 4天 | frontend组件 + 集成到主App |
| Phase 4 | 问答功能开发 | 3天 | contract-v2-qa handler + 知识库集成 |
| Phase 5 | 测试 + 优化 + 文档 | 2天 | - |

**总计**：14天

### 6.3 数据迁移计划

**Phase 6（可选，后续迭代）**：

提供迁移工具，帮助用户从 v1.0 迁移到 v2.0：

```
scripts/migrate-contract-v1-to-v2.js
  - 读取 app_contract_mgr_rows 数据
  - 创建 contract_v2_org_nodes（根据甲方分组）
  - 创建 contract_v2_main_records（主记录）
  - 创建 contract_v2_versions（每个row一个版本）
  - 迁移 app_contract_v2_content 数据
  - 自动向量化到知识库
```

**迁移策略**：
- ✅ 用户自主选择迁移时间
- ✅ 迁移后 v1.0 数据保留（不删除）
- ✅ 提供迁移回滚工具
- ✅ 迁移过程中 v1.0 可继续使用

### 6.4 优先级排序

1. **P0**：创建新App `contract-mgr-v2`（manifest.json）
2. **P0**：数据模型迁移脚本（migrations/install.js）
3. **P0**：App专用handler（contract-v2-extract、contract-v2-section）
4. **P1**：组织管理API + 合同版本API
5. **P1**：前端树状导航组件
6. **P1**：前端合同详情页（含版本切换）
7. **P2**：问答功能（可后续迭代）
8. **P3**：数据迁移工具（可选）

---

## 七、架构关键决策

### 7.1 问题1：合同数据存储策略

**核心矛盾**：
- 合同管理需要业务数据（编号、金额、状态、版本）
- 问答功能需要向量化检索（知识库）
- 两者数据模型不兼容

**设计方案**：v2.0 使用独立表 + 独立知识库

```
┌──────────────────────────────────────────┐
│ contract_v2_main_records（v2业务数据）     │
│ - 合同编号、金额、状态                     │
│ - 组织节点、版本管理                       │
│ - 扩展表：contract_v2_versions            │
│           app_contract_v2_content         │
│           app_contract_v2_rows            │
├──────────────────────────────────────────┤
│ v2专用知识库（检索数据）                    │
│ knowledge_bases（contract-v2专用）         │
│ kb_articles（合同版本映射）                │
│ kb_sections（合同章节）                    │
│ kb_paragraphs（向量化段落）                │
└──────────────────────────────────────────┘
```

**与 v1.0 的隔离**：
- **v1.0 (`contract-mgr`)**：
  - 使用 `app_contract_mgr_content`、`app_contract_mgr_rows`
  - 通用 handler 直接写入这些表
  - 无组织层级、无版本管理
  
- **v2.0 (`contract-mgr-v2`)**：
  - 使用独立的 `app_contract_v2_*` 表
  - 专用 handler 写入 v2 表
  - 新增组织管理、版本管理
  - 自动创建合同知识库

**数据映射规则**：

| v2业务表 | 知识库表 | 映射关系 |
|---------|---------|---------|
| `contract_v2_versions.id` | `kb_articles.id` | 版本ID → 文章ID |
| `contract_v2_versions.version_number` | `kb_articles.title` | 版本号 → 文章标题 |
| `app_contract_v2_content.sections` | `kb_sections` | 章节映射（1:1） |
| `章节内段落` | `kb_paragraphs` | 段落向量化 |

**同步流程**：

```
用户上传合同版本（v2.0）
  ↓
OCR + 清洗 + 章节分析（通用handler）
  ↓
contract_v2_extract handler 写入 v2业务表
  ↓
contract_v2_section handler 写入 v2内容表
  ↓
后台向量化任务（异步）
  ↓
创建 kb_articles（合同版本）
创建 kb_sections（章节）
创建 kb_paragraphs + 向量化（段落）
  ↓
合同可被检索问答（v2专用知识库）
```

**v2专用Handler职责**：

| Handler | 职责 | 数据流向 |
|---------|------|---------|
| `contract-v2-extract` | 从 `mini_app_row.data` 读提取结果 | 写入 `app_contract_v2_rows` |
| `contract-v2-section` | 从 `mini_app_row.data` 读章节结构 | 写入 `app_contract_v2_content` |
| `contract-v2-version` | 版本管理（上传/切换） | 操作 `contract_v2_versions` |

**知识库自动创建**：
- 用户首次安装 `contract-mgr-v2` 时，自动创建专用知识库
- 知识库名称：`合同知识库（用户ID）`
- 每个用户一个独立的合同知识库，避免数据混淆

**优势**：
- ✅ v1.0 和 v2.0 完全隔离，可并行运行
- ✅ 用户可选择使用哪个版本
- ✅ v2.0 失败不影响 v1.0 用户
- ✅ 数据迁移可控（用户自主选择）

---
name: contract-qa
description: "合同问答技能。支持检索多份合同内容，回答合同相关问题。
             当用户询问合同条款、合同内容、合同对比时自动触发。"
argument-hint: "[search|compare] --query=xxx --contracts=xxx"
user-invocable: false
allowed-tools: []
---
```

**工具设计**：

#### tool 1: `contract_search`

```javascript
{
  contract_ids: string[],  // 合同ID数组（用户选择）
  query: string,           // 搜索查询
  top_k: number,           // 返回结果数量
  threshold: number        // 相似度阈值
}
```

返回：
```json
{
  "items": [
    {
      "contract_id": "contract_001",
      "contract_name": "供货协议 v2.0",
      "section": "第5.2条",
      "content": "产品质量标准...",
      "score": 0.85
    }
  ]
}
```

#### tool 2: `contract_context`

```javascript
{
  paragraph_id: string,    // 段落ID
  context_mode: "section"  // 扩展上下文模式
}
```

返回完整章节内容。

**用户操作流程**：

```
用户 → 在合同管理界面选择多份合同
     → 点击"问答"按钮
     → 创建新对话（或使用现有对话）
     → 系统注入合同上下文到对话
     → 用户提问："这几份合同的质量标准有什么不同？"
     → 专家调用 contract-qa 技能
     → contract_search 检索相关条款
     → 专家生成回答（引用具体条款）
```

**前端集成**：

```vue
<!-- ContractList.vue -->
<template>
  <div>
    <!-- 合同列表 -->
    <contract-item @select="toggleContract(contract)">
      <button @click="startQA">与专家对话</button>
    </contract-item>
    
    <!-- 多选后激活 -->
    <div v-if="selectedContracts.length > 0">
      <button @click="createQATopic">
        创建问答对话（已选{{ selectedContracts.length }}份）
      </button>
    </div>
  </div>
</template>

<script>
export default {
  methods: {
    async createQATopic() {
      // 1. 创建新对话
      const topic = await createTopic({
        expert_id: 'contract-expert',
        title: `合同问答（${selectedContracts.length}份）`
      });
      
      // 2. 注入合同上下文
      await injectContractContext({
        topic_id: topic.id,
        contract_ids: selectedContracts.map(c => c.id)
      });
      
      // 3. 跳转到对话页面
      router.push(`/chat/${topic.id}`);
    }
  }
}
</script>
```

**后台注入逻辑**：

```javascript
// ContractQAService.js
async injectContractContext(topicId, contractIds) {
  // 1. 获取合同基本信息
  const contracts = await ContractService.getContracts(contractIds);
  
  // 2. 创建系统消息（注入上下文）
  const systemMessage = {
    role: 'system',
    content: `当前对话关联以下合同：
      ${contracts.map(c => `
        - ${c.name} (${c.version_number})
          编号：${c.contract_number}
          甲方：${c.party_a}
          金额：${c.contract_amount}
      `).join('\n')}
      
      用户将针对这些合同提问，请使用 contract-qa 技能检索具体内容。`,
    topic_id: topicId
  };
  
  await MessageService.createMessage(systemMessage);
}
```

**优势**：
- ✅ 无缝融入专家对话体验
- ✅ 问答历史自然保存在对话中
- ✅ 用户无需理解"会话"概念
- ✅ 专家可基于对话上下文理解合同背景

### 7.3 其他遗留问题

- [ ] 是否需要导入现有合同数据？（迁移脚本）
- [ ] 版本号命名规则？（v1.0 还是 2026-001）
- [ ] 是否需要合同模板功能？
- [ ] 是否需要合同审批流程？
- [ ] 合同知识库是否需要独立权限管理？

### 7.4 技术风险

- **树状结构性能**：节点数超过1000时查询性能（需索引优化）
- **多合同问答**：Token限制（需分块检索 + 摘要策略）
- **版本对比**：是否需要版本对比功能（Diff算法）
- **数据同步**：业务数据与知识库同步失败处理（需补偿机制）

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

## 九、App部署流程

### 9.1 安装新App

**用户视角**：
```
用户登录 → 进入App Market
        → 看到"销售合同管理 v2.0"
        → 点击"安装"
        → 系统自动：
           1. 创建 contract_v2_* 表
           2. 注册专用handler
           3. 创建合同知识库
           4. 配置states流程
```

**管理员视角**：
```bash
# 发布新App到Registry
node scripts/publish-app.js apps/contract-mgr-v2

# 安装测试
node scripts/init-contract-v2-app.js
```

### 9.2 使用新App

**用户操作流程**：
```
1. 进入"销售合同管理 v2.0"
2. 创建组织节点（集团 → 甲方 → 项目）
3. 在节点下上传合同
4. 系统自动执行：
   - OCR（通用handler）
   - 清洗（通用handler）
   - 提取（通用handler）
   - 持久化（v2专用handler）
   - 向量化（后台任务）
5. 用户确认入库
6. 选择多份合同 → 与专家对话
```

### 9.3 v1.0与v2.0并行运行

**场景**：
- 管理员A继续使用 `contract-mgr`（v1.0）
- 管理员B使用 `contract-mgr-v2`（v2.0）
- 两者的数据完全隔离

**数据库状态**：
```
app_contract_mgr_content（v1.0数据）
app_contract_mgr_rows（v1.0数据）

app_contract_v2_content（v2.0数据）
app_contract_v2_rows（v2.0数据）
contract_v2_org_nodes（v2.0组织树）
contract_v2_main_records（v2.0合同主记录）
contract_v2_versions（v2.0版本管理）
```

### 9.4 迁移时机

**建议时机**：
- ✅ v2.0稳定运行1个月后
- ✅ 组织有明确的层级管理需求
- ✅ 需要多合同问答功能
- ✅ 新项目优先使用v2.0

**不迁移的场景**：
- ❌ 现有流程已满足需求
- ❌ 合同数量少（<50份）
- ❌ 无组织层级管理需求

---

## 十、下一步行动

1. ✅ 设计文档已创建（本文档）
2. ⏭ 创建 App目录结构 `apps/contract-mgr-v2/`
3. ⏭ 编写 manifest.json（states + handlers配置）
4. ⏭ 编写 migrations/install.js（数据模型）
5. ⏭ 创建专用handler目录
6. ⏭ 开始 Phase 1 开发

**Issue链接**：
- #661（设计文档）
- 待创建：#662（开发任务）

---

✌Bazinga！亲爱的