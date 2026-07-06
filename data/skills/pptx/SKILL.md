---
name: pptx
description: "PowerPoint 演示文稿处理。用于读取现有 PPTX 基本信息、文本、表格、图表基础数据与备注，创建新演示文稿，并提取媒体文件。支持在新建演示文稿时添加文本、图片、表格、图表、形状、媒体与演讲者备注。当用户提到 .pptx 文件或需要操作 PowerPoint 时触发。"
license: MIT
argument-hint: "[file|slide|object|master] [action] [path]"
user-invocable: true
---

# PPTX - PowerPoint 演示文稿处理

> **依赖**：pptxgenjs 4.0+ (创建演示文稿) + adm-zip (读取现有 PPTX)

## ⚠️ 重要限制

**pptxgenjs 4.0 只能创建新演示文稿，无法编辑现有文件！**

- ✅ **支持**：创建新演示文稿、读取现有文件信息、提取内容
- ❌ **不支持**：编辑现有 PPTX 文件（添加/修改/删除幻灯片或对象）

**编辑现有文件的替代方案**：
1. 使用 `file read` 读取现有文件内容
2. 使用 `file create` 创建新文件，添加修改后的内容
3. 删除原文件，重命名新文件

---

## 工具

本技能提供四个工具：

| 工具 | 最终名称 | 说明 |
|------|----------|------|
| `file` | `pptx__file` | 文件级操作（读取、创建、提取） |
| `slide` | `pptx__slide` | 幻灯片创建（仅限新建演示文稿） |
| `object` | `pptx__object` | 内容对象操作（添加、提取） |
| `master` | `pptx__master` | 模板母版（定义、列出） |

---

## file - 文件级操作

通过 `action` 参数区分具体操作：

| action | 功能 | 关键参数 |
|--------|------|----------|
| `read` | 读取演示文稿信息 | `scope`, `slideNumbers` |
| `create` | 创建演示文稿 | `source`, `slides`, `markdown` |
| `extract` | 提取媒体文件 | `outputDir`, `extractType` |

### read - 读取演示文稿

**参数**：
- `action` (string, required): `"read"`
- `path` (string, required): PPTX 文件路径
- `scope` (string, optional): 读取范围
  - `info`: 基本信息（幻灯片数量、元数据）
  - `text`: 提取所有文本内容
  - `structure`: 提取页面级粗粒度结构信息（文本形状、图片、表格、图表、媒体引用、对象顺序及基础变换信息）
  - `normalized`: 提取标准化 slide object model，可直接作为 JSON 中间表示消费
  - `media`: 提取媒体信息（图片、视频列表）和幻灯片引用关系
  - `tables`: 提取表格内容
  - `charts`: 提取图表基础数据（类型、系列、标签、数值）
  - `notes`: 提取演讲者备注文本
- `includeAssets` (boolean, optional): 当 `scope = "normalized"` 时，是否内联 `presentation.assetMap`，用于直接 round-trip 重建资源对象

`structure` 结果会按幻灯片返回 `summary`、`notes` 与 `objects`。它更适合作为分析视图使用，用于理解页面内容与结构，不建议作为默认编辑入口。

`normalized` 在 `structure` 基础上提供显式的标准化导出入口，返回更收敛的 schema：仅保留 `presentation`、`slides[].summary` 和 `slides[].objects[]` 下的核心字段，适合直接持久化为 JSON 或作为后续重建输入。当前 read/create 结果都会回显 `schema` 元信息，其中包含 `presentation`、`slide`、`object` 三层契约定义。

当前实现中，normalized 的支持矩阵与对象校验已经共享同一套 schema 定义，`requirements` / `requirementsAnyOf` 与 `warningCode` 会同时体现在支持矩阵和创建阶段反馈中。schema 里还会显式回显字段级 `required`、`properties`、`defaults` 和 `example`，便于 LLM 或调用方按字段约束生成/修正对象。

**默认推荐工作流**：
1. `file read` with `scope: "normalized"`
2. 修改 normalized JSON
3. `file create` with `source: "normalized"`

