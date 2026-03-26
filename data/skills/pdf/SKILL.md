---
name: pdf
description: "PDF 文件处理。用于读取、提取文本/表格/图片、合并、拆分、旋转、水印、加密/解密、表单填写、页面渲染。当用户提到 .pdf 文件或需要操作 PDF 时触发。"
license: Proprietary. LICENSE.txt has complete terms
argument-hint: "[operation] [path]"
user-invocable: true
---

# PDF - PDF 文件处理

> **依赖**：pdf-lib (PDF 操作) + pdf-parse v2.4+ (文本/表格/图片提取、页面渲染)

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `read_pdf` | 读取 PDF 元数据 | `path`, `parse_page_info` |
| `extract_text` | 提取文本 | `path`, `from_page`, `to_page`, `suppress_warnings` |
| `extract_tables` | 提取表格 | `path`, `from_page`, `to_page` |
| `extract_images` | 提取图片 | `path`, `from_page`, `to_page`, `image_threshold` |
| `convert_to_images` | 渲染页面为图片 | `path`, `output_dir`, `scale`, `from_page`, `to_page` |
| `merge_pdfs` | 合并 PDF | `paths[]`, `output` |
| `split_pdf` | 拆分 PDF | `path`, `output_dir`, `pages_per_file` |
| `rotate_pages` | 旋转页面 | `path`, `output`, `pages[]`, `degrees` |
| `create_pdf` | 创建 PDF | `output`, `content[]` |
| `pdf_to_markdown` | 转为 Markdown | `path`, `output` |
| `encrypt_pdf` | 加密 PDF | `path`, `output`, `user_password` |
| `decrypt_pdf` | 解密 PDF | `path`, `output`, `password` |
| `add_watermark` | 添加水印 | `path`, `output`, `watermark` |
| `check_fillable_fields` | 检查可填写字段 | `path` |
| `extract_form_field_info` | 提取表单字段信息 | `path`, `output` |
| `fill_fillable_fields` | 填写表单字段 | `path`, `field_values`, `output` |

## 基本操作

### read_pdf

读取 PDF 元数据和基本信息。

**参数：**
- `path` (string, required): PDF 文件路径
- `parse_page_info` (boolean, optional): 解析每页详细信息（默认: false）
- `suppress_warnings` (boolean, optional): 抑制警告输出（默认: true）

**返回：** 页数、元数据（标题、作者、主题、创建者）、加密状态、每页尺寸

### extract_text

从 PDF 页面提取文本内容。

**参数：**
- `path` (string, required): PDF 文件路径
- `from_page` (number, optional): 起始页（从1开始，默认: 1）
- `to_page` (number, optional): 结束页（包含）
- `suppress_warnings` (boolean, optional): 抑制警告输出（默认: true）

### extract_tables

从 PDF 提取表格数据（使用 pdf-parse v2 的 getTable 方法）。

**参数：**
- `path` (string, required): PDF 文件路径
- `from_page` (number, optional): 起始页（从1开始）
- `to_page` (number, optional): 结束页（包含）
- `suppress_warnings` (boolean, optional): 抑制警告输出（默认: true）

### extract_images

从 PDF 中提取嵌入的图片（使用 pdf-parse v2 的 getImage 方法）。

**参数：**
- `path` (string, required): PDF 文件路径
- `from_page` (number, optional): 起始页（从1开始）
- `to_page` (number, optional): 结束页（包含）
- `image_threshold` (number, optional): 图片最小尺寸阈值，像素（默认: 80）
- `suppress_warnings` (boolean, optional): 抑制警告输出（默认: true）

## 编辑操作

### merge_pdfs

合并多个 PDF 文件。

**参数：**
- `paths` (string[], required): PDF 文件路径数组（至少2个）
- `output` (string, required): 输出文件路径

### split_pdf

将 PDF 拆分为多个文件。

**参数：**
- `path` (string, required): PDF 文件路径
- `output_dir` (string, required): 输出目录
- `pages_per_file` (number, optional): 每个文件的页数（默认: 1）
- `prefix` (string, optional): 输出文件名前缀（默认: "page"）

### rotate_pages

旋转 PDF 页面。

**参数：**
- `path` (string, required): PDF 文件路径
- `output` (string, required): 输出文件路径
- `pages` (number[], optional): 要旋转的页码（从1开始，为空则旋转所有）
- `degrees` (number, optional): 旋转角度 - 90, 180, 270（默认: 90）

