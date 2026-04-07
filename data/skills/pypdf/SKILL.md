---
name: pypdf
description: "PDF 文件处理（Python 版）。使用 PyMuPDF 实现，内存效率高，适合处理大文件。用于读取、提取文本/表格/图片、合并、拆分、旋转、水印、加密/解密、页面渲染。当用户提到 .pdf 文件或需要操作 PDF 时触发。"
license: Proprietary. LICENSE.txt has complete terms
argument-hint: "[read|write] [operation] [path]"
user-invocable: true
---

# PyPDF - PDF 文件处理（Python 版）

> **依赖**：PyMuPDF (fitz) - 内存高效的 PDF 处理库
> 
> **优势**：相比 Node.js 版 `pdf` 技能，PyMuPDF 使用内存映射，处理 100MB PDF 仅需 20-50MB 内存，适合大文件处理。

## 工具

本技能提供两个工具，通过 `operation` 参数区分具体操作：

| 工具 | 最终名称 | 说明 |
|------|----------|------|
| `read` | `pypdf__read` | PDF 读取操作（不修改原文件） |
| `write` | `pypdf__write` | PDF 写入操作（创建或修改文件） |

---

## read - PDF 读取工具

通过 `operation` 参数区分具体读取操作：

| operation | 功能 | 关键参数 |
|-----------|------|----------|
| `metadata` | 读取元数据 | `parse_page_info` |
| `text` | 提取文本 | `from_page`, `to_page` |
| `tables` | 提取表格 | `from_page`, `to_page` |
| `images` | 提取图片 | `from_page`, `to_page`, `image_threshold` |
| `render` | 渲染页面为图片 | `output_dir`, `scale`, `from_page`, `to_page` |
| `markdown` | 转 Markdown | `output`, `from_page`, `to_page` |
| `fields` | 检查表单字段 | - |

### 参数说明

**通用参数：**
- `path` (string, required): PDF 文件路径
- `operation` (string, required): 操作类型
- `from_page` (number, optional): 起始页（从1开始）
- `to_page` (number, optional): 结束页（包含）

**metadata 操作参数：**
- `parse_page_info` (boolean, optional): 解析每页详细信息（默认: false）

**images 操作参数：**
- `image_threshold` (number, optional): 图片最小尺寸阈值，像素（默认: 80）

**render 操作参数：**
- `output_dir` (string, optional): 输出目录（不指定则只返回 dataUrl）
- `scale` (number, optional): 缩放比例（默认: 1.5，相当于 150 DPI）
- `desired_width` (number, optional): 期望宽度（像素），设置后将忽略 scale
- `prefix` (string, optional): 输出文件名前缀（默认: "page"）

**markdown 操作参数：**
- `output` (string, optional): 输出 markdown 文件路径

### 调用示例

```javascript
// 读取元数据
pypdf__read({ path: "doc.pdf", operation: "metadata" })

// 提取第1-5页文本
pypdf__read({ path: "doc.pdf", operation: "text", from_page: 1, to_page: 5 })

// 提取表格
pypdf__read({ path: "doc.pdf", operation: "tables" })

// 提取图片
pypdf__read({ path: "doc.pdf", operation: "images", image_threshold: 100 })

// 渲染页面为图片
pypdf__read({ path: "doc.pdf", operation: "render", output_dir: "./images", scale: 1.5 })

// 转 Markdown
pypdf__read({ path: "doc.pdf", operation: "markdown", output: "doc.md" })

// 检查表单字段
pypdf__read({ path: "form.pdf", operation: "fields" })
```

---

## write - PDF 写入工具

通过 `operation` 参数区分具体写入操作：

| operation | 功能 | 关键参数 |
|-----------|------|----------|
| `create` | 创建 PDF | `content[]`, `title`, `page_size` |
| `merge` | 合并 PDF | `paths[]` |
| `split` | 拆分 PDF（核心功能，内存高效） | `output_dir`, `pages_per_file` |
| `rotate` | 旋转页面 | `pages[]`, `degrees` |
| `encrypt` | 加密 PDF | `user_password`, `owner_password` |
| `decrypt` | 解密 PDF | `password` |
| `watermark` | 添加水印 | `watermark`, `is_text` |

### 参数说明

**通用参数：**
- `path` (string, required for most operations): PDF 文件路径
- `output` (string, required): 输出文件路径
- `operation` (string, required): 操作类型

**create 操作参数：**
- `content` (string[], required): 文本内容数组（每项为一页）
- `title` (string, optional): PDF 标题
- `page_size` (string, optional): 页面大小 - "letter" 或 "a4"（默认: "a4"）

**merge 操作参数：**
- `paths` (string[], required): 要合并的 PDF 文件路径数组（至少2个）

