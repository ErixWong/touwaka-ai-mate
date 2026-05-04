# App 平台设计 - 多维表格 + AI 增强架构

## 概述

在 Touwaka Mate 的顶部导航栏中新增 **"App"** 菜单，作为文档智能场景的统一入口。App 菜单内托管一系列"小程序"（Mini-App），每个小程序专注于一个具体的业务场景，共享系统的 AI 能力（LLM、技能）和第三方能力（MCP 服务如 markitdown、mineru）。

### 核心理念

| 理念                   | 说明                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| **多维表格内核** | 借鉴飞书多维表格（Bitable）/ APITable 的 Table→Field→Record 三层模型，统一所有文档类和数据库类需求 |
| **App-first**    | 用户通过表单/列表等传统 UI 完成操作，AI 在后台辅助，而非纯聊天驱动                                   |
| **状态机驱动**   | 记录通过状态流转驱动处理（待OCR→待提取→待确认→已确认），异步、可观测、可重试                      |
| **处理脚本化**   | AI 处理逻辑独立为脚本，通过时钟调度，与 App 配置解耦                                                 |
| **共享能力**     | 所有小程序共享系统的 LLM、技能、MCP 连接，脚本内部调用，无需重复集成                                 |
| **渐进增强**     | 从简单表单开始，逐步加入 AI 辅助填充、智能审核等能力                                                 |

### 为什么不是纯聊天？

```
❌ 纯聊天入口的问题：
   - 用户需要描述需求 → AI 理解 → 多轮对话 → 结果
   - 对于重复性操作（如录入100份合同），效率极低
   - 缺乏结构化数据的浏览、筛选、统计能力
   - 用户心理预期不稳定，"不落地"

✅ App 平台的优势：
   - 用户直接打开"销售合同管理"→ 上传文件 → AI 自动提取 → 表单预填 → 用户确认
   - 列表/表格视图天然适合数据浏览和统计
   - 操作路径明确，学习成本低
   - AI 作为增强能力，而非唯一入口
```

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Touwaka Mate 顶部导航栏                              │
│  🤖 专家 | 🧩 技能 | 📚 知识库 | 🎯 解决方案 | 📱 App | 🏢 组织 | 👤 个人 | ⚙️ 系统  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           App 平台层                                         │
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ 📄 合同管理   │  │ 📊 文档对比   │  │ 📋 发票管理   │  │ 📁 质量文档   │    │
│  │  (小程序)     │  │  (小程序)     │  │  (小程序)     │  │  (小程序)     │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │                 │              │
│         └─────────────────┴─────────────────┴─────────────────┘              │
│                                    │                                        │
│                         ┌──────────▼──────────┐                              │
│                         │   共享能力层          │                              │
│                         │  ┌────────────────┐ │                              │
│                         │  │ LLM (表达/反思) │ │                              │
│                         │  ├────────────────┤ │                              │
│                         │  │ 技能系统        │ │                              │
│                         │  │ (fapiao, pdf..)│ │                              │
│                         │  ├────────────────┤ │                              │
│                         │  │ MCP 服务        │ │                              │
│                         │  │ (markitdown,   │ │                              │
│                         │  │  mineru)       │ │                              │
│                         │  ├────────────────┤ │                              │
│                         │  │ 表单系统        │ │                              │
│                         │  │ (已有设计)      │ │                              │
│                         │  └────────────────┘ │                              │
│                         └─────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 前端路由与导航

在 [`AppHeader.vue`](frontend/src/components/AppHeader.vue:10) 的 `header-nav` 中新增 App 导航项：

```
nav 结构（现有）：
  🤖 专家 → /experts
  🧩 技能 → /skills
  📚 知识库 → /knowledge
  🎯 解决方案 → /solutions
  🏢 组织 → /organization (管理员)
  👤 个人 → /personal
  ⚙️ 系统 → /system (管理员)

新增：
  📱 App → /apps
```

路由设计（在 [`router/index.ts`](frontend/src/router/index.ts:23) 的 children 中新增）：

```typescript
// App 平台路由
{
  path: 'apps',
  name: 'apps',
  component: () => import('@/views/AppsView.vue'),
},
{
  path: 'apps/:appId',
  name: 'app-detail',
  component: () => import('@/views/AppDetailView.vue'),
},
```

## 多维表格数据模型（Bitable 架构）

> **灵感来源**：飞书多维表格（Bitable）/ APITable 的 Table→Field→Record 三层模型。
>
> **核心洞察**：所有需求（A~E）本质上都是"结构化数据 + 文档附件 + AI 处理"的组合。
> 无论是合同、发票、质量文档，都可以抽象为一张"多维表格"——有字段定义、有数据行、有关联文件。
> 因此我们不需要为每个场景建不同的表，而是用一套统一的模型覆盖所有场景。

### 三层模型

```
┌─────────────────────────────────────────────────────────────────────────┐
│  App（小程序）= 一张多维表格                                              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Table（表定义）                                                  │   │
│  │  • 表名、描述、图标                                               │   │
│  │  • AI 管线配置（OCR 服务、提取模型、Prompt 模板）                   │   │
│  │  • 功能开关（上传、列表、统计、批量...）                            │   │
│  │  • 关联的技能 / MCP 服务                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                         │                                               │
│                         ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Fields（字段定义）= JSON 存储在 table 元数据中                    │   │
│  │                                                                   │   │
│  │  每个字段有：                                                     │   │
│  │  • name: 字段标识（如 contract_number）                           │   │
│  │  • label: 显示名称（如 "合同编号"）                               │   │
│  │  • type: 数据类型（text/number/date/select/file/link...）         │   │
│  │  • required: 是否必填                                             │   │
│  │  • ai_extractable: 是否可由 AI 提取                               │   │
│  │  • ai_confidence: AI 提取的置信度阈值                              │   │
│  │  • default: 默认值                                                │   │
│  │  • options: 选项列表（select 类型）                                │   │
│  │                                                                   │   │
│  │  不同 App 的字段完全不同，但存储结构统一                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                         │                                               │
│                         ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Records（数据行）= 每行一个 JSON                                  │   │
│  │                                                                   │   │
│  │  data 字段存储该行所有字段的值：                                    │   │
│  │  {                                                                │   │
│  │    "contract_number": "HT-2024-001",                              │   │
│  │    "contract_date": "2024-03-15",                                 │   │
│  │    "party_a": "某某科技有限公司",                                  │   │
│  │    "party_b": "某某集团有限公司",                                  │   │
│  │    "contract_amount": 100000,                                     │   │
│  │    "status": "执行中"                                             │   │
│  │  }                                                                │   │
│  │                                                                   │   │
│  │  这和 APITable 的 datasheet_record.data 完全一致                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 数据库设计

> **完整的数据库表定义已提取到独立文件**：[`database-schema.md`](database-schema.md)
>
> 包含：核心表（`mini_apps`、`mini_app_rows`、`mini_app_files`）、状态机表（`app_row_handlers`、`app_state`、`app_action_logs`）、权限表（`mini_app_role_access`）、知识库扩展字段、虚拟列索引、ER 关系图。
>
> **批量进度追踪**：通过查询 `mini_app_rows` 按 `_status` 分组统计实现，无需单独的批量任务表。

核心表概览：

| 表名 | 用途 |
|------|------|
| `mini_apps` | 小程序注册表（= 多维表格的 Table 定义），字段定义/视图配置/功能开关存为 JSON，状态定义在 `app_state` 表 |
| `mini_app_rows` | 小程序数据记录（= 多维表格的 Record 行），`data JSON` 存储所有字段值（含 `_status`、`_ocr_text` 系统字段） |
| `mini_app_files` | 小程序文件关联表（关联 attachments），不存储 OCR 结果 |
| `app_state` | App 状态定义表（统一管理状态定义、流转顺序、脚本绑定） |

### 与 APITable 架构的对照

| APITable 概念       | APITable 表                         | 我们的概念         | 我们的表                         | 说明                      |
| ------------------- | ----------------------------------- | ------------------ | -------------------------------- | ------------------------- |
| Datasheet（表定义） | `datasheet`                       | Mini App（小程序） | `mini_apps`                    | 一个小程序 = 一张多维表格 |
| Meta（字段定义）    | `datasheet_meta.meta_data` (JSON) | Fields（字段定义） | `mini_apps.fields` (JSON)      | 字段 schema 存为 JSON     |
| Record（数据行）    | `datasheet_record.data` (JSON)    | Record（记录）     | `mini_app_rows.data` (JSON) | 每行数据存为 JSON         |
| Changeset（变更集） | `datasheet_changeset`             | —                 | 暂不实现                         | 后续可加 OT 协同          |
| Revision（版本号）  | `revision` 字段                   | Revision           | `revision` 字段                | 乐观锁                    |

### 字段类型体系

```
支持的字段类型（fields 中的 type）：

基础类型：
  text        → 短文本（VARCHAR）     如：合同编号、甲方名称
  textarea    → 长文本（TEXT）         如：付款条款、备注
  number      → 数字（INT/DECIMAL）    如：合同金额、发票税额
  date        → 日期（DATE）           如：签订日期、生效日期
  select      → 单选（ENUM）           如：状态、文档类型
  multiselect → 多选（SET）            如：标签、适用范围
  boolean     → 布尔（BIT(1)）         如：是否续签、是否含税

高级类型：
  file        → 文件附件               如：合同PDF、发票扫描件
  link        → 关联记录               如：关联模板、关联上一版本
  user        → 用户引用               如：负责人、审批人
  formula     → 计算公式               如：含税金额 = 金额 × (1 + 税率)
  auto_id     → 自动编号               如：HT-{YYYY}-{0000}

嵌套类型（复杂结构）：
  group       → 字段分组（嵌套对象）   如：卖方信息（名称+税号+地址）
  repeating   → 重复区域（数组）       如：发票明细行、付款计划
```

### 嵌套字段设计（group + repeating）

> **问题**：发票有多个明细行，合同有多个付款节点，这些"一行中包含多行"的结构
> 用扁平字段无法表达。需要 `group` 和 `repeating` 两种嵌套类型。

#### group 类型（嵌套对象）

`group` 类型将多个字段组织为一个嵌套对象，适用于"一个概念包含多个属性"的场景。

```jsonc
// group 字段定义
{
  "name": "seller_info",
  "label": "卖方信息",
  "type": "group",
  "fields": [
    { "name": "name", "label": "名称", "type": "text", "required": true },
    { "name": "tax_id", "label": "纳税人识别号", "type": "text" },
    { "name": "address", "label": "地址", "type": "text" },
    { "name": "phone", "label": "电话", "type": "text" },
    { "name": "bank_account", "label": "开户行及账号", "type": "text" }
  ]
}

// 存储在 record.data 中的值：
{
  "seller_info": {
    "name": "某某科技有限公司",
    "tax_id": "91110108MA01XXXXX",
    "address": "北京市海淀区XXX路XX号",
    "phone": "010-XXXXXXXX",
    "bank_account": "中国银行海淀支行 XXXXXXXXXXX"
  }
}
```

#### repeating 类型（重复区域/数组）

`repeating` 类型表示一个可变长度的数组，每个数组元素包含相同的子字段结构。
适用于"一对多"关系，如发票明细行、合同付款计划、质量文档修订历史等。

```jsonc
// repeating 字段定义
{
  "name": "invoice_items",
  "label": "发票明细",
  "type": "repeating",
  "fields": [
    { "name": "description", "label": "货物或应税劳务名称", "type": "text", "required": true },
    { "name": "specification", "label": "规格型号", "type": "text" },
    { "name": "unit", "label": "单位", "type": "text" },
    { "name": "quantity", "label": "数量", "type": "number" },
    { "name": "unit_price", "label": "单价", "type": "number" },
    { "name": "amount", "label": "金额", "type": "number", "required": true },
    { "name": "tax_rate", "label": "税率", "type": "number" },
    { "name": "tax_amount", "label": "税额", "type": "number" }
  ],
  "min_items": 1,       // 最少 1 行
  "max_items": 100,     // 最多 100 行
  "summary_fields": [   // 汇总字段（自动计算）
    { "source": "amount", "function": "sum", "target": "total_amount" },
    { "source": "tax_amount", "function": "sum", "target": "total_tax" }
  ]
}

// 存储在 record.data 中的值：
{
  "invoice_items": [
    { "description": "服务器设备", "specification": "Xeon-E5/64G/2T", "unit": "台",
      "quantity": 2, "unit_price": 50000, "amount": 100000, "tax_rate": 13, "tax_amount": 13000 },
    { "description": "网络交换机", "specification": "48口千兆", "unit": "台",
      "quantity": 5, "unit_price": 3000, "amount": 15000, "tax_rate": 13, "tax_amount": 1950 }
  ],
  "total_amount": 115000,    // 自动汇总
  "total_tax": 14950         // 自动汇总
}
```

#### 更多 repeating 使用场景

```jsonc
// 场景 D：合同付款计划
{
  "name": "payment_schedule",
  "label": "付款计划",
  "type": "repeating",
  "fields": [
    { "name": "milestone", "label": "付款节点", "type": "text", "required": true },
    { "name": "amount", "label": "金额", "type": "number", "required": true },
    { "name": "due_date", "label": "预计付款日期", "type": "date" },
    { "name": "status", "label": "状态", "type": "select",
      "options": ["未到期", "待支付", "已支付", "已逾期"] }
  ]
}

// 场景 C：质量文档修订历史
{
  "name": "revision_history",
  "label": "修订历史",
  "type": "repeating",
  "fields": [
    { "name": "version", "label": "版本号", "type": "text", "required": true },
    { "name": "date", "label": "修订日期", "type": "date", "required": true },
    { "name": "author", "label": "修订人", "type": "text" },
    { "name": "description", "label": "修订内容", "type": "textarea" }
  ]
}

// 场景 A：合同条款对照（模板 vs 实际）
{
  "name": "clause_comparison",
  "label": "条款对照",
  "type": "repeating",
  "fields": [
    { "name": "clause_name", "label": "条款名称", "type": "text", "required": true },
    { "name": "template_content", "label": "模板要求", "type": "textarea" },
    { "name": "actual_content", "label": "实际内容", "type": "textarea" },
    { "name": "match_status", "label": "匹配状态", "type": "select",
      "options": ["完全匹配", "部分匹配", "不匹配", "缺失"] },
    { "name": "risk_level", "label": "风险等级", "type": "select",
      "options": ["无", "低", "中", "高"] }
  ]
}
```

#### 嵌套字段的 AI 提取

嵌套字段的 AI 提取需要在脚本中特殊处理。`llm-extract` 脚本会根据字段类型自动构建不同的 Prompt：

```javascript
// scripts/llm-extract 中对嵌套字段的处理
function buildFieldPrompt(fields, prefix = '') {
  const lines = [];
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
  
    if (field.type === 'group') {
      // group 类型：递归构建子字段
      lines.push(`- ${path} (${field.label}): 对象，包含以下字段：`);
      lines.push(...buildFieldPrompt(field.fields, path));
    } else if (field.type === 'repeating') {
      // repeating 类型：说明是数组
      lines.push(`- ${path} (${field.label}): 数组，每个元素包含以下字段：`);
      lines.push(...buildFieldPrompt(field.fields, `${path}[]`));
      if (field.min_items) lines.push(`  最少 ${field.min_items} 项`);
    } else {
      lines.push(`- ${path} (${field.label}): 类型=${field.type}${field.required ? ', 必填' : ''}`);
    }
  }
  return lines;
}
```

LLM 返回的 JSON 中，嵌套字段直接作为嵌套对象/数组存储：

```json
{
  "contract_number": "HT-2024-001",
  "seller_info": {
    "name": "某某科技有限公司",
    "tax_id": "91110108MA01XXXXX"
  },
  "invoice_items": [
    { "description": "服务器设备", "amount": 100000, "tax_rate": 13, "tax_amount": 13000 }
  ]
}
```

#### 前端渲染嵌套字段

```
┌─────────────────────────────────────────────────────────────────────────┐
│  group 字段渲染                                                          │
│                                                                         │
│  卖方信息（group）：                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  名称：某某科技有限公司                                          │   │
│  │  纳税人识别号：91110108MA01XXXXX                                 │   │
│  │  地址：北京市海淀区XXX路XX号                                     │   │
│  │  电话：010-XXXXXXXX                                              │   │
│  │  开户行及账号：中国银行海淀支行 XXXXXXXXXXX                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│  → 渲染为带边框的字段组，内部字段平铺展示                                │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│  repeating 字段渲染                                                      │
│                                                                         │
│  发票明细（repeating）：                                                 │
│  ┌──────┬────────┬────┬────┬────────┬────────┬──────┬──────┐           │
│  │ 名称  │ 规格    │ 单位│ 数量│ 单价    │ 金额    │ 税率  │ 税额  │           │
│  ├──────┼────────┼────┼────┼────────┼────────┼──────┼──────┤           │
│  │ 服务器│ Xeon-E5│ 台 │ 2  │ 50,000 │100,000 │ 13%  │13,000│           │
│  │ 交换机│ 48口   │ 台 │ 5  │  3,000 │ 15,000 │ 13%  │ 1,950│           │
│  ├──────┼────────┼────┼────┼────────┼────────┼──────┼──────┤           │
│  │      │        │    │    │ 合计：  │115,000 │      │14,950│           │
│  └──────┴────────┴────┴────┴────────┴────────┴──────┴──────┘           │
│  [+ 添加行]  [- 删除选中行]                                              │
│  → 渲染为可编辑的表格，支持增删行，底部显示汇总行                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 前端组件扩展

```
frontend/src/components/apps/fields/
├── TextField.vue           # text
├── TextAreaField.vue       # textarea
├── NumberField.vue         # number
├── DateField.vue           # date
├── SelectField.vue         # select
├── FileField.vue           # file
├── BooleanField.vue        # boolean
├── GroupField.vue          # group → 递归渲染子字段为带边框的字段组
└── RepeatingField.vue      # repeating → 渲染为可编辑表格 + 增删行按钮
```

`GroupField.vue` 和 `RepeatingField.vue` 都会递归调用 `renderField()` 来渲染子字段，
形成任意深度的嵌套结构（虽然实际使用中通常不超过 2 层）。

#### 嵌套字段的校验规则

```javascript
// 后端校验嵌套字段
function validateField(value, fieldDef) {
  if (fieldDef.type === 'group') {
    // group：校验每个子字段
    if (!value || typeof value !== 'object') {
      throw new Error(`${fieldDef.label} 必须是对象`);
    }
    for (const subField of fieldDef.fields) {
      if (subField.required && !value[subField.name]) {
        throw new Error(`${fieldDef.label}.${subField.label} 为必填项`);
      }
    }
  }
  
  if (fieldDef.type === 'repeating') {
    // repeating：校验数组长度和每个元素的子字段
    if (!Array.isArray(value)) {
      throw new Error(`${fieldDef.label} 必须是数组`);
    }
    if (fieldDef.min_items && value.length < fieldDef.min_items) {
      throw new Error(`${fieldDef.label} 至少需要 ${fieldDef.min_items} 项`);
    }
    if (fieldDef.max_items && value.length > fieldDef.max_items) {
      throw new Error(`${fieldDef.label} 最多 ${fieldDef.max_items} 项`);
    }
    for (const item of value) {
      for (const subField of fieldDef.fields) {
        if (subField.required && !item[subField.name]) {
          throw new Error(`${fieldDef.label} 每行的 ${subField.label} 为必填项`);
        }
      }
    }
  }
}
```

#### 嵌套字段的汇总计算

`repeating` 类型支持 `summary_fields` 配置，自动从数组元素中计算汇总值：

```javascript
// 后端自动计算汇总字段
function computeSummaries(data, fields) {
  for (const field of fields) {
    if (field.type === 'repeating' && field.summary_fields) {
      const items = data[field.name] || [];
      for (const summary of field.summary_fields) {
        switch (summary.function) {
          case 'sum':
            data[summary.target] = items.reduce((sum, item) =>
              sum + (Number(item[summary.source]) || 0), 0);
            break;
          case 'count':
            data[summary.target] = items.length;
            break;
          case 'avg':
            data[summary.target] = items.length > 0
              ? items.reduce((sum, item) => sum + (Number(item[summary.source]) || 0), 0) / items.length
              : 0;
            break;
        }
      }
    }
  }
  return data;
}
```

#### 嵌套深度限制

```
建议嵌套层级不超过 2 层：

✅ 推荐结构：
  invoice_items: repeating          ← 第 1 层
    description: text               ← 第 2 层（叶子）
    amount: number                  ← 第 2 层（叶子）

⚠️ 可接受但需谨慎：
  contract: group                   ← 第 1 层
    parties: repeating              ← 第 2 层
      name: text                    ← 第 3 层（叶子）

❌ 不推荐：
  超过 3 层嵌套，前端渲染和 AI 提取都会变得复杂
```

### 虚拟列索引（按需优化）

