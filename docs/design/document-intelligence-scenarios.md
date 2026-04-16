# 文档智能场景设计方案

> 基于现有知识库系统，扩展支持合同验证、版本对比、文档生命周期管理、元数据提取、发票入库等场景

> ⚠️ **架构升级**：本文档中的场景已整合到 **App 平台** 架构中，详见 [`app-platform-design.md`](app-platform-design.md)。
> 新方案采用"App-first"理念，在顶部导航新增"App"菜单，通过小程序容器托管各场景，共享 AI/MCP 能力。
> 本文档保留作为各场景的详细业务流程和技术细节参考。

---

## 1. 场景概述

| 场景 | 描述 | 核心能力 | 与现有知识库的关系 |
|------|------|----------|-------------------|
| **A. 合同完备性验证** | 比对合同模板与提交合同，检测条款缺漏 | 模板对比 + 结构化解析 | 可复用文档解析能力 |
| **B. 文档版本差异** | 对比合同1.0与1.1版本，识别修改内容 | 版本对比 + 差异标注 | 新能力，需独立设计 |
| **C. 文档生命周期** | 管理质量体系文档的有效期和生效版本 | 版本追踪 + 状态管理 | 扩展知识库元数据 |
| **D. 合同元数据提取** | 批量提取100+份合同的元数据 | OCR/解析 + 结构化提取 | 类似发票处理流程 |
| **E. 发票批量入库** | OCR识别发票，按模板存入数据库 | OCR + 模板匹配 + 入库 | 已有fapiao技能基础 |

---

## 2. 现有资源盘点

### 2.1 已部署服务

| 服务 | 能力 | 接入方式 | 适用场景 |
|------|------|----------|----------|
| **markitdown** | OCR识别、文档转Markdown | MCP / API | D, E |
| **mineru** | PDF深度解析、结构化提取 | MCP / API | A, B, D |
| **fapiao技能** | 发票结构化提取（坐标解析） | Skill | E |

### 2.2 现有系统能力

| 系统 | 能力 | 可复用点 |
|------|------|----------|
| **知识库** | 向量存储、语义搜索、段落管理 | 文档解析流程、存储结构 |
| **MCP Client** | 外部服务集成、工具调用 | markitdown/mineru接入 |
| **附件服务** | 文件存储、Token访问 | 文档上传、预览 |

---

## 3. 场景A：合同完备性验证

### 3.1 业务流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        合同完备性验证流程                                      │
└─────────────────────────────────────────────────────────────────────────────┘

1. 定义模板
   ┌──────────────┐
   │ 管理员       │ 创建销售合同模板，定义必需条款清单
   │              │ - 条款名称
   │              │ - 条款内容要点
   │              │ - 是否必需
   └──────┬───────┘
          │
          ▼
2. 存储模板
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ contract_templates 表                                                     │
   │                                                                          │
   │ id | name | type | clauses (JSON) | created_at                           │
   │                                                                          │
   │ clauses 结构:                                                            │
   │ [                                                                        │
   │   { "name": "付款条款", "required": true, "keywords": ["付款", "支付"] }, │
   │   { "name": "交付条款", "required": true, "keywords": ["交付", "交货"] }, │
   │   { "name": "违约责任", "required": true, "keywords": ["违约", "赔偿"] }, │
   │   ...                                                                    │
   │ ]                                                                        │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
3. 提交合同验证
   ┌──────────────┐
   │ 用户         │ 上传合同文件（PDF/Word）
   │              │ 选择模板类型："销售合同"
   └──────┬───────┘
          │
          ▼
4. 文档解析
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ mineru / markitdown                                                       │
   │                                                                          │
   │ 输入: 合同文件                                                            │
   │ 输出: 结构化内容（Markdown + 段落划分）                                    │
   │                                                                          │
   │ 关键步骤:                                                                 │
   │ - 提取文档结构（章节、条款）                                              │
   │ - 识别条款标题和内容                                                      │
   │ - 标注段落位置                                                            │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
