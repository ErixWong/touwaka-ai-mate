---
name: pypdf
description: "PDF 文件处理（Python 版）。使用 PyMuPDF 实现，内存效率高，适合处理大文件。用于读取、提取文本/表格/图片、合并、拆分、旋转、水印、加密/解密、页面渲染。当用户提到 .pdf 文件或需要操作 PDF 时触发。"
license: Proprietary. LICENSE.txt has complete terms
user-invocable: true
source_path: index.py
dependencies:
  python:
    - PyMuPDF>=1.23.0
---

# PyPDF - PDF 文件处理（Python 版）

> **依赖**：PyMuPDF (fitz) - 内存高效的 PDF 处理库
> 
> **优势**：相比 Node.js 版 `pdf` 技能，PyMuPDF 使用内存映射，处理 100MB PDF 仅需 20-50MB 内存，适合大文件处理。

## 工具清单

本技能提供 14 个独立工具，每个工具专注于单一功能：

### 📖 读取类工具（7个）

| 工具 | 功能 | 核心参数 |
|------|------|----------|
| `read_metadata` | 读取 PDF 元数据 | `path`, `parse_page_info` |
| `extract_text` | 提取文本内容 | `path`, `from_page`, `to_page` |
| `extract_tables` | 提取表格数据 | `path`, `from_page`, `to_page` |
| `extract_images` | 提取内嵌图片 | `path`, `from_page`, `to_page`, `threshold`, `output_dir` |
| `render_pages` | 渲染页面为图片 | `path`, `from_page`, `to_page`, `output_dir`, `scale` |
| `to_markdown` | 转换为 Markdown | `path`, `from_page`, `to_page`, `output` |
| `read_form_fields` | 读取表单字段 | `path` |

### ✏️ 写入类工具（7个）

| 工具 | 功能 | 核心参数 |
|------|------|----------|
| `create_pdf` | 创建新 PDF | `output`, `content`, `title`, `page_size` |
| `merge_pdfs` | 合并多个 PDF | `output`, `paths` |
| `split_pdf` | 拆分 PDF（内存高效） | `path`, `output_dir`, `pages_per_file` |
| `rotate_pages` | 旋转指定页面 | `path`, `output`, `pages`, `degrees` |
| `encrypt_pdf` | 加密 PDF | `path`, `output`, `user_password` |
| `decrypt_pdf` | 解密 PDF | `path`, `output`, `password` |
| `add_watermark` | 添加水印 | `path`, `output`, `watermark`, `is_text` |

---

## 读取类工具详情

### read_metadata - 读取 PDF 元数据

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| parse_page_info | boolean | ❌ | 解析每页详细信息（默认: false） |

**调用示例：**
```javascript
pypdf__read_metadata({ path: "doc.pdf" })
pypdf__read_metadata({ path: "doc.pdf", parse_page_info: true })
```

---

### extract_text - 提取文本内容

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| from_page | number | ❌ | 起始页（从1开始） |
| to_page | number | ❌ | 结束页（包含） |

**调用示例：**
```javascript
// 提取全部文本
pypdf__extract_text({ path: "doc.pdf" })

// 提取第1-5页
pypdf__extract_text({ path: "doc.pdf", from_page: 1, to_page: 5 })
```

---

### extract_tables - 提取表格数据

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| from_page | number | ❌ | 起始页（从1开始） |
| to_page | number | ❌ | 结束页（包含） |

**调用示例：**
```javascript
pypdf__extract_tables({ path: "doc.pdf", from_page: 1, to_page: 3 })
```

---

### extract_images - 提取内嵌图片

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| from_page | number | ❌ | 起始页（从1开始） |
| to_page | number | ❌ | 结束页（包含） |
| threshold | number | ❌ | 图片最小尺寸阈值，像素（默认: 80） |
| output_dir | string | ❌ | 输出目录（指定后图片保存到文件，不返回 base64，防止内存溢出） |

**调用示例：**
```javascript
// 提取所有大于100像素的图片（返回 base64，适合小文件）
pypdf__extract_images({ path: "doc.pdf", threshold: 100 })

// 提取图片到目录（推荐，防止内存溢出）
pypdf__extract_images({ 
  path: "doc.pdf", 
  output_dir: "./extracted_images"
})
```

**注意事项：**
- 当 PDF 包含大量高分辨率图片时，建议使用 `output_dir` 参数将图片保存到文件
- 不指定 `output_dir` 时，所有图片以 base64 形式返回，可能导致输出被截断

---

### render_pages - 渲染页面为图片

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| from_page | number | ❌ | 起始页（从1开始） |
| to_page | number | ❌ | 结束页（包含） |
| output_dir | string | ❌ | 输出目录（不指定则返回 dataUrl） |
| scale | number | ❌ | 缩放比例（默认: 1.5，相当于 150 DPI） |
| desired_width | number | ❌ | 期望宽度（像素），设置后忽略 scale |
| prefix | string | ❌ | 输出文件名前缀（默认: "page"） |