> 完整的虚拟列 SQL 示例见 [`database-schema.md`](database-schema.md) 的"虚拟列索引"章节。

**策略**：初期不建虚拟列，纯 JSON 查询。当某个小程序数据量超过 1000 条且查询变慢时，再按需添加。

### 场景映射到字段定义

```yaml
# 场景 D：销售合同管理
fields:
  - { name: contract_number, label: "合同编号", type: text, required: true, ai_extractable: true }
  - { name: contract_date, label: "签订日期", type: date, required: true, ai_extractable: true }
  - { name: party_a, label: "甲方", type: text, required: true, ai_extractable: true }
  - { name: party_b, label: "乙方", type: text, required: true, ai_extractable: true }
  - { name: contract_amount, label: "合同金额", type: number, required: true, ai_extractable: true }
  - { name: start_date, label: "开始日期", type: date, ai_extractable: true }
  - { name: end_date, label: "结束日期", type: date, ai_extractable: true }
  - { name: payment_terms, label: "付款条款", type: textarea, ai_extractable: true }
  - { name: status, label: "状态", type: select, options: ["待审批", "执行中", "已完成", "已终止"], default: "待审批" }
  - { name: contract_file, label: "合同文件", type: file }

# 场景 E：发票管理（使用 group + repeating 嵌套类型）
fields:
  - { name: invoice_number, label: "发票号码", type: text, required: true, ai_extractable: true }
  - { name: invoice_date, label: "开票日期", type: date, required: true, ai_extractable: true }
  - { name: invoice_type, label: "发票类型", type: text, ai_extractable: true }
  # 卖方信息（group 嵌套对象）
  - name: seller_info
    label: "销售方信息"
    type: group
    ai_extractable: true
    fields:
      - { name: name, label: "名称", type: text, required: true }
      - { name: tax_id, label: "纳税人识别号", type: text }
      - { name: address_phone, label: "地址电话", type: text }
      - { name: bank_account, label: "开户行及账号", type: text }
  # 购买方信息（group 嵌套对象）
  - name: buyer_info
    label: "购买方信息"
    type: group
    ai_extractable: true
    fields:
      - { name: name, label: "名称", type: text, required: true }
      - { name: tax_id, label: "纳税人识别号", type: text }
      - { name: address_phone, label: "地址电话", type: text }
      - { name: bank_account, label: "开户行及账号", type: text }
  # 发票明细（repeating 数组）
  - name: invoice_items
    label: "发票明细"
    type: repeating
    ai_extractable: true
    min_items: 1
    max_items: 100
    fields:
      - { name: description, label: "货物或应税劳务名称", type: text, required: true }
      - { name: specification, label: "规格型号", type: text }
      - { name: unit, label: "单位", type: text }
      - { name: quantity, label: "数量", type: number }
      - { name: unit_price, label: "单价", type: number }
      - { name: amount, label: "金额", type: number, required: true }
      - { name: tax_rate, label: "税率", type: number }
      - { name: tax_amount, label: "税额", type: number }
    summary_fields:
      - { source: amount, function: sum, target: total_amount }
      - { source: tax_amount, function: sum, target: total_tax }
  # 汇总字段（由 summary_fields 自动计算）
  - { name: total_amount, label: "合计金额", type: number, ai_extractable: true }
  - { name: total_tax, label: "合计税额", type: number, ai_extractable: true }
  - { name: total_with_tax, label: "价税合计", type: number, required: true, ai_extractable: true }
  - { name: invoice_file, label: "发票文件", type: file }

# 场景 C：质量文档管理
fields:
  - { name: doc_number, label: "文档编号", type: text, required: true }
  - { name: doc_title, label: "文档标题", type: text, required: true }
  - { name: doc_type, label: "文档类型", type: select, options: ["程序文件", "作业指导书", "质量手册", "记录表单"] }
  - { name: version, label: "版本号", type: text }
  - { name: effective_date, label: "生效日期", type: date }
  - { name: expiry_date, label: "失效日期", type: date }
  - { name: doc_status, label: "文档状态", type: select, options: ["草稿", "生效中", "已失效", "已替代"] }
  - { name: previous_version, label: "上一版本", type: link }
  - { name: doc_file, label: "文档文件", type: file }
```

## 状态机与处理脚本架构

> **核心变更**：用"记录状态 + 处理脚本 + 时钟调度"替代原来的 `config.ai_assist` AI 管线配置。
>
> **原因**：AI 管线配置虽然灵活，但把处理逻辑耦合在了 App 配置中。
> 改为状态机模式后，处理逻辑独立为"脚本"，App 只需定义字段和状态，
> 脚本负责状态转换和字段填充，时钟负责调度。
>
> **关键洞察**：脚本 ≈ 技能的 tool。对 AI 能力的调用（MCP/LLM/技能）在脚本内部实现，
> App 配置完全不关心。

### 核心思路

```
上传文件 → 创建记录（status=待OCR, data={}）→ 时钟扫描 → 脚本处理 → 填充字段 → 更新状态
```

1. **记录有状态**：每条记录都有一个 `status` 字段，表示当前处理阶段
2. **状态触发脚本**：每种状态可以关联一个处理脚本
3. **时钟调度**：定时扫描特定状态的记录，调用对应脚本处理
4. **脚本填充字段**：脚本处理完后，根据 App 的字段定义填充 `data`
5. **AI 在脚本内部**：脚本内部调用 MCP/LLM/技能，App 配置不关心

### 状态流转示例

```
合同管理 App 的状态流转：

  上传文件 → [待OCR] ──脚本:ocr_service──→ [待提取] ──脚本:llm_extract──→ [待确认] ──用户确认──→ [已确认]
                 ↓                              ↓
             [OCR失败]                     [提取失败]
                 ↓                              ↓
              可重试                          可重试

发票管理 App 的状态流转：

  上传文件 → [待处理] ──脚本:fapiao_extract──→ [待确认] ──用户确认──→ [已确认]
                 ↓
             [处理失败]

质量文档 App 的状态流转（无 AI）：

  手动创建 → [已确认]（直接确认，无需 AI 处理）
```

### 数据模型变更

> **核心变更**：状态定义从 `mini_apps.statuses` JSON 字段移到独立的 `app_state` 表。
> 记录状态从独立的 `mini_app_rows.status` 字段改为存储在 `data._status` JSON 字段中。

#### 状态存储在 data._status 字段

```sql
-- 状态不再作为独立字段，而是存储在 data JSON 的 _status 键中
-- 通过虚拟列索引实现高效查询
ALTER TABLE mini_app_rows
ADD COLUMN _status VARCHAR(64)
  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(data, '$._status'))) STORED,
ADD INDEX idx_app_status (app_id, _status);
```

#### 新增表：处理脚本、状态定义、执行日志

> 完整的 CREATE TABLE 语句见 [`database-schema.md`](database-schema.md) 的"状态机表"章节。

| 表名 | 用途 |
|------|------|
| `app_row_handlers` | 处理脚本表（脚本入口、并发控制、超时重试） |
| `app_state` | App 状态定义表（统一管理状态定义、流转顺序、脚本绑定） |
| `app_action_logs` | 脚本执行日志（输入/输出/耗时/错误信息） |

### 时钟调度机制

```
┌─────────────────────────────────────────────────────────────────────────┐
│  App Clock（时钟调度器）                                                  │
│                                                                         │
│  运行方式：Node.js 定时器（setInterval）或 node-cron                      │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  每 N 秒执行一次：                                               │   │
│  │                                                                   │   │
│  │  1. 查询所有活跃的 app_state 记录（有 handler_id 的状态）        │   │
│  │                                                                   │   │
│  │  2. 对每个状态：                                                  │   │
│  │     a. 查询 mini_app_rows 中 _status 匹配的记录                │   │
│  │        WHERE app_id = ? AND _status = ? LIMIT ?                     │   │
│  │     b. 如果没有记录，跳过                                         │   │
│  │                                                                   │   │
│  │  3. 对每条记录：                                                  │   │
│  │     a. 将 _status 改为 "processing_{原状态}"（防止重复处理）     │   │
│  │     b. 加载脚本 handler                                           │   │
│  │     c. 调用脚本的 process(context) 函数                            │   │
│  │     d. 根据结果：                                                 │   │
│  │        成功 → 更新 data + 设置 success_next_state                 │   │
│  │        失败 → 设置 failure_next_state + 记录错误日志               │   │
│  │     e. 写入 app_action_logs                                       │   │
│  │                                                                   │   │
│  │  4. 并发控制：                                                    │   │
│  │     • 每个脚本有最大并发数（app_row_handlers.concurrency）   │   │
│  │     • 全局最大并发数（避免系统过载）                                │   │
│  │                                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  配置示例：                                                              │
│  {                                                                      │
│    "interval": 10,           // 每 10 秒扫描一次                         │
│    "batch_size": 10,         // 每次每个状态最多处理 10 条               │
│    "global_concurrency": 5   // 全局最大并发                             │
│  }                                                                      │
│                                                                         │
│  优化：上传文件后可立即触发一次时钟（不等间隔），减少延迟                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 处理脚本的实现规范

处理脚本是一个标准的 Node.js 模块，导出一个 `process` 函数。

#### 脚本返回值规范

脚本的 `process()` 函数返回一个对象，时钟调度器根据以下规则处理：

```javascript
{
  success: boolean,       // 必填：处理是否成功
  data?: Object,          // 成功时：合并到 mini_app_rows.data 的字段
  error?: string          // 失败时：错误信息
}
```

**时钟调度器处理逻辑**：
- `data` 中的所有键 → `Object.assign(record.data, data)` 合并到记录数据
- 系统约定字段（以 `_` 开头）用于存储处理状态：
  - `_ocr_text` → OCR 识别文本
  - `_ocr_service` → OCR 服务标识（如 'markitdown'）
  - `_ocr_status` → OCR 状态（'completed' | 'failed'）

#### 脚本示例

```javascript
// scripts/ocr-service/index.js
// 处理"待OCR"状态的记录

/**
 * @param {Object} context - 上下文
 * @param {Object} context.record - 当前记录（mini_app_rows）
 * @param {Object} context.app - App 定义（含 fields, statuses）
 * @param {Array}  context.files - 关联的文件列表（mini_app_files）
 * @param {Object} context.services - 共享服务
 * @param {Function} context.services.callMcp - 调用 MCP 服务
 * @param {Function} context.services.callLlm - 调用 LLM
 * @param {Function} context.services.callSkill - 调用技能
 * @returns {Object} { success: boolean, data?: Object, error?: string }
 */
module.exports = {
  async process(context) {
    const { record, app, files, services } = context;

    // 1. 获取关联文件
    const file = files[0];
    if (!file) {
      return { success: false, error: '没有关联文件' };
    }

    // 2. 调用 markitdown 做 OCR
    let ocrText = '';
    try {
      const result = await services.callMcp('markitdown', 'convert', {
        file_path: file.file_path
      });
      ocrText = result.text;
    } catch (e) {
      // markitdown 失败，尝试 mineru
      try {
        const result = await services.callMcp('mineru', 'parse', {
          file_path: file.file_path
        });
        ocrText = result.text;
      } catch (e2) {
        return { success: false, error: 'OCR 识别失败: ' + e2.message };
      }
    }

    // 3. 返回结果（OCR 文本存入 record.data）
    return {
      success: true,
      data: {
        // OCR 结果直接存入 record.data 的系统字段
        _ocr_text: ocrText,
        _ocr_service: 'markitdown',
        _ocr_status: 'completed'
      }
    };
  }
};
```

```javascript
// scripts/llm-extract/index.js
// 处理"待提取"状态的记录（OCR 已完成，需要 LLM 提取元数据）

module.exports = {
  async process(context) {
    const { record, app, files, services } = context;

    // 1. 获取 OCR 文本（从 record.data 中读取）
    const ocrText = record.data._ocr_text;
    if (!ocrText) {
      return { success: false, error: '没有 OCR 文本，请先执行 OCR' };
    }

    // 2. 根据 App 的 fields 定义构建提取 Prompt
    const extractableFields = app.fields.filter(f => f.ai_extractable);
    const fieldDefinitions = extractableFields
      .map(f => `- ${f.name} (${f.label}): 类型=${f.type}${f.required ? ', 必填' : ''}`)
      .join('\n');

    // 3. 调用 LLM 提取
    const result = await services.callLlm('extract_metadata', {
      field_definitions: fieldDefinitions,
      ocr_text: ocrText
    });

    // 4. 解析 LLM 返回的 JSON
    let metadata;
    try {
      metadata = JSON.parse(result.text);
    } catch (e) {
      return { success: false, error: 'LLM 返回格式错误: ' + e.message };
    }

    // 5. 返回填充数据（会合并到 record.data）
    return {
      success: true,
      data: metadata
    };
  }
};
```

```javascript
// scripts/fapiao-extract/index.js
// 发票专用提取脚本（调用 fapiao 技能，一步到位）