5. AI比对分析
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ LLM 分析                                                                  │
   │                                                                          │
   │ 输入:                                                                     │
   │ - 模板条款清单                                                            │
   │ - 合同解析内容                                                            │
   │                                                                          │
   │ 输出:                                                                     │
   │ - 匹配结果：每个模板条款是否在合同中存在                                   │
   │ - 缺漏清单：必需但缺失的条款                                              │
   │ - 内容差异：条款内容与模板要求的差异                                       │
   │                                                                          │
   │ Prompt 示例:                                                              │
   │ """                                                                       │
   │ 你是合同审核专家。请根据以下模板条款清单，检查合同内容是否完备。            │
   │                                                                          │
   │ 模板条款:                                                                 │
   │ 1. 付款条款（必需）- 应包含付款方式、付款时间、付款比例                    │
   │ 2. 交付条款（必需）- 应包含交付时间、交付方式、验收标准                    │
   │ ...                                                                       │
   │                                                                          │
   │ 合同内容:                                                                 │
   │ {解析后的合同内容}                                                        │
   │                                                                          │
   │ 请输出:                                                                   │
   │ 1. 每个条款的匹配状态（存在/缺失/部分存在）                                │
   │ 2. 缺失条款的风险等级                                                     │
   │ 3. 建议补充的内容                                                         │
   │ """                                                                       │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
6. 输出报告
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 验证报告                                                                  │
   │                                                                          │
   │ {                                                                        │
   │   "template_name": "销售合同标准模板",                                    │
   │   "contract_file": "销售合同_2026_001.pdf",                               │
   │   "verification_result": {                                               │
   │     "total_clauses": 12,                                                 │
   │     "matched": 10,                                                       │
   │     "missing": 2,                                                        │
   │     "partial": 1                                                         │
   │   },                                                                     │
   │   "missing_clauses": [                                                   │
   │     { "name": "违约责任", "required": true, "risk": "高" },              │
   │     { "name": "保密条款", "required": false, "risk": "低" }              │
   │   ],                                                                     │
   │   "recommendations": [                                                   │
   │     "建议添加违约责任条款，明确违约情形和赔偿标准",                        │
   │     "建议补充保密条款，保护商业信息"                                      │
   │   ]                                                                      │
   │ }                                                                        │
   └──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据库设计

```sql
-- 合同模板表
CREATE TABLE contract_templates (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL COMMENT '模板名称',
  type VARCHAR(32) NOT NULL COMMENT '合同类型：sales/purchase/service/etc',
  description TEXT COMMENT '模板描述',
  clauses JSON NOT NULL COMMENT '条款清单',
  version INT DEFAULT 1 COMMENT '模板版本',
  is_active BIT(1) DEFAULT b'1' COMMENT '是否启用',
  created_by VARCHAR(32) COMMENT '创建者',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 合同验证记录表
CREATE TABLE contract_verifications (
  id VARCHAR(32) PRIMARY KEY,
  template_id VARCHAR(32) NOT NULL COMMENT '使用的模板ID',
  contract_file VARCHAR(256) NOT NULL COMMENT '合同文件路径',
  contract_name VARCHAR(128) COMMENT '合同名称',
  verification_result JSON COMMENT '验证结果',
  missing_clauses JSON COMMENT '缺失条款',
  recommendations JSON COMMENT '建议内容',
  verified_by VARCHAR(32) COMMENT '验证者',
  verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (template_id) REFERENCES contract_templates(id)
);
```

### 3.3 技术实现要点

| 要点 | 实现方案 |
|------|----------|
| **文档解析** | 通过 MCP Client 调用 mineru/markitdown，获取结构化内容 |
| **条款识别** | LLM 分析 + 关键词匹配双重验证 |
| **模板管理** | 前端界面支持模板创建、条款编辑 |
| **报告生成** | Markdown 格式报告，支持导出 PDF |

---

## 4. 场景B：文档版本差异对比

### 4.1 业务流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        文档版本差异对比流程                                    │
└─────────────────────────────────────────────────────────────────────────────┘

1. 上传版本
   ┌──────────────┐     ┌──────────────┐
   │ 合同 v1.0    │     │ 合同 v1.1    │
   │ (基准版本)   │     │ (新版本)     │
   └──────┬───────┘     └──────┬───────┘
          │                    │
          ▼                    ▼
2. 文档解析
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ mineru 解析                                                               │
   │                                                                          │
   │ 输出:                                                                     │
   │ - 文档结构（章节树）                                                      │
   │ - 段落内容（按位置索引）                                                  │
   │ - 段落哈希（用于快速比对）                                                │
   │                                                                          │
   │ v1.0 结构:                                                               │
   │ {                                                                        │
   │   "sections": [                                                          │
   │     { "id": "s1", "title": "第一条 合同标的", "hash": "abc123" },        │
   │     { "id": "s2", "title": "第二条 付款方式", "hash": "def456" },        │
   │     ...                                                                  │
   │   ],                                                                     │
   │   "paragraphs": [                                                        │
   │     { "id": "p1", "section_id": "s1", "content": "...", "hash": "xxx" }, │
   │     ...                                                                  │
   │   ]                                                                      │
   │ }                                                                        │
   └──────────────────────────────────────────────────────────────────────────┘
          │                    │
          ▼                    ▼
