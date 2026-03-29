---
name: xlsx
description: "Excel 文件处理。用于读取、写入、编辑 .xlsx/.xls/.csv 文件，支持工作表管理、格式化、公式计算、数据查询和格式转换。当用户需要操作电子表格文件时触发。"
---

# XLSX - Excel 文件处理

## 路径参数说明

> **重要**：所有工具的 `path` 参数遵循以下规则：

| 参数类型 | 说明 |
|----------|------|
| **相对路径** | 相对于工作目录，工具自动拼接基础路径。示例：`input/file.xlsx` |
| **绝对路径** | 仅管理员可用，需在允许的路径范围内 |

**基础路径规则**：
- 管理员：项目根目录 或 `data/` 目录
- 普通用户：`data/work/{user_id}/` 目录

**示例**：
```javascript
// 相对路径（推荐）
read({ path: 'input/data.xlsx', scope: 'workbook' })

// 绝对路径（仅管理员）
read({ path: '/absolute/path/to/data.xlsx', scope: 'workbook' })
```

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `read` | 读取 Excel | `scope`: workbook/sheet/cell |
| `write` | 写入 Excel | `scope`: workbook/sheet/cell |
| `sheet` | 工作表管理 | `action`: add/delete/rename/copy |
| `format` | 格式化 | `type`: column/cell |
| `query` | 数据查询 | `action`: filter/sort/find |
| `convert` | 格式转换 | `format`: json/csv, `direction`: to/from |
| `calc` | 公式计算 | - |

## read

```javascript
// 读取工作簿
read({ path: 'data.xlsx', scope: 'workbook' })
read({ path: 'data.xlsx', scope: 'workbook', includeData: true })

// 读取工作表
read({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1' })
read({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1', header: 'json', range: 'A1:C10' })

// 读取单元格
read({ path: 'data.xlsx', scope: 'cell', sheet: 'Sheet1', cell: 'A1' })
```

## write

```javascript
// 创建工作簿
write({
  path: 'new.xlsx',
  scope: 'workbook',
  sheets: [{ name: 'Sheet1', data: [['A', 'B'], [1, 2]] }]
})

// 写入工作表
write({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1', data: [[...]], mode: 'overwrite' })
write({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1', data: [[...]], mode: 'append' })

// 写入单元格
write({ path: 'data.xlsx', scope: 'cell', sheet: 'Sheet1', cell: 'A1', value: 'Hello' })
write({ path: 'data.xlsx', scope: 'cell', sheet: 'Sheet1', cell: 'C1', formula: '=SUM(A1:B1)' })
```

## sheet

```javascript
sheet({ path: 'data.xlsx', action: 'add', name: 'NewSheet' })
sheet({ path: 'data.xlsx', action: 'delete', sheet: 'Sheet2' })
sheet({ path: 'data.xlsx', action: 'rename', sheet: 'Sheet1', newName: 'Summary' })
sheet({ path: 'data.xlsx', action: 'copy', sourceSheet: 'Template', targetSheet: 'Copy1' })
```

## format

```javascript
// 列宽
format({
  path: 'data.xlsx', type: 'column', sheet: 'Sheet1',
  columns: [{ column: 'A', width: 20 }, { column: 'B', width: 15 }]
})

// 单元格样式
format({
  path: 'data.xlsx', type: 'cell', sheet: 'Sheet1',
  cells: ['A1', 'B1'],
  style: { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } } }
})
```

## query

```javascript
// 筛选
query({ path: 'data.xlsx', action: 'filter', column: 'status', condition: 'equals', value: 'active' })

// 排序
query({ path: 'data.xlsx', action: 'sort', column: 'amount', order: 'desc' })

// 查找
query({ path: 'data.xlsx', action: 'find', query: 'error' })
```

**筛选条件**: `equals`, `not_equals`, `greater`, `less`, `contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`

## convert

```javascript
// Excel ↔ JSON
convert({ path: 'data.xlsx', format: 'json', direction: 'to' })
convert({ path: 'output.xlsx', format: 'json', direction: 'from', data: [{ name: 'Alice' }] })

// Excel ↔ CSV
convert({ path: 'data.xlsx', format: 'csv', direction: 'to', output: 'data.csv' })
convert({ path: 'data.csv', format: 'csv', direction: 'from', output: 'data.xlsx' })
```

## calc

```javascript
calc({ path: 'data.xlsx', sheet: 'Sheet1' })
// 返回: { formulas: [{ cell: 'C1', formula: 'SUM(A1:B1)', value: 15 }] }
```

## 输出规范

- **字体**: 使用专业字体（Arial, Times New Roman）
- **公式错误**: 必须确保零错误（#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?）
- **财务模型颜色**: 蓝色=输入，黑色=公式，绿色=跨表引用，红色=外部链接，黄色=关键假设
- **数字格式**: 年份用文本，货币用 $#,##0，负数用括号