module.exports = {
  async process(context) {
    const { record, app, files, services } = context;

    const file = files[0];
    if (!file) {
      return { success: false, error: '没有关联文件' };
    }

    // 直接调用 fapiao 技能（内部已实现 OCR + 结构化提取）
    const result = await services.callSkill('fapiao', 'extract', {
      file_path: file.file_path
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // fapiao 技能返回的数据直接映射到字段
    return {
      success: true,
      data: result.data  // { invoice_number, invoice_date, total_amount, ... }
    };
  }
};
```

### 脚本管理界面

```
┌─────────────────────────────────────────────────────────────────────────┐
│  脚本管理（系统管理 → 处理脚本）                                          │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  脚本列表                                                        │   │
│  │  ┌──────┬──────────────┬──────────┬─────────┬────────┐         │   │
│  │  │ 名称  │ 描述          │ handler  │ 状态    │ 操作   │         │   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┤         │   │
│  │  │ OCR  │ markitdown   │ scripts/ │ ✅ 启用 │ 编辑   │         │   │
│  │  │      │ + mineru回退  │ ocr      │         │ 日志   │         │   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┤         │   │
│  │  │ 提取  │ LLM元数据提取 │ scripts/ │ ✅ 启用 │ 编辑   │         │   │
│  │  │      │              │ extract  │         │ 日志   │         │   │
│  │  ├──────┼──────────────┼──────────┼─────────┼────────┤         │   │
│  │  │ 发票  │ fapiao技能   │ skills/  │ ✅ 启用 │ 编辑   │         │   │
│  │  │      │              │ fapiao   │         │ 日志   │         │   │
│  │  └──────┴──────────────┴──────────┴─────────┴────────┘         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  脚本详情页：                                                            │
│  • 基本信息：名称、描述、handler 路径                                     │
│  • 并发控制：最大并发数、超时时间、最大重试次数                             │
│  • 关联的 App：哪些 App 的哪些状态使用了这个脚本                          │
│  • 执行日志：最近 N 次执行的结果（成功/失败/耗时/输出）                    │
│  • 测试：选择一条记录手动触发执行                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 完整示例：定义"合同管理" App

```sql
-- 1. 创建脚本
INSERT INTO app_row_handlers (id, name, description, handler, handler_function, concurrency, timeout) VALUES
('script-ocr', 'OCR识别', '调用markitdown/mineru进行OCR识别', 'scripts/ocr-service', 'process', 3, 60),
('script-extract', 'LLM提取', '调用LLM从OCR文本中提取结构化元数据', 'scripts/llm-extract', 'process', 2, 120);

-- 2. 创建 App（不再包含 statuses JSON 字段）
INSERT INTO mini_apps (id, name, icon, type, fields, config)
VALUES (
  'contract-mgr',
  '销售合同管理',
  '📄',
  'document',
  -- fields
  '[
    {"name":"contract_number","label":"合同编号","type":"text","required":true,"ai_extractable":true},
    {"name":"contract_date","label":"签订日期","type":"date","required":true,"ai_extractable":true},
    {"name":"party_a","label":"甲方","type":"text","required":true,"ai_extractable":true},
    {"name":"party_b","label":"乙方","type":"text","required":true,"ai_extractable":true},
    {"name":"contract_amount","label":"合同金额","type":"number","required":true,"ai_extractable":true},
    {"name":"status","label":"状态","type":"select","options":["待审批","执行中","已完成","已终止"],"default":"待审批"},
    {"name":"contract_file","label":"合同文件","type":"file"}
  ]',
  -- config（只保留功能开关）
  '{
    "features":["upload","list","detail"],
    "supported_formats":[".pdf",".docx",".jpg"]
  }'
);

-- 3. 在 app_state 表中定义状态（统一管理状态定义、流转顺序、脚本绑定）
INSERT INTO app_state (id, app_id, name, label, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state) VALUES
-- 状态定义（按流转顺序排列）
('state-1', 'contract-mgr', 'pending_ocr', '待OCR', 1, 1, 0, 0, 'script-ocr', 'pending_extract', 'ocr_failed'),
('state-2', 'contract-mgr', 'pending_extract', '待提取', 2, 0, 0, 0, 'script-extract', 'pending_review', 'extract_failed'),
('state-3', 'contract-mgr', 'pending_review', '待确认', 3, 0, 0, 0, NULL, NULL, NULL),  -- 用户手动确认
('state-4', 'contract-mgr', 'confirmed', '已确认', 4, 0, 1, 0, NULL, NULL, NULL),  -- 终态
-- 错误状态
('state-5', 'contract-mgr', 'ocr_failed', 'OCR失败', 0, 0, 0, 1, NULL, NULL, NULL),
('state-6', 'contract-mgr', 'extract_failed', '提取失败', 0, 0, 0, 1, NULL, NULL, NULL);
```

### 方案评价

#### ✅ 优点

| 优点                     | 说明                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| **关注点分离**     | App 只定义字段和状态，处理逻辑完全在脚本中。App 配置更简洁。                                          |
| **异步天然**       | 上传即返回，处理在后台进行。用户体验更好，不需要等待 OCR/LLM。                                        |
| **可观测**         | 每条记录的状态一目了然：`pending_ocr` → `pending_extract` → `pending_review` → `confirmed` |
| **可重试**         | 失败的记录只需重置状态即可重新处理（如将 `ocr_failed` 改回 `pending_ocr`）                        |
| **灵活**           | 脚本 = 代码，可以做任何事：调 MCP、调 LLM、调技能、调外部 API、多步组合                               |
| **可组合**         | 多个脚本形成处理管线：OCR 脚本 → 提取脚本 → 验证脚本，通过状态串联                                  |
| **可管理**         | 脚本有独立的管理界面，可以启用/禁用/测试/查看日志                                                     |
| **可复用**         | 一个脚本可以被多个 App 使用（如 OCR 脚本同时服务合同管理和发票管理）                                  |
| **与现有架构一致** | 脚本 ≈ 技能的 tool，复用 `BaseMiniAppService` 的 `callMcp`/`callLlm`/`callSkill`             |

#### ⚠️ 注意事项

| 注意点               | 说明                               | 缓解措施                                                |
| -------------------- | ---------------------------------- | ------------------------------------------------------- |
| **时钟延迟**   | 处理不是即时的，取决于时钟间隔     | 时钟间隔可配置（默认 10 秒）；上传后可立即触发一次时钟  |
| **并发控制**   | 多个脚本同时运行可能过载           | 每个脚本有并发限制，全局也有并发限制                    |
| **脚本管理**   | 需要开发脚本管理界面               | Phase 1 先用数据库直接管理，后续再加 UI                 |
| **调试**       | 脚本出错时需要好的日志             | `app_action_logs` 表记录每次执行的输入/输出/错误/耗时 |
| **状态一致性** | 脚本执行中途崩溃可能导致状态不一致 | 使用 "processing_" 前缀状态 + 超时回滚机制              |

#### 🔄 与原 AI 管线方案的对比

| 维度           | AI 管线配置（原方案）       | 状态机 + 脚本（新方案）  |
| -------------- | --------------------------- | ------------------------ |
| App 配置复杂度 | 高（需配 OCR、LLM、Prompt） | 低（只需配字段和状态）   |
| 处理灵活性     | 中（配置驱动，有限组合）    | 高（代码驱动，无限可能） |
| 异步支持       | 需额外实现                  | 天然支持                 |
| 可观测性       | 中（需额外日志）            | 高（状态字段直接可见）   |
| 可重试         | 需额外实现                  | 天然支持（重置状态即可） |
| 开发成本       | 低（配置即用）              | 中（需写脚本代码）       |
| 管理复杂度     | 低（配置在 App 中）         | 中（脚本独立管理）       |
| 适合场景       | 简单、标准化的提取          | 复杂、多样化的处理       |

**结论**：状态机 + 脚本方案更适合当前需求。虽然需要多写一些脚本代码，但换来了更好的灵活性、可观测性和异步处理能力。脚本本质上就是"技能的 tool"，与现有架构完全一致。

> **注意**：本文档中之前设计的 `config.ai_assist` AI 管线配置、`app_prompt_templates` Prompt 模板表等章节，
> 在新方案中被"处理脚本"取代。Prompt 模板可以在脚本内部硬编码或从配置文件读取，
> 不再需要独立的模板表。这些旧章节保留作为参考，实际实现以本节为准。

## 场景映射

### 场景 A：合同完备性验证 → "合同管理"小程序

```
用户操作流程：
1. 打开 App → 选择"合同管理"
2. 切换到"模板管理"子页
3. 上传标准合同模板（或从已有合同创建模板）
4. 系统用 mineru 解析模板，提取条款结构
5. 切换到"合同验证"子页
6. 上传待验证合同
7. 系统解析后与模板对比，生成条款对照表
8. 标记缺失/偏差条款，高亮显示

技术路径：
  文档解析 → mineru MCP / markitdown MCP
  条款对比 → LLM (通过技能调用)
  结果展示 → 前端对比视图（左右分栏）
```

### 场景 B：文档版本差异 → "文档对比"小程序

```
用户操作流程：
1. 打开 App → 选择"文档对比"
2. 上传 v1.0 和 v1.1 两份文档
3. 系统解析两份文档
4. 生成结构化差异报告（新增/删除/修改的条款）
5. 支持并排查看和内联查看两种模式

技术路径：
  文档解析 → mineru MCP
  差异分析 → LLM + 文本 diff 算法
  结果展示 → 前端 diff 视图
```

### 场景 C：文档生命周期 → "质量文档管理"小程序

```
用户操作流程：
1. 打开 App → 选择"质量文档管理"
2. 查看文档列表（含有效期、状态标签）
3. 上传新版本文档时，系统自动关联旧版本
4. 过期文档标记为"已失效"，不参与 RAG 检索
5. 支持按文档类型、有效期、状态筛选

技术路径：
  版本管理 → 数据库版本链
  RAG 过滤 → kb_articles 增加 effective_date / expiry_date 字段
  状态提醒 → 定时任务检查过期
```

### 场景 D：合同元数据提取 → "合同管理"小程序（批量模式）

```
用户操作流程：
1. 打开 App → 选择"合同管理"
2. 点击"批量导入"
3. 上传多个合同文件（支持拖拽）
4. 系统逐个处理：
   a. OCR 识别（markitdown）
   b. LLM 提取元数据
   c. 自动填入表单
5. 用户逐个确认/修正提取结果
6. 批量保存到合同数据库

技术路径：
  OCR → markitdown MCP（批量调用）
  元数据提取 → LLM（通过技能调用）
  表单填充 → 复用已有表单系统
```

### 场景 E：发票批量入库 → "发票管理"小程序

```
用户操作流程：
1. 打开 App → 选择"发票管理"
2. 点击"批量录入"
3. 上传发票图片/PDF
4. 系统调用 OCR + fapiao 技能提取数据
5. 自动填入表单，用户确认
6. 保存到发票数据库
7. 支持导出 Excel

技术路径：
  OCR → markitdown MCP
  发票解析 → fapiao 技能（已有）
  数据存储 → 数据库
  导出 → xlsx 技能
```

## 前端 CRUD 实现策略

> **核心问题**：每个 App 的字段不同，前端表单和列表如何实现？后端 API 是否统一？

### 后端 API：完全统一

所有 App 的 CRUD 操作走**同一套 API**，通过 `appId` 区分不同的"表"：

```
GET    /api/mini-apps/:appId/data          → 查询记录列表
GET    /api/mini-apps/:appId/data/:id      → 获取记录详情
POST   /api/mini-apps/:appId/data          → 创建记录
PUT    /api/mini-apps/:appId/data/:id      → 更新记录
DELETE /api/mini-apps/:appId/data/:id      → 删除记录
POST   /api/mini-apps/:appId/extract       → AI 提取（上传文件 + OCR + LLM）
```

后端根据 `appId` 查询 `mini_apps.fields` 获取字段定义，自动做：

- **字段校验**：required 检查、类型检查（number/date/select）
- **数据存储**：统一写入 `mini_app_rows.data`（JSON）
- **权限过滤**：Phase 1 按 `user_id` 过滤

```javascript
// 统一的创建记录逻辑
async createRecord(appId, userId, inputData) {
  // 1. 获取 App 的字段定义
  const app = await MiniApp.findByPk(appId);
  const fields = app.fields; // JSON 数组
  
  // 2. 校验必填字段
  for (const field of fields) {
    if (field.required && !inputData[field.name]) {
      throw new Error(`${field.label} 为必填项`);
    }
  }
  
  // 3. 过滤只保留定义的字段（防止注入）
  const data = {};
  for (const field of fields) {
    if (inputData[field.name] !== undefined) {
      data[field.name] = this.castValue(inputData[field.name], field.type);
    }
  }
  
  // 4. 自动生成 title（取第一个 required text 字段的值）
  const titleField = fields.find(f => f.required && f.type === 'text');
  
  // 5. 写入 mini_app_rows
  return await MiniAppRow.create({
    id: generateId(),
    app_id: appId,
    user_id: userId,
    data,
    title: data[titleField?.name] || '',
    status: 'confirmed',
  });
}
```

### 前端：一个通用组件覆盖所有 App

**不需要为每个 App 单独写组件**。核心是一个 `GenericMiniApp.vue`，它根据 `mini_apps.fields` 和 `mini_apps.views` 的配置自动渲染：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  GenericMiniApp.vue 工作原理                                             │
│                                                                         │
│  1. 进入 App → 请求 GET /api/mini-apps/:appId                           │
│     → 获取 fields（字段定义）+ views（视图配置）+ config（AI 管线）       │
│                                                                         │
│  2. 根据 fields 自动渲染：                                               │
│     • 列表页 → 表格列 = fields 中 required/ai_extractable 的字段         │
│     • 表单页 → 表单字段 = fields 逐个渲染为输入控件                      │
│     • 详情页 → 字段值展示                                               │
│                                                                         │
│  3. 字段类型 → 控件映射：                                                │
│     text       → <input type="text">                                    │
│     textarea   → <textarea>                                             │
│     number     → <input type="number">                                  │
│     date       → <DatePicker>                                           │
│     select     → <Select>（options 从 field.options 读取）              │
│     file       → <FileUpload>（上传后调 /extract）                       │
│     boolean    → <Switch>                                               │
│                                                                         │
│  4. 所有 CRUD 操作调用统一 API                                           │
│     → GET /api/mini-apps/:appId/data                                    │
│     → POST /api/mini-apps/:appId/data                                   │
│     → PUT /api/mini-apps/:appId/data/:id                                │
│     → DELETE /api/mini-apps/:appId/data/:id                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 通用组件结构

```
frontend/src/components/apps/
├── GenericMiniApp.vue          # 通用小程序主组件（一个组件覆盖所有 App）
│   ├── 列表视图（表格 + 筛选 + 分页）
│   ├── 表单视图（新增/编辑，根据 fields 自动生成）
│   ├── 详情视图（字段值展示 + 关联文件）
│   └── AI 提取视图（上传文件 → AI 提取 → 预填表单）
├── fields/                     # 字段渲染组件（按类型）
│   ├── TextField.vue           # text → <input>
│   ├── TextAreaField.vue       # textarea → <textarea>
│   ├── NumberField.vue         # number → <input type="number">
│   ├── DateField.vue           # date → <DatePicker>
│   ├── SelectField.vue         # select → <Select>
│   ├── FileField.vue           # file → <FileUpload>
│   └── BooleanField.vue        # boolean → <Switch>
└── AppContainer.vue            # 容器（AI 状态、共享能力注入）
```

### GenericMiniApp.vue 核心逻辑

```vue
<script setup lang="ts">
// 1. 获取 App 定义
const route = useRoute()
const appId = route.params.appId
const { data: app } = await useFetch(`/api/mini-apps/${appId}`)

// fields: [{ name: 'contract_number', label: '合同编号', type: 'text', required: true }, ...]
const fields = computed(() => app.value?.fields || [])

// 2. 列表视图：自动生成表格列
const tableColumns = computed(() => 
  fields.value
    .filter(f => f.required || f.ai_extractable)
    .map(f => ({ key: f.name, label: f.label, sortable: true }))
)

// 3. 表单视图：根据字段类型渲染控件
function renderField(field) {
  switch (field.type) {
    case 'text': return TextField
    case 'textarea': return TextAreaField
    case 'number': return NumberField
    case 'date': return DateField
    case 'select': return SelectField
    case 'file': return FileField
    case 'boolean': return BooleanField
  }
}

// 4. CRUD 操作（统一 API）
async function loadRecords(page = 1) {
  records.value = await fetch(`/api/mini-apps/${appId}/data?page=${page}`)
}

async function saveRecord(formData) {
  if (editingId.value) {
    await fetch(`/api/mini-apps/${appId}/data/${editingId.value}`, 
      { method: 'PUT', body: formData })
  } else {
    await fetch(`/api/mini-apps/${appId}/data`, 
      { method: 'POST', body: formData })
  }
  await loadRecords()
}

async function deleteRecord(id) {
  await fetch(`/api/mini-apps/${appId}/data/${id}`, { method: 'DELETE' })
  await loadRecords()
}

// 5. AI 提取（上传文件后）
async function handleFileExtract(file) {
  const result = await fetch(`/api/mini-apps/${appId}/extract`, 
    { method: 'POST', body: { file } })
  // result.metadata 自动填入表单
  formData.value = { ...formData.value, ...result.metadata }
}
</script>
```

### 什么时候需要自定义组件？

大多数 App 用 `GenericMiniApp.vue` 就够了。只有以下场景需要写自定义组件：

| 场景                      | 通用组件能否覆盖 | 解决方案                               |
| ------------------------- | ---------------- | -------------------------------------- |
| 标准 CRUD + AI 提取       | ✅ 可以          | `GenericMiniApp.vue`                 |
| 列表 + 筛选 + 排序        | ✅ 可以          | `GenericMiniApp.vue`                 |
| 文档对比（左右分栏 diff） | ❌ 不行          | 自定义 `DocumentCompare.vue`         |
| 合同条款高亮标注          | ❌ 不行          | 自定义 `ContractReview.vue`          |
| 发票图片预览 + 明细编辑   | ❌ 不行          | 自定义 `InvoiceManager.vue`          |
| 统计图表                  | ⚠️ 部分        | 通用组件提供基础统计，复杂图表需自定义 |

**策略**：先用 `GenericMiniApp.vue` 快速上线所有 App，后续按需为特定 App 开发自定义组件。自定义组件和通用组件共享同一套后端 API 和数据模型。

### 前端路由加载逻辑

```typescript
// AppDetailView.vue
const miniAppComponent = computed(() => {
  // 如果 App 配置了自定义组件，加载自定义组件
  if (currentApp.value?.component) {
    return defineAsyncComponent(() => 
      import(`@/components/apps/mini-apps/${currentApp.value.component}.vue`))
  }
  // 否则使用通用组件
  return GenericMiniApp
})
```

## 上传 → 状态机处理 → 确认入库 完整流程

> **核心变更**：原来的"上传 → API 提取 → 前端暂存 → 确认"流程，
> 改为"上传 → 创建记录（初始状态）→ 时钟调度脚本处理 → 用户确认"。
> 处理过程完全异步，通过记录状态追踪进度。

### 整体流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│  上传 → 状态机处理 → 确认入库 完整流程                                    │
│                                                                         │
│  Step 1: 上传文件 + 创建记录                                             │
│    用户拖拽/选择文件 → POST /api/mini-apps/:appId/data                   │
│    → 文件保存到 data/attachments/                                       │
│    → 创建 mini_app_rows 记录（status = 初始状态，data = {}）          │
│    → 创建 mini_app_files 记录（关联 attachments）                        │
│    → 调用 attachment 服务上传文件（source_tag='mini_app_file'）           │
│    → 返回 record_id                                                     │
│    → 触发一次时钟扫描（不等间隔）                                        │
│                                                                         │
│  Step 2: 时钟调度 + 脚本处理（异步）                                     │
│    时钟扫描到 status = pending_ocr 的记录                                │
│    → 加载绑定的脚本（ocr-service）                                       │
│    → 脚本调用 markitdown/mineru 做 OCR                                   │
│    → 成功 → status = pending_extract                                    │
│    → 时钟再次扫描 → 加载 llm-extract 脚本                                │
│    → 脚本调用 LLM 提取元数据                                             │
│    → 成功 → status = pending_review, data = {提取的字段}                 │
│                                                                         │
│  Step 3: 前端展示处理结果                                                │
│    前端轮询记录状态 → 发现 status = pending_review                       │
│    → GenericMiniApp 的表单自动填充 data 中的字段                         │
│    → AI 提取的字段标记为 🤖 图标                                         │
│    → 用户可以修改任意字段                                                │
│    → 用户可以查看原始 OCR 文本（展开面板）                               │
│                                                                         │
│  Step 4: 用户确认入库                                                   │
│    → 用户点击"确认保存"                                                 │
│    → PUT /api/mini-apps/:appId/data/:recordId                           │
│    → body: { data: {修正后的字段值}, status: "confirmed" }               │
│    → 后端校验字段 → 更新记录状态为 confirmed                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 数据流详解

```
用户上传 contract.pdf
     │
     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  POST /api/mini-apps/:appId/data                                     │
│  Content-Type: multipart/form-data                                   │
│                                                                      │
│  后端处理：                                                           │
│  1. 保存文件到 data/attachments/2026/04/13/contract_xxx.pdf          │
│  2. 创建 mini_app_rows 记录：                                      │
│     {                                                                │
│       id: "rec_001",                                                 │
│       app_id: "contract-mgr",                                        │
│       user_id: "user_123",                                           │
│       data: {},                        ← 初始为空                    │
│       title: "contract.pdf",          ← 暂用文件名                   │
│       status: "pending_ocr"           ← 初始状态                     │
│     }                                                                │
│  3. 创建 mini_app_files 记录（关联 attachments）：                     │
│     {                                                                │
│       id: "file_001",                                                │
│       record_id: "rec_001",                                          │
│       app_id: "contract-mgr",                                        │
│       attachment_id: "att_xxx"  // 关联 attachments 表              │
│     }                                                                │
│  4. 返回 { record_id: "rec_001", status: "pending_ocr" }             │
│  5. 触发一次时钟扫描（可选优化）                                       │
└──────────────────────────────────────────────────────────────────────┘
     │
     ▼ （异步，时钟调度）
┌──────────────────────────────────────────────────────────────────────┐
│  时钟扫描：发现 rec_001 _status = pending_ocr                         │
│                                                                      │
│  1. 查找 app_state:                                                  │
│     app_id=contract-mgr, name=pending_ocr                            │
│     → 找到 handler_id = script-ocr                                    │
│                                                                      │
│  2. 将 _status 改为 "processing_pending_ocr"（防重复）                │
│                                                                      │
│  3. 加载并执行 scripts/ocr-service 的 process(context)：              │
│     context = { record, app, files, services }                       │
│     → 脚本调用 services.callMcp('markitdown', 'convert', ...)        │
│     → 脚本返回 { success: true, data: { _ocr_text, _ocr_service, _ocr_status } }│
│                                                                      │
│  4. 更新记录：                                                        │
│     UPDATE mini_app_rows SET                                      │
│       data._status = 'pending_extract',                               │
│       data._ocr_text = '...',                                          │
│       data._ocr_service = 'markitdown',                                │
│       data._ocr_status = 'completed'                                   │
│                                                                      │
│  5. 写入 app_action_logs                                             │
└──────────────────────────────────────────────────────────────────────┘
     │
     ▼ （异步，时钟再次扫描）
┌──────────────────────────────────────────────────────────────────────┐
│  时钟扫描：发现 rec_001 _status = pending_extract                     │
│                                                                      │
│  1. 查找 app_state:                                                  │
│     app_id=contract-mgr, name=pending_extract                        │
│     → 找到 handler_id = script-extract                                │
│                                                                      │
│  2. 将 _status 改为 "processing_pending_extract"                     │
│                                                                      │
│  3. 加载并执行 scripts/llm-extract 的 process(context)：              │
│     → 脚本读取 record.data._ocr_text                                │
│     → 脚本调用 services.callLlm('extract_metadata', {...})           │
│     → 脚本返回 { success: true, data: {                              │
│         contract_number: "HT-2024-001",                              │
│         contract_date: "2024-03-15",                                 │
│         party_a: "某某科技有限公司",                                  │
│         party_b: "某某集团有限公司",                                  │
│         contract_amount: 100000                                      │
│     }}                                                               │
│                                                                      │
│  4. 更新记录：                                                        │
│     UPDATE mini_app_rows SET                                      │
│       data._status = 'pending_review',                               │
│       data = '{"contract_number":"HT-2024-001",...}',                │
│       title = 'HT-2024-001',                                         │
│       ai_extracted = 1                                               │
│                                                                      │
│  5. 写入 app_action_logs                                             │
└──────────────────────────────────────────────────────────────────────┘
     │
     ▼ （前端轮询发现状态变化）
┌──────────────────────────────────────────────────────────────────────┐
│  前端：GET /api/mini-apps/:appId/data/rec_001                        │
│  返回：status = "pending_review", data = {提取的字段}                 │
│                                                                      │
│  GenericMiniApp 表单视图：                                            │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  📎 contract.pdf 已上传    [查看 OCR 原文 ▼]                  │    │
│  │  状态：✅ AI 提取完成，请确认                                  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  合同编号:  🤖 HT-2024-001                                   │    │
│  │  签订日期:  🤖 2024-03-15                                    │    │
│  │  甲    方:  🤖 某某科技有限公司                               │    │
│  │  乙    方:  🤖 某某集团有限公司                               │    │
│  │  合同金额:  🤖 100,000                                       │    │
│  │                                                              │    │
│  │  用户可以修改任意字段（点击即变为编辑状态）                     │    │
│  │                                                              │    │
│  │  [取消]  [确认保存]                                           │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                      │
│  用户修改金额为 1,000,000（AI 识别少了零）                            │
│  点击"确认保存"                                                      │
└──────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PUT /api/mini-apps/:appId/data/rec_001                              │
│  Body: {                                                             │
│    data: {                                                           │
│      contract_number: "HT-2024-001",                                 │
│      contract_date: "2024-03-15",                                    │
│      party_a: "某某科技有限公司",                                     │
│      party_b: "某某集团有限公司",                                     │
│      contract_amount: 1000000,         ← 用户修正后的值              │
│      status: "待审批"                                                │
│    },                                                                │
│    status: "confirmed"                 ← 用户确认                    │
│  }                                                                   │
│                                                                      │
│  后端处理：                                                           │
│  1. 校验字段（required 检查、类型检查）                               │
│  2. 更新 mini_app_rows：                                          │
│     data = {修正后的字段值}                                           │
│     status = "confirmed"                                             │
│  3. 返回 { record_id: "rec_001", status: "confirmed" }               │
└──────────────────────────────────────────────────────────────────────┘
```

### 批量场景（100+份文件）

> **设计决策**：批量上传不创建单独的 `batch_tasks` 记录，而是为每个文件创建独立的 `mini_app_rows` 记录。
> 进度追踪通过查询 `mini_app_rows` 按 `_status` 分组统计实现。
> 原因：OCR 处理时间（~3s/文件）远大于传输开销，单记录处理更简单可靠。

```
用户上传 50 份合同
     │
     ▼
POST /api/mini-apps/:appId/data/batch
   → 为每个文件创建一条 mini_app_rows（_status = pending_ocr, data = {}）
   → 记录上传时间戳 upload_time = NOW()
   → 返回 { upload_time: "2026-04-14T10:30:00Z", count: 50 }
     │
     ▼
时钟自动处理（并发=3）：
  扫描 pending_ocr 的记录 → 调用 ocr-service 脚本
  扫描 pending_extract 的记录 → 调用 llm-extract 脚本
  每条记录独立处理，互不影响
     │
     ▼
前端轮询 GET /api/mini-apps/:appId/status-summary?created_after=2026-04-14T10:30:00Z
   → 返回按 _status 分组统计：
   {
     "total": 50,
     "by_status": {
       "pending_ocr": 5,
       "pending_extract": 8,
       "pending_review": 20,
       "confirmed": 15,
       "ocr_failed": 2
     },
     "completed": 35,  // pending_review + confirmed
     "processing": 13, // pending_ocr + pending_extract
     "failed": 2       // 所有 is_error 状态
   }
     │
     ▼
前端展示结果列表：
  ┌────────────────────────────────────────────────────────────────┐
  │  批量处理结果（50份）                                           │    │
  │                                                                │    │
  │  ✅ HT-2024-001  某某科技  ¥100,000   [查看] [编辑] [确认]     │    │
  │  ✅ HT-2024-002  某某集团  ¥200,000   [查看] [编辑] [确认]     │    │
  │  ⏳ contract_003.pdf  处理中...                                 │    │
  │  ❌ scan_004.pdf  OCR失败                        [重试]        │    │
  │  ...                                                           │    │
  │                                                                │    │
  │  [全部确认]  [逐个确认]                                         │    │
  └────────────────────────────────────────────────────────────────┘
     │
     ▼
用户逐个确认/修正 → PUT /api/mini-apps/:appId/data/:recordId
   → 更新 data + _status = "confirmed"
```

### 状态追踪的关键设计

```
┌──────────────────────────────────────────────────────────────────────┐
│  状态追踪策略                                                        │
│                                                                      │
│  核心优势：所有中间状态都持久化在 mini_app_rows.data._status 中      │
│                                                                      │
│  单文件场景：                                                         │
│    前端轮询 GET /api/mini-apps/:appId/data/:recordId                 │
│    → 检查 data._status 字段变化                                      │
│    → pending_ocr → pending_extract → pending_review → confirmed      │
│    → 任何一步失败，前端都能看到具体错误状态                            │
│                                                                      │
│  批量场景（无 batch_tasks 表）：                                      │
│    前端轮询 GET /api/mini-apps/:appId/status-summary?created_after=T │
│    → 按 _status 分组统计                                             │
│    → 前端展示每条记录的当前状态                                       │
│    → 用时间戳筛选本次上传的记录                                       │
│                                                                      │
│  与原方案的区别：                                                     │
│    原方案：metadata 暂存在前端 state 或 batch_results 表              │
│    新方案：metadata 直接存在 mini_app_rows.data 中                 │
│    → 更简单，不需要额外的暂存机制                                     │
│    → 刷新页面不会丢失数据                                             │
│    → 每个状态变化都有 app_action_logs 记录                            │
│    → 不需要 batch_tasks 表，进度可从记录状态统计                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 小程序配置模型

> **核心问题**：一个小程序的配置到底包含哪些东西？处理流程如何通过状态机 + 脚本驱动？

### 配置的四个部分

一个小程序的配置由四部分组成：**字段定义**、**状态定义**、**视图配置**、**功能开关**。

```
┌─────────────────────────────────────────────────────────────────────────┐
│  mini_apps 一条记录 + app_state 多条记录 = 一个小程序的完整配置          │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. fields（字段定义）= 表单 + 列表 + 数据模型                    │   │
│  │     定义这张"表"有哪些列、什么类型、是否必填、选项列表             │   │
│  │     → 前端根据 fields 自动生成表单和列表列                        │   │
│  │     → 后端根据 fields 做校验和类型转换                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  2. app_state 表（状态定义）= 记录的生命周期                      │   │
│  │     定义记录可以处于哪些状态、初始状态、终态、错误状态             │   │
│  │     定义状态流转顺序（sort_order）                                │   │
│  │     定义状态绑定的处理脚本（handler_id）                          │   │
│  │     → 时钟根据 app_state 查询待处理状态                          │   │
│  │     → 前端根据状态显示处理进度                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  3. views（视图配置）= 列表怎么展示、表单怎么布局                  │   │
│  │     哪些字段在列表中显示、默认排序、筛选器                         │   │
│  │     → 前端根据 views 渲染列表视图                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  4. config（功能开关）= 启用哪些功能                              │   │
│  │     支持的文件格式、批量上限等                                     │   │
│  │     → 前端根据 config 显示/隐藏功能入口                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  注意：处理逻辑不在 App 配置中！                                        │
│  处理逻辑在 app_row_handlers 表中独立管理，                       │
│  通过 app_state 表的 handler_id 字段绑定到特定状态。                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 完整配置示例（销售合同管理）

```jsonc
// mini_apps 表一条记录
{
  "id": "contract-mgr",
  "name": "销售合同管理",
  "icon": "📄",
  "type": "document",
  "component": null,  // null = 使用 GenericMiniApp
  
  // ═══════════════════════════════════════════
  // 1. fields：字段定义（表单 + 列表 + 数据模型）
  // ═══════════════════════════════════════════
  "fields": [
    { "name": "contract_number", "label": "合同编号", "type": "text", 
      "required": true, "ai_extractable": true },
    { "name": "contract_date", "label": "签订日期", "type": "date", 
      "required": true, "ai_extractable": true },
    { "name": "party_a", "label": "甲方", "type": "text", 
      "required": true, "ai_extractable": true },
    { "name": "party_b", "label": "乙方", "type": "text", 
      "required": true, "ai_extractable": true },
    { "name": "contract_amount", "label": "合同金额", "type": "number", 
      "required": true, "ai_extractable": true },
    { "name": "start_date", "label": "开始日期", "type": "date", 
      "ai_extractable": true },
    { "name": "end_date", "label": "结束日期", "type": "date", 
      "ai_extractable": true },
    { "name": "payment_terms", "label": "付款条款", "type": "textarea", 
      "ai_extractable": true },
    { "name": "status", "label": "状态", "type": "select", 
      "options": ["待审批", "执行中", "已完成", "已终止"], "default": "待审批" },
    { "name": "contract_file", "label": "合同文件", "type": "file" }
  ],
  
  // 注意：statuses 已移到 app_state 表，不再在 mini_apps 中存储
  
  // ═══════════════════════════════════════════
  // 2. views：视图配置（列表、详情、表单布局）
  // ═══════════════════════════════════════════
  "views": {
    // 列表视图配置
    "list": {
      "columns": ["contract_number", "contract_date", "party_a", "party_b", "contract_amount", "status"],
      "sort": { "field": "contract_date", "order": "desc" },
      "filters": [
        { "field": "status", "type": "select", "label": "状态" },
        { "field": "contract_date", "type": "date_range", "label": "签订日期" }
      ],
      "row_actions": ["view", "edit", "delete"]  // 行操作按钮
    },
    
    // 详情视图配置（浏览模式）
    "detail": {
      "layout": "grid",           // 布局模式：grid（栅格）| vertical（垂直）
      "columns": 12,              // 栅格总数（12栅格系统）
      "sections": [
        {
          "title": "基本信息",
          "fields": [
            { "name": "contract_number", "span": 6 },   // 占6格（半行）
            { "name": "contract_date", "span": 6 },
            { "name": "status", "span": 6 }
          ]
        },
        {
          "title": "合同方",
          "fields": [
            { "name": "party_a", "span": 6 },
            { "name": "party_b", "span": 6 }
          ]
        },
        {
          "title": "金额与期限",
          "fields": [
            { "name": "contract_amount", "span": 6 },
            { "name": "start_date", "span": 6 },
            { "name": "end_date", "span": 6 },
            { "name": "payment_terms", "span": 12 }    // 占整行（长字段）
          ]
        }
      ]
    },
    
    // 编辑表单配置（Modal 形式）
    "form": {
      "layout": "grid",
      "columns": 12,
      "label_span": 2,            // label 占2格
      "control_span": 4,          // 控件占4格（正常字段共6格，半行）
      "sections": [
        {
          "title": "基本信息",
          "fields": [
            { "name": "contract_number", "span": 6, "editable": true },
            { "name": "contract_date", "span": 6, "editable": true },
            { "name": "status", "span": 6, "editable": true }
          ]
        },
        {
          "title": "合同方",
          "fields": [
            { "name": "party_a", "span": 6, "editable": true },
            { "name": "party_b", "span": 6, "editable": true }
          ]
        },
        {
          "title": "金额与期限",
          "fields": [
            { "name": "contract_amount", "span": 6, "editable": true },
            { "name": "start_date", "span": 6, "editable": true },
            { "name": "end_date", "span": 6, "editable": true },
            { "name": "payment_terms", "span": 12, "rows": 4, "editable": true }  // textarea 占整行，高度4行
          ]
        },
        {
          "title": "附件",
          "fields": [
            { "name": "contract_file", "span": 12, "editable": true }
          ]
        }
      ]
    }
  },
  
  // ═══════════════════════════════════════════
  // 3. config：功能开关（不含 AI 管线）
  // ═══════════════════════════════════════════
  "config": {
    "features": ["upload", "list", "detail", "stats"],
    "supported_formats": [".pdf", ".docx", ".doc", ".jpg", ".png"],
    "max_file_size": 20971520,
    "batch_enabled": true,
    "batch_limit": 50
  }
}

// ═══════════════════════════════════════════
// 状态定义（在 app_state 表中，不在 App 配置中）
// ═══════════════════════════════════════════
// app_state 表记录（按 sort_order 排序）：
//   sort_order=1: pending_ocr    → handler=script-ocr    → success=pending_extract, failure=ocr_failed
//   sort_order=2: pending_extract → handler=script-extract → success=pending_review,  failure=extract_failed
//   sort_order=3: pending_review → handler=NULL          → 用户手动确认
//   sort_order=4: confirmed      → handler=NULL          → 终态
//   is_error=1:   ocr_failed, extract_failed            → 错误状态
```

### 不同 App 的配置差异

```jsonc
// 发票管理 App — 用 fapiao 技能一步到位
{
  "fields": [
    { "name": "invoice_number", "label": "发票号码", "type": "text", "required": true, "ai_extractable": true },
    { "name": "invoice_date", "label": "开票日期", "type": "date", "required": true, "ai_extractable": true },
    { "name": "total_with_tax", "label": "价税合计", "type": "number", "ai_extractable": true },
    // ...更多字段
  ],
  "config": {
    "features": ["upload", "list", "detail", "export"],
    "supported_formats": [".pdf", ".jpg", ".png"]
  }
}
// app_state 表记录：
//   sort_order=1: pending_process → handler=fapiao-extract → success=pending_review, failure=process_failed
//   sort_order=2: pending_review  → handler=NULL         → 用户手动确认
//   sort_order=3: confirmed       → handler=NULL         → 终态
//   is_error=1:   process_failed  → handler=NULL         → 错误状态

// 质量文档管理 App — 不需要 AI 处理，纯手动录入
{
  "fields": [
    { "name": "doc_number", "label": "文档编号", "type": "text", "required": true },
    { "name": "doc_title", "label": "文档标题", "type": "text", "required": true },
    { "name": "doc_type", "label": "文档类型", "type": "select", 
      "options": ["程序文件", "作业指导书", "质量手册", "记录表单"] },
    { "name": "effective_date", "label": "生效日期", "type": "date" },
    { "name": "expiry_date", "label": "失效日期", "type": "date" },
    { "name": "doc_file", "label": "文档文件", "type": "file" }
  ],
  "config": {
    "features": ["upload", "list", "detail"],
    "supported_formats": [".pdf", ".docx"]
  }
}
// app_state 表记录（只有一个状态）：
//   sort_order=1: confirmed → is_initial=1, is_terminal=1, handler=NULL → 直接确认
```

### 配置总结

| 配置项                       | 存储位置                   | 控制什么                            | 谁读取      |
| ---------------------------- | -------------------------- | ----------------------------------- | ----------- |
| `fields`                   | `mini_apps.fields`       | 表单字段、列表列、数据校验          | 前端 + 后端 |
| 状态定义                     | `app_state` 表            | 记录状态流转、处理进度、脚本绑定    | 前端 + 时钟 |
| `views`                    | `mini_apps.views`        | 列表展示列、排序、筛选、表单分组    | 前端        |
| `config.features`          | `mini_apps.config`       | 启用哪些功能（上传/列表/统计/导出） | 前端        |
| `config.supported_formats` | `mini_apps.config`       | 允许上传的文件类型                  | 前端        |
| 处理脚本                     | `app_row_handlers` | 脚本代码、并发控制、超时            | 时钟        |

**前端只关心 `fields` + `app_state` + `views` + `config.features`**，不关心脚本细节。
**时钟只关心 `app_state` + `app_row_handlers`**，根据状态触发脚本。

## 定义一个 App 需要什么？

> **一句话**：定义一个 App = 填一张配置表（`mini_apps` 表的一条记录）+ 可选的状态脚本绑定。

### 必填项（最小可用 App）

```jsonc
// 最简 App 定义 — 只需 4 个字段
{
  "name": "销售合同管理",           // App 名称
  "icon": "📄",                    // 图标
  "type": "document",              // 类型
  "fields": [                      // 字段定义（核心！）
    { "name": "title", "label": "标题", "type": "text", "required": true },
    { "name": "amount", "label": "金额", "type": "number" },
    { "name": "date", "label": "日期", "type": "date" }
  ]
}
// → 自动获得：列表页 + 新增表单 + 编辑表单 + 详情页 + 删除
// → 没有处理脚本，纯手动录入，记录直接为 confirmed 状态
```

### 完整定义清单

```
┌─────────────────────────────────────────────────────────────────────────┐
│  定义一个 App 需要填写的内容（按层级）                                    │
│                                                                         │
│  ═══ 第一层：基本信息（必填）═══                                         │
│                                                                         │
│  ✅ name          App 名称，如"销售合同管理"                              │
│  ✅ icon          图标 emoji，如 📄                                      │
│  ✅ type          类型：document / workflow / data / utility             │
│  ✅ fields        字段定义（至少 1 个字段）                               │
│                   每个字段：name, label, type, required, options...      │
│                                                                         │
│  ═══ 第二层：状态定义（可选，不填则只有 confirmed 状态）═══               │
│                                                                         │
│  ⬜ app_state 表   状态定义列表，每个状态记录包含：                       │
│    ⬜ name            状态标识（如 pending_ocr）                         │
│    ⬜ label           显示名称（如 "待OCR"）                             │
│    ⬜ sort_order      流转顺序（1, 2, 3...）                             │
│    ⬜ is_initial      是否为初始状态                                      │
│    ⬜ is_terminal     是否为终态                                         │
│    ⬜ is_error        是否为错误状态                                      │
│    ⬜ handler_id      处理脚本 ID（可选）                                 │
│    ⬜ success_next_state  成功后转到什么状态                              │
│    ⬜ failure_next_state  失败后转到什么状态                              │
│                                                                         │
│  注意：状态定义在 app_state 表中独立管理，                               │
│  通过 sort_order 定义流转顺序，通过 handler_id 绑定脚本。                │
│                                                                         │
│  ═══ 第三层：视图配置（可选，有默认值）═══                                │
│                                                                         │
│  ⬜ views.list.columns     列表显示哪些列（默认：所有 required 字段）     │
│  ⬜ views.list.sort        默认排序（默认：按创建时间倒序）               │
│  ⬜ views.list.filters     筛选器（默认：无）                             │
│  ⬜ views.form.groups      表单分组（默认：所有字段平铺）                 │
│                                                                         │
│  ═══ 第四层：功能开关（可选，有默认值）═══                                │
│                                                                         │
│  ⬜ config.features              启用的功能（默认：upload, list, detail）│
│  ⬜ config.supported_formats     支持的文件格式（默认：.pdf, .docx, .jpg）│
│  ⬜ config.max_file_size         最大文件大小（默认：10MB）               │
│  ⬜ config.batch_enabled         是否支持批量（默认：false）              │
│  ⬜ config.batch_limit           批量上限（默认：50）                    │
│                                                                         │
│  ═══ 第五层：权限（可选，有默认值）═══                                    │
│                                                                         │
│  ⬜ visibility         可见范围（默认：all = 全员可用）                   │
│  ⬜ owner_id           App 管理员（默认：创建者）                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 定义 App 的操作方式

```
方式 1：管理员在后台 UI 创建（推荐）
  → 系统管理 → App 管理 → 新建 App
  → 表单填写：名称、图标、类型
  → 字段设计器：拖拽添加字段，设置类型和属性
  → 状态设计器：定义状态流转（可选）
  → 脚本绑定：为状态选择处理脚本（可选）
  → 保存 → 立即可用

方式 2：数据库直接插入（开发阶段）
   → INSERT INTO mini_apps (id, name, icon, type, fields, ...)
   → INSERT INTO app_state (app_id, name, label, sort_order, handler_id, ...)
   → 适合批量创建、脚本化部署

方式 3：JSON 配置文件导入（未来）
  → 上传一个 JSON 文件，包含完整的 App 定义
  → 系统解析后创建 mini_apps 记录
```

### 创建 App 的 SQL 示例

```sql
-- ========================================
-- 示例 1：纯手动 App（无 AI 处理）
-- ========================================
INSERT INTO mini_apps (id, name, icon, type, fields)
VALUES (
  'quality-docs',
  '质量文档管理',
  '📋',
  'document',
  '[...字段定义...]'
);
-- 在 app_state 表中定义唯一状态
INSERT INTO app_state (id, app_id, name, label, sort_order, is_initial, is_terminal, is_error)
VALUES ('state-1', 'quality-docs', 'confirmed', '已确认', 1, 1, 1, 0);
-- 无需绑定脚本，用户手动录入后直接 confirmed

-- ========================================
-- 示例 2：带 AI 处理的合同管理 App
-- ========================================

-- Step 1: 确保 OCR 和提取脚本已存在
-- （通常脚本只需创建一次，可被多个 App 复用）
-- INSERT INTO app_row_handlers ... （见上方"状态机与处理脚本架构"章节）

-- Step 2: 创建 App（不再包含 statuses JSON 字段）
INSERT INTO mini_apps (id, name, icon, type, fields, config)
VALUES (
  'contract-mgr',
  '销售合同管理',
  '📄',
  'document',
  '[...字段定义...]',
  '{"features":["upload","list","detail"],"supported_formats":[".pdf",".docx",".jpg"]}'
);

-- Step 3: 在 app_state 表中定义状态（统一管理状态定义、流转顺序、脚本绑定）
INSERT INTO app_state (id, app_id, name, label, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state) VALUES
-- 状态定义（按流转顺序排列）
('state-1', 'contract-mgr', 'pending_ocr', '待OCR', 1, 1, 0, 0, 'script-ocr', 'pending_extract', 'ocr_failed'),
('state-2', 'contract-mgr', 'pending_extract', '待提取', 2, 0, 0, 0, 'script-extract', 'pending_review', 'extract_failed'),
('state-3', 'contract-mgr', 'pending_review', '待确认', 3, 0, 0, 0, NULL, NULL, NULL),  -- 用户手动确认
('state-4', 'contract-mgr', 'confirmed', '已确认', 4, 0, 1, 0, NULL, NULL, NULL),  -- 终态
-- 错误状态
('state-5', 'contract-mgr', 'ocr_failed', 'OCR失败', 0, 0, 0, 1, NULL, NULL, NULL),
('state-6', 'contract-mgr', 'extract_failed', '提取失败', 0, 0, 0, 1, NULL, NULL, NULL);
```

### 总结：定义 App = 填一张表 + 可选绑定脚本

| 步骤 | 做什么                                                         | 必填？                  |
| ---- | -------------------------------------------------------------- | ----------------------- |
| 1    | 取个名字、选个图标                                             | ✅                      |
| 2    | 定义字段（name/label/type）                                    | ✅                      |
| 3    | 定义状态流转（如 pending_ocr → pending_extract → confirmed） | ⬜ 不填则直接 confirmed |
| 4    | 绑定处理脚本到状态                                             | ⬜ 不填则无自动处理     |
| 5    | 调整视图（列表列、排序、筛选）                                 | ⬜ 有默认值             |
| 6    | 设置权限（谁能用）                                             | ⬜ 默认全员             |

**最小可用**：步骤 1+2，30 秒创建一个纯手动录入的 App。
**AI 增强**：步骤 1+2+3+4，5 分钟创建一个带自动处理的 App（前提是脚本已存在）。

## 前端架构

### 页面结构

```
frontend/src/
├── views/
│   ├── AppsView.vue              # App 列表页（小程序商店）
│   └── AppDetailView.vue         # App 详情页（动态加载小程序组件）
├── components/
│   └── apps/
│       ├── AppCard.vue            # 小程序卡片（用于列表展示）
│       ├── AppContainer.vue       # 小程序容器（提供共享能力注入）
│       └── mini-apps/             # 各小程序组件
│           ├── ContractManager.vue    # 合同管理
│           ├── DocumentCompare.vue    # 文档对比
│           ├── InvoiceManager.vue     # 发票管理
│           ├── QualityDocs.vue        # 质量文档管理
│           └── ...
```

### AppsView.vue - 小程序列表页

```vue
<!-- views/AppsView.vue -->
<template>
  <div class="apps-view">
    <h1 class="view-title">{{ $t('apps.title') }}</h1>
  
    <div class="apps-grid">
      <AppCard
        v-for="app in activeApps"
        :key="app.id"
        :app="app"
        @click="openApp(app)"
      />
    </div>
  
    <div v-if="activeApps.length === 0" class="empty-state">
      <span class="empty-icon">📱</span>
      <p>{{ $t('apps.noApps') }}</p>
    </div>
  </div>
</template>
```

### AppDetailView.vue - 动态加载小程序

```vue
<!-- views/AppDetailView.vue -->
<template>
  <div class="app-detail-view">
    <!-- 小程序头部 -->
    <div class="app-header">
      <button class="btn-back" @click="goBack">← {{ $t('apps.back') }}</button>
      <div class="app-info">
        <span class="app-icon">{{ currentApp?.icon }}</span>
        <h1 class="app-name">{{ currentApp?.name }}</h1>
      </div>
    </div>
  
    <!-- 动态加载小程序组件 -->
    <AppContainer :app="currentApp">
      <component :is="miniAppComponent" :app="currentApp" />
    </AppContainer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'

// 小程序组件映射（按需加载）
const componentMap: Record<string, ReturnType<typeof defineAsyncComponent>> = {
  ContractManager: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/ContractManager.vue')
  ),
  DocumentCompare: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/DocumentCompare.vue')
  ),
  InvoiceManager: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/InvoiceManager.vue')
  ),
  QualityDocs: defineAsyncComponent(() => 
    import('@/components/apps/mini-apps/QualityDocs.vue')
  ),
}

