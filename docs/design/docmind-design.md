# 通用文档管理 (DocMind) - 产品设计文档

## 一、产品定位

**应用名称**: DocMind - 智能文档管理  
**App ID**: `docmind`  
**Slogan**: 通用文档智能识别与管理

**核心价值**: 
- 支持任意类型文档的 OCR 识别、元数据提取、章节分析
- 通用的文件夹分类系统，替代合同专用组织架构
- AI 生成的文档描述摘要，作为列表展示的核心字段

---

## 二、核心功能

| 功能模块 | 描述 |
|----------|------|
| 文件夹管理 | 多级嵌套文件夹，支持创建/重命名/删除/移动 |
| 文档上传 | 支持 PDF/DOCX/DOC/JPG/PNG，单文件或批量上传 |
| 版本管理 | 同一文档支持多版本，版本对比、设为当前 |
| AI 处理管道 | OCR → 文本过滤 → 元数据提取 → 章节分析 → 人工确认 |
| 文档列表 | 卡片式展示：名称 + AI 描述摘要 + 分类 + 版本数 + 更新时间 |
| 详情查看 | 文档内容查看 + 元数据编辑 + 版本历史 |
| 统计面板 | 按分类/状态/文件夹分布统计 |

---

## 三、数据模型设计

### 3.1 数据库表结构

```sql
-- 文件夹表 (替代原组织架构)
CREATE TABLE docmind_folders (
  id VARCHAR(32) PRIMARY KEY,
  parent_id VARCHAR(32) NULL,
  name VARCHAR(128) NOT NULL,
  path VARCHAR(255) COMMENT '层级路径',
  level INT DEFAULT 1,
  sort_order INT DEFAULT 0,
  is_active BIT(1) DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES docmind_folders(id) ON DELETE CASCADE
);

-- 文档主记录表
CREATE TABLE docmind_documents (
  id VARCHAR(32) PRIMARY KEY,
  folder_id VARCHAR(32) NOT NULL,
  document_name VARCHAR(128) NOT NULL,
  document_code VARCHAR(64) COMMENT '文档编号',
  category VARCHAR(64) COMMENT '分类：合同/发票/报告/简历/其他',
  description LONGTEXT COMMENT 'AI 生成的描述摘要',
  tags JSON COMMENT '标签数组',
  custom_fields JSON COMMENT '自定义扩展字段',
  current_version_id VARCHAR(32),
  version_count INT DEFAULT 0,
  status ENUM('draft','processing','completed','archived') DEFAULT 'draft',
  created_by VARCHAR(32),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (folder_id) REFERENCES docmind_folders(id) ON DELETE CASCADE
);

-- 版本表
CREATE TABLE docmind_versions (
  id VARCHAR(32) PRIMARY KEY,
  document_id VARCHAR(32) NOT NULL,
  row_id VARCHAR(32) NOT NULL,
  file_id VARCHAR(32),
  version_number VARCHAR(16) NOT NULL,
  version_name VARCHAR(64),
  version_type ENUM('draft','official','amendment','attachment'),
  version_status ENUM('draft','reviewing','approved','rejected','archived') DEFAULT 'draft',
  effective_date DATE,
  expiry_date DATE,
  change_summary TEXT,
  is_current BIT(1) DEFAULT 0,
  created_by VARCHAR(32),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_doc_version (document_id, version_number),
  FOREIGN KEY (document_id) REFERENCES docmind_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);

-- 内容扩展表 (OCR/文本/章节)
CREATE TABLE docmind_content (
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

-- 元数据扩展表 (可配置字段)
CREATE TABLE docmind_metadata (
  row_id VARCHAR(32) PRIMARY KEY,
  document_date DATE COMMENT '文档日期',
  author VARCHAR(128) COMMENT '作者/起草人',
  department VARCHAR(128) COMMENT '部门',
  source VARCHAR(128) COMMENT '来源',
  importance ENUM('high','normal','low') DEFAULT 'normal',
  custom_fields JSON COMMENT '用户自定义字段',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (row_id) REFERENCES mini_app_rows(id) ON DELETE CASCADE
);
```

### 3.2 manifest.json 字段定义