3. 结构对比
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 对比算法                                                                  │
   │                                                                          │
   │ Step 1: 章节结构对比                                                     │
   │ - 新增章节：v1.1 有但 v1.0 无                                            │
   │ - 删除章节：v1.0 有但 v1.1 无                                            │
   │ - 章节重命名：标题变化                                                   │
   │                                                                          │
   │ Step 2: 段落内容对比                                                     │
   │ - 哈希快速比对：hash 不同则内容变化                                      │
   │ - 详细比对：LLM 分析具体修改内容                                         │
   │                                                                          │
   │ Step 3: 语义差异分析                                                     │
   │ - 关键条款变化识别                                                       │
   │ - 风险条款标注                                                           │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
4. 差异报告
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 差异报告                                                                  │
   │                                                                          │
   │ {                                                                        │
   │   "base_version": "合同_v1.0.pdf",                                       │
   │   "new_version": "合同_v1.1.pdf",                                        │
   │   "summary": {                                                           │
   │     "sections_added": 1,                                                 │
   │     "sections_removed": 0,                                               │
   │     "sections_modified": 3,                                              │
   │     "paragraphs_modified": 15                                            │
   │   },                                                                     │
   │   "changes": [                                                           │
   │     {                                                                    │
   │       "type": "section_added",                                           │
   │       "section": "第八条 争议解决",                                      │
   │       "content": "新增仲裁条款..."                                       │
   │     },                                                                   │
   │     {                                                                    │
   │       "type": "paragraph_modified",                                      │
   │       "section": "第二条 付款方式",                                       │
   │       "old_content": "付款期限为30天",                                   │
   │       "new_content": "付款期限为45天",                                   │
   │       "change_type": "期限延长",                                         │
   │       "risk_level": "中"                                                 │
   │     }                                                                    │
   │   ]                                                                      │
   │ }                                                                        │
   └──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 数据库设计

```sql
-- 文档版本表
CREATE TABLE document_versions (
  id VARCHAR(32) PRIMARY KEY,
  document_id VARCHAR(32) NOT NULL COMMENT '文档ID（同一文档的不同版本）',
  version_number VARCHAR(16) NOT NULL COMMENT '版本号：v1.0/v1.1/etc',
  file_path VARCHAR(256) NOT NULL COMMENT '文件路径',
  file_hash VARCHAR(64) COMMENT '文件哈希（用于去重）',
  parsed_content JSON COMMENT '解析后的结构化内容',
  parsed_hash JSON COMMENT '段落哈希映射',
  uploaded_by VARCHAR(32) COMMENT '上传者',
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_doc_version (document_id, version_number)
);

-- 文档差异记录表
CREATE TABLE document_diffs (
  id VARCHAR(32) PRIMARY KEY,
  document_id VARCHAR(32) NOT NULL COMMENT '文档ID',
  base_version_id VARCHAR(32) NOT NULL COMMENT '基准版本ID',
  new_version_id VARCHAR(32) NOT NULL COMMENT '新版本ID',
  diff_result JSON COMMENT '差异结果',
  analyzed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (base_version_id) REFERENCES document_versions(id),
  FOREIGN KEY (new_version_id) REFERENCES document_versions(id)
);
```

### 4.3 技术实现要点

| 要点 | 实现方案 |
|------|----------|
| **段落哈希** | 使用 SHA256 对段落内容生成哈希，快速判断是否变化 |
| **结构对比** | 树形结构比对算法，识别章节增删改 |
| **语义分析** | LLM 分析修改的语义含义，标注风险等级 |
| **可视化** | 类似 Git Diff 的左右对照展示 |

---

## 5. 场景C：文档生命周期管理

### 5.1 业务需求

```
质量体系文档管理需求：

1. 每份文档都有有效期（如：年度审核后更新）
2. 同一文档可能有多个版本，但只有一个是"当前生效"
3. RAG查询时，只应从生效版本中召回
4. 需要追踪文档的生效历史
```

### 5.2 数据模型扩展