const miniAppComponent = computed(() => {
  const comp = currentApp.value?.component
  return comp ? componentMap[comp] : null
})
</script>
```

### AppContainer.vue - 共享能力注入

```vue
<!-- components/apps/AppContainer.vue -->
<template>
  <div class="app-container">
    <!-- 全局 AI 状态提示 -->
    <div v-if="aiProcessing" class="ai-status-bar">
      <span class="ai-spinner">🤖</span>
      <span>{{ aiStatusMessage }}</span>
    </div>
  
    <!-- 小程序内容 -->
    <slot />
  
    <!-- 全局 AI 助手浮窗（可选） -->
    <div v-if="showAiAssistant" class="ai-assistant-fab">
      <button @click="toggleAiPanel">🤖</button>
    </div>
  </div>
</template>

<script setup lang="ts">
// AppContainer 提供：
// 1. AI 处理状态管理
// 2. MCP 服务调用接口
// 3. 技能调用接口
// 4. 表单系统接入
// 5. 文件上传/管理
// 6. AI 助手浮窗（可选，允许用户在 App 内与 AI 对话）
</script>
```

## 后端架构

### API 设计

```typescript
// ============================================
// 小程序管理 API
// ============================================

// 获取可用小程序列表
GET /api/mini-apps
Response: MiniApp[]