**split 操作参数：**
- `output_dir` (string, required): 输出目录
- `pages_per_file` (number, optional): 每个文件的页数（默认: 1）
- `prefix` (string, optional): 输出文件名前缀（默认: "page"）

**rotate 操作参数：**
- `pages` (number[], optional): 要旋转的页码（从1开始，为空则旋转所有）
- `degrees` (number, optional): 旋转角度 - 90, 180, 270（默认: 90）

**encrypt 操作参数：**
- `user_password` (string, required): 打开 PDF 的密码
- `owner_password` (string, optional): 编辑密码（默认使用 user_password）

**decrypt 操作参数：**
- `password` (string, required): 当前密码

**watermark 操作参数：**
- `watermark` (string, required): 水印文本或水印 PDF 路径
- `is_text` (boolean, optional): true 为文本水印，false 为 PDF 路径（默认: true）

### 调用示例

```javascript
// 创建 PDF
pypdf__write({ 
  output: "new.pdf", 
  operation: "create", 
  content: ["第一页内容", "第二页内容"],
  title: "我的文档"
})

// 合并 PDF
pypdf__write({ 
  output: "merged.pdf", 
  operation: "merge", 
  paths: ["a.pdf", "b.pdf", "c.pdf"]
})

// 拆分 PDF（每文件1页）- 内存高效，适合大文件
pypdf__write({ 
  path: "large.pdf", 
  output: "merged.pdf",
  operation: "split", 
  output_dir: "./split", 
  pages_per_file: 1
})

// 旋转所有页面90度
pypdf__write({ 
  path: "doc.pdf", 
  output: "rotated.pdf", 
  operation: "rotate", 
  degrees: 90 
})

// 旋转指定页面
pypdf__write({ 
  path: "doc.pdf", 
  output: "rotated.pdf", 
  operation: "rotate", 
  pages: [1, 3, 5], 
  degrees: 180 
})

// 加密 PDF
pypdf__write({ 
  path: "doc.pdf", 
  output: "encrypted.pdf", 
  operation: "encrypt", 
  user_password: "secret123"
})

// 解密 PDF
pypdf__write({ 
  path: "encrypted.pdf", 
  output: "decrypted.pdf", 
  operation: "decrypt", 
  password: "secret123"
})

// 添加文本水印
pypdf__write({ 
  path: "doc.pdf", 
  output: "watermarked.pdf", 
  operation: "watermark", 
  watermark: "机密文件"
})
```

---

## 与 pdf 技能的区别

| 特性 | pdf (Node.js) | pypdf (Python) |
|------|---------------|----------------|
| 内存占用 | 高（需加载完整 PDF） | 低（内存映射） |
| 大文件支持 | 有限（< 50MB） | 优秀（> 100MB） |
| 处理速度 | 中等 | 快 |
| 表格提取 | 支持 | 支持（PyMuPDF find_tables） |
| 表单填写 | 支持 | 不支持 |

**建议：**
- 小文件（< 10MB）：使用 `pdf` 或 `pypdf` 均可
- 大文件（> 10MB）：优先使用 `pypdf`
- 需要表单填写：使用 `pdf` 技能

---

## 常见任务

### 处理大文件 PDF

对于大文件 PDF（如 50MB+），使用 `pypdf` 技能的 `split` 操作将其拆分为小文件：

```javascript
// 将大 PDF 拆分为每文件 10 页的小文件
pypdf__write({ 
  path: "large.pdf", 
  output: "merged.pdf",
  operation: "split", 
  output_dir: "./split", 
  pages_per_file: 10
})
```

### 扫描版 PDF 处理

对于扫描版 PDF 或基于图片的 PDF，使用 `render` 操作转换为图片：

```javascript
pypdf__read({ 
  path: "scanned.pdf", 
  operation: "render", 
  output_dir: "./images", 
  scale: 1.5 
})
```

---

## 快速参考

| 任务 | 工具 | operation |
|------|------|-----------|
| 读取元数据 | `read` | `metadata` |
| 提取文本 | `read` | `text` |
| 提取表格 | `read` | `tables` |
| 提取图片 | `read` | `images` |
| 渲染页面 | `read` | `render` |
| 转 Markdown | `read` | `markdown` |
| 检查表单字段 | `read` | `fields` |
| 创建 PDF | `write` | `create` |
| 合并 PDF | `write` | `merge` |
| 拆分 PDF | `write` | `split` |
| 旋转页面 | `write` | `rotate` |
| 加密 PDF | `write` | `encrypt` |
| 解密 PDF | `write` | `decrypt` |
| 添加水印 | `write` | `watermark` |

---

## 更新日志

- **2026-04-07**: 创建 pypdf 技能，使用 PyMuPDF 实现，解决大文件 PDF 处理内存问题
