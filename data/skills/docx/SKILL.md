---
name: docx
description: "Word 文档处理。用于读取、写入、编辑、模板填充 .docx 文件。支持页眉页脚、超链接、目录、图片操作。使用 Patcher API 保留原文档样式。当用户需要操作 Word 文档时触发。"
---

# DOCX - Word 文档处理 (重构版)

## 路径参数说明

> **重要**：所有工具的 `path` 参数遵循以下规则：

| 参数类型 | 说明 |
|----------|------|
| **相对路径** | 相对于工作目录，工具自动拼接基础路径。示例：`input/file.docx` |
| **绝对路径** | 仅管理员可用，需在允许的路径范围内 |

**基础路径规则**：
- 管理员：项目根目录 或 `data/` 目录
- 普通用户：`data/work/{user_id}/` 目录

**示例**：
```javascript
// 相对路径（推荐）
read({ path: 'input/document.docx', scope: 'text' })

// 绝对路径（仅管理员）
read({ path: '/absolute/path/to/document.docx', scope: 'text' })
```

## 工具列表

### 简化工具名（推荐）

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `read` | 读取文档 | `scope`: info/text/paragraphs/tables/comments/images/headers/footers |
| `write` | 写入文档 | `source`: data/markdown，支持 `header`/`footer` |
| `patch` | 模板填充 | `patches`: { placeholder: value }，保留原文档样式 |
| `edit` | 编辑文档 | `action`: replace/append/insert/delete |
| `convert` | 格式转换 | `format`: markdown/html |
| `image` | 图片操作 | `action`: extract/insert/list |
| `link` | 超链接操作 | `action`: add/list |
| `toc` | 目录操作 | `action`: insert/update |

### 兼容旧工具名

| 旧工具名 | 新工具名 |
|----------|----------|
| `docx_read` | `read` |
| `docx_write` | `write` |
| `docx_edit` | `edit` |
| `docx_convert` | `convert` |
| `docx_image` | `image` |
| `docx_patch` (新增) | `patch` |
| `docx_link` (新增) | `link` |
| `docx_toc` (新增) | `toc` |

---

## read - 读取文档

### scope 参数

| scope | 说明 | 返回内容 |
|-------|------|----------|
| `info` | 文档信息 | 元数据、段落数、字数、是否有页眉页脚 |
| `text` | 提取文本 | 纯文本或 HTML（`includeFormatting: true`） |
| `paragraphs` | 提取段落 | 段落列表（可选样式） |
| `tables` | 提取表格 | 表格数据数组 |
| `comments` | 提取批注 | 批注列表 |
| `images` | 提取图片信息 | 图片列表（路径、大小） |
| `headers` | 提取页眉 | 页眉内容 |
| `footers` | 提取页脚 | 页脚内容 |

### 示例

```javascript
// 读取文档信息
read({ path: 'document.docx', scope: 'info' })
// 返回: { metadata, paragraphCount, characterCount, wordCount, hasHeader, hasFooter }

// 提取文本
read({ path: 'document.docx', scope: 'text' })
read({ path: 'document.docx', scope: 'text', includeFormatting: true })  // 返回 HTML

// 提取段落/表格/批注
read({ path: 'document.docx', scope: 'paragraphs' })
read({ path: 'document.docx', scope: 'tables' })
read({ path: 'document.docx', scope: 'comments' })

// 提取图片信息
read({ path: 'document.docx', scope: 'images' })
// 返回: { imageCount, images: [{ path, fileName, extension, size }] }

// 提取页眉页脚
read({ path: 'document.docx', scope: 'headers' })
read({ path: 'document.docx', scope: 'footers' })
```

---

## write - 写入文档

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string | 输出文件路径 |
| `source` | string | 数据来源：`data` 或 `markdown` |
| `content` | array | 内容数据（source 为 data） |
| `markdown` | string | Markdown 内容（source 为 markdown） |
| `title` | string | 文档标题 |
| `properties` | object | 文档属性（author, subject, keywords） |
| `header` | object | 页眉配置 |
| `footer` | object | 页脚配置 |
| `sections` | array | 多节配置 |