// 获取小程序详情
GET /api/mini-apps/:appId
Response: MiniApp

// ============================================
// 小程序数据操作 API（通用 CRUD）
// ============================================

// 查询小程序数据（分页、筛选）
GET /api/mini-apps/:appId/data?page=&size=&filter=&sort=
Response: { items: any[], total: number, page: number, pages: number }

// 获取单条数据详情
GET /api/mini-apps/:appId/data/:recordId
Response: any

// 创建记录（手动填写）
POST /api/mini-apps/:appId/data
Request: { metadata: Record<string, any>, attachments?: string[] }

// 更新记录
PUT /api/mini-apps/:appId/data/:recordId
Request: { metadata: Record<string, any> }

// 删除记录
DELETE /api/mini-apps/:appId/data/:recordId

// ============================================
// AI 辅助 API
// ============================================

// 上传文件并 AI 提取元数据
POST /api/mini-apps/:appId/extract
Content-Type: multipart/form-data
Request: { file: File, options?: { ocr_service?: string, extract_fields?: string[] } }
Response: {
  ocr_text: string,           // OCR 识别的文本
  metadata: Record<string, any>,  // AI 提取的元数据
  confidence: Record<string, number>,  // 各字段置信度
  file_id: string             // 文件ID
}

// 批量上传并提取
POST /api/mini-apps/:appId/extract-batch
Content-Type: multipart/form-data
Request: { files: File[], options?: {} }
Response: {
  task_id: string,            // 后台任务ID
  status: 'processing',
  total: number
}

// 查询批量处理进度
GET /api/mini-apps/:appId/batch-status/:taskId
Response: {
  task_id: string,
  status: 'processing' | 'completed' | 'partial' | 'failed',
  progress: { completed: number, total: number, failed: number },
  results?: Array<{
    file_name: string,
    metadata: Record<string, any>,
    confidence: Record<string, number>,
    status: 'success' | 'failed'
  }>
}

// 确认并保存提取结果
POST /api/mini-apps/:appId/confirm
Request: {
  records: Array<{
    file_id: string,
    metadata: Record<string, any>,
    confirmed: boolean
  }>
}

// ============================================
// 文档对比 API（场景 B）
// ============================================

// 上传两份文档进行对比
POST /api/mini-apps/:appId/compare
Request: {
  file_a_id: string,  // 旧版本文件ID
  file_b_id: string   // 新版本文件ID
}
Response: {
  comparison_id: string,
  differences: Array<{
    section: string,
    type: 'added' | 'removed' | 'modified',
    old_content?: string,
    new_content?: string,
    summary: string
  }>,
  summary: string
}

// ============================================
// 合同模板验证 API（场景 A）
// ============================================

// 上传/管理合同模板
POST /api/mini-apps/:appId/templates
Request: { name: string, file_id: string }

// 验证合同完备性
POST /api/mini-apps/:appId/verify
Request: {
  template_id: string,
  contract_file_id: string
}
Response: {
  verification_id: string,
  coverage: number,  // 覆盖率 0-100%
  missing_clauses: string[],
  modified_clauses: Array<{
    clause: string,
    expected: string,
    actual: string
  }>,
  score: number  // 合规评分 0-100
}
```

### 后端服务架构

```
server/
├── services/
│   └── mini-apps/
│       ├── MiniAppService.js          # 小程序注册管理
│       ├── MiniAppDataService.js      # 通用数据 CRUD
│       ├── AiExtractionService.js     # AI 元数据提取
│       ├── BatchProcessService.js     # 批量处理
│       └── DocumentCompareService.js  # 文档对比
├── controllers/
│   └── mini-app.controller.js
└── routes/
    └── mini-app.routes.js
```

### AI 提取流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    AI 元数据提取流程（场景 D/E 核心）                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户上传文件                                                            │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. 文件接收 & 存储                                               │   │
│  │     • 保存到 data/attachments/                                    │   │
│  │     • 生成 file_id                                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  2. OCR 识别                                                     │   │
│  │     • 调用 markitdown MCP 或 mineru MCP                          │   │
│  │     • 输入：文件路径                                              │   │
│  │     • 输出：Markdown 文本                                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  3. LLM 元数据提取                                               │   │
│  │     • 构建提取 Prompt（含字段定义和 OCR 文本）                     │   │
│  │     • 调用系统 LLM                                               │   │
│  │     • 输出：结构化 JSON                                           │   │
│  │     • 示例 Prompt：                                               │   │
│  │       "从以下合同文本中提取元数据：                                │   │
│  │        合同编号、签订日期、甲方、乙方、合同金额...                  │   │
│  │        以 JSON 格式返回。"                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  4. 结果返回前端                                                  │   │
│  │     • metadata: { contract_number: "HT-2024-001", ... }          │   │
│  │     • confidence: { contract_number: 0.95, ... }                 │   │
│  │     • 前端自动填充表单，标记 AI 填充字段                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 批量处理流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         批量处理流程                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  用户上传 N 个文件                                                       │
│       │                                                                 │
│       ▼                                                                 │
│  创建批量任务（task_id）                                                  │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  后台任务队列（串行或并行处理）                                    │   │
│  │  for each file:                                                  │   │
│  │    1. OCR 识别                                                   │   │
│  │    2. LLM 提取                                                   │   │
│  │    3. 保存中间结果                                                │   │
│  │    4. 更新进度                                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  前端轮询进度（SSE 或 polling）                                          │
│       │                                                                 │
│       ▼                                                                 │
│  全部完成后，展示提取结果列表                                              │
│  用户逐个确认/修正 → 批量保存                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 权限设计

> App 平台的权限分两层：**App 级权限**（谁能用哪个 App）和 **记录级权限**（谁能看到/操作哪些数据行）。
> 设计原则：复用现有的 RBAC + 组织架构体系，不造新轮子。

### 现有权限基础设施

系统已有以下权限组件（可直接复用）：

| 组件       | 来源                                                       | 说明                                                                                |
| ---------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| RBAC       | [`tool-permission-design.md`](../parse2/tool-permission-design.md) | `users` → `user_roles` → `roles` → `role_permissions` → `permissions` |
| 组织架构   | [`org-architecture.md`](../parse2/org-architecture.md)             | `departments`（树形）+ `positions`（含 `is_manager` 标识）                    |
| 知识库权限 | [`kb-permission-design.md`](../parse2/kb-permission-design.md)     | `visibility` ENUM('owner', 'department', 'all') + `owner_id` + `creator_id`   |
| 角色等级   | `roles.level`                                            | ENUM('user', 'power_user', 'admin')                                                 |

### 第一层：App 级权限（谁能用哪个 App）

#### 设计思路

App 级权限控制的是"用户能否看到和使用某个小程序"。参考知识库的 `visibility` 模式：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  App 级权限模型                                                          │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  visibility = 'all'（全员可用）                                   │   │
│  │  所有登录用户都能看到和使用这个 App                                 │   │
│  │  适用：发票管理（公司统一报销流程）                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  visibility = 'department'（部门可用）                            │   │
│  │  仅 owner 所在部门的成员能看到和使用                               │   │
│  │  适用：质量文档管理（仅质量部使用）                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  visibility = 'owner'（仅管理员）                                 │   │
│  │  仅 owner_id 用户和 admin 角色能使用                              │   │
│  │  适用：个人文档库、测试中的 App                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  visibility = 'role'（指定角色可用）                               │   │
│  │  通过 app_role_access 表指定哪些角色可以使用                       │   │
│  │  适用：合同管理（仅销售部+法务部+管理层）                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ⚠️ admin 角色始终能看到所有 App（与知识库一致）                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 数据模型扩展

> 完整的 SQL 语句见 [`database-schema.md`](database-schema.md) 的"权限表"章节。

`mini_apps` 表增加权限字段：`visibility`、`owner_id`、`creator_id`（已在核心表 CREATE TABLE 中包含）。
新增 `mini_app_role_access` 表用于 `visibility = 'role'` 时的角色访问控制。

#### App 可见性检查逻辑

```javascript
/**
 * 获取用户可见的 App 列表
 * 复用知识库权限检查的模式
 */
async function getAccessibleApps(user) {
  const conditions = [];
  const params = [];
  
  // 1. admin 角色看到所有
  if (user.isAdmin) {
    return await MiniApp.findAll({ where: { is_active: true } });
  }
  
  // 2. visibility = 'all'：所有人可见
  conditions.push("visibility = 'all'");
  
  // 3. visibility = 'owner'：仅 owner_id
  conditions.push("(visibility = 'owner' AND owner_id = ?)");
  params.push(user.id);
  
  // 4. visibility = 'department'：owner 同部门
  if (user.department_id) {
    conditions.push(`
      (visibility = 'department' AND 
       (SELECT department_id FROM users WHERE id = owner_id) = ?)
    `);
    params.push(user.department_id);
  }
  
  // 5. visibility = 'role'：通过 mini_app_role_access
  const userRoleIds = await getUserRoleIds(user.id);
  if (userRoleIds.length > 0) {
    conditions.push(`
      (visibility = 'role' AND 
       id IN (SELECT app_id FROM mini_app_role_access WHERE role_id IN (?)))
    `);
    params.push(userRoleIds);
  }
  
  return await MiniApp.findAll({
    where: {
      is_active: true,
      [Op.or]: conditions.map(c => Sequelize.literal(c))
    }
  });
}
```

### 第二层：记录级权限（谁能看到/操作哪些数据行）

#### Phase 1 简化方案：创建者自己可见

> **Phase 1 决定**：记录级权限先做最简单的——**创建者自己可见**。
> 即每个用户只能看到自己创建的记录，admin 和 App 管理员除外。
> 复杂的部门级/角色级共享留到后续 Phase。

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Phase 1 记录权限规则（极简）                                             │
│                                                                         │
│  查询：WHERE user_id = 当前用户ID                                        │
│  编辑：只有记录创建者可以编辑                                             │
│  删除：只有记录创建者 + admin 可以删除                                    │
│  例外：App 管理员（owner_id）+ admin 角色可以看到所有记录                  │
│                                                                         │
│  无需额外的权限表、无需 config.record_access 配置                        │
│  mini_app_rows.user_id 字段已足够                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

```javascript
// Phase 1 极简权限过滤
async function filterRecords(records, app, user) {
  // admin 和 App 管理员看所有
  if (user.isAdmin || user.id === app.owner_id) {
    return records;
  }
  // 普通用户只看自己的
  return records.filter(r => r.user_id === user.id);
}
```

#### Phase 2+ 扩展方向（预留设计）

后续如需更细粒度的记录级权限，在 `mini_apps.config.record_access` 中配置：

```yaml
# Phase 2+ 预留配置（Phase 1 不实现）
config:
  record_access:
    visibility: personal | department | all
    edit_mode: owner | department | app_managers
    delete_mode: owner_only | managers_only
    role_overrides:
      - role: finance
        visibility: all
```

详见本文档 Git 历史中的完整权限设计。

### App 创建权限

```
谁可以创建 App？

┌─────────────────────────────────────────────────────────────────────────┐
│  App 创建权限规则                                                        │
│                                                                         │
│  admin 角色                                                              │
│  ✅ 可以创建任何类型的 App                                                │
│  ✅ 可以指定任意用户为 owner_id                                           │
│  ✅ 无数量限制                                                           │
│                                                                         │
│  部门负责人（positions.is_manager = true）                                │
│  ✅ 可以为本部门创建 App                                                  │
│  ✅ owner_id 必须是同部门成员                                             │
│  ✅ visibility 默认 = 'department'                                       │
│  ✅ 无数量限制                                                           │
│                                                                         │
│  普通用户                                                                │
│  ✅ 可以创建个人 App（visibility = 'owner'）                              │
│  ❌ 不能创建部门级或全员级 App                                            │
│  📍 个人 App 限 3 个                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 与现有系统的集成

### 与表单系统的关系

App 平台复用 [`form-system-design.md`](../parse2/form-system-design.md) 中的表单系统：

| 表单系统功能        | App 平台使用方式                   |
| ------------------- | ---------------------------------- |
| `DynamicForm.vue` | 小程序中的录入/编辑表单            |
| AI 自动填充         | OCR + LLM 提取后自动填充           |
| 表单模板            | 小程序配置中的 `metadata_fields` |
| 表单提交            | 小程序数据保存                     |

**关键区别**：表单系统设计为聊天右侧面板中的表单，App 平台中的表单是**全页面**的，不需要聊天上下文。

### 与 MCP Client 的关系

复用 [`mcp-client-resident-design.md`](mcp-client-resident-design.md) 中的 MCP 连接：

```javascript
// 小程序通过 MCP Client 调用外部服务
const mcpClient = context.mcpClient;

// 调用 markitdown 做 OCR
const ocrResult = await mcpClient.callTool('markitdown', 'convert', {
  file_path: '/path/to/contract.pdf'
});

// 调用 mineru 做深度解析
const parseResult = await mcpClient.callTool('mineru', 'parse', {
  file_path: '/path/to/contract.pdf',
  output_format: 'markdown'
});
```

### 与技能系统的关系

小程序可以调用已有技能：

| 小程序   | 使用的技能                                 |
| -------- | ------------------------------------------ |
| 发票管理 | `fapiao`（发票解析）、`xlsx`（导出）   |
| 合同管理 | `pdf`（PDF 处理）、`docx`（Word 处理） |
| 文档对比 | `pdf`（PDF 处理）                        |

### 与知识库的关系

场景 C（质量文档管理）需要扩展知识库：

> 完整的 ALTER TABLE 语句见 [`database-schema.md`](database-schema.md) 的"知识库扩展"章节。

RAG 检索时增加过滤条件：`WHERE document_status = 'effective' AND (expiry_date IS NULL OR expiry_date > NOW())`

## 实施路线

### Phase 1：基础平台 + 发票管理（3周）

**目标**：搭建 App 平台框架，实现第一个小程序

| 任务               | 说明                                  | 时间 |
| ------------------ | ------------------------------------- | ---- |
| 数据库表创建       | `mini_apps` 表 + 小程序数据存储方案 | 2天  |
| 前端 App 导航      | `AppHeader` 新增 App 菜单、路由配置 | 1天  |
| AppsView 页面      | 小程序列表页（卡片网格）              | 1天  |
| AppDetailView 页面 | 动态组件加载框架                      | 2天  |
| AI 提取服务        | OCR + LLM 提取后端服务                | 3天  |
| 发票管理小程序     | 基于 fapiao 技能的发票录入            | 3天  |
| 批量处理           | 批量上传 + 后台任务 + 进度查询        | 3天  |

### Phase 2：合同管理（2周）

**目标**：实现合同元数据提取和模板验证

| 任务           | 说明                       | 时间 |
| -------------- | -------------------------- | ---- |
| 合同管理小程序 | 列表、上传、详情、统计     | 3天  |
| 合同元数据提取 | OCR + LLM 提取合同关键字段 | 2天  |
| 合同模板管理   | 模板上传、条款结构提取     | 2天  |
| 合同完备性验证 | 模板对比、缺失条款检测     | 3天  |

### Phase 3：文档对比 + 质量文档（2周）

**目标**：实现文档版本对比和文档生命周期管理

| 任务               | 说明                           | 时间 |
| ------------------ | ------------------------------ | ---- |
| 文档对比小程序     | 双文件上传、差异分析、对比视图 | 3天  |
| 质量文档管理小程序 | 文档列表、版本链、有效期管理   | 3天  |
| 知识库扩展         | kb_articles 增加生命周期字段   | 1天  |
| RAG 过滤           | 检索时过滤失效文档             | 1天  |
| 过期提醒           | 定时任务检查文档过期           | 2天  |

## ~~小程序数据存储方案~~（已整合到多维表格数据模型）

> 数据存储方案已整合到上方的"多维表格数据模型"章节。
> 核心变化：`metadata JSON` → `data JSON`，字段定义从 config 中独立为 `fields JSON`。
> 这与 APITable 的 `datasheet_record.data` 模型完全一致。

## 深度思考：小程序运行时模型

> 本节探讨小程序"到底怎么跑"这个核心问题——如何开发、如何托管、后端如何处理。

### 核心问题拆解

```
小程序的生命周期：
  开发 → 注册 → 加载 → 运行 → 数据持久化

需要回答的问题：
  1. 谁来开发小程序？（开发者？管理员？AI？）
  2. 小程序以什么形式存在？（代码？配置？混合？）
  3. 前端如何加载和渲染小程序？
  4. 后端如何执行小程序的业务逻辑？
  5. 小程序如何调用 AI 能力（LLM/技能/MCP）？
  6. 小程序的数据如何存储和查询？
```

### 三种开发模式对比

#### 模式一：配置驱动（Low-Code）

**适用场景**：标准化的 CRUD + AI 提取场景（发票管理、合同元数据录入等）

```
管理员通过 UI 配置：
  ┌─────────────────────────────────────────────────┐
  │  小程序配置器（Admin UI）                          │
  │                                                   │
  │  基本信息：名称、图标、描述                          │
  │  元数据字段：拖拽式表单设计器                        │
  │  AI 管线：选择 OCR 服务 → 选择提取模型 → 定义字段映射 │
  │  功能开关：上传、列表、详情、统计、批量               │
  │  权限：哪些角色可用                                 │
  └─────────────────────────────────────────────────┘
                    │
                    ▼
          保存为 mini_apps.config (JSON)
                    │
                    ▼
          GenericMiniApp.vue 自动渲染
```

**前端渲染**：系统提供一个通用的 `GenericMiniApp.vue` 组件，根据 `config` 自动生成：

- 列表页（表格 + 筛选 + 排序）
- 上传页（拖拽上传 + AI 提取进度）
- 详情页（元数据展示 + 关联文件）
- 统计页（基于 metadata_fields 中的数值字段）

**后端处理**：系统提供一个通用的 `GenericMiniAppService`，根据 `config` 中的 `pipeline` 定义执行：

```javascript
// 配置驱动的管线定义（存在 mini_apps.config 中）
{
  "pipeline": {
    "extract": {
      "steps": [
        { "type": "mcp", "server": "markitdown", "tool": "convert", "input": "file_path" },
        { "type": "llm", "prompt_key": "contract_metadata", "input": "previous_output" }
      ]
    },
    "verify": {
      "steps": [
        { "type": "mcp", "server": "mineru", "tool": "parse", "input": "file_path" },
        { "type": "llm", "prompt_key": "contract_clause_compare", "input": "previous_output" }
      ]
    }
  }
}
```

**优点**：零代码、快速迭代、管理员自助
**缺点**：灵活性有限，只能做预设的操作组合

#### 模式二：组件驱动（Custom Component）

**适用场景**：需要复杂交互的场景（文档对比的 diff 视图、合同条款高亮标注等）

```
开发者编写 Vue 组件：
  frontend/src/components/apps/mini-apps/
    └── DocumentCompare.vue    ← 开发者编写
  
  同时编写后端服务：
  server/services/mini-apps/
    └── DocumentCompareService.js  ← 开发者编写
```

**前端加载**：通过 `componentMap` 映射，`defineAsyncComponent` 按需加载：