**支持矩阵（normalized -> create）**：
- `text`: `full`，要求 `content.text`
- `image`: `partial`，要求 `source.path`、`source.data` 或 `source.assetKey`；仅有 `embedId` 时会返回 `image-resource-mapping-required`
- `table`: `partial`，要求 `content.previewRows`
- `chart`: `basic`，要求 `content.chartType` 与 `content.series`
- `shape`: `basic`，支持基础 shape 参数
- `notes`: `full`，要求 `content.text`
- `media`: `partial`，要求 `source.path` / `source.data` / `source.assetKey`；缺失资源映射时会返回 `media-resource-mapping-required`

- `slideNumbers` (number[], optional): 指定幻灯片编号

**示例**：
```javascript
// 读取基本信息
pptx__file({ action: "read", path: "presentation.pptx", scope: "info" })

// 提取文本
pptx__file({ action: "read", path: "presentation.pptx", scope: "text" })

// 提取结构
pptx__file({ action: "read", path: "presentation.pptx", scope: "structure" })

// 导出标准化模型
pptx__file({ action: "read", path: "presentation.pptx", scope: "normalized" })

// 导出可直接 round-trip 的标准化模型（内联资源）
pptx__file({ action: "read", path: "presentation.pptx", scope: "normalized", includeAssets: true })

// 提取备注
pptx__file({ action: "read", path: "presentation.pptx", scope: "notes" })
```

### create - 创建演示文稿

**参数**：
- `action` (string, required): `"create"`
- `path` (string, required): 输出文件路径
- `source` (string, optional): 创建来源 - `data`、`markdown` 或 `normalized`（默认: `data`）
- `slides` (object[], optional): 幻灯片数据数组
- `markdown` (string, optional): Markdown 内容（当前支持一级标题、二级标题、普通文本、无序列表）
- `normalized` (object, optional): 标准化 slide object model，可选包含 `assetMap`
- `properties` (object, optional): 文档属性
  - `title`: 标题
  - `author`: 作者
  - `company`: 公司
  - `layout`: 布局（`LAYOUT_16x9`, `LAYOUT_4x3`, `LAYOUT_WIDE`）

**示例**：
```javascript
// 从数据创建
pptx__file({
  action: "create",
  path: "new.pptx",
  slides: [
    { title: "第一章", content: "这是内容" },
    { title: "第二章", texts: ["要点一", "要点二"] }
  ],
  properties: { title: "我的演示", author: "张三" }
})

// 从 Markdown 创建
pptx__file({
  action: "create",
  path: "markdown.pptx",
  source: "markdown",
  markdown: "# 标题页\n\n## 内容\n- 要点一\n- 要点二"
})

// 从标准化模型重建（当前最小支持 text/table/notes/chart/shape/image）
pptx__file({
  action: "create",
  path: "normalized.pptx",
  source: "normalized",
  normalized: {
    slides: [
      {
        number: 1,
        objects: [
          { kind: "text", content: { text: "标题" }, transform: { inches: { x: 0.5, y: 0.5, w: 4, h: 0.5 } } },
          { kind: "table", content: { previewRows: [["A", "B"], ["1", "2"]] }, transform: { inches: { x: 0.5, y: 1.5, w: 5 } } },
          { kind: "chart", name: "销量", content: { chartType: "bar", series: [{ name: "Sales", labels: ["Q1", "Q2"], values: [10, 20] }] }, transform: { inches: { x: 0.5, y: 3.5, w: 5, h: 3 } } },
          { kind: "notes", content: { text: "讲解备注" } }
        ]
      }
    ]
  }
})
```

使用 `source: "normalized"` 创建时，返回结果会额外包含 `rebuildStats`、结构化 `warnings`、normalized 版本元信息和支持矩阵回显，便于判断哪些对象已成功重建、哪些对象被跳过。`warnings` 现在还会附带 `suggestedFix`，方便基于 warning code 自动修正对象。`image` 当前支持 `source.path`、`source.data`，也支持通过 `normalized.assetMap` 或 `normalized.presentation.assetMap` 配合 `source.assetKey` 重建；仅有 `embedId` 时仍需要外部资源映射。`media` 同样支持 `source.path`、`source.data` 或 `source.assetKey + assetMap`。

