---
name: pptx
description: "PowerPoint 演示文稿处理。用于读取、写入、编辑 .pptx 文件，支持幻灯片管理、图片/表格插入、Markdown 转换、合并导出。当用户需要操作演示文稿文件时触发。"
---

# PPTX - PowerPoint 演示文稿处理

## 路径参数说明

> **重要**：所有工具的 `path` 参数遵循以下规则：

| 参数类型 | 说明 |
|----------|------|
| **相对路径** | 相对于工作目录，工具自动拼接基础路径。示例：`input/file.pptx` |
| **绝对路径** | 仅管理员可用，需在允许的路径范围内 |

**基础路径规则**：
- 管理员：项目根目录 或 `data/` 目录
- 普通用户：`data/work/{user_id}/` 目录

**示例**：
```javascript
// 相对路径（推荐）
pptx_read({ path: 'input/presentation.pptx', scope: 'info' })

// 绝对路径（仅管理员）
pptx_read({ path: '/absolute/path/to/presentation.pptx', scope: 'info' })
```

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pptx_read` | 读取演示文稿 | `scope`: info/text/structure |
| `pptx_write` | 写入演示文稿 | `source`: data/markdown |
| `pptx_slide` | 幻灯片管理 | `action`: add/delete/update |
| `pptx_image` | 图片操作 | `action`: extract/add |
| `pptx_table` | 添加表格 | - |
| `pptx_export` | 导出操作 | `action`: images/thumbnail/merge |

## pptx_read

```javascript
// 读取信息
pptx_read({ path: 'presentation.pptx', scope: 'info' })

// 提取文本
pptx_read({ path: 'presentation.pptx', scope: 'text' })
pptx_read({ path: 'presentation.pptx', scope: 'text', slideNumbers: [1, 3, 5] })

// 提取结构
pptx_read({ path: 'presentation.pptx', scope: 'structure' })
```

## pptx_write

```javascript
// 从数据创建
pptx_write({
  path: 'output.pptx',
  source: 'data',
  slides: [
    { title: 'Welcome', content: 'Introduction' },
    { title: 'Key Points', texts: [{ text: 'Point 1', bullet: true }] },
    { title: 'Data', tables: [{ rows: [['Name', 'Value'], ['A', '100']] }] }
  ]
})

// 从 Markdown 创建
pptx_write({
  path: 'output.pptx',
  source: 'markdown',
  markdown: '# Slide 1\n- Point 1\n- Point 2\n\n# Slide 2\n- Point 3'
})
```

## pptx_slide

```javascript
pptx_slide({ path: 'presentation.pptx', action: 'add', title: 'New Slide', content: ['Point 1', 'Point 2'] })
pptx_slide({ path: 'presentation.pptx', action: 'delete', slideNumber: 3 })
pptx_slide({ path: 'presentation.pptx', action: 'update', slideNumber: 2, title: 'Updated' })
```

## pptx_image

```javascript
// 提取图片
pptx_image({ path: 'presentation.pptx', action: 'extract', outputDir: './images' })

// 添加图片
pptx_image({ path: 'presentation.pptx', action: 'add', slideNumber: 1, imagePath: 'chart.png', x: 1, y: 2, width: 6, height: 4 })
```

## pptx_table

```javascript
pptx_table({
  path: 'presentation.pptx',
  slideNumber: 3,
  rows: [['Name', 'Q1', 'Q2'], ['Product A', '100', '150']],
  x: 0.5, y: 1.5, width: 9
})
```

## pptx_export

```javascript
// 导出图片（需外部工具）
pptx_export({ path: 'presentation.pptx', action: 'images', outputDir: './slides' })

// 缩略图
pptx_export({ path: 'presentation.pptx', action: 'thumbnail', output: 'thumb.png', slideNumber: 1 })

// 合并
pptx_export({ action: 'merge', paths: ['part1.pptx', 'part2.pptx'], output: 'merged.pptx' })
```

## 注意事项

- **幻灯片编号**: 从 1 开始
- **坐标单位**: 英寸
- **图片导出**: 需外部工具（LibreOffice/云服务）