```typescript
// AppDetailView.vue 中的组件映射
const componentMap = {
  // 配置驱动的通用组件
  'generic': GenericMiniApp,
  // 自定义组件
  'ContractManager': defineAsyncComponent(() =>
    import('@/components/apps/mini-apps/ContractManager.vue')),
  'DocumentCompare': defineAsyncComponent(() =>
    import('@/components/apps/mini-apps/DocumentCompare.vue')),
}
```

**后端处理**：每个自定义小程序可以有专属的 Service 类，继承 `BaseMiniAppService`：

```javascript
class DocumentCompareService extends BaseMiniAppService {
  // 可以覆写任意方法，实现自定义逻辑
  async compareFiles(fileAId, fileBId) {
    // 1. 获取两份文件的 OCR 文本
    const textA = await this.getFileOcrText(fileAId);
    const textB = await this.getFileOcrText(fileBId);
  
    // 2. 调用 LLM 做语义对比
    const diff = await this.callLlm('document_semantic_diff', {
      text_a: textA,
      text_b: textB
    });
  
    // 3. 结合文本 diff 算法
    const textDiff = this.computeTextDiff(textA, textB);
  
    // 4. 合并结果
    return this.mergeDiffResults(textDiff, diff);
  }
}
```

**优点**：完全灵活，可以实现任意 UI 和逻辑
**缺点**：需要开发者，需要随主应用一起部署

#### 模式三：混合模式（推荐）

**核心思路**：简单场景用配置，复杂场景用组件，两者可以无缝切换。

```
开发路径：
  ┌──────────────┐     需求变复杂      ┌──────────────┐
  │  配置驱动     │ ──────────────────► │  组件驱动     │
  │  (MVP 阶段)  │                     │  (成熟阶段)   │
  └──────────────┘                     └──────────────┘
        │                                    │
        │  共享同一套：                        │
        │  • 数据模型 (mini_app_rows)       │
        │  • AI 能力 (BaseMiniAppService)      │
        │  • 文件管理 (attachment service)     │
        │  • 权限体系 (同一套 auth)             │
        └────────────────────────────────────┘
```

**演进示例**：

```
发票管理小程序的演进路径：

Phase 1（配置驱动）：
  config 中定义 metadata_fields（发票号码、日期、金额...）
  config 中定义 pipeline（markitdown OCR → LLM 提取）
  使用 GenericMiniApp.vue 渲染
  → 2小时上线

Phase 2（混合）：
  发现 fapiao 技能已经能精确解析发票
  config 中 pipeline 改为调用 fapiao 技能
  仍然使用 GenericMiniApp.vue
  → 改配置即可

Phase 3（组件驱动）：
  需要发票图片预览、明细表格编辑、批量核验等复杂 UI
  开发 InvoiceManager.vue 自定义组件
  后端复用 InvoiceAppService（继承 BaseMiniAppService）
  → 数据模型不变，只是 UI 升级
```

### 后端处理架构详解

#### 分层架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          API 层 (Routes + Controller)                    │
│                                                                         │
│  mini-app.routes.js                                                     │
│    GET  /api/mini-apps                    → 列表                        │
│    GET  /api/mini-apps/:appId             → 详情                        │
│    GET  /api/mini-apps/:appId/data        → 数据查询                    │
│    POST /api/mini-apps/:appId/extract     → AI 提取                     │
│    POST /api/mini-apps/:appId/compare     → 文档对比                    │
│    POST /api/mini-apps/:appId/verify      → 合同验证                    │
│    ...                                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                        服务层 (Services)                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  MiniAppRegistry                                                 │   │
│  │  • 管理小程序注册信息                                              │   │
│  │  • 根据 appId 路由到对应的 Service                                │   │
│  │  • 如果有自定义 Service → 使用自定义                               │   │
│  │  • 如果没有 → 使用 GenericMiniAppService + config                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                         │                                               │
│            ┌────────────┼────────────┐                                  │
│            ▼            ▼            ▼                                  │
│  ┌──────────────┐ ┌──────────┐ ┌──────────────┐                       │
│  │ GenericMini  │ │ Invoice  │ │ Document     │  ...                  │
│  │ AppService   │ │ AppSvc   │ │ CompareSvc   │                       │
│  │ (配置驱动)   │ │ (自定义)  │ │ (自定义)     │                       │
│  └──────┬───────┘ └────┬─────┘ └──────┬───────┘                       │
│         │              │              │                                 │
│         └──────────────┴──────────────┘                                 │
│                        │                                                │
│                        ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  BaseMiniAppService（共享基类）                                    │   │
│  │                                                                   │   │
│  │  • callMcp(server, tool, args)    → 调用 MCP 服务                 │   │
│  │  • callLlm(promptKey, vars)       → 调用 LLM                     │   │
│  │  • callSkill(skillId, tool, args) → 调用技能                      │   │
│  │  • saveRecord(data)               → 保存数据                      │   │
│  │  • getFileOcrText(fileId)         → 获取文件 OCR 文本             │   │
│  │  • getStatusSummary(uploadTime)   → 查询批量进度（按时间戳）        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                        │                                                │
│                        ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  基础设施层                                                       │   │
│  │                                                                   │   │
│  │  MCP Client (驻留) → markitdown, mineru, ...                     │   │
│  │  ToolManager → fapiao, pdf, docx, xlsx, ...                      │   │
│  │  LLM Service → 表达心智 / 反思心智                                │   │
│  │  Attachment Service → 文件存储                                    │   │
│  │  Database → mini_app_rows, mini_app_files, ...                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 服务路由机制

```javascript
// MiniAppRegistry - 小程序服务路由器
class MiniAppRegistry {
  constructor() {
    this.customServices = new Map();
  }
  
  // 注册自定义服务
  register(appId, ServiceClass) {
    this.customServices.set(appId, new ServiceClass());
  }
  
  // 获取服务实例
  getService(appId, config) {
    // 优先使用自定义服务
    if (this.customServices.has(appId)) {
      return this.customServices.get(appId);
    }
    // 回退到通用服务（配置驱动）
    return new GenericMiniAppService(config);
  }
}

// 注册自定义服务（在应用启动时）
registry.register('invoice-manager', InvoiceAppService);
registry.register('doc-compare', DocumentCompareService);
// 合同管理、质量文档等使用 GenericMiniAppService（配置驱动）
```

#### AI 能力调用方式

小程序通过 `BaseMiniAppService` 的统一接口调用 AI 能力，无需关心底层实现：

```javascript
class BaseMiniAppService {
  
  /**
   * 调用 MCP 服务
   * 底层通过 ResidentSkillManager → MCP Client 驻留进程 → MCP Server
   */
  async callMcp(serverName, toolName, args) {
    // 通过内部 API 调用 MCP Client 驻留进程
    const result = await this.postInternal('/internal/mcp/call', {
      server_name: serverName,
      tool_name: toolName,
      arguments: args,
    });
    return result;
  }
  
  /**
   * 调用 LLM
   * 使用系统配置的 LLM，支持 prompt 模板
   */
  async callLlm(promptKey, variables) {
    // 从 prompt 库加载模板，填充变量，调用 LLM
    const prompt = await this.loadPrompt(promptKey, variables);
    const result = await this.llmService.chat(prompt);
    return result;
  }
  
  /**
   * 调用已有技能
   * 底层通过 ToolManager → 技能脚本
   */
  async callSkill(skillId, toolName, params) {
    const result = await this.postInternal('/internal/skill/execute', {
      skill_id: skillId,
      tool_name: toolName,
      params,
    });
    return result;
  }
}
```

**调用链示例**：

```
场景 E：发票管理 - 提取发票数据

前端：POST /api/mini-apps/invoice-manager/extract
  │
  ▼
mini-app.controller.js
  │
  ▼
MiniAppRegistry.getService('invoice-manager') → InvoiceAppService
  │
  ▼
InvoiceAppService.extractFromFile(filePath)
  │
  ├─► this.callSkill('fapiao', 'extract', { path: filePath })
  │     │
  │     ▼
  │   ToolManager.executeTool('fapiao', 'extract', {...})
  │     │
  │     ▼
  │   data/skills/fapiao/index.js → pdfjs-dist 坐标提取
  │     │
  │     ▼
  │   返回：{ invoice_number, invoice_date, seller, buyer, total_amount, ... }
  │
  ├─► 如果 fapiao 技能失败（扫描件），回退到：
  │   this.callMcp('markitdown', 'convert', { file_path: filePath })
  │     │
  │     ▼
  │   MCP Client 驻留进程 → markitdown MCP Server → OCR 文本
  │     │
  │     ▼
  │   this.callLlm('invoice_extraction', { ocr_text })
  │     │
  │     ▼
  │   LLM → 结构化 JSON
  │
  └─► 返回合并结果给前端
```

### 批量处理引擎

对于场景 D（100+份合同）和场景 E（批量发票），需要一个健壮的批量处理引擎：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       批量处理引擎 (BatchEngine)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  前端上传 N 个文件                                                       │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. 创建批量记录                                                  │   │
│  │     • 保存所有文件到 attachment 服务                               │   │
│  │     • 为每个文件创建 mini_app_rows（_status=初始状态）            │   │
│  │     • 记录统一的 upload_time 时间戳                                │   │
│  │     • 立即返回 upload_time + count 给前端                         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  2. 后台异步处理（Worker）                                         │   │
│  │     • 从队列中取任务                                               │   │
│  │     • 并发控制（最多 3 个同时处理，避免 LLM/MCP 过载）              │   │
│  │     • 每个文件的处理流程：                                          │   │
│  │       a. OCR 识别（调用 MCP）                                      │   │
│  │       b. AI 提取（调用 LLM 或技能）                                │   │
│  │       c. 保存中间结果到 batch_results 表                           │   │
│  │       d. 更新进度                                                  │   │
│  │     • 支持错误重试（最多 2 次）                                     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  3. 进度通知                                                      │   │
│  │     • 方案 A：SSE 推送（如果用户在线）                              │   │
│  │     • 方案 B：前端轮询 GET /status-summary?created_after=...      │   │
│  │     • 推荐先用轮询，简单可靠                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  4. 结果确认                                                      │   │
│  │     • 全部完成后，前端展示提取结果列表                              │   │
│  │     • 用户逐个确认/修正                                            │   │
│  │     • POST /confirm 批量保存到 mini_app_rows                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**批量进度查询设计**：

> **设计决策**：不使用单独的 `batch_tasks` 表。
> 批量上传时，为每个文件创建一条 `mini_app_rows`（`_status` = 初始状态），
> 所有记录共享同一个 `upload_time` 时间戳（存储在 `created_at` 字段）。
> 前端通过时间戳查询并按 `_status` 分组统计进度。

#### 进度查询 API

```typescript
// 查询批量处理进度（按上传时间戳）
GET /api/mini-apps/:appId/status-summary?created_after=2026-04-14T10:30:00Z
Response: {
  total: number,
  by_status: {
    [status_name]: count  // 如 { "pending_ocr": 5, "confirmed": 20 }
  },
  completed: number,   // 所有 is_terminal 状态的记录数
  processing: number,  // 所有非终态、非错误状态的记录数
  failed: number       // 所有 is_error 状态的记录数
}
```

#### 后端实现示例

```javascript
// 批量进度查询服务
async getStatusSummary(appId, createdAfter) {
  // 1. 查询该时间之后创建的所有记录
  const records = await MiniAppRow.findAll({
    where: {
      app_id: appId,
      created_at: { [Op.gte]: createdAfter }
    },
    attributes: ['_status']
  });
  
  // 2. 按 _status 分组统计
  const byStatus = {};
  for (const record of records) {
    const status = record._status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }
  
  // 3. 获取状态定义，判断终态和错误状态
  const stateDefs = await AppState.findAll({ where: { app_id: appId } });
  const terminalStates = stateDefs.filter(s => s.is_terminal).map(s => s.name);
  const errorStates = stateDefs.filter(s => s.is_error).map(s => s.name);
  
  // 4. 计算汇总指标
  const completed = terminalStates.reduce((sum, s) => sum + (byStatus[s] || 0), 0);
  const failed = errorStates.reduce((sum, s) => sum + (byStatus[s] || 0), 0);
  const processing = records.length - completed - failed;
  
  return {
    total: records.length,
    by_status: byStatus,
    completed,
    processing,
    failed
  };
}
```

#### 前端进度展示

```javascript
// 前端轮询进度
async function pollProgress(uploadTime) {
  const summary = await fetch(
    `/api/mini-apps/${appId}/status-summary?created_after=${uploadTime}`
  );
  
  // 更新进度条
  progressPercent = (summary.completed / summary.total) * 100;
  statusText = `已完成 ${summary.completed}/${summary.total}，失败 ${summary.failed}`;
  
  // 判断是否完成
  if (summary.processing === 0) {
    // 所有记录都已处理完毕（成功或失败）
    showResultsList();
  }
}
```

### ~~Prompt 模板管理~~（已废弃 — 由处理脚本内部管理）

> **注意**：在新架构中，Prompt 模板由处理脚本内部管理（硬编码或从配置文件读取），
> 不再需要独立的 `app_prompt_templates` 表。本节保留作为参考。
> 如需 Prompt 模板管理功能，建议在 Phase 2+ 作为可选增强实现。

#### ~~Prompt 模板表~~（可选增强，Phase 1 不实现）

AI 提取的质量很大程度上取决于 Prompt。需要一个 Prompt 模板管理系统：

```sql
-- Prompt 模板表
CREATE TABLE app_prompt_templates (
    id VARCHAR(32) PRIMARY KEY,
    app_id VARCHAR(32) COMMENT '关联小程序（NULL=全局可用）',
  
    prompt_key VARCHAR(128) NOT NULL COMMENT '模板标识',
    name VARCHAR(128) NOT NULL COMMENT '模板名称',
    description TEXT COMMENT '描述',
  
    -- Prompt 内容
    system_prompt TEXT COMMENT '系统提示词',
    user_prompt_template TEXT NOT NULL COMMENT '用户提示词模板（支持 {{变量}}）',
  
    -- 输出格式
    output_format ENUM('json', 'text', 'markdown') DEFAULT 'json',
    output_schema JSON COMMENT '期望的 JSON 输出结构',
  
    -- 模型参数
    temperature DECIMAL(3,2) DEFAULT 0.1 COMMENT '温度（提取任务用低温度）',
  
    is_active BIT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
    UNIQUE INDEX idx_app_key (app_id, prompt_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='小程序 Prompt 模板';
```

**Prompt 模板示例**：

```yaml
# 合同元数据提取
prompt_key: "contract_metadata_extraction"
system_prompt: |
  你是一个合同分析专家。从给定的合同文本中提取结构化元数据。
  请严格按照 JSON Schema 输出，不要添加额外字段。
  如果某个字段无法从文本中确定，请设为 null。
user_prompt_template: |
  请从以下合同文本中提取元数据：
  
  ## 期望字段
  {{field_definitions}}
  
  ## 合同文本
  {{ocr_text}}
  
  请以 JSON 格式返回。
output_format: json
output_schema:
  type: object
  properties:
    contract_number: { type: string, description: "合同编号" }
    contract_date: { type: string, format: date }
    party_a: { type: string }
    party_b: { type: string }
    contract_amount: { type: number }
    start_date: { type: string, format: date }
    end_date: { type: string, format: date }
temperature: 0.1
```

### 文件处理管线详解

```
文件上传后的完整处理流程：

  用户上传 contract.pdf
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  Attachment Service（已有）                                    │
  │  • 保存文件到 data/attachments/2026/04/13/                    │
  │  • 生成 file_id                                               │
  │  • 记录文件元信息（名称、大小、MIME）                           │
  └──────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  OCR 服务选择（根据文件类型和小程序配置）                        │
  │                                                                │
  │  文件类型判断：                                                 │
  │    .pdf (文本型) → markitdown（快速、轻量）                     │
  │    .pdf (扫描型) → mineru（深度解析、OCR）                      │
  │    .docx/.doc   → markitdown                                  │
  │    .jpg/.png    → mineru（纯图片 OCR）                         │
  │                                                                │
  │  如何判断 PDF 是否扫描型？                                      │
  │    方案 1：先用 markitdown 尝试，如果输出为空或过短 → 切 mineru  │
  │    方案 2：用 pdfjs 检查是否有文本层                            │
  │    推荐：方案 1，简单有效                                       │
  └──────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  OCR 执行                                                     │
  │  • 调用 MCP Client → markitdown/mineru                        │
  │  • 输入：文件路径                                               │
  │  • 输出：Markdown 文本                                         │
  │  • 保存 OCR 结果到 mini_app_rows.data._ocr_text                │
  └──────────────────────────────────────────────────────────────┘
       │
       ▼
  ┌──────────────────────────────────────────────────────────────┐
  │  AI 提取                                                      │
  │                                                                │
  │  两种路径：                                                    │
  │                                                                │
  │  路径 A：技能直出（如 fapiao）                                  │
  │    • fapiao 技能直接返回结构化数据                              │
  │    • 无需 LLM，速度快、精度高                                  │
  │    • 适合标准化文档（发票、身份证等）                            │
  │                                                                │
  │  路径 B：LLM 提取（通用）                                      │
  │    • 使用 Prompt 模板 + OCR 文本                               │
  │    • LLM 返回结构化 JSON                                       │
  │    • 适合非标准化文档（合同、报告等）                            │
  │                                                                │
  │  选择逻辑：                                                    │
  │    if (config.skill_id && skill 支持该文件类型) → 路径 A       │
  │    else → 路径 B                                               │
  └──────────────────────────────────────────────────────────────┘
       │
       ▼
  返回给前端：{ ocr_text, metadata, confidence, file_id }
```

### 前端通用组件架构

对于配置驱动的小程序，`GenericMiniApp.vue` 需要自动渲染以下视图：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  GenericMiniApp.vue                                                     │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Tab Bar（根据 config.features 动态生成）                         │   │
│  │  [列表] [上传] [统计] [设置]                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  列表视图 (features 包含 'list')                                  │   │
│  │                                                                   │   │
│  │  筛选栏：根据 metadata_fields 中的 type=select/date 生成          │   │
│  │  搜索框：全文搜索（标题、OCR 文本）                                │   │
│  │                                                                   │   │
│  │  ┌───────┬────────┬────────┬────────┬──────┬──────────┐         │   │
│  │  │ 标题  │ 字段1   │ 字段2   │ 字段3  │ 状态 │ 操作     │         │   │
│  │  ├───────┼────────┼────────┼────────┼──────┼──────────┤         │   │
│  │  │ ...   │ ...    │ ...    │ ...    │ 草稿 │ 查看 编辑│         │   │
│  │  └───────┴────────┴────────┴────────┴──────┴──────────┘         │   │
│  │                                                                   │   │
│  │  表格列：从 metadata_fields 中取 required + ai_extractable 字段    │   │
│  │  分页：复用 Pagination.vue                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  上传视图 (features 包含 'upload')                                │   │
│  │                                                                   │   │
│  │  ┌─────────────────────────────────────────────────────────┐     │   │
│  │  │  拖拽上传区域                                            │     │   │
│  │  │  支持：.pdf, .docx, .jpg, .png                          │     │   │
│  │  └─────────────────────────────────────────────────────────┘     │   │
│  │                                                                   │   │
│  │  上传后：                                                         │   │
│  │  ┌─────────────────────────────────────────────────────────┐     │   │
│  │  │  AI 提取进度                                             │     │   │
│  │  │  ████████████░░░░ 75% (3/4 文件已完成)                   │     │   │
│  │  └─────────────────────────────────────────────────────────┘     │   │
│  │                                                                   │   │
│  │  提取完成后：                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────┐     │   │
│  │  │  DynamicForm（复用已有表单系统）                          │     │   │
│  │  │  • AI 提取的字段标记为 🤖 自动填充                        │     │   │
│  │  │  • 置信度低的字段标记为 ⚠️ 需确认                         │     │   │
│  │  │  • 用户可修改任意字段                                     │     │   │
│  │  └─────────────────────────────────────────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 与聊天系统的联动

小程序和聊天不是割裂的，而是可以互相增强：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  联动方式                                                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. App → 聊天（数据引用）                                               │
│     用户在聊天中可以说：                                                  │
│     "帮我查一下 HT-2024-001 这份合同的条款"                              │
│     → 专家通过技能查询 mini_app_rows                                  │
│     → 返回合同详情                                                       │
│                                                                         │
│  2. 聊天 → App（操作引导）                                               │
│     用户在聊天中说："我要录入一批发票"                                    │
│     → AI 回复："你可以使用发票管理小程序批量录入，点击这里打开 →"          │
│     → 提供跳转链接到 /apps/invoice-manager                               │
│                                                                         │
│  3. App 内嵌 AI 助手                                                     │
│     小程序右下角的 AI 浮窗按钮                                           │
│     → 点击展开侧边对话面板                                               │
│     → 用户可以问："这份合同有什么问题？"                                  │
│     → AI 基于当前打开的合同数据回答                                       │
│     → 上下文自动包含当前记录的 metadata 和 OCR 文本                      │
│                                                                         │
│  4. App 操作日志 → 聊天                                                  │
│     小程序中的操作（上传、提取、确认）可以作为系统消息                     │
│     → 插入到当前对话的上下文中                                           │
│     → 专家可以感知用户的操作历史                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 开发工作流