### extract - 提取媒体文件

**参数**：
- `action` (string, required): `"extract"`
- `path` (string, required): PPTX 文件路径
- `outputDir` (string, optional): 输出目录
- `extractType` (string, optional): 提取类型 - `images`, `media`, `all`

**示例**：
```javascript
// 提取图片
pptx__file({
  action: "extract",
  path: "presentation.pptx",
  outputDir: "images",
  extractType: "images"
})
```

---

## slide - 幻灯片创建

创建新的演示文稿并添加幻灯片。

**参数**：
- `action` (string, required): `"add"`
- `output` (string, required): 输出文件路径
- `title` (string, optional): 幻灯片标题
- `content` (string | string[], optional): 幻灯片内容
- `slides` (object[], optional): 多个幻灯片数据
- `background` (object, optional): 背景配置
- `master` (object, optional): 母版配置
- `properties` (object, optional): 文档属性

**示例**：
```javascript
// 创建单个幻灯片
pptx__slide({
  action: "add",
  output: "single.pptx",
  title: "演示标题",
  content: ["要点一", "要点二"]
})

// 创建多个幻灯片
pptx__slide({
  action: "add",
  output: "multi.pptx",
  slides: [
    { title: "第一页", content: "内容一" },
    { title: "第二页", texts: ["要点A", "要点B"] }
  ]
})
```

---

## object - 内容对象操作

通过 `action` 参数区分具体操作：

| action | 功能 | 关键参数 |
|--------|------|----------|
| `add` | 创建包含对象的演示文稿 | `type`, `text`, `image`, `chart` 等 |
| `extract` | 提取对象内容 | `type`, `outputDir` |

### add - 添加对象到新演示文稿

**参数**：
- `action` (string, required): `"add"`
- `output` (string, required): 输出文件路径
- `slideNumber` (number, optional): 仅接受 `1`。当前工具会创建一个新的单页演示文稿，不支持写入指定页。
- `type` (string, required): 对象类型
  - `text`: 文本
  - `image`: 图片
  - `table`: 表格
  - `chart`: 图表
  - `shape`: 形状
  - `media`: 视频/音频
  - `notes`: 演讲者备注
- `properties` (object, optional): 文档属性

**文本示例**：
```javascript
pptx__object({
  action: "add",
  output: "text.pptx",
  type: "text",
  text: "Hello World",
  options: { fontSize: 24, bold: true, color: "FF0000" }
})
```

**图片示例**：
```javascript
pptx__object({
  action: "add",
  output: "image.pptx",
  type: "image",
  image: { path: "photo.jpg", x: 1, y: 1, w: 4, h: 3 }
})
```

**表格示例**：
```javascript
pptx__object({
  action: "add",
  output: "table.pptx",
  type: "table",
  table: {
    rows: [
      [{ text: "姓名" }, { text: "年龄" }],
      [{ text: "张三" }, { text: "25" }]
    ],
    x: 0.5, y: 1, w: 9
  }
})
```

**图表示例**：
```javascript
pptx__object({
  action: "add",
  output: "chart.pptx",
  type: "chart",
  chart: {
    type: "bar",
    data: [
      { name: "销售额", labels: ["一月", "二月"], values: [100, 150] }
    ],
    title: "月度销售额"
  }
})
```

**支持的图表类型**：
- `bar`, `bar3D`: 柱状图
- `line`, `line3D`: 折线图
- `pie`, `pie3D`: 饼图
- `doughnut`: 环形图
- `area`, `area3D`: 面积图
- `scatter`: 散点图
- `radar`, `radar3D`: 雷达图
- `bubble`, `bubble3D`: 气泡图

### extract - 提取对象内容