```json
{
  "id": "docmind",
  "name": "文档识别与管理",
  "version": "1.0.0",
  "description": "通用文档智能识别与管理，支持 OCR、元数据提取、章节分析",
  "icon": "📄",
  "type": "document",
  "fields": [
    { "name": "document_name", "label": "文档名称", "type": "text", "required": true },
    { "name": "document_code", "label": "文档编号", "type": "text" },
    { "name": "category", "label": "分类", "type": "select", "options": ["合同", "发票", "报告", "简历", "其他"] },
    { "name": "folder_id", "label": "所属文件夹", "type": "select" }
  ],
  "extension_tables": [
    { "name": "docmind_content", "type": "content", "fields": [...] },
    { "name": "docmind_metadata", "type": "metadata", "fields": [...] }
  ]
}
```

## 四、文件关联机制

### 4.1 核心关联链

```
docmind_documents (主记录)
    └── current_version_id → docmind_versions.id
                                └── row_id → mini_app_rows.id (运行时记录)
                                                    ├── data (JSON 元数据)
                                                    └── mini_app_files (关联 attachments)
                                                                            └── attachments (实际文件)
```

### 4.2 表关系说明

| 表 | 用途 | 关联键 |
|---|---|---|
| `docmind_documents` | 文档主记录 | id, folder_id, current_version_id |
| `docmind_versions` | 版本历史 | document_id, row_id |
| `mini_app_rows` | 运行时记录（系统表） | id (= row_id), app_id, status, data |
| `mini_app_files` | 记录-附件关联（系统表） | record_id → mini_app_rows.id, attachment_id |
| `attachments` | 实际文件（系统表） | id, file_name, file_path, mime_type |

### 4.3 上传流程

**现有平台统一上传方式 (base64):**

```
前端处理:
1. 用户选择文件 → 读取为 base64
2. 调用 uploadAttachment({ base64_data, file_name, mime_type, source_tag, source_id })
   → 后端保存文件到 ./data/attachments/，返回 attachment_id
3. 调用 createRecord(appId, {}, [attachment_id])
   → 创建 mini_app_rows 记录 + 关联 mini_app_files

后端处理:
4. 创建 docmind_documents 记录
5. 创建 docmind_versions 记录，row_id 指向步骤3的 mini_app_rows.id
6. AI 处理管道读取 mini_app_rows 的关联附件进行处理
```

**当前 API:**
```
POST /api/attachments
Body: {
  source_tag: 'mini_app_file',
  source_id: 'docmind',
  file_name: 'xxx.pdf',
  mime_type: 'application/pdf',
  base64_data: 'JVBERi0xLj...'  // 文件 base64 编码
}
```

**局限性 (未来可优化):**
- base64 编码会让文件体积增加 ~33%
- 大文件可能超出 HTTP 请求体限制
- 当前平台只有 `POST /api/attachments` (base64) 端点

**未来优化方案:**
```
1. 新增路由: POST /api/attachments/upload (FormData)
2. 新增 Controller 方法: uploadFormData() 使用 koa-multer
3. 前端改用 FormData 上传
```

**当前 MVP 阶段:** 复用现有 base64 上传方式，与 contract-mgr-v2 一致。

```javascript
// 1. 文件转 base64
const base64Data = await fileToBase64(file)

// 2. 上传附件
const att = await uploadAttachment({
  source_tag: 'mini_app_file',  // 固定值
  source_id: 'docmind',          // App ID
  file_name: file.name,
  mime_type: file.type,
  base64_data: base64Data,
})

// 3. 创建记录（自动关联附件）
const clientId = await newID(20)  // 生成 20 位 ID
const record = await createRecord('docmind', {}, [att.id], clientId)

// 4. 创建文��主记录
const doc = await createDocument({
  document_name: form.name,
  folder_id: form.folder_id,
  category: form.category,
})

// 5. 创建版本记录
await createVersion(doc.id, {
  row_id: record.id,      // 关联到 mini_app_rows
  file_id: att.id,        // 可选，冗余存储
  version_number: '1',
})
```

### 4.4 manifest 中的字段映射

```json
{
  "fields": [
    { "name": "document_name", "label": "文档名称", "type": "text", "required": true },
    { "name": "document_code", "label": "文档编号", "type": "text" },
    { "name": "category", "label": "分类", "type": "select" },
    { "name": "folder_id", "label": "所属文件夹", "type": "select" }
  ]
}
```