## 创建和转换

### create_pdf

创建新的 PDF 文件。

**参数：**
- `output` (string, required): 输出文件路径
- `title` (string, optional): PDF 标题
- `content` (string[], required): 文本内容数组（每项为一页）
- `page_size` (string, optional): 页面大小 - "letter" 或 "a4"（默认: "a4"）

### convert_to_images

将 PDF 页面转换为图片。

**参数：**
- `path` (string, required): PDF 文件路径
- `output_dir` (string, optional): 输出目录（不指定则只返回 dataUrl）
- `scale` (number, optional): 缩放比例（默认: 1.5，相当于 150 DPI）
- `desired_width` (number, optional): 期望宽度（像素），设置后将忽略 scale
- `prefix` (string, optional): 输出文件名前缀（默认: "page"）
- `from_page` (number, optional): 起始页（从1开始）
- `to_page` (number, optional): 结束页（包含）
- `suppress_warnings` (boolean, optional): 抑制警告输出（默认: true）

### pdf_to_markdown

将 PDF 转换为 Markdown 格式。

**参数：**
- `path` (string, required): PDF 文件路径
- `output` (string, optional): 输出 markdown 文件路径
- `from_page` (number, optional): 起始页（从1开始）
- `to_page` (number, optional): 结束页（包含）

## 安全操作

### encrypt_pdf

使用密码保护加密 PDF。

**参数：**
- `path` (string, required): PDF 文件路径
- `output` (string, required): 输出文件路径
- `user_password` (string, required): 打开 PDF 的密码
- `owner_password` (string, optional): 编辑密码（默认使用 user_password）

### decrypt_pdf

移除 PDF 密码保护。

**参数：**
- `path` (string, required): PDF 文件路径
- `output` (string, required): 输出文件路径
- `password` (string, required): 当前密码

### add_watermark

为 PDF 页面添加水印。

**参数：**
- `path` (string, required): PDF 文件路径
- `output` (string, required): 输出文件路径
- `watermark` (string, required): 水印文本或水印 PDF 路径
- `is_text` (boolean, optional): true 为文本水印，false 为 PDF 路径（默认: true）

## 表单操作

### check_fillable_fields

检查 PDF 是否有可填写的表单字段。

**参数：**
- `path` (string, required): PDF 文件路径

### extract_form_field_info

提取可填写表单字段的信息。

**参数：**
- `path` (string, required): PDF 文件路径
- `output` (string, optional): 输出 JSON 文件路径（不指定则只返回结果）

### fill_fillable_fields

填写 PDF 中的可填写表单字段。

**参数：**
- `path` (string, required): PDF 文件路径
- `field_values` (object, required): 字段名和值的键值对
- `output` (string, required): 输出 PDF 文件路径

## 常见任务

### 扫描版 PDF 处理

对于扫描版 PDF 或基于图片的 PDF，文本提取可能失败。使用 `convert_to_images` 转换为图片，然后发送给 VL（视觉语言）模型进行文字识别。

**工作流程：**
1. 使用 `convert_to_images` 将 PDF 页面转换为 PNG 图片
2. 将生成的图片发送给 VL 模型（如 GPT-4V、Claude Vision、Qwen-VL）
3. VL 模型将识别并提取图片中的文字

**示例：**
```javascript
convert_to_images({ path: "scanned.pdf", output_dir: "./images", scale: 1.5 })
```

## 快速参考

| 任务 | 最佳工具 | 说明 |
|------|----------|------|
| 合并 PDF | `merge_pdfs` | 多个 PDF 合并为一个 |
| 拆分 PDF | `split_pdf` | 按页拆分 |
| 提取文本 | `extract_text` | 获取文本内容 |
| 提取表格 | `extract_tables` | 获取表格数据 |
| 提取图片 | `extract_images` | 获取嵌入图片 |
| 渲染页面 | `convert_to_images` | 页面转 PNG |
| 创建 PDF | `create_pdf` | 从文本创建 |
| 扫描版 PDF | `convert_to_images` + VL 模型 | 先转图片再识别 |
| 填写表单 | `fill_fillable_fields` | 填写表单字段 |

## 更新日志

- **2026-03-26**: 升级 pdf-parse 到 v2.4.5，新增表格提取、图片提取、页面渲染功能