### 页眉配置

```javascript
header: {
  text: 'Document Header',
  alignment: 'CENTER'  // LEFT, CENTER, RIGHT
}
```

### 页脚配置

```javascript
footer: {
  text: 'Company Name',
  pageNumber: true,
  pagePrefix: 'Page ',
  pageSuffix: '',
  pageAlignment: 'CENTER'
}
```

### 示例

```javascript
// 从数据创建（带页眉页脚）
write({
  path: 'output.docx',
  source: 'data',
  title: 'Report Title',
  header: { text: 'Company Report', alignment: 'CENTER' },
  footer: { pageNumber: true, pagePrefix: 'Page ' },
  content: [
    { type: 'heading', text: 'Introduction', level: 1 },
    { type: 'paragraph', text: 'This is the content.' },
    { type: 'paragraph', text: 'Bold text', runs: [{ text: 'Bold', bold: true }] },
    { type: 'list', items: ['Item 1', 'Item 2'] },
    { type: 'table', headers: ['Name', 'Value'], rows: [['A', '1']] }
  ]
})

// 从 Markdown 创建
write({
  path: 'output.docx',
  source: 'markdown',
  markdown: '# Title\n\nParagraph with **bold** text.\n\n- Item 1\n- Item 2',
  header: { text: 'Header' },
  footer: { pageNumber: true }
})

// 多节文档
write({
  path: 'output.docx',
  sections: [
    { 
      content: [{ type: 'heading', text: 'Section 1', level: 1 }],
      header: { text: 'Section 1 Header' }
    },
    { 
      content: [{ type: 'heading', text: 'Section 2', level: 1 }],
      header: { text: 'Section 2 Header' }
    }
  ]
})
```

---

## patch - 模板填充（核心功能）

> **重要**：使用 Patcher API，保留原文档样式！

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string | 模板文件路径 |
| `patches` | object | 替换数据 `{ placeholder: value }` |
| `output` | string | 输出文件路径（可选，默认覆盖原文件） |
| `keepOriginalStyles` | boolean | 保留原文档样式（默认 true） |
| `delimiters` | object | 占位符分隔符（默认 `{ start: '{{', end: '}}' }`） |

### 模板文档准备

在 Word 文档中使用 `{{placeholder}}` 格式的占位符：

```
姓名：{{name}}
日期：{{date}}
金额：{{amount}}
```

### 示例

```javascript
// 简单文本替换
patch({
  path: 'template.docx',
  patches: {
    name: '张三',
    date: '2024-01-15',
    amount: '¥1,000.00'
  },
  output: 'output.docx'
})

// 复杂替换（段落样式）
patch({
  path: 'template.docx',
  patches: {
    title: {
      type: 'paragraph',
      children: [{ text: '新标题', bold: true, size: 28 }]
    }
  }
})

// 自定义分隔符
patch({
  path: 'template.docx',
  patches: { name: 'John' },
  delimiters: { start: '[[', end: ']]' }
})
```

---

## edit - 编辑文档

> **推荐使用 `patch` 工具进行编辑，可保留原文档样式**

### action 参数

| action | 说明 | 关键参数 |
|--------|------|----------|
| `replace` | 替换占位符 | `replacements`: { placeholder: value } |
| `append` | 添加段落 | `text`: 内容 |
| `insert` | 插入段落 | `text`: 内容，`placeholder`: 占位符 |
| `delete` | 删除内容 | `placeholder`: 占位符 |

### 示例

```javascript
// 替换占位符（保留格式）
edit({
  path: 'document.docx',
  action: 'replace',
  replacements: {
    title: '新标题',
    author: '张三'
  }
})

// 在占位符处插入内容
edit({
  path: 'document.docx',
  action: 'insert',
  placeholder: 'content_here',
  text: '这是新插入的内容'
})

// 添加段落到末尾
edit({
  path: 'document.docx',
  action: 'append',
  text: '新段落'
})

// 删除占位符内容
edit({
  path: 'document.docx',
  action: 'delete',
  placeholder: 'remove_this'
})
```