```sql
-- 扩展 kb_articles 表，添加生命周期字段
ALTER TABLE kb_articles ADD COLUMN effective_from DATE COMMENT '生效日期';
ALTER TABLE kb_articles ADD COLUMN effective_to DATE COMMENT '失效日期';
ALTER TABLE kb_articles ADD COLUMN status ENUM('draft', 'active', 'expired', 'archived') DEFAULT 'active' COMMENT '文档状态';
ALTER TABLE kb_articles ADD COLUMN version_number VARCHAR(16) COMMENT '版本号';
ALTER TABLE kb_articles ADD COLUMN supersedes VARCHAR(32) COMMENT '取代的旧版本文章ID';
ALTER TABLE kb_articles ADD COLUMN document_type VARCHAR(32) COMMENT '文档类型：policy/procedure/guide/etc';

-- 文档生效历史表
CREATE TABLE document_effective_history (
  id VARCHAR(32) PRIMARY KEY,
  article_id VARCHAR(32) NOT NULL COMMENT '文章ID',
  effective_from DATE NOT NULL COMMENT '生效日期',
  effective_to DATE COMMENT '失效日期',
  change_reason TEXT COMMENT '变更原因',
  approved_by VARCHAR(32) COMMENT '审批人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (article_id) REFERENCES kb_articles(id)
);
```

### 5.3 状态流转

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        文档生命周期状态流转                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   draft     │
                    │  (草稿)     │
                    └──────┬──────┘
                           │ 审批通过
                           ▼
                    ┌─────────────┐
           取代旧版本│   active    │有效期结束
                    │  (生效)     │───────────────►
                    └──────┬──────┘                │
                           │                       ▼
                           │              ┌─────────────┐
                           │              │   expired   │
                           │              │  (失效)     │
                           │              └──────┬──────┘
                           │                     │ 归档
                           │                     ▼
                           │              ┌─────────────┐
                           │              │  archived   │
                           │              │  (归档)     │
                           │              └─────────────┘
                           │
                           ▼
              新版本生效时，旧版本自动变为 expired
```

### 5.4 RAG召回优化

```javascript
// kb.controller.js - 召回时过滤生效文档

async recallKnowledge(kbId, query, options) {
  const KbArticle = this.db.getModel('kb_article');
  const KbParagraph = this.db.getModel('kb_paragraph');
  
  // 构建生效文档过滤条件
  const effectiveFilter = {
    status: 'active',
    effective_from: { [Op.lte]: new Date() },
    effective_to: { [Op.or]: [null, { [Op.gte]: new Date() }] }
  };
  
  // 如果指定了文档类型，添加类型过滤
  if (options.document_type) {
    effectiveFilter.document_type = options.document_type;
  }
  
  // 向量搜索时，只搜索生效文档的段落
  const results = await KbParagraph.findAll({
    where: {
      ...effectiveFilter,
      embedding: { [Op.isNot]: null }
    },
    include: [{
      model: KbArticle,
      where: effectiveFilter  // 确保文章也是生效状态
    }],
    order: [['distance', 'ASC']],
    limit: options.top_k || 5
  });
  
  return results;
}
```

### 5.5 前端管理界面

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  文档生命周期管理                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  文档列表                                                            │    │
│  │                                                                      │    │
│  │  文档名称          版本    状态      生效日期    失效日期    操作     │    │
│  │  ────────────────────────────────────────────────────────────────── │    │
│  │  质量手册          v2.0    ✓生效     2026-01-01  2027-12-31  [管理] │    │
│  │  质量手册          v1.0    ○失效     2024-01-01  2025-12-31  [查看] │    │
│  │  检验规程          v3.1    ✓生效     2026-03-01  -           [管理] │    │
│  │  检验规程          v3.0    ○失效     2025-01-01  2026-02-28  [查看] │    │
│  │  采购流程          v1.0    ⚠即将失效 2025-01-01  2026-04-30  [更新] │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  即将失效提醒                                                        │    │
│  │                                                                      │    │
│  │  ⚠ 以下文档将在30天内失效，请及时更新：                               │    │
│  │  - 采购流程 v1.0 (2026-04-30)                                        │    │
│  │  - 供应商管理规程 v2.0 (2026-05-15)                                  │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. 场景D：合同元数据批量提取

### 6.1 业务流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        合同元数据批量提取流程                                  │
└─────────────────────────────────────────────────────────────────────────────┘

1. 批量上传
   ┌──────────────┐
   │ 用户         │ 上传100+份合同文件
   │              │ 选择提取模板："销售合同元数据"
   └──────┬───────┘
          │
          ▼
2. 任务创建
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 批量任务表 batch_extraction_tasks                                         │
   │                                                                          │
   │ id | name | template_id | file_count | status | created_by              │
   │                                                          | created_at    │
   │                                                          |               │
   │ 任务状态: pending → processing → completed → failed                      │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
3. 并行处理
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 后台任务调度器                                                             │
   │                                                                          │
   │ for each file in task.files:                                             │
   │   1. 调用 mineru/markitdown 解析文档                                     │
   │   2. 调用 LLM 提取元数据                                                  │
   │   3. 存入 contract_metadata 表                                           │
   │   4. 更新任务进度                                                         │
   │                                                                          │
   │ 并行策略:                                                                 │
   │ - 批量大小: 10份/批                                                      │
   │ - 并发数: 3个并发任务                                                    │
   │ - 失败重试: 最多3次                                                      │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
4. 元数据提取
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ LLM 提取 Prompt                                                           │
   │                                                                          │
   │ """                                                                       │
   │ 请从以下合同内容中提取元数据，以JSON格式返回：                              │
   │                                                                          │
   │ 合同内容:                                                                 │
   │ {解析后的合同内容}                                                        │
   │                                                                          │
   │ 需提取字段:                                                               │
   │ - 合同编号                                                                │
   │ - 合同名称                                                                │
   │ - 签订日期                                                                │
   │ - 甲方名称                                                                │
   │ - 甲方联系人                                                              │
   │ - 乙方名称                                                                │
   │ - 乙方联系人                                                              │
   │ - 合同金额                                                                │
   │ - 合同期限（开始日期、结束日期）                                           │
   │ - 付款方式                                                                │
   │ - 交付方式                                                                │
   │ - 关键条款摘要                                                            │
   │                                                                          │
   │ 返回格式:                                                                 │
   │ {                                                                        │
   │   "contract_number": "...",                                              │
   │   "contract_name": "...",                                                │
   │   ...                                                                    │
   │ }                                                                        │
   │ """                                                                       │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
5. 数据入库
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ contract_metadata 表                                                      │
   │                                                                          │
   │ id | contract_file | contract_number | contract_name | signing_date      │
   │                                                          | party_a        │
   │                                                          | party_b        │
   │                                                          | amount         │
   │                                                          | start_date     │
   │                                                          | end_date       │
   │                                                          | payment_method │
   │                                                          | delivery_method│
   │                                                          | key_clauses    │
   │                                                          | extracted_at   │
   │                                                          | extraction_task│
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
6. 导出/统计
   ┌──────────────┐
   │ 用户         │ 查看提取结果
   │              │ - 导出Excel/CSV
   │              │ - 统计分析（金额汇总、期限分布等）
   │              │ - 异常数据检查（缺失字段、格式错误）
   └──────┬───────┘
```

