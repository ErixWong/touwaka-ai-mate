# PDF 技能重构方案

## 当前问题

当前 PDF 技能有 **16 个工具**，工具数量过多导致：
1. LLM 选择困难 - 需要从大量工具中选择
2. 维护成本高 - 每个工具都需要单独维护
3. 用户体验差 - 需要记住多个工具名称
4. **职责不清** - 混合了基本操作和组合技能

## 技能分类原则

### 基本技能 vs 组合技能

| 类型 | 定义 | 示例 |
|------|------|------|
| **基本技能** | 单一原子操作，不可再分 | 提取文本、提取图片、合并 PDF |
| **组合技能** | 由多个基本技能组合而成 | PDF 转 Markdown（提取文本 + 格式转换） |

### 当前工具分类

#### 基本技能 - 读取类（Read）

| 工具 | 功能 | 保留 |
|------|------|------|
| `read_pdf` | 读取元数据 | ✅ |
| `extract_text` | 提取文本 | ✅ |
| `extract_tables` | 提取表格 | ✅ |
| `extract_images` | 提取图片 | ✅ |
| `convert_to_images` | 渲染为图片 | ✅ |
| `check_fillable_fields` | 检查可填写字段 | ✅ |
| `extract_form_field_info` | 提取表单字段信息 | ✅ |

#### 基本技能 - 写入类（Write）

| 工具 | 功能 | 保留 |
|------|------|------|
| `merge_pdfs` | 合并 PDF | ✅ |
| `split_pdf` | 拆分 PDF | ✅ |
| `rotate_pages` | 旋转页面 | ✅ |
| `create_pdf` | 创建 PDF | ✅ |
| `encrypt_pdf` | 加密 | ✅ |
| `decrypt_pdf` | 解密 | ✅ |
| `add_watermark` | 添加水印 | ✅ |
| `fill_fillable_fields` | 填写表单字段 | ✅ |

#### 组合技能 - 应移除或独立

| 工具 | 功能 | 处理方式 |
|------|------|----------|
| `pdf_to_markdown` | 转为 Markdown | ❌ 移除，作为独立组合技能 |

## 重构方案：两大工具

### 方案：`read_pdf` + `write_pdf`

### 充分利用新版 pdf-parse v2.4.5 特性

新版 pdf-parse 提供了丰富的功能，重构方案应充分利用：

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

#### `read_pdf` - 统一读取接口

```javascript
await read_pdf({
  path: "document.pdf",  // 本地路径或 URL
  action: "text",  // text | tables | images | metadata | form | screenshot | header
  // 可选参数
  from_page: 1,
  to_page: 10,
  output_dir: "./output",  // 用于 screenshot/images
  scale: 1.5,  // 用于 screenshot
  desired_width: 1024,  // 用于 screenshot（替代 scale）
  image_threshold: 80,  // 用于 images
  password: "xxx",  // 用于密码保护的 PDF
  suppress_warnings: true  // 抑制警告输出
});
```

**action 参数说明：**

| action | 功能 | 额外参数 | pdf-parse 方法 |
|--------|------|----------|----------------|
| `metadata` | 读取元数据（默认） | `parse_page_info` | `getInfo()` |
| `text` | 提取文本 | `from_page`, `to_page` | `getText({ partial })` |
| `tables` | 提取表格 | `from_page`, `to_page` | `getTable()` |
| `images` | 提取图片 | `from_page`, `to_page`, `image_threshold`, `output_dir` | `getImage()` |
| `screenshot` | 渲染为图片 | `from_page`, `to_page`, `scale`, `desired_width`, `output_dir` | `getScreenshot()` |
| `form` | 提取表单字段 | - | pdf-lib |
| `header` | 获取远程 PDF 头信息 | `validate_pdf` | `getHeader()` **(新)** |

> **注意**：`markdown` 不作为基本 action，因为 PDF 转 Markdown 是组合技能（提取文本 + 格式转换），应作为独立技能实现。

#### 新增功能详解

##### 1. `header` action - 远程 PDF 验证

```javascript
// 在下载前验证远程 PDF
const result = await read_pdf({
  path: "https://example.com/document.pdf",
  action: "header",
  validate_pdf: true  // 验证是否为有效 PDF
});

// 返回
{
  success: true,
  status: 200,
  size: 1024000,  // 文件大小（字节）
  is_pdf: true,   // 是否为 PDF
  headers: { ... } // HTTP 头信息
}
```