**参数**：
- `action` (string, required): `"extract"`
- `path` (string, required): PPTX 文件路径
- `type` (string, required): 提取类型 - `images`, `media`, `text`
- `outputDir` (string, optional): 输出目录

**示例**：
```javascript
pptx__object({
  action: "extract",
  path: "presentation.pptx",
  type: "images",
  outputDir: "extracted"
})
```

---

## master - 模板母版

通过 `action` 参数区分具体操作：

| action | 功能 | 关键参数 |
|--------|------|----------|
| `define` | 定义母版并创建演示文稿 | `name`, `background`, `objects` |
| `list` | 列出母版布局 | `path` |

### define - 定义母版

**参数**：
- `action` (string, required): `"define"`
- `output` (string, required): 输出文件路径
- `name` (string, required): 母版名称
- `background` (object, optional): 背景配置
- `objects` (object[], optional): 母版上的固定对象
- `slideNumber` (object, optional): 幻灯片编号配置
- `properties` (object, optional): 文档属性

**示例**：
```javascript
pptx__master({
  action: "define",
  output: "template.pptx",
  name: "CompanyTemplate",
  background: { color: "F5F5F5" },
  objects: [
    { text: "公司名称", options: { x: 0.5, y: 0.2 } }
  ]
})
```

### list - 列出母版

返回的是 PPTX 中可枚举的布局信息（`slideLayout*.xml`），可用于识别布局名称，但不是完整的母版结构解析。

**参数**：
- `action` (string, required): `"list"`
- `path` (string, required): PPTX 文件路径

**示例**：
```javascript
pptx__master({
  action: "list",
  path: "template.pptx"
})
```

---

## 幻灯片数据结构

创建演示文稿时，每个幻灯片支持以下字段：

```typescript
interface SlideData {
  title?: string;              // 标题
  content?: string;            // 内容文本
  texts?: (string | TextItem)[];  // 文本列表
  images?: ImageItem[];        // 图片列表
  tables?: TableItem[];        // 表格列表
  charts?: ChartItem[];        // 图表列表
  shapes?: ShapeItem[];        // 形状列表
  background?: Background;     // 背景
  notes?: string;              // 演讲者备注
}
```

---

## 快速参考

| 任务 | 工具 | action |
|------|------|--------|
| 读取基本信息 | `file` | `read` (scope: `info`) |
| 提取文本 | `file` | `read` (scope: `text`) |
| 提取页面级粗粒度结构 | `file` | `read` (scope: `structure`) |
| 导出标准化模型 | `file` | `read` (scope: `normalized`) |
| 提取媒体信息与引用 | `file` | `read` (scope: `media`) |
| 提取表格 | `file` | `read` (scope: `tables`) |
| 提取图表基础数据 | `file` | `read` (scope: `charts`) |
| 提取备注 | `file` | `read` (scope: `notes`) |
| 创建演示文稿 | `file` | `create` |
| 提取媒体文件 | `file` | `extract` |
| 创建幻灯片 | `slide` | `add` |
| 添加文本 | `object` | `add` (type: `text`) |
| 添加图片 | `object` | `add` (type: `image`) |
| 添加表格 | `object` | `add` (type: `table`) |
| 添加图表 | `object` | `add` (type: `chart`) |
| 添加形状 | `object` | `add` (type: `shape`) |
| 添加媒体 | `object` | `add` (type: `media`) |
| 添加备注 | `object` | `add` (type: `notes`) |
| 提取对象 | `object` | `extract` |
| 定义母版 | `master` | `define` |
| 列出布局 | `master` | `list` |

---

## 更新日志

- **2026-03-28**: 升级到 pptxgenjs 4.0.1，重新设计工具架构（4 个工具）
- **2026-03-28**: **重要变更**：移除编辑现有文件的功能（pptxgenjs 4.0 不支持）
- **2026-03-28**: 新增图表类型支持（14 种图表）
- **2026-03-28**: 新增演讲者备注、媒体、母版定义功能
- **2026-03-28**: 新增 Markdown 创建支持