**调用示例：**
```javascript
// 渲染所有页面到目录
pypdf__render_pages({ 
  path: "doc.pdf", 
  output_dir: "./images",
  scale: 1.5 
})

// 渲染第1-3页，指定宽度
pypdf__render_pages({ 
  path: "doc.pdf",
  from_page: 1,
  to_page: 3,
  output_dir: "./thumbs",
  desired_width: 800,
  prefix: "thumb"
})
```

---

### to_markdown - 转换为 Markdown

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| from_page | number | ❌ | 起始页（从1开始） |
| to_page | number | ❌ | 结束页（包含） |
| output | string | ❌ | 输出 markdown 文件路径 |

**调用示例：**
```javascript
pypdf__to_markdown({ path: "doc.pdf", output: "doc.md" })
```

---

### read_form_fields - 读取表单字段

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |

**调用示例：**
```javascript
pypdf__read_form_fields({ path: "form.pdf" })
```

---

## 写入类工具详情

### create_pdf - 创建新 PDF

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **output** | string | ✅ | 输出 PDF 文件路径 |
| **content** | string[] | ✅ | 文本内容数组（每项为一页） |
| title | string | ❌ | PDF 标题 |
| page_size | string | ❌ | 页面大小: "a4" 或 "letter"（默认: "a4"） |

**调用示例：**
```javascript
pypdf__create_pdf({
  output: "new.pdf",
  content: ["第一页内容", "第二页内容"],
  title: "我的文档",
  page_size: "a4"
})
```

---

### merge_pdfs - 合并多个 PDF

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **output** | string | ✅ | 输出 PDF 文件路径 |
| **paths** | string[] | ✅ | 要合并的 PDF 文件路径数组（至少2个） |

**调用示例：**
```javascript
pypdf__merge_pdfs({
  output: "merged.pdf",
  paths: ["a.pdf", "b.pdf", "c.pdf"]
})
```

---

### split_pdf - 拆分 PDF（内存高效）

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| **output_dir** | string | ✅ | 输出目录 |
| pages_per_file | number | ❌ | 每个文件的页数（默认: 1） |
| prefix | string | ❌ | 输出文件名前缀（默认: "page"） |

**调用示例：**
```javascript
// 拆分为单页文件
pypdf__split_pdf({
  path: "large.pdf",
  output_dir: "./split",
  pages_per_file: 1,
  prefix: "page"
})

// 每10页一个文件
pypdf__split_pdf({
  path: "large.pdf",
  output_dir: "./chunks",
  pages_per_file: 10
})
```

---

### rotate_pages - 旋转指定页面

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| **output** | string | ✅ | 输出 PDF 文件路径 |
| pages | number[] | ❌ | 要旋转的页码（从1开始，空则旋转所有） |
| degrees | number | ❌ | 旋转角度: 90, 180, 270（默认: 90） |

**调用示例：**
```javascript
// 旋转所有页面90度
pypdf__rotate_pages({
  path: "doc.pdf",
  output: "rotated.pdf",
  degrees: 90
})

// 旋转指定页面180度
pypdf__rotate_pages({
  path: "doc.pdf",
  output: "rotated.pdf",
  pages: [1, 3, 5],
  degrees: 180
})
```

---

### encrypt_pdf - 加密 PDF

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| **output** | string | ✅ | 输出 PDF 文件路径 |
| **user_password** | string | ✅ | 打开 PDF 的密码 |
| owner_password | string | ❌ | 编辑密码（默认使用 user_password） |

**调用示例：**
```javascript
pypdf__encrypt_pdf({
  path: "doc.pdf",
  output: "encrypted.pdf",
  user_password: "secret123"
})
```

---

### decrypt_pdf - 解密 PDF

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| **output** | string | ✅ | 输出 PDF 文件路径 |
| **password** | string | ✅ | 当前密码 |

**调用示例：**
```javascript
pypdf__decrypt_pdf({
  path: "encrypted.pdf",
  output: "decrypted.pdf",
  password: "secret123"
})
```

---

### add_watermark - 添加水印

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| **path** | string | ✅ | PDF 文件路径 |
| **output** | string | ✅ | 输出 PDF 文件路径 |
| **watermark** | string | ✅ | 水印文本或水印 PDF 路径 |
| is_text | boolean | ❌ | true 为文本水印，false 为 PDF 路径（默认: true） |

**调用示例：**
```javascript
// 添加文本水印
pypdf__add_watermark({
  path: "doc.pdf",
  output: "watermarked.pdf",
  watermark: "CONFIDENTIAL",
  is_text: true
})

// 添加 PDF 水印
pypdf__add_watermark({
  path: "doc.pdf",
  output: "watermarked.pdf",
  watermark: "stamp.pdf",
  is_text: false
})
```

---

## 核心优势

### 内存高效处理
- 使用 PyMuPDF 的内存映射技术
- 拆分 100MB PDF 仅需 20-50MB 内存
- 支持超大文件处理

### 工具设计原则
- **单一职责**：每个工具只做一件事
- **参数精确**：无冗余参数，每个参数都有明确用途
- **命名直观**：工具名即功能，一目了然