**注意**: 实际文件不存储在应用表中，而是通过 `mini_app_files` 关联到 `attachments` 表。这是平台的标准模式，所有 App 复用同一套附件机制。

---

## 五、UI 设计

### 5.1 整体布局

```
┌──────────────────────────────────────────────────────────┐
│  左侧边栏 (280px)        │     主内容区                  │
│  ┌────────────────────┐ │  ┌──────────────────────────┐ │
│  │ 📁 文件夹树         │ │  │ 🔍 搜索  类型筛选 文件夹 │ │
│  │                    │ │  ├──────────────────────────┤ │
│  │ ▼ 我的文档          │ │  │                          │ │
│  │   ├─ 合同           │ │  │  ┌──────────────────┐   │ │
│  │   ├─ 发票           │ │  │  │ 文档名称          │   │ │
│  │   └─ 报告           │ │  │  │ AI描述摘要...    │   │ │
│  │ ▶ 公司资料          │ │  │  │ 合同  3版本  2024│   │ │
│  │ ▶ 个人简历          │ │  │  └──────────────────┘   │ │
│  │                    │ │  │                          │ │
│  │ [+ 新建文件夹]     │ │  │  ┌──────────────────┐   │ │
│  └────────────────────┘ │  │  │ 另一个文档        │   │ │
│                         │  │  │ ...               │   │ │
│  ┌────────────────────┐ │  │  └──────────────────┘   │ │
│  │ 📊 统计概览         │ │  │                          │ │
│  │ 总文档: 128        │ │  └──────────────────────────┘ │
│  │ 待处理: 12         │ │                               │
│  └────────────────────┘ │                               │
└──────────────────────────────────────────────────────────┘
```

### 4.2 卡片展示

```
┌─────────────────────────────────────────────────────────┐
│ 年度采购框架协议                          📋 合同  3版本 │
│ 本合同约定甲方向乙方采购各类原材料，合同金额为...        │
│ 📅 2024-01-15  🏷️ 采购  💰 ¥500,000                     │
└─────────────────────────────────────────────────────────┘
```

**关键变化**:
- 移除 `party_a` / `party_b` 等合同特有字段
- 新增 `description` (AI 描述摘要) 作为核心展示字段
- 分类从固定枚举改为可配置

---

## 五、与合同应用的关系

| 维度 | 合同管理 (contract-mgr-v2) | 文档管理 (docmind) |
|------|---------------------------|-------------------|
| 定位 | 垂直领域 - 销售合同 | 通用场景 - 任意文档 |
| 文件夹 | 集团→甲方→项目 (固定) | 自定义多级文件夹 |
| 字段 | contract_number, party_a... | document_code, custom_fields |
| 描述 | 无 | AI 自动生成摘要 |
| 后续演进 | 保持现状 | 可扩展为文档平台 |

**建议**: 合同管理作为 `docmind` 的一个"分类"存在，长期可考虑将 contract-mgr-v2 的数据迁移至 docmind。

---

## 六、开发计划

### Phase 1: 基础框架 (MVP)
- [ ] 创建 app 骨架 (manifest, migrations)
- [ ] 文件夹管理 CRUD
- [ ] 文档上传与列表展示
- [ ] 复用 contract-mgr-v2 的 AI 处理管道

### Phase 2: 完善功能
- [ ] 版本管理
- [ ] 详情页与内容查看
- [ ] 统计面板

### Phase 3: 高级特性
- [ ] 自定义元数据字段模板
- [ ] AI Prompt 可配置
- [ ] 与其他应用的数据关联

---

## 七、命名规范

| 资源 | 命名规则 | 示例 |
|------|----------|------|
| App ID | kebab-case | `docmind` |
| 数据库表 | snake_case + 前缀 | `docmind_folders`, `docmind_documents` |
| 前端组件 | PascalCase | `DocMindView.vue`, `FolderTree.vue` |
| API 路由 | kebab-case | `/api/docmind/folders` |
| 状态名称 | snake_case | `pending_ocr`, `pending_extract` |

---

*亲爱的，以上是独立新建通用文档管理应用的产品设计文档，请审阅。✌Bazinga！*