```
开发一个小程序的完整流程：

  ┌─────────────┐
  │  1. 需求分析  │  确定场景、元数据字段、AI 管线需求
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  2. 选择模式  │  配置驱动 or 组件驱动？
  │              │  • 标准 CRUD + AI 提取 → 配置驱动
  │              │  • 复杂交互/自定义 UI → 组件驱动
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  3. 定义配置  │
  │  (配置驱动)   │  • 在 mini_apps 表中插入记录
  │              │  • 定义 metadata_fields
  │              │  • 定义 pipeline
  │              │  • 定义 prompt 模板
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  3. 编写代码  │
  │  (组件驱动)   │  • Vue 组件 (frontend)
  │              │  • Service 类 (backend)
  │              │  • Prompt 模板
  │              │  • 注册到 MiniAppRegistry
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  4. 测试     │  • 单文件提取测试
  │              │  • 批量处理测试
  │              │  • 边界情况（扫描件、非标准格式）
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  5. 上线     │  • 数据库迁移
  │              │  • 前端构建部署
  │              │  • 小程序注册（mini_apps 表）
  └─────────────┘
```

### 技术决策总结

| 决策点             | 选择                                      | 理由                                                                                 |
| ------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| **数据模型** | **多维表格（Bitable）**             | **借鉴飞书/APITable 的 Table→Field→Record 三层模型，一套表结构覆盖所有场景** |
| 字段存储           | JSON（`mini_apps.fields`）              | 灵活定义，无需 ALTER TABLE 即可新增字段类型                                          |
| 行数据存储         | JSON（`mini_app_rows.data`）         | 与 APITable 的 `datasheet_record.data` 一致，通用且灵活                            |
| **处理架构** | **状态机 + 处理脚本 + 时钟调度**    | **异步处理、可观测、可重试、关注点分离**                                       |
| 记录状态           | JSON 字段 `data._status` + 虚拟列索引    | 状态作为数据的一部分，通过虚拟列实现高效查询                                         |
| 状态定义           | 独立表（`app_state`）                    | 统一管理状态定义、流转顺序、脚本绑定，可查询可排序                                   |
| 处理脚本           | 独立模块（`app_row_handlers`）    | 脚本可复用、可管理、可测试                                                           |
| 时钟调度           | Node.js 定时器 + 即时触发                 | 简单可靠，上传后可立即触发                                                           |
| 索引策略           | 初期纯 JSON 查询，按需加虚拟列            | 避免过早优化，数据量增长后再针对性加速                                               |
| 开发模式           | 混合（配置 + 组件）                       | 简单场景零代码，复杂场景全灵活                                                       |
| 前端加载           | defineAsyncComponent                      | 按需加载，不影响首屏                                                                 |
| 后端架构           | Service 层 + 共享基类                     | 复用 AI 能力，避免重复代码                                                           |
| AI 调用            | 脚本内部调用（callMcp/callLlm/callSkill） | App 配置不关心 AI 细节，脚本内部实现                                                 |
| 批量处理           | 时钟自动处理 + 轮询                       | 每条记录独立处理，天然支持批量                                                       |
| 文件处理           | 脚本内先 OCR 后提取，支持回退             | 兼顾速度和准确率                                                                     |

## 文档库 → 知识库同步

> **场景**：用户把合同、质量文档等丢进 App 平台后，希望其中某些文档能被 AI 在问答时引用（作为知识库使用）。需要定义同步机制。

### 核心问题

1. **选择性同步**：不是所有文档都要进知识库（发票不需要，质量文档需要）
2. **版本管理**：质量文档有版本链，知识库中只保留当前生效版本
3. **增量同步**：新增/修改文档后，知识库要自动更新
4. **双向关联**：知识库中的文章要能追溯到 App 中的原始记录

### 关键洞察：状态即事件

经过讨论确认：**每个事件都可以映射到一个状态**，因此现有的 `app_state` 状态机模型已经足够覆盖所有场景，无需引入独立的事件驱动系统。

| 事件场景 | 状态映射 | 说明 |
|---------|---------|------|
| 创建后 OCR + 提取 | `pending_ocr` → `pending_extract` → `confirmed` | 现有模型直接支持 |
| 确认后同步知识库 | `confirmed` → `synced` | 增加 `synced` 状态即可 |
| 更新后重新处理 | `confirmed` → `pending_review` | 状态回退，触发重新处理 |
| 删除前审核 | 不需要状态 | 前端确认弹窗即可 |
| 金额 > 100万需经理审批 | `pending_review` → `pending_approval` → `confirmed` | 增加审批状态 |

### 数据模型

> 完整的 ALTER TABLE 语句见 [`database-schema.md`](database-schema.md) 的"知识库扩展"章节。

`mini_apps.config` 中增加 `kb_sync` 配置项：

```jsonc
// config.kb_sync 字段：
{
  "enabled": true,
  "kb_id": "kb_xxx",           // 目标知识库ID
  "category_field": "doc_type", // 用哪个字段作为知识库分类
  "content_source": "ocr_text", // 内容来源：ocr_text 或某个 textarea 字段
  "title_field": "doc_title",   // 用哪个字段作为文章标题
  "sync_on_confirm": true       // 确认后自动同步
}
```

### 同步处理器

通过 `app_state` 表配置 `confirmed` → `synced` 的状态流转，时钟扫描自动触发 KB 同步：

```sql
-- confirmed → synced 的状态定义（在 app_state 表中）
INSERT INTO app_state (id, app_id, name, label, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state)
VALUES ('state-sync', 'app_xxx', 'synced', '已同步', 5, 0, 1, 0, 'handler_kb_sync', NULL, 'sync_failed');

-- confirmed 状态需要更新 success_next_state 指向 synced
UPDATE app_state SET success_next_state = 'synced' 
WHERE app_id = 'app_xxx' AND name = 'confirmed';
```

```javascript
// scripts/kb-sync/index.js
module.exports = {
  async process(context) {
    const { record, app, files, services } = context;
    
    const syncConfig = app.config?.kb_sync;
    if (!syncConfig?.enabled) {
      return { success: true, data: {} };
    }
    
    // 1. 获取内容
    const content = syncConfig.content_source === 'ocr_text'
      ? record.data._ocr_text
      : record.data[syncConfig.content_source];
    
    if (!content) {
      return { success: false, error: '没有可同步的内容' };
    }
    
    // 2. 创建/更新知识库文章
    const title = record.data[syncConfig.title_field] || record.title;
    const category = record.data[syncConfig.category_field];
    
    const existing = await services.callSkill('kb-editor', 'find_article', {
      kb_id: syncConfig.kb_id,
      source_record_id: record.id
    });
    
    if (existing) {
      await services.callSkill('kb-editor', 'update_article', {
        article_id: existing.id,
        title, content, category,
        effective_date: record.data.effective_date,
        expiry_date: record.data.expiry_date,
        version: record.data.version
      });
    } else {
      await services.callSkill('kb-editor', 'create_article', {
        kb_id: syncConfig.kb_id,
        title, content, category,
        source_type: 'app_sync',
        source_app_id: app.id,
        source_record_id: record.id,
        effective_date: record.data.effective_date,
        expiry_date: record.data.expiry_date,
        version: record.data.version
      });
    }
    
    return { success: true, data: { synced: true } };
  }
};
```

### RAG 检索过滤

```sql
-- 只从生效的文档中检索
WHERE (source_type = 'manual' OR document_status = 'effective')
  AND (expiry_date IS NULL OR expiry_date > NOW())
```

### 版本管理场景

```
质量文档 v1.0 → 同步到知识库（effective）
质量文档 v2.0 → 同步到知识库（effective）
                → v1.0 自动标记为 superseded

RAG 检索时只返回 effective 状态的文章
```

### Phase 规划

| Phase | 功能 |
|-------|------|
| Phase 1 | 确认后手动同步（用户点击"同步到知识库"按钮） |
| Phase 2 | 确认后自动同步（通过 confirmed → synced 状态事件） |
| Phase 2 | 版本管理（新版本同步时自动标记旧版本为 superseded） |
| Phase 3 | 文档过期自动检查（scheduler 定时任务） |

## 总结

App 平台的核心价值：

1. **多维表格内核**：借鉴飞书 Bitable / APITable 的 Table→Field→Record 三层模型，一套数据结构覆盖所有文档类和数据库类需求
2. **状态机驱动**：记录通过状态流转驱动处理，异步、可观测、可重试
3. **处理脚本化**：AI 处理逻辑独立为脚本，可复用、可管理、可测试，与 App 配置解耦
4. **落地感强**：用户打开"合同管理"App，看到的是熟悉的列表/表单界面，而非聊天窗口
5. **能力复用**：所有小程序共享 LLM、技能、MCP 服务，脚本内部调用，无需重复集成
6. **渐进式**：从简单的发票管理开始，逐步扩展到合同、文档对比等复杂场景
7. **与聊天互补**：App 处理结构化操作，聊天处理探索性对话，两者不冲突
8. **开发友好**：配置驱动让简单场景零代码，组件驱动让复杂场景全灵活

## 表单布局设计详解

> **设计原则**：表单分两套配置（编辑/浏览），使用12栅格系统，支持字段可编辑性控制。

### 12栅格布局系统

```
┌─────────────────────────────────────────────────────────────────────────┐
│  12栅格布局系统                                                           │
│                                                                         │
│  每行共12格，分为左右两组：                                               │
│                                                                         │
│  正常字段（占6格 = 半行）：                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  [2格 label] [4格 控件]     │    [2格 label] [4格 控件]         │   │
│  │  合同编号: [________]       │    签订日期: [________]           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  长字段（占12格 = 整行）：                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  [2格 label] [10格 控件]                                        │   │
│  │  付款条款: [________________________________]                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  textarea（占12格，可配置高度）：                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  备注:                                                           │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │                                                         │   │   │
│  │  │  （高度可配置：rows=2, 3, 4, 5...）                      │   │   │
│  │  │                                                         │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 编辑表单 vs 浏览表单

```
┌─────────────────────────────────────────────────────────────────────────┐
│  两套表单配置的区别                                                       │
│                                                                         │
│  浏览表单（detail）：                                                     │
│  • 用于详情页展示，所有字段只读                                           │
│  • 不需要 editable 配置（默认都不可编辑）                                 │
│  • 控件渲染为静态文本（如 <span>而非<input>）                            │
│  • 用于快速查看记录内容                                                   │
│                                                                         │
│  编辑表单（form）：                                                       │
│  • 用于 Modal 编辑，字段可编辑性需配置                                    │
│  • editable: true → 可编辑                                              │
│  • editable: false → 不可编辑（如 AI 提取后锁定）                        │
│  • editable: "conditional" → 条件可编辑（如状态=草稿时可编辑）           │
│  • 用于新增/编辑记录                                                     │
│                                                                         │
│  示例：                                                                   │
│  { "name": "contract_number", "span": 6, "editable": true }            │
│  { "name": "ai_extracted_at", "span": 6, "editable": false }           │
│  { "name": "status", "span": 6, "editable": "status=='draft'" }        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 字段布局属性

| 属性 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `span` | number | 字段占用的栅格数（1-12） | `6`（半行），`12`（整行） |
| `label_span` | number | label 占用的栅格数（默认2） | `2` |
| `control_span` | number | 控件占用的栅格数（默认4） | `4` |
| `rows` | number | textarea 高度（行数） | `4` |
| `editable` | boolean/string | 是否可编辑 | `true`, `false`, `"status=='draft'"` |
| `visible` | boolean/string | 是否可见 | `true`, `false`, `"amount>10000"` |

### Modal 编辑界面

```
┌─────────────────────────────────────────────────────────────────────────┐
│  编辑 Modal                                                              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  编辑合同：HT-2024-001                                    [×]   │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │                                                                   │   │
│  │  ┌─ 基本信息 ───────────────────────────────────────────────┐   │   │
│  │  │  合同编号: [HT-2024-001____]  │  签订日期: [2024-03-15__] │   │   │
│  │  │  状态:     [执行中 ▼]         │                           │   │   │
│  │  └───────────────────────────────────────────────────────────┘   │   │
│  │                                                                   │   │
│  │  ┌─ 合同方 ─────────────────────────────────────────────────┐   │   │
│  │  │  甲方: [某某科技有限公司____] │ 乙方: [某某集团有限公司____]│   │   │
│  │  └───────────────────────────────────────────────────────────┘   │   │
│  │                                                                   │   │
│  │  ┌─ 金额与期限 ─────────────────────────────────────────────┐   │   │
│  │  │  合同金额: [100000____]      │ 开始日期: [2024-04-01__]  │   │   │
│  │  │  结束日期: [2025-03-31__]    │                           │   │   │
│  │  │  付款条款: [________________________________________]    │   │   │
│  │  │              （textarea, rows=4, 占整行）                 │   │   │
│  │  └───────────────────────────────────────────────────────────┘   │   │
│  │                                                                   │   │
│  │  ┌─ 附件 ───────────────────────────────────────────────────┐   │   │
│  │  │  合同文件: [contract.pdf] [更换]                          │   │   │
│  │  └───────────────────────────────────────────────────────────┘   │   │
│  │                                                                   │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │                              [取消]  [保存]                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 非OCR应用的纯录入场景

```
┌─────────────────────────────────────────────────────────────────────────┐
│  非OCR应用的信息录入流程                                                  │
│                                                                         │
│  对于不需要 OCR 处理的 App（如质量文档管理）：                             │
│                                                                         │
│  1. 用户打开 App → 点击"新增"                                            │
│  2. 弹出编辑 Modal                                                       │
│  3. 用户手动填写表单字段                                                 │
│  4. 点击保存 → 直接创建 confirmed 状态的记录                             │
│  5. 无需状态流转，无需脚本处理                                            │
│                                                                         │
│  配置要点：                                                               │
│  • app_state 只有一个状态：confirmed（is_initial=1, is_terminal=1）    │
│  • 无 handler_id 绑定                                                   │
│  • views.form 中所有字段 editable: true                                 │
│                                                                         │
│  SQL 示例：                                                               │
│  INSERT INTO app_state (id, app_id, name, label, sort_order,            │
│    is_initial, is_terminal, is_error, handler_id)                       │
│  VALUES ('state-1', 'quality-docs', 'confirmed', '已确认',              │
│    1, 1, 1, 0, NULL);                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 列表页与详情页结构

### 列表页结构

```
┌─────────────────────────────────────────────────────────────────────────┐
│  列表页结构                                                              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  工具栏                                                          │   │
│  │  [+ 新增] [批量导入] [导出 Excel]                    搜索: [___]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  筛选栏                                                          │   │
│  │  状态: [全部 ▼]  签订日期: [2024-01-01] ~ [2024-12-31]          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  数据表格                                                        │   │
│  │  ┌───────┬────────┬────────┬────────┬────────┬──────┬────────┐│   │
│  │  │ 编号  │ 日期    │ 甲方    │ 乙方    │ 金额    │ 状态 │ 操作   ││   │
│  │  ├───────┼────────┼────────┼────────┼────────┼──────┼────────┤│   │
│  │  │ HT-01 │ 03-15  │ 某某科技│ 某某集团│ ¥100K  │ 执行 │ 查看   ││   │
│  │  │       │        │        │        │        │      │ 编辑   ││   │
│  │  │       │        │        │        │        │      │ 删除   ││   │
│  │  ├───────┼────────┼────────┼────────┼────────┼──────┼────────┤│   │
│  │  │ HT-02 │ 04-01  │ ...    │ ...    │ ¥200K  │ 草稿 │ ...    ││   │
│  │  └───────┴────────┴────────┴────────┴────────┴──────┴────────┘│   │
│  │                                                                 │   │
│  │  分页：[<] 1 2 3 4 5 ... 20 [>]  共 200 条                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 详情页结构

```
┌─────────────────────────────────────────────────────────────────────────┐
│  详情页结构                                                              │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  头部                                                            │   │
│  │  ← 返回列表    合同详情：HT-2024-001                    [编辑] │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  基本信息                                                        │   │
│  │  合同编号: HT-2024-001          │  签订日期: 2024-03-15          │   │
│  │  状态:     执行中               │                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  合同方                                                          │   │
│  │  甲方: 某某科技有限公司          │  乙方: 某某集团有限公司          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  金额与期限                                                      │   │
│  │  合同金额: ¥100,000             │  开始日期: 2024-04-01          │   │
│  │  结束日期: 2025-03-31           │                                │   │
│  │  付款条款: 分三期付款，首付款30%，验收后50%，尾款20%...          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  附件                                                            │   │
│  │  合同文件: contract.pdf  [下载] [预览]                           │   │
│  │  OCR 原文: [展开查看 ▼]                                          │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  处理历史                                                        │   │
│  │  2024-03-15 10:30  OCR 完成 (markitdown)                        │   │
│  │  2024-03-15 10:32  LLM 提取完成                                  │   │
│  │  2024-03-15 10:35  用户确认                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 事件触发与状态解耦讨论

> **核心问题**：是否需要独立的 event 表来跟踪事件触发？

### 现有设计：状态即事件

经过分析，**每个事件都可以映射到一个状态**，因此现有的 `app_state` 状态机模型已经足够覆盖所有场景：

| 事件场景 | 状态映射 | 说明 |
|---------|---------|------|
| 文件上传完成 | `pending_ocr` | 上传后自动进入待OCR状态 |
| OCR 处理完成 | `pending_extract` | OCR成功后自动进入待提取状态 |
| LLM 提取完成 | `pending_review` | 提取成功后进入待确认状态 |
| 用户确认 | `confirmed` | 用户点击确认后进入已确认状态 |
| OCR 失败 | `ocr_failed` | OCR失败进入错误状态 |
| 提取失败 | `extract_failed` | 提取失败进入错误状态 |
| 同步知识库 | `synced` | 确认后同步完成进入已同步状态 |

### 为什么不需要独立的 event 表？

