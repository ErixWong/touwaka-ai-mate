---
name: xlsx
description: "Excel 文件处理。用于读取、写入、编辑 .xlsx/.xls/.csv 文件，支持工作表管理、格式化、公式计算、数据查询和格式转换。当用户需要操作电子表格文件时触发。"
---

# XLSX - Excel 文件处理

## 工具

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `excel_read` | 读取 Excel | `scope`: workbook/sheet/cell |
| `excel_write` | 写入 Excel | `scope`: workbook/sheet/cell |
| `excel_sheet` | 工作表管理 | `action`: add/delete/rename/copy |
| `excel_format` | 格式化 | `type`: column/cell |
| `excel_query` | 数据查询 | `action`: filter/sort/find |
| `excel_convert` | 格式转换 | `format`: json/csv, `direction`: to/from |
| `excel_calc` | 公式计算 | - |

## excel_read

```javascript
// 读取工作簿
excel_read({ path: 'data.xlsx', scope: 'workbook' })
excel_read({ path: 'data.xlsx', scope: 'workbook', includeData: true })

// 读取工作表
excel_read({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1' })
excel_read({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1', header: 'json', range: 'A1:C10' })

// 读取单元格
excel_read({ path: 'data.xlsx', scope: 'cell', sheet: 'Sheet1', cell: 'A1' })
```

## excel_write

```javascript
// 创建工作簿
excel_write({
  path: 'new.xlsx',
  scope: 'workbook',
  sheets: [{ name: 'Sheet1', data: [['A', 'B'], [1, 2]] }]
})

// 写入工作表
excel_write({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1', data: [[...]], mode: 'overwrite' })
excel_write({ path: 'data.xlsx', scope: 'sheet', sheet: 'Sheet1', data: [[...]], mode: 'append' })

// 写入单元格
excel_write({ path: 'data.xlsx', scope: 'cell', sheet: 'Sheet1', cell: 'A1', value: 'Hello' })
excel_write({ path: 'data.xlsx', scope: 'cell', sheet: 'Sheet1', cell: 'C1', formula: '=SUM(A1:B1)' })
```

## excel_sheet

```javascript
excel_sheet({ path: 'data.xlsx', action: 'add', name: 'NewSheet' })
excel_sheet({ path: 'data.xlsx', action: 'delete', sheet: 'Sheet2' })
excel_sheet({ path: 'data.xlsx', action: 'rename', sheet: 'Sheet1', newName: 'Summary' })
excel_sheet({ path: 'data.xlsx', action: 'copy', sourceSheet: 'Template', targetSheet: 'Copy1' })
```

## excel_format

```javascript
// 列宽
excel_format({
  path: 'data.xlsx', type: 'column', sheet: 'Sheet1',
  columns: [{ column: 'A', width: 20 }, { column: 'B', width: 15 }]
})

// 单元格样式
excel_format({
  path: 'data.xlsx', type: 'cell', sheet: 'Sheet1',
  cells: ['A1', 'B1'],
  style: { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } } }
})
```

## excel_query

```javascript
// 筛选
excel_query({ path: 'data.xlsx', action: 'filter', column: 'status', condition: 'equals', value: 'active' })

// 排序
excel_query({ path: 'data.xlsx', action: 'sort', column: 'amount', order: 'desc' })

// 查找
excel_query({ path: 'data.xlsx', action: 'find', query: 'error' })
```

**筛选条件**: `equals`, `not_equals`, `greater`, `less`, `contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`

## excel_convert

```javascript
// Excel ↔ JSON
excel_convert({ path: 'data.xlsx', format: 'json', direction: 'to' })
excel_convert({ path: 'output.xlsx', format: 'json', direction: 'from', data: [{ name: 'Alice' }] })

// Excel ↔ CSV
excel_convert({ path: 'data.xlsx', format: 'csv', direction: 'to', output: 'data.csv' })
excel_convert({ path: 'data.csv', format: 'csv', direction: 'from', output: 'data.xlsx' })
```

## excel_calc

```javascript
excel_calc({ path: 'data.xlsx', sheet: 'Sheet1' })
// 返回: { formulas: [{ cell: 'C1', formula: 'SUM(A1:B1)', value: 15 }] }
```

## 兼容旧工具名

| 旧名称 | 新名称 |
|--------|--------|
| `read_workbook`, `read` | `excel_read(scope: 'workbook')` |
| `read_sheet` | `excel_read(scope: 'sheet')` |
| `read_cell` | `excel_read(scope: 'cell')` |
| `create_workbook`, `create` | `excel_write(scope: 'workbook')` |
| `write_sheet` | `excel_write(scope: 'sheet')` |
| `write_cell` | `excel_write(scope: 'cell')` |
| `add_sheet` | `excel_sheet(action: 'add')` |
| `delete_sheet` | `excel_sheet(action: 'delete')` |
| `rename_sheet` | `excel_sheet(action: 'rename')` |
| `copy_sheet` | `excel_sheet(action: 'copy')` |
| `set_column_width` | `excel_format(type: 'column')` |
| `set_cell_style` | `excel_format(type: 'cell')` |
| `filter_data` | `excel_query(action: 'filter')` |
| `sort_data` | `excel_query(action: 'sort')` |
| `find_data` | `excel_query(action: 'find')` |
| `to_json` | `excel_convert(format: 'json', direction: 'to')` |
| `from_json` | `excel_convert(format: 'json', direction: 'from')` |
| `to_csv` | `excel_convert(format: 'csv', direction: 'to')` |
| `from_csv` | `excel_convert(format: 'csv', direction: 'from')` |
| `calculate_formulas` | `excel_calc()` |

## 输出规范

- **字体**: 使用专业字体（Arial, Times New Roman）
- **公式错误**: 必须确保零错误（#REF!, #DIV/0!, #VALUE!, #N/A, #NAME?）
- **财务模型颜色**: 蓝色=输入，黑色=公式，绿色=跨表引用，红色=外部链接，黄色=关键假设
- **数字格式**: 年份用文本，货币用 $#,##0，负数用括号