### 6.2 数据库设计

```sql
-- 元数据提取模板表
CREATE TABLE metadata_templates (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL COMMENT '模板名称',
  document_type VARCHAR(32) NOT NULL COMMENT '文档类型：contract/invoice/report/etc',
  fields JSON NOT NULL COMMENT '提取字段定义',
  prompt_template TEXT COMMENT 'LLM提取Prompt模板',
  created_by VARCHAR(32) COMMENT '创建者',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 批量提取任务表
CREATE TABLE batch_extraction_tasks (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL COMMENT '任务名称',
  template_id VARCHAR(32) NOT NULL COMMENT '使用的模板ID',
  file_count INT NOT NULL COMMENT '文件总数',
  processed_count INT DEFAULT 0 COMMENT '已处理数量',
  success_count INT DEFAULT 0 COMMENT '成功数量',
  failed_count INT DEFAULT 0 COMMENT '失败数量',
  status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
  error_log JSON COMMENT '错误日志',
  created_by VARCHAR(32) COMMENT '创建者',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME COMMENT '完成时间',
  
  FOREIGN KEY (template_id) REFERENCES metadata_templates(id)
);

-- 合同元数据表
CREATE TABLE contract_metadata (
  id VARCHAR(32) PRIMARY KEY,
  task_id VARCHAR(32) COMMENT '提取任务ID',
  contract_file VARCHAR(256) NOT NULL COMMENT '合同文件路径',
  contract_number VARCHAR(64) COMMENT '合同编号',
  contract_name VARCHAR(128) COMMENT '合同名称',
  signing_date DATE COMMENT '签订日期',
  party_a_name VARCHAR(128) COMMENT '甲方名称',
  party_a_contact VARCHAR(64) COMMENT '甲方联系人',
  party_b_name VARCHAR(128) COMMENT '乙方名称',
  party_b_contact VARCHAR(64) COMMENT '乙方联系人',
  amount DECIMAL(12,2) COMMENT '合同金额',
  start_date DATE COMMENT '合同开始日期',
  end_date DATE COMMENT '合同结束日期',
  payment_method VARCHAR(64) COMMENT '付款方式',
  delivery_method VARCHAR(64) COMMENT '交付方式',
  key_clauses JSON COMMENT '关键条款摘要',
  raw_content TEXT COMMENT '原始解析内容',
  extraction_status ENUM('success', 'partial', 'failed') DEFAULT 'success',
  extraction_error TEXT COMMENT '提取错误信息',
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (task_id) REFERENCES batch_extraction_tasks(id)
);
```