```
┌─────────────────────────────────────────────────────────────────────────┐
│  状态机模型 vs 事件驱动模型                                               │
│                                                                         │
│  状态机模型（当前设计）：                                                 │
│  • 状态变化 = 事件发生                                                   │
│  • app_action_logs 记录每次状态转换的详细信息                            │
│  • 时钟扫描状态 → 触发脚本 → 状态转换                                    │
│  • 简单、直观、易于理解和调试                                             │
│                                                                         │
│  事件驱动模型（备选方案）：                                               │
│  • 需要独立的 app_events 表                                             │
│  • 事件类型：upload_complete, ocr_complete, extract_complete...        │
│  • 事件处理器监听事件 → 触发动作                                         │
│  • 更复杂，需要额外的事件总线机制                                         │
│                                                                         │
│  结论：                                                                   │
│  • 状态机模型已足够覆盖所有场景                                           │
│  • app_action_logs 表已记录所有"事件"详情                                │
│  • 无需引入额外复杂度                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### app_action_logs 作为事件日志

`app_action_logs` 表已经承担了事件日志的功能：

```sql
-- app_action_logs 记录每次状态转换（即事件）
CREATE TABLE app_action_logs (
    id VARCHAR(32) PRIMARY KEY,
    handler_id VARCHAR(32) NOT NULL,     -- 处理脚本
    record_id VARCHAR(32) NOT NULL,      -- 记录ID
    app_id VARCHAR(32) NOT NULL,         -- App ID
    
    trigger_status VARCHAR(64) NOT NULL, -- 触发时的状态（事件来源）
    result_status VARCHAR(64),           -- 执行后的状态（事件结果）
    
    success BIT(1) NOT NULL,             -- 是否成功
    output_data JSON,                    -- 输出数据
    error_message TEXT,                  -- 错误信息
    
    duration INT,                        -- 耗时（毫秒）
    retry_count INT DEFAULT 0,           -- 重试次数
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**查询事件历史示例**：

```sql
-- 查询某条记录的所有处理事件
SELECT 
    trigger_status AS event_from,
    result_status AS event_to,
    success,
    duration,
    created_at AS event_time
FROM app_action_logs
WHERE record_id = 'rec_001'
ORDER BY created_at;

-- 结果：
-- event_from      | event_to        | success | duration | event_time
-- pending_ocr     | pending_extract | 1       | 2300     | 2024-03-15 10:30
-- pending_extract | pending_review  | 1       | 5200     | 2024-03-15 10:32
```

### 特殊事件场景的处理

对于一些特殊事件场景，可以通过扩展状态定义来处理：

```
┌─────────────────────────────────────────────────────────────────────────┐
│  特殊事件场景的状态扩展                                                   │
│                                                                         │
│  场景：金额 > 100万需经理审批                                             │
│                                                                         │
│  状态流转扩展：                                                           │
│  pending_review → pending_approval → approved → confirmed              │
│                                                                         │
│  SQL 定义：                                                               │
│  INSERT INTO app_state VALUES                                           │
│  ('state-approval', 'contract-mgr', 'pending_approval', '待审批',       │
│   3.5, 0, 0, 0, 'handler_notify_manager', 'approved', 'approval_failed');│
│                                                                         │
│  脚本 handler_notify_manager：                                          │
│  • 发送通知给经理                                                        │
│  • 经理在 App 中审批                                                     │
│  • 审批通过 → approved 状态                                              │
│  • 审批拒绝 → approval_failed 状态                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## OCR 类应用的数据结构定义流程

> **核心流程**：定义数据结构 → 构建 Prompt → OCR 返回结构化数据 → 回填字段 → 状态更新

### 完整流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│  OCR 类应用的数据处理流程                                                 │
│                                                                         │
│  Step 1: 定义 App 的数据结构（fields）                                   │
│    • 在 mini_apps.fields 中定义所有需要提取的字段                        │
│    • 设置 ai_extractable: true 标记可由 AI 提取的字段                   │
│    • 设置 required: true 标记必填字段                                   │
│                                                                         │
│  Step 2: 定义状态流转（app_state）                                       │
│    • pending_ocr → pending_extract → pending_review → confirmed        │
│    • 绑定 OCR 脚本和 LLM 提取脚本                                        │
│                                                                         │
│  Step 3: 上传文件 → 创建记录                                             │
│    • 用户上传文件                                                        │
│    • 创建 mini_app_rows（_status = pending_ocr, data = {}）            │
│    • 创建 mini_app_files（关联 attachments）                            │
│                                                                         │
│  Step 4: OCR 脚本处理                                                    │
│    • 时钟扫描 pending_ocr 状态的记录                                     │
│    • 脚本调用 markitdown/mineru 做 OCR                                   │
│    • OCR 文本存入 data._ocr_text                                        │
│    • 状态更新为 pending_extract                                          │
│                                                                         │
│  Step 5: LLM 提取脚本处理                                                │
│    • 时钟扫描 pending_extract 状态的记录                                 │
│    • 脚本读取 data._ocr_text                                            │
│    • 脚本根据 fields 定义构建提取 Prompt                                 │
│    • 调用 LLM → 返回结构化 JSON                                          │
│    • JSON 数据回填到 data 字段                                           │
│    • 状态更新为 pending_review                                           │
│                                                                         │
│  Step 6: 用户确认                                                        │
│    • 前端展示提取结果（AI 提取字段标记 🤖）                               │
│    • 用户可修改任意字段                                                  │
│    • 用户点击确认 → 状态更新为 confirmed                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### LLM 提取 Prompt 构建

```javascript
// scripts/llm-extract/index.js
// 根据 fields 定义自动构建提取 Prompt

function buildExtractPrompt(fields, ocrText) {
  // 1. 筛选可提取字段
  const extractableFields = fields.filter(f => f.ai_extractable);
  
  // 2. 构建字段定义描述
  const fieldDefs = extractableFields.map(f => {
    let def = `- ${f.name} (${f.label}): 类型=${f.type}`;
    if (f.required) def += ', 必填';
    if (f.options) def += `, 选项=[${f.options.join('|')}]`;
    return def;
  }).join('\n');
  
  // 3. 构建输出 Schema
  const schema = {};
  for (const f of extractableFields) {
    schema[f.name] = null;  // 默认值
  }
  
  // 4. 组装 Prompt
  return `
你是一个文档数据提取专家。请从以下文档内容中提取结构化数据。

## 需要提取的字段
${fieldDefs}

## 输出要求
- 以 JSON 格式返回
- 如果某个字段无法从文档中确定，请设为 null
- 不要添加额外字段

## 输出 Schema
${JSON.stringify(schema, null, 2)}

## 文档内容
${ocrText}

请返回提取的 JSON 数据：
`;
}
```

### LLM 返回数据回填

```javascript
// LLM 返回的数据直接合并到 record.data
async function processExtractResult(record, llmResult) {
  // 1. 解析 LLM 返回的 JSON
  let extractedData;
  try {
    extractedData = JSON.parse(llmResult.text);
  } catch (e) {
    return { success: false, error: 'LLM 返回格式错误' };
  }
  
  // 2. 字段校验（根据 fields 定义）
  for (const field of app.fields) {
    if (field.required && !extractedData[field.name]) {
      // 必填字段缺失，记录警告但不阻止流程
      console.warn(`必填字段 ${field.name} 未提取到`);
    }
  }
  
  // 3. 数据回填（合并到现有 data）
  const newData = {
    ...record.data,
    ...extractedData,
    _status: 'pending_review',
    _extracted_at: new Date().toISOString()
  };
  
  // 4. 更新记录
  await MiniAppRow.update(
    { data: newData, ai_extracted: 1 },
    { where: { id: record.id } }
  );
  
  return { success: true, data: extractedData };
}
```

### 前端展示提取结果

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AI 提取结果展示                                                          │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  📎 contract.pdf 已上传                                          │   │
│  │  状态：✅ AI 提取完成，请确认                                      │   │
│  │  [查看 OCR 原文 ▼]                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  合同编号:  🤖 HT-2024-001        │  签订日期: 🤖 2024-03-15      │   │
│  │  甲    方:  🤖 某某科技有限公司    │  乙    方: 🤖 某某集团有限公司 │   │
│  │  合同金额:  🤖 ¥100,000           │  状    态: [待审批 ▼]        │   │
│  │                                                                   │   │
│  │  🤖 = AI 自动提取，点击可修改                                      │   │
│  │  ⚠️ = 置信度低，建议人工确认                                       │   │
│  │                                                                   │   │
│  │  [取消]  [确认保存]                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 事件驱动设计（CRUD 事件处理器）

> **用户需求**：对于任何一个 App 的记录，应该有固定的几种事件（新增、修改、删除）。
> 对于每个事件，允许定义对应的操作脚本，这是**事件驱动**。
> 与**状态驱动**（业务逻辑状态流转）是两种不同的驱动模式，两者可以并存。

### 两种驱动模式对比

```
┌─────────────────────────────────────────────────────────────────────────┐
│  两种驱动模式                                                            │
│                                                                         │
│  ════════════════════════════════════════════════════════════════════  │
│  模式一：事件驱动（CRUD Events）                                         │
│  ════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  触发时机：固定的 CRUD 操作                                              │
│    • create  → 记录创建后                                               │
│    • update  → 记录更新后                                               │
│    • delete  → 记录删除前（可阻止）                                      │
│                                                                         │
│  执行方式：同步执行（阻塞 API 响应）                                      │
│    • 脚本执行完毕后才返回 API 结果                                       │
│    • 失败可选择：阻止操作、记录日志、忽略继续                             │
│                                                                         │
│  适用场景：                                                              │
│    • 数据校验（创建前检查必填字段）                                       │
│    • 自动计算（创建后自动生成编号）                                       │
│    • 关联更新（修改后同步更新其他表）                                     │
│    • 权限检查（删除前检查是否有关联数据）                                 │
│    • 通知发送（创建后发送通知）                                          │
│                                                                         │
│  ════════════════════════════════════════════════════════════════════  │
│  模式二：状态驱动（Business States）                                     │
│  ════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  触发时机：业务状态流转                                                  │
│    • pending_ocr → pending_extract → pending_review → confirmed        │
│                                                                         │
│  执行方式：异步执行（时钟调度）                                          │
│    • 上传后立即返回，后台异步处理                                        │
│    • 通过轮询查询处理进度                                                │
│                                                                         │
│  适用场景：                                                              │
│    • OCR 处理（耗时操作）                                               │
│    • LLM 提取（AI 元数据提取）                                          │
│    • 知识库同步（确认后同步）                                            │
│    • 审批流程（状态流转）                                                │
│                                                                         │
│  ════════════════════════════════════════════════════════════════════  │
│  两者并存                                                                │
│  ════════════════════════════════════════════════════════════════════  │
│                                                                         │
│  示例：合同管理 App                                                      │
│    • 事件驱动：创建后自动生成合同编号 HT-{YYYY}-{0000}                   │
│    • 状态驱动：上传后 OCR → LLM 提取 → 用户确认                          │
│                                                                         │
│  执行顺序：                                                              │
│    1. 用户上传文件 → POST /api/mini-apps/:appId/data                   │
│    2. 事件驱动脚本执行（create 事件）                                    │
│       → 自动生成编号、校验字段                                           │
│       → 同步执行，阻塞响应                                               │
│    3. 记录创建成功，状态设为 pending_ocr                                 │
│    4. 状态驱动脚本执行（时钟调度）                                       │
│       → OCR → LLM 提取                                                  │
│       → 异步执行，不阻塞                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 数据模型：app_event_handlers 表

> **完整的 CREATE TABLE 语句见 [`database-schema.md`](database-schema.md) 的"事件处理器表"章节。

```sql
CREATE TABLE app_event_handlers (
    id VARCHAR(32) PRIMARY KEY,
    app_id VARCHAR(32) NOT NULL COMMENT '小程序ID',
    
    -- 事件类型（固定三种）
    event_type ENUM('create', 'update', 'delete') NOT NULL COMMENT '事件类型',
    
    -- 处理脚本
    handler_id VARCHAR(32) NOT NULL COMMENT '处理脚本ID',
    
    -- 执行控制
    priority INT DEFAULT 0 COMMENT '执行优先级（数值越小越先执行）',
    execution_mode ENUM('sync', 'async') DEFAULT 'sync' COMMENT '执行模式：sync=同步阻塞，async=异步',
    
    -- 失败处理策略
    failure_policy ENUM('block', 'log', 'ignore') DEFAULT 'log' COMMENT '失败策略：block=阻止操作，log=记录日志继续，ignore=忽略',
    
    -- 条件过滤（可选）
    condition JSON COMMENT '触发条件，如 {"amount": {"$gt": 10000}}',
    
    is_active BIT(1) DEFAULT 1 COMMENT '是否启用',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    UNIQUE KEY uk_app_event_handler (app_id, event_type, handler_id),
    FOREIGN KEY (app_id) REFERENCES mini_apps(id) ON DELETE CASCADE,
    FOREIGN KEY (handler_id) REFERENCES app_row_handlers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='App 事件处理器';
```

### 事件类型详解

| 事件类型 | 触发时机 | 执行顺序 | 可阻止操作 | 典型用途 |
|---------|---------|---------|-----------|---------|
| `create` | 记录创建后 | API 返回前执行 | ✅ 可以 | 自动编号、数据校验、通知发送 |
| `update` | 记录更新后 | API 返回前执行 | ✅ 可以 | 关联更新、审计日志、状态检查 |
| `delete` | 记录删除前 | 删除前执行 | ✅ 可以 | 权限检查、关联数据检查、清理资源 |

### 失败策略详解

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `block` | 阻止操作，返回错误给用户 | 数据校验失败、权限检查失败 |
| `log` | 记录日志，继续执行操作 | 通知发送失败、非关键检查失败 |
| `ignore` | 忽略错误，继续执行 | 可选的增强功能失败 |

### 条件过滤语法

`condition` 字段支持 JSON 条件表达式，用于限定脚本触发条件：

```jsonc
// 示例条件
{ "amount": { "$gt": 10000 } }                    // 金额 > 10000 时触发
{ "status": "draft" }                              // 状态为草稿时触发
{ "$or": [{ "amount": { "$gt": 10000 } }, { "type": "important" }] }  // 或条件

// 支持的操作符
$eq   → 等于
$ne   → 不等于
$gt   → 大于
$gte  → 大于等于
$lt   → 小于
$lte  → 小于等于
$in   → 在列表中
$nin  → 不在列表中
$or   → 或条件
$and  → 且条件
```

### 脚本示例

#### 创建后自动编号

```javascript
// scripts/auto-number/index.js
module.exports = {
  async process(context) {
    const { record, app, event } = context;
    
    // 只在合同管理 App 执行
    if (app.id !== 'contract-mgr') {
      return { success: true, data: {} };
    }
    
    // 生成合同编号：HT-{YYYY}-{0000}
    const year = new Date().getFullYear();
    const count = await context.services.query(`
      SELECT COUNT(*) as count FROM mini_app_rows 
      WHERE app_id = 'contract-mgr' 
        AND JSON_EXTRACT(data, '$.contract_number') LIKE 'HT-${year}%'
    `);
    
    const number = `HT-${year}-${String(count + 1).padStart(4, '0')}`;
    
    return {
      success: true,
      data: { contract_number: number }
    };
  }
};
```

#### 删除前检查关联数据

```javascript
// scripts/check-relations/index.js
module.exports = {
  async process(context) {
    const { record, app, event } = context;
    
    // 检查是否有关联的发票
    const invoices = await context.services.query(`
      SELECT COUNT(*) as count FROM mini_app_rows
      WHERE app_id = 'invoice-mgr'
        AND JSON_EXTRACT(data, '$.contract_id') = ?
    `, [record.id]);
    
    if (invoices.count > 0) {
      return {
        success: false,
        error: `该合同关联了 ${invoices.count} 张发票，无法删除`,
        block: true  // 阻止删除操作
      };
    }
    
    return { success: true, data: {} };
  }
};
```

#### 更新后发送通知

```javascript
// scripts/send-notification/index.js
module.exports = {
  async process(context) {
    const { record, app, event, oldRecord } = context;
    
    // 只在状态变更时发送通知
    if (record.data.status === oldRecord?.data?.status) {
      return { success: true, data: {} };
    }
    
    // 发送通知（失败不影响主操作）
    try {
      await context.services.callSkill('notification', 'send', {
        to: record.data.owner_id,
        title: `合同状态变更：${record.data.contract_number}`,
        content: `状态从 "${oldRecord.data.status}" 变为 "${record.data.status}"`
      });
    } catch (e) {
      // 记录日志但不阻止操作
      console.error('通知发送失败:', e.message);
    }
    
    return { success: true, data: {} };
  }
};
```

### 执行流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│  事件驱动执行流程                                                        │
│                                                                         │
│  用户操作：POST /api/mini-apps/:appId/data                              │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  1. 查询 app_event_handlers                                      │   │
│  │     WHERE app_id = ? AND event_type = 'create' AND is_active = 1│   │
│  │     ORDER BY priority ASC                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  2. 检查 condition 条件                                          │   │
│  │     对每个 handler，检查 condition 是否满足                      │   │
│  │     不满足则跳过该 handler                                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  3. 执行脚本（按 priority 顺序）                                  │   │
│  │     for each handler:                                            │   │
│  │       a. 加载脚本 handler                                         │   │
│  │       b. 调用 process(context)                                    │   │
│  │       c. 根据结果：                                               │   │
│  │          success → 合并 data 到记录                               │   │
│  │          failure + block → 返回错误，阻止操作                     │   │
│  │          failure + log → 记录日志，继续                           │   │
│  │          failure + ignore → 忽略，继续                            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  4. 所有脚本执行完毕                                              │   │
│  │     • 无阻止 → 创建记录，返回成功                                  │   │
│  │     • 有阻止 → 返回错误，不创建记录                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 管理界面

```
┌─────────────────────────────────────────────────────────────────────────┐
│  系统管理 → App 管理 → 事件处理器                                         │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  事件处理器列表                                                  │   │
│  │  ┌──────┬────────┬──────────┬────────┬────────┬────────┬──────┐│   │
│  │  │ App   │ 事件    │ 脚本      │ 优先级  │ 失败策略│ 条件    │ 操作 ││   │
│  │  ├──────┼────────┼──────────┼────────┼────────┼────────┼──────┤│   │
│  │  │ 合同  │ create │ 自动编号  │ 1      │ block  │ 无     │ 编辑 ││   │
│  │  │ 管理  │        │          │        │        │        │ 删除 ││   │
│  │  ├──────┼────────┼──────────┼────────┼────────┼────────┼──────┤│   │
│  │  │ 合同  │ delete │ 关联检查  │ 1      │ block  │ 无     │ 编辑 ││   │
│  │  │ 管理  │        │          │        │        │        │ 删除 ││   │
│  │  ├──────┼────────┼──────────┼────────┼────────┼────────┼──────┤│   │
│  │  │ 合同  │ update │ 发送通知  │ 2      │ log    │ 状态变更│ 编辑 ││   │
│  │  │ 管理  │        │          │        │        │        │ 删除 ││   │
│  │  └──────┴────────┴──────────┴────────┴────────┴────────┴──────┘│   │
│  │                                                                 │   │
│  │  [+ 新增事件处理器]                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  新增事件处理器弹窗：                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  App：[合同管理 ▼]                                               │   │
│  │  事件类型：[create ▼]  (create/update/delete)                    │   │
│  │  处理脚本：[自动编号 ▼]                                           │   │
│  │  优先级：[1]  （数值越小越先执行）                                │   │
│  │  执行模式：[同步 ▼]  (sync/async)                                │   │
│  │  失败策略：[阻止 ▼]  (block/log/ignore)                          │   │
│  │  触发条件：[JSON 条件表达式，可选]                                │   │
│  │             例如：{"amount": {"$gt": 10000}}                     │   │
│  │  [取消]  [保存]                                                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### API 接口

```typescript
// 获取 App 的事件处理器列表
GET /api/mini-apps/:appId/event-handlers
Response: EventHandler[]

// 创建事件处理器（管理员）
POST /api/mini-apps/:appId/event-handlers
Request: { event_type, handler_id, priority, execution_mode, failure_policy, condition }

// 更新事件处理器（管理员）
PUT /api/mini-apps/:appId/event-handlers/:handlerId

// 删除事件处理器（管理员）
DELETE /api/mini-apps/:appId/event-handlers/:handlerId

// 测试事件处理器
POST /api/mini-apps/:appId/event-handlers/:handlerId/test
Request: { record_id: string, event_type: 'create' | 'update' | 'delete' }
Response: { success: boolean, data?: any, error?: string, blocked?: boolean }
```

### Phase 规划

| Phase | 功能 | 说明 |
|-------|------|------|
| **Phase 1** | 状态驱动（已设计） | OCR → LLM 提取 → 用户确认，先实现 |
| **Phase 2** | 事件驱动基础 | create/update/delete 事件处理器，同步执行 |
| **Phase 3** | 事件驱动增强 | 条件过滤、异步执行、复杂编排 |

### 事件驱动与状态驱动的协调

```
┌─────────────────────────────────────────────────────────────────────────┐
│  两种驱动模式的协调                                                      │
│                                                                         │
│  完整流程示例：合同管理 App                                              │
│                                                                         │
│  用户上传合同文件                                                        │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  POST /api/mini-apps/contract-mgr/data                          │   │
│  │                                                                   │   │
│  │  Step 1: 事件驱动（create 事件）                                  │   │
│  │    • 自动编号脚本 → 生成 HT-2024-0001                            │   │
│  │    • 数据校验脚本 → 检查必填字段                                  │   │
│  │    • 同步执行，阻塞响应                                           │   │
│  │    • 失败 → 返回错误，不创建记录                                  │   │
│  │                                                                   │   │
│  │  Step 2: 创建记录                                                 │   │
│  │    • 写入 mini_app_rows                                          │   │
│  │    • data = { contract_number: "HT-2024-0001", ... }            │   │
│  │    • _status = "pending_ocr"                                     │   │
│  │                                                                   │   │
│  │  Step 3: 返回响应                                                 │   │
│  │    • { record_id: "rec_001", status: "pending_ocr" }            │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                                                                  │
│      ▼ （异步，时钟调度）                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Step 4: 状态驱动（pending_ocr 状态）                            │   │
│  │    • OCR 脚本 → markitdown/mineru                                │   │
│  │    • 异步执行，不阻塞                                             │   │
│  │    • 成功 → _status = "pending_extract"                          │   │
│  │                                                                   │   │
│  │  Step 5: 状态驱动（pending_extract 状态）                        │   │
│  │    • LLM 提取脚本 → 提取元数据                                    │   │
│  │    • 异步执行                                                     │   │
│  │    • 成功 → _status = "pending_review"                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                                                                  │
│      ▼ （用户确认）                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  PUT /api/mini-apps/contract-mgr/data/rec_001                   │   │
│  │                                                                   │   │
│  │  Step 6: 事件驱动（update 事件）                                  │   │
│  │    • 发送通知脚本 → 通知相关人员                                  │   │
│  │    • 同步执行                                                     │   │
│  │    • 失败策略 = log → 失败不影响确认                              │   │
│  │                                                                   │   │
│  │  Step 7: 更新记录                                                 │   │
│  │    • _status = "confirmed"                                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 总结

| 维度 | 事件驱动 | 状态驱动 |
|------|---------|---------|
| 触发源 | CRUD 操作（固定） | 业务状态流转（可配置） |
| 执行方式 | 同步阻塞 | 异步时钟调度 |
| 失败处理 | 可阻止操作 | 记录错误状态 |
| 适用场景 | 校验、计算、通知 | OCR、LLM、审批 |
| 实现优先级 | Phase 2+ | **Phase 1（先实现）** |

✌Bazinga！