---

## convert - 格式转换

### 示例

```javascript
// 转 Markdown
convert({ path: 'document.docx', format: 'markdown' })
convert({ path: 'document.docx', format: 'markdown', output: 'document.md' })

// 转 HTML
convert({ path: 'document.docx', format: 'html' })
convert({ path: 'document.docx', format: 'html', output: 'document.html', includeStyles: true })
```

---

## image - 图片操作

### action 参数

| action | 说明 | 关键参数 |
|--------|------|----------|
| `list` | 列出图片 | 无额外参数 |
| `extract` | 提取图片 | `outputDir`: 输出目录 |
| `insert` | 插入图片 | `imagePath`: 图片路径，`placeholder`: 占位符 |

### 示例

```javascript
// 列出图片
image({ path: 'document.docx', action: 'list' })

// 提取图片
image({ path: 'document.docx', action: 'extract', outputDir: './images' })

// 在占位符处插入图片（保留格式）
image({
  path: 'document.docx',
  action: 'insert',
  placeholder: 'image_here',
  imagePath: 'chart.png',
  width: 500,
  height: 300
})

// 插入图片到末尾（可能丢失格式）
image({
  path: 'document.docx',
  action: 'insert',
  imagePath: 'chart.png',
  width: 500,
  height: 300
})
```

---

## link - 超链接操作

### action 参数

| action | 说明 | 关键参数 |
|--------|------|----------|
| `list` | 列出超链接 | 无额外参数 |
| `add` | 添加超链接 | `placeholder`: 占位符，`url`: 链接，`text`: 显示文本 |

### 示例

```javascript
// 列出超链接
link({ path: 'document.docx', action: 'list' })

// 在占位符处添加超链接
link({
  path: 'document.docx',
  action: 'add',
  placeholder: 'link_here',
  url: 'https://example.com',
  text: '点击访问'
})
```

---

## toc - 目录操作

### action 参数

| action | 说明 | 关键参数 |
|--------|------|----------|
| `insert` | 插入目录 | `placeholder`: 占位符 |
| `update` | 更新目录提示 | 无额外参数 |

### 示例

```javascript
// 在占位符处插入目录
toc({
  path: 'document.docx',
  action: 'insert',
  placeholder: 'toc_here'
})

// 更新目录提示
toc({ path: 'document.docx', action: 'update' })
// 返回提示：需要在 Word 中手动更新目录（F9）
```

---

## 最佳实践

### 1. 模板填充优先

使用 `patch` 工具进行模板填充，可保留原文档的所有样式：

```javascript
// 推荐：使用模板填充
patch({ path: 'template.docx', patches: { name: '张三' } })

// 不推荐：直接编辑（可能丢失格式）
edit({ path: 'document.docx', action: 'append', text: '新内容' })
```

### 2. 占位符命名规范

- 使用清晰的命名：`{{customer_name}}`、`{{invoice_date}}`
- 避免特殊字符：仅使用字母、数字、下划线
- 模板中占位符前后留空格：`姓名：{{ name }}`

### 3. 页眉页脚设置

创建专业文档时添加页眉页脚：

```javascript
write({
  path: 'report.docx',
  header: { text: '公司报告', alignment: 'CENTER' },
  footer: { pageNumber: true, pagePrefix: '第 ', pageSuffix: ' 页' },
  content: [...]
})
```

---

## 注意事项

- **模板填充**：使用 `patch` 工具可保留原文档样式
- **占位符格式**：默认 `{{placeholder}}`，可自定义分隔符
- **目录更新**：插入目录后需在 Word 中手动更新（F9）
- **图片插入**：推荐使用占位符方式，可保留格式
- **兼容性**：旧工具名（`docx_read` 等）仍然支持