##### 2. URL 直接加载

```javascript
// 直接从 URL 加载 PDF，无需先下载
const result = await read_pdf({
  path: "https://example.com/document.pdf",
  action: "text"
});
```

##### 3. 密码保护 PDF

```javascript
// 读取密码保护的 PDF
const result = await read_pdf({
  path: "protected.pdf",
  action: "text",
  password: "secret123"
});
```

#### `write_pdf` - 统一写入接口

```javascript
await write_pdf({
  action: "merge",  // merge | split | rotate | create | encrypt | decrypt | watermark | fill_form
  // 根据 action 不同参数
  paths: ["a.pdf", "b.pdf"],  // merge
  output: "merged.pdf",
  
  // 或其他 action 的参数
  // split: path, output_dir, pages_per_file
  // rotate: path, output, pages, degrees
  // create: output, title, content
  // encrypt: path, output, user_password
  // decrypt: path, output, password
  // watermark: path, output, watermark
  // fill_form: path, field_values, output
});
```

**action 参数说明：**

| action | 功能 | 必需参数 |
|--------|------|----------|
| `merge` | 合并 PDF | `paths[]`, `output` |
| `split` | 拆分 PDF | `path`, `output_dir`, `pages_per_file?` |
| `rotate` | 旋转页面 | `path`, `output`, `pages[]?`, `degrees?` |
| `create` | 创建 PDF | `output`, `title?`, `content[]` |
| `encrypt` | 加密 | `path`, `output`, `user_password` |
| `decrypt` | 解密 | `path`, `output`, `password` |
| `watermark` | 添加水印 | `path`, `output`, `watermark` |
| `fill_form` | 填写表单 | `path`, `field_values`, `output` |

## 优势对比

| 指标 | 当前方案 | 重构方案 |
|------|----------|----------|
| 工具数量 | 16 个 | 2 个 |
| LLM 选择复杂度 | 高 | 低 |
| 参数设计 | 分散 | 统一 |
| 代码复用 | 低 | 高 |
| 扩展性 | 需新增工具 | 只需新增 action |

## 实现建议

### 1. 保持向后兼容

```javascript
// 新 API
await read_pdf({ path: "doc.pdf", action: "text" });

// 旧 API 仍然可用（内部转发到新 API）
await extract_text({ path: "doc.pdf" });
```

### 2. 统一错误处理

```javascript
{
  success: false,
  error: "Invalid action: xxx",
  available_actions: ["metadata", "text", "tables", ...]
}
```

### 3. 智能默认值

```javascript
// action 默认为 metadata
await read_pdf({ path: "doc.pdf" });  // 等同于 read_pdf({ path: "doc.pdf", action: "metadata" })
```

## 迁移计划

### 阶段 1：添加新工具（不删除旧工具）
- 实现 `read_pdf` 和 `write_pdf`
- 更新 SKILL.md 文档
- 旧工具标记为 deprecated

### 阶段 2：测试验证
- 使用新工具测试所有功能
- 确保 LLM 能正确选择新工具

### 阶段 3：移除旧工具
- 删除旧工具定义
- 清理代码

## 示例对比

### 当前方式

```javascript
// 提取文本
await extract_text({ path: "doc.pdf", from_page: 1, to_page: 5 });

// 提取表格
await extract_tables({ path: "doc.pdf" });

// 合并 PDF
await merge_pdfs({ paths: ["a.pdf", "b.pdf"], output: "merged.pdf" });
```

### 重构后

```javascript
// 提取文本
await read_pdf({ path: "doc.pdf", action: "text", from_page: 1, to_page: 5 });

// 提取表格
await read_pdf({ path: "doc.pdf", action: "tables" });

// 合并 PDF
await write_pdf({ action: "merge", paths: ["a.pdf", "b.pdf"], output: "merged.pdf" });
```

## 结论

推荐采用 **read_pdf + write_pdf** 两工具方案，理由：

1. **简化 LLM 决策** - 只需选择读或写
2. **降低维护成本** - 代码集中，易于维护
3. **提升扩展性** - 新功能只需添加 action
4. **保持兼容性** - 旧 API 可继续使用

是否需要我开始实现这个重构方案？