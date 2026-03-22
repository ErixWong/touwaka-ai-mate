---
name: docx
description: "Word 文档处理。用于读取、写入、编辑 .docx 文件，支持文本/段落/表格/批注提取、Markdown 转换、图片操作。当用户需要操作 Word 文档时触发。"
---

# DOCX - Word 文档处理

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
docx_read({ path: 'input/document.docx', scope: 'text' })

// 绝对路径（仅管理员）
docx_read({ path: '/absolute/path/to/document.docx', scope: 'text' })
```

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `docx_read` | 读取文档 | `scope`: info/text/paragraphs/tables/comments |
| `docx_write` | 写入文档 | `source`: data/markdown |
| `docx_edit` | 编辑文档 | `action`: add_paragraph/replace_text/add_table |
| `docx_convert` | 格式转换 | `format`: markdown/html |
| `docx_image` | 图片操作 | `action`: extract/insert |

## docx_read

```javascript
// 读取信息
docx_read({ path: 'document.docx', scope: 'info' })

// 提取文本
docx_read({ path: 'document.docx', scope: 'text' })
docx_read({ path: 'document.docx', scope: 'text', includeFormatting: true })  // 返回 HTML

// 提取段落/表格/批注
docx_read({ path: 'document.docx', scope: 'paragraphs' })
docx_read({ path: 'document.docx', scope: 'tables' })
docx_read({ path: 'document.docx', scope: 'comments' })
```

## docx_write

```javascript
// 从数据创建
docx_write({
  path: 'output.docx',
  source: 'data',
  content: [
    { type: 'heading', text: 'Title', level: 1 },
    { type: 'paragraph', text: 'Content here.' },
    { type: 'list', items: ['Item 1', 'Item 2'] },
    { type: 'table', headers: ['Name', 'Value'], rows: [['A', '1']] }
  ]
})

// 从 Markdown 创建
docx_write({
  path: 'output.docx',
  source: 'markdown',
  markdown: '# Title\n\nParagraph with **bold** text.\n\n- Item 1\n- Item 2'
})
```

## docx_edit

```javascript
// 添加段落
docx_edit({ path: 'document.docx', action: 'add_paragraph', text: 'New paragraph', position: 'end' })
docx_edit({ path: 'document.docx', action: 'add_paragraph', text: 'Intro', position: 'start' })
docx_edit({ path: 'document.docx', action: 'add_paragraph', text: 'At position 3', position: 3 })

// 替换文本
docx_edit({ path: 'document.docx', action: 'replace_text', search: 'old', replace: 'new' })

// 添加表格
docx_edit({
  path: 'document.docx',
  action: 'add_table',
  headers: ['Name', 'Age'],
  rows: [['Alice', '25'], ['Bob', '30']],
  position: 5
})
```

## docx_convert

```javascript
// 转 Markdown
docx_convert({ path: 'document.docx', format: 'markdown' })
docx_convert({ path: 'document.docx', format: 'markdown', output: 'document.md' })

// 转 HTML
docx_convert({ path: 'document.docx', format: 'html' })
docx_convert({ path: 'document.docx', format: 'html', output: 'document.html', includeStyles: true })
```

## docx_image

```javascript
// 提取图片
docx_image({ path: 'document.docx', action: 'extract', outputDir: './images' })

// 插入图片
docx_image({ path: 'document.docx', action: 'insert', imagePath: 'chart.png', width: 500, height: 300 })
```

## 注意事项

- **编辑限制**: 编辑操作会丢失原有格式和样式
- **图片插入**: 图片添加到文档末尾
- **Markdown 支持**: 标题、粗体、斜体、列表
