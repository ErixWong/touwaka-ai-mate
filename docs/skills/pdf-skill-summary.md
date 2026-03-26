# PDF 技能升级与重构总结

## 1. pdf-parse 升级

### 版本变更
- **旧版本**：`^1.1.1`
- **新版本**：`^2.4.5`

### 关键参数：抑制警告输出

```javascript
const { PDFParse, VerbosityLevel } = require('pdf-parse');

const parser = new PDFParse({
  data: pdfBuffer,
  verbosity: VerbosityLevel.ERRORS  // 只显示错误，抑制警告
});
```

### VerbosityLevel 选项

| 值 | 说明 |
|---|---|
| `VerbosityLevel.ERRORS` | 只显示错误信息 |
| `VerbosityLevel.WARNINGS` | 显示警告和错误 |
| `VerbosityLevel.INFOS` | 显示信息、警告和错误 |

---

## 2. PDF 技能代码更新

### 更新的函数

| 函数 | 文件位置 | 更新内容 |
|------|----------|----------|
| `extractText()` | [index.js:209](../../data/skills/pdf/index.js#L209) | 使用 `PDFParse` 类 + `verbosity` 参数 |
| `extractTables()` | [index.js:267](../../data/skills/pdf/index.js#L267) | 使用 `getTable()` 实现真正的表格提取 |
| `extractImages()` | [index.js:851](../../data/skills/pdf/index.js#L851) | 使用 `getImage()` 实现图片提取 |
| `convertToImages()` | [index.js:515](../../data/skills/pdf/index.js#L515) | 使用 `getScreenshot()` 实现页面渲染 |
| `readPdf()` | [index.js:144](../../data/skills/pdf/index.js#L144) | 使用 `getInfo()` 获取更丰富的元数据 |

---

## 3. 新版本 pdf-parse 新功能

| 方法 | 功能 | 示例 |
|------|------|------|
| `getText()` | 提取文本 | 支持 `partial` 分页提取 |
| `getInfo()` | 获取元数据 | 支持 `parsePageInfo` |
| `getTable()` | 提取表格 | **新功能** |
| `getImage()` | 提取图片 | **新功能** |
| `getScreenshot()` | 渲染为 PNG | **新功能** |
| `getHeader()` | 获取远程 PDF 头信息 | **新功能** (Node.js 专用) |

---

## 4. 重构方案：read_pdf + write_pdf

### 充分利用新版 pdf-parse v2.4.5 特性

| 新版特性 | 当前利用 | 重构方案 |
|----------|----------|----------|
| `getText({ partial })` | ✅ 已用 | 支持分页提取 |
| `getInfo({ parsePageInfo })` | ✅ 已用 | 获取丰富元数据 |
| `getTable()` | ✅ 已用 | 表格提取 |
| `getImage({ imageThreshold })` | ✅ 已用 | 图片提取 |
| `getScreenshot({ scale, desiredWidth })` | ✅ 已用 | 页面渲染 |
| `getHeader(url, validatePdf)` | ❌ 未用 | **新增**：远程 PDF 验证 |
| `verbosity: VerbosityLevel.ERRORS` | ✅ 已用 | 抑制警告 |
| `password` 参数 | ❌ 未用 | **新增**：密码保护 PDF |
| `url` 加载方式 | ❌ 未用 | **新增**：直接从 URL 加载 |

### 技能分类原则

| 类型 | 定义 | 示例 |
|------|------|------|
| **基本技能** | 单一原子操作，不可再分 | 提取文本、提取图片、合并 PDF |
| **组合技能** | 由多个基本技能组合而成 | PDF 转 Markdown（提取文本 + 格式转换） |

### `read_pdf` - 统一读取接口

```javascript
await read_pdf({
  path: "document.pdf",  // 本地路径或 URL
  action: "text",  // metadata | text | tables | images | screenshot | form | header
  from_page: 1,
  to_page: 10,
  password: "xxx",  // 密码保护 PDF
  suppress_warnings: true
});
```

| action | 功能 | pdf-parse 方法 |
|--------|------|----------------|
| `metadata` | 读取元数据 | `getInfo()` |
| `text` | 提取文本 | `getText({ partial })` |
| `tables` | 提取表格 | `getTable()` |
| `images` | 提取图片 | `getImage()` |
| `screenshot` | 渲染为图片 | `getScreenshot()` |
| `form` | 提取表单字段 | pdf-lib |
| `header` | 远程 PDF 验证 | `getHeader()` **(新)** |

> **注意**：`markdown` 不作为基本 action，因为 PDF 转 Markdown 是组合技能。

### `write_pdf` - 统一写入接口

```javascript
await write_pdf({
  action: "merge",  // merge | split | rotate | create | encrypt | decrypt | watermark | fill_form
  paths: ["a.pdf", "b.pdf"],
  output: "merged.pdf"
});
```

| action | 功能 |
|--------|------|
| `merge` | 合并 PDF |
| `split` | 拆分 PDF |
| `rotate` | 旋转页面 |
| `create` | 创建 PDF |
| `encrypt` | 加密 PDF |
| `decrypt` | 解密 PDF |
| `watermark` | 添加水印 |
| `fill_form` | 填写表单 |

### 优势对比

| 指标 | 当前方案 | 重构方案 |
|------|----------|----------|
| 工具数量 | 16 个 | 2 个 |
| LLM 选择难度 | 高 | 低 |
| 代码复用 | 分散 | 统一 |
| 扩展性 | 需新增工具 | 只需新增 action |

---

## 5. 相关文档

- [pdf-parse 升级指南](./pdf-parse-upgrade.md)
- [PDF 技能重构方案](./pdf-skill-refactor-plan.md)

## 6. GitHub Issue

- **Issue #408**: [refactor: PDF 技能工具重构为 read_pdf + write_pdf 两大类](https://github.com/ErixWong/touwaka-ai-mate/issues/408)

---

*最后更新：2026-03-26*