### 6.3 技术实现要点

| 要点 | 实现方案 |
|------|----------|
| **批量处理** | 后台任务调度器（参考现有 background-task-scheduler-design.md） |
| **并行控制** | 控制并发数，避免API限流 |
| **进度追踪** | WebSocket 推送进度更新 |
| **错误处理** | 记录失败文件，支持单独重试 |
| **模板管理** | 前端界面支持自定义提取字段 |

---

## 7. 场景E：发票批量入库

### 7.1 与现有 fapiao 技能的关系

```
现有 fapiao 技能能力：
- 基于 pdfjs-dist 的坐标提取
- 支持增值税专用发票、普通发票、电子发票
- 输出 JSON/Markdown 格式

需要扩展的能力：
- 批量处理（多文件并行）
- 模板匹配（不同发票类型）
- 数据入库（存入数据库）
- 去重校验（避免重复入库）
```

### 7.2 业务流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        发票批量入库流程                                        │
└─────────────────────────────────────────────────────────────────────────────┘

1. 批量上传
   ┌──────────────┐
   │ 用户         │ 上传发票文件（PDF/图片）
   │              │ 可选择：直接入库 / 先预览再确认
   └──────┬───────┘
          │
          ▼
2. OCR识别
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ markitdown / mineru                                                       │
   │                                                                          │
   │ 对于PDF发票:                                                              │
   │ - 有文本层：直接使用 fapiao 技能坐标提取                                  │
   │ - 无文本层（扫描版）：先 OCR 识别，再结构化提取                           │
   │                                                                          │
   │ 对于图片发票:                                                             │
   │ - 使用 VL 模型（视觉语言模型）识别内容                                    │
   │ - 或调用 markitdown OCR                                                  │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
3. 结构化提取
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ fapiao 技能 / LLM                                                         │
   │                                                                          │
   │ 提取字段:                                                                 │
   │ - 发票号码（唯一标识）                                                    │
   │ - 开票日期                                                                │
   │ - 发票类型                                                                │
   │ - 销售方信息（名称、税号）                                                │
   │ - 购买方信息（名称、税号）                                                │
   │ - 商品明细                                                                │
   │ - 金额信息（合计、税额、价税合计）                                        │
   │ - 备注                                                                    │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
4. 去重校验
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ 检查发票号码是否已存在                                                    │
   │                                                                          │
   │ SELECT COUNT(*) FROM invoices WHERE invoice_number = ?                   │
   │                                                                          │
   │ - 已存在：提示重复，跳过或更新                                            │
   │ - 不存在：继续入库                                                        │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
5. 数据入库
   ┌──────────────────────────────────────────────────────────────────────────┐
   │ invoices 表                                                               │
   │                                                                          │
   │ id | invoice_number | invoice_date | invoice_type | seller_name          │
   │                                                          | seller_tax_id │
   │                                                          | buyer_name    │
   │                                                          | buyer_tax_id  │
   │                                                          | total_amount  │
   │                                                          | total_tax     │
   │                                                          | total_with_tax│
   │                                                          | items         │
   │                                                          | remarks       │
   │                                                          | file_path     │
   │                                                          | created_at    │
   └──────────────────────────────────────────────────────────────────────────┘
          │
          ▼
6. 后续应用
   ┌──────────────┐
   │ 用户         │ - 发票统计（按月、按供应商汇总）
   │              │ - 报销管理（关联报销单）
   │              │ - 税务申报（导出汇总数据）
   │              │ - 异常检查（金额异常、重复发票）
   └──────┬───────┘
