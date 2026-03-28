---
name: pptx
description: "PowerPoint 演示文稿处理。用于读取现有 PPTX 信息、创建新演示文稿、提取媒体文件。支持文本、图片、表格、图表、形状、媒体、演讲者备注。当用户提到 .pptx 文件或需要操作 PowerPoint 时触发。"
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
1. 使用 `pptx_file read` 读取现有文件内容
2. 使用 `pptx_file create` 创建新文件，添加修改后的内容
3. 删除原文件，重命名新文件

---

## 工具

本技能提供四个工具：

| 工具 | 最终名称 | 说明 |
|------|----------|------|
| `pptx_file` | `pptx__file` | 文件级操作（读取、创建、提取） |
| `pptx_slide` | `pptx__slide` | 幻灯片创建（仅限新建演示文稿） |
| `pptx_object` | `pptx__object` | 内容对象操作（添加、提取） |
| `pptx_master` | `pptx__master` | 模板母版（定义、列出） |

---

## pptx_file - 文件级操作

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
  - `structure`: 提取结构信息（形状、图片等）
  - `media`: 提取媒体信息（图片、视频列表）
- `slideNumbers` (number[], optional): 指定幻灯片编号

**示例**：
```javascript
// 读取基本信息
pptx__file({ action: "read", path: "presentation.pptx", scope: "info" })

// 提取文本
pptx__file({ action: "read", path: "presentation.pptx", scope: "text" })

// 提取结构
pptx__file({ action: "read", path: "presentation.pptx", scope: "structure" })
```

### create - 创建演示文稿

**参数**：
- `action` (string, required): `"create"`
- `path` (string, required): 输出文件路径
- `source` (string, optional): 创建来源 - `data` 或 `markdown`（默认: `data`）
- `slides` (object[], optional): 幻灯片数据数组
- `markdown` (string, optional): Markdown 内容
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
```

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

## pptx_slide - 幻灯片创建

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

## pptx_object - 内容对象操作

通过 `action` 参数区分具体操作：

| action | 功能 | 关键参数 |
|--------|------|----------|
| `add` | 创建包含对象的演示文稿 | `type`, `text`, `image`, `chart` 等 |
| `extract` | 提取对象内容 | `type`, `outputDir` |

### add - 添加对象到新演示文稿

**参数**：
- `action` (string, required): `"add"`
- `output` (string, required): 输出文件路径
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

## pptx_master - 模板母版

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
| 读取基本信息 | `pptx_file` | `read` (scope: `info`) |
| 提取文本 | `pptx_file` | `read` (scope: `text`) |
| 提取结构 | `pptx_file` | `read` (scope: `structure`) |
| 提取媒体信息 | `pptx_file` | `read` (scope: `media`) |
| 创建演示文稿 | `pptx_file` | `create` |
| 提取媒体文件 | `pptx_file` | `extract` |
| 创建幻灯片 | `pptx_slide` | `add` |
| 添加文本 | `pptx_object` | `add` (type: `text`) |
| 添加图片 | `pptx_object` | `add` (type: `image`) |
| 添加表格 | `pptx_object` | `add` (type: `table`) |
| 添加图表 | `pptx_object` | `add` (type: `chart`) |
| 添加形状 | `pptx_object` | `add` (type: `shape`) |
| 添加媒体 | `pptx_object` | `add` (type: `media`) |
| 添加备注 | `pptx_object` | `add` (type: `notes`) |
| 提取对象 | `pptx_object` | `extract` |
| 定义母版 | `pptx_master` | `define` |
| 列出母版 | `pptx_master` | `list` |

---

## 更新日志

- **2026-03-28**: 升级到 pptxgenjs 4.0.1，重新设计工具架构（4 个工具）
- **2026-03-28**: **重要变更**：移除编辑现有文件的功能（pptxgenjs 4.0 不支持）
- **2026-03-28**: 新增图表类型支持（14 种图表）
- **2026-03-28**: 新增演讲者备注、媒体、母版定义功能
- **2026-03-28**: 新增 Markdown 创建支持