```

### 7.3 数据库设计

```sql
-- 发票表
CREATE TABLE invoices (
  id VARCHAR(32) PRIMARY KEY,
  invoice_number VARCHAR(20) NOT NULL UNIQUE COMMENT '发票号码（20位）',
  invoice_date DATE NOT NULL COMMENT '开票日期',
  invoice_type VARCHAR(64) COMMENT '发票类型',
  seller_name VARCHAR(128) COMMENT '销售方名称',
  seller_tax_id VARCHAR(20) COMMENT '销售方税号',
  buyer_name VARCHAR(128) COMMENT '购买方名称',
  buyer_tax_id VARCHAR(20) COMMENT '购买方税号',
  total_amount DECIMAL(12,2) COMMENT '合计金额',
  total_tax DECIMAL(12,2) COMMENT '税额',
  total_with_tax DECIMAL(12,2) COMMENT '价税合计',
  items JSON COMMENT '商品明细',
  remarks TEXT COMMENT '备注',
  file_path VARCHAR(256) COMMENT '发票文件路径',
  file_hash VARCHAR(64) COMMENT '文件哈希',
  ocr_method VARCHAR(32) COMMENT 'OCR方法：fapiao/markitdown/mineru/vl',
  extraction_status ENUM('success', 'partial', 'failed') DEFAULT 'success',
  verified BIT(1) DEFAULT b'0' COMMENT '是否已核验',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 发票批量入库任务表
CREATE TABLE invoice_batch_tasks (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL COMMENT '任务名称',
  file_count INT NOT NULL COMMENT '文件总数',
  processed_count INT DEFAULT 0 COMMENT '已处理数量',
  success_count INT DEFAULT 0 COMMENT '成功数量',
  duplicate_count INT DEFAULT 0 COMMENT '重复数量',
  failed_count INT DEFAULT 0 COMMENT '失败数量',
  status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
  created_by VARCHAR(32) COMMENT '创建者',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME COMMENT '完成时间'
);
```

### 7.4 技术实现要点

| 要点 | 实现方案 |
|------|----------|
| **OCR选择** | 根据文件类型自动选择：PDF文本层用fapiao，扫描版用markitdown |
| **VL模型** | 对于图片发票，调用视觉语言模型识别 |
| **去重机制** | 发票号码唯一索引 + 文件哈希校验 |
| **批量入库** | 复用场景D的批量任务调度器 |
| **报销关联** | 可扩展关联报销单表 |

---

## 8. 统一架构设计

### 8.1 模块关系图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        文档智能系统统一架构                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────────┐
                              │    前端管理界面      │
                              │                     │
                              │ - 模板管理          │
                              │ - 任务管理          │
                              │ - 结果查看          │
                              │ - 统计分析          │
                              └──────────┬──────────┘
                                         │ API
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              后端服务层                                          │
│                                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ 模板服务    │  │ 对比服务    │  │ 提取服务    │  │ 入库服务    │            │
│  │             │  │             │  │             │  │             │            │
│  │ - 合同模板  │  │ - 版本对比  │  │ - 元数据    │  │ - 发票入库  │            │
│  │ - 提取模板  │  │ - 完备性    │  │ - 批量任务  │  │ - 去重校验  │            │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                          后台任务调度器                                      ││
│  │                                                                              ││
│  │  - 批量任务队列                                                              ││
│  │  - 并行控制                                                                  ││
│  │  - 进度追踪                                                                  ││
│  │  - 错误处理                                                                  ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              能力层                                              │
│                                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ MCP Client  │  │ fapiao技能  │  │ 知识库系统  │  │ LLM服务     │            │
│  │             │  │             │  │             │  │             │            │
│  │ - markitdown│  │ - 坐标提取  │  │ - 向量存储  │  │ - 元数据提取│            │
│  │ - mineru    │  │ - 结构化    │  │ - 语义搜索  │  │ - 差异分析  │            │
│  │             │  │             │  │ - 生命周期  │  │ - 完备性验证│            │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              数据层                                              │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                          数据库表                                            ││
│  │                                                                              ││
│  │ 模板类:                                                                      ││
│  │ - contract_templates (合同模板)                                              ││
│  │ - metadata_templates (提取模板)                                              ││
│  │                                                                              ││
│  │ 文档类:                                                                      ││
│  │ - document_versions (文档版本)                                               ││
│  │ - document_diffs (差异记录)                                                  ││
│  │ - kb_articles (扩展生命周期字段)                                             ││
│  │                                                                              ││
│  │ 任务类:                                                                      ││
│  │ - batch_extraction_tasks (批量提取任务)                                      ││
│  │ - invoice_batch_tasks (发票入库任务)                                         ││
│  │                                                                              ││
│  │ 结果类:                                                                      ││
│  │ - contract_verifications (验证记录)                                          ││
│  │ - contract_metadata (合同元数据)                                             ││
│  │ - invoices (发票数据)                                                        ││
│  │ - document_effective_history (生效历史)                                      ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 服务接口统一设计

```javascript
// 统一API路由设计

// 模板管理
router.prefix('/api/templates');
router.get('/contract', listContractTemplates);
router.post('/contract', createContractTemplate);
router.get('/metadata', listMetadataTemplates);
router.post('/metadata', createMetadataTemplate);

// 合同验证
router.prefix('/api/contract');
router.post('/verify', verifyContract);
router.get('/verifications/:id', getVerificationResult);

// 文档对比
router.prefix('/api/document');
router.post('/compare', compareDocuments);
router.get('/diffs/:id', getDiffResult);
router.get('/versions/:documentId', listVersions);

// 批量提取
router.prefix('/api/extraction');
router.post('/batch', createBatchTask);
router.get('/tasks/:id', getTaskStatus);
router.get('/results/:taskId', getExtractionResults);

// 发票入库
router.prefix('/api/invoice');
router.post('/batch', createInvoiceBatchTask);
router.get('/tasks/:id', getInvoiceTaskStatus);
router.get('/list', listInvoices);
router.get('/stats', getInvoiceStats);

// 文档生命周期
router.prefix('/api/document-lifecycle');
router.get('/active', listActiveDocuments);
router.get('/expiring', listExpiringDocuments);
router.post('/update-status', updateDocumentStatus);
```

---

## 9. 实施建议

### 9.1 分阶段实施

| 阶段 | 场景 | 优先级 | 预估时间 | 依赖 |
|------|------|--------|----------|------|
| **Phase 1** | E. 发票批量入库 | 高 | 2周 | fapiao技能已有基础 |
| **Phase 2** | D. 合同元数据提取 | 高 | 2周 | Phase 1批量框架 |
| **Phase 3** | C. 文档生命周期 | 中 | 1周 | 知识库扩展 |
| **Phase 4** | A. 合同完备性验证 | 中 | 2周 | mineru接入 |
| **Phase 5** | B. 文档版本差异 | 低 | 2周 | Phase 4对比基础 |

### 9.2 技术依赖

| 依赖项 | 状态 | 需要的工作 |
|--------|------|------------|
| **markitdown MCP** | 已部署 | 通过MCP Client接入 |
| **mineru MCP** | 已部署 | 通过MCP Client接入 |
| **fapiao技能** | 已实现 | 扩展批量处理能力 |
| **后台任务调度器** | 已设计 | 实现批量任务框架 |
| **知识库系统** | 已实现 | 扩展生命周期字段 |

### 9.3 关键决策点

| 决策项 | 选项 | 建议 |
|--------|------|------|
| **OCR服务选择** | markitdown vs mineru | PDF文本层用mineru，扫描版用markitdown |
| **批量任务调度** | 新建 vs 复用现有 | 复用现有设计，扩展支持新场景 |
| **元数据存储** | 独立表 vs 知识库扩展 | 合同元数据独立表，质量文档扩展知识库 |
| **差异可视化** | 简单文本 vs Git Diff风格 | 先实现简单文本对比，后续优化可视化 |

---

## 10. 总结

### 10.1 场景能力矩阵

| 场景 | 核心能力 | 技术栈 | 数据存储 |
|------|----------|--------|----------|
| A. 合同完备性 | 模板对比 + LLM分析 | mineru + LLM | contract_templates, contract_verifications |
| B. 版本差异 | 结构对比 + 语义分析 | mineru + LLM | document_versions, document_diffs |
| C. 生命周期 | 状态管理 + RAG过滤 | 知识库扩展 | kb_articles扩展, document_effective_history |
| D. 元数据提取 | OCR + LLM提取 | markitdown/mineru + LLM | metadata_templates, contract_metadata |
| E. 发票入库 | OCR + 结构化入库 | fapiao/markitdown | invoices, invoice_batch_tasks |

### 10.2 复用关系

```
知识库系统
    │
    ├─► C. 生命周期管理（扩展 kb_articles）
    │
    └─► D/E. 批量处理框架（复用后台任务调度）

fapiao 技能
    │
    └─► E. 发票入库（扩展批量能力）

MCP Client
    │
    ├─► A/B/D. 文档解析（markitdown/mineru）
    │
    └─► D/E. OCR能力接入

LLM 服务
    │
    ├─► A. 完备性验证分析
    │
    ├─► B. 差异语义分析
    │
    └─► D. 元数据提取
```

---

*创建时间: 2026-04-13*
*状态: 设计思路草案*
*下一步: 根据优先级分阶段实施*