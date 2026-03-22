# XLSX 技能公式处理经验总结

> 本文档记录了 xlsx 技能中公式处理功能的开发经验，包括遇到的问题、解决方案和最佳实践。

## 背景

xlsx 技能使用 `xlsx` 库处理 Excel 文件读写，使用 `hyperformula` 库进行公式计算。在实现公式识别和计算功能时，遇到了多个技术问题。

## 技术栈

| 库 | 用途 | 版本 |
|---|---|---|
| xlsx (SheetJS) | Excel 文件读写 | ^0.18.5 |
| exceljs | 高级格式化功能 | ^4.4.0 |
| hyperformula | 公式计算引擎 | ^2.7.0 |

## 问题与解决方案

### 1. HyperFormula 导入问题

**问题描述**：
```javascript
const HyperFormula = require('hyperformula');
// HyperFormula 不是类，而是对象 { HyperFormula: class, ... }
```

**错误现象**：
```
HyperFormulaLib.buildEmpty is not a function
```

**解决方案**：
```javascript
function getHyperFormula() {
  if (!HyperFormula) {
    const hfModule = require('hyperformula');
    // HyperFormula 导出格式: { HyperFormula: class, ... }
    HyperFormula = hfModule.HyperFormula || hfModule.default || hfModule;
  }
  return HyperFormula;
}
```

**经验教训**：
- ES Module 和 CommonJS 的导出格式可能不同
- 使用 `||` 链式判断多种可能的导出格式
- 延迟加载可以避免启动时的模块解析问题

### 2. 公式计算问题

**问题描述**：
使用 `buildEmpty()` 创建实例后，公式计算返回错误结果。

**错误代码**：
```javascript
const hfInstance = HyperFormulaLib.buildEmpty({ licenseKey: 'gpl-v3' });
hfInstance.addSheet(sheetName);
hfInstance.setSheetContent(0, data);
```

**解决方案**：
使用 `buildFromSheets()` 直接创建带数据的实例：
```javascript
const hfInstance = HyperFormulaLib.buildFromSheets({
  [sheetName]: data
}, {
  licenseKey: 'gpl-v3'
});
```

**经验教训**：
- HyperFormula 的 `buildFromSheets()` 比 `buildEmpty()` + `setSheetContent()` 更可靠
- 公式字符串必须带 `=` 前缀才能被 HyperFormula 识别

### 3. 公式字符串识别问题

**问题描述**：
`excel_convert` 将 `=B2*C2` 作为普通文本写入单元格，而非公式对象。

**原因分析**：
`XLSX.utils.aoa_to_sheet()` 和 `XLSX.utils.json_to_sheet()` 不会自动识别公式字符串。

**解决方案**：
```javascript
// 检测公式字符串
for (let row = range.s.r; row <= range.e.r; row++) {
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cell = worksheet[cellAddress];
    if (cell && typeof cell.v === 'string' && cell.v.startsWith('=')) {
      // 转换为公式对象
      cell.f = cell.v.substring(1);  // 去掉 = 前缀
      // ... 计算并设置值
    }
  }
}
```

**经验教训**：
- xlsx 库的 `.f` 属性存储公式（不带 `=` 前缀）
- 需要手动检测并转换公式字符串

### 4. Excel XML 错误

**问题描述**：
Excel 打开文件时报错：
```
已修复的部件: 有 XML 错误的 /xl/worksheets/sheet1.xml
已修复的记录: /xl/styles.xml 部分的 格式 (样式)
```

**原因分析**：
1. 单元格类型设置不正确（公式单元格设为 `'n'` 但值为 `null`）
2. 空字符串 `''` 写入单元格导致样式冲突

**错误代码**：
```javascript
cell.t = 'n';
cell.v = null;  // 问题：null 值可能导致 XML 错误
```

**解决方案**：
```javascript
// 根据计算结果类型动态设置
if (typeof calculatedValue === 'number') {
  cell.t = 'n';
  cell.v = calculatedValue;
} else if (typeof calculatedValue === 'string') {
  cell.t = 'str';
  cell.v = calculatedValue;
} else if (typeof calculatedValue === 'boolean') {
  cell.t = 'b';
  cell.v = calculatedValue;
} else {
  cell.t = 'n';
  cell.v = 0;  // 使用 0 替代 null
}

// 删除可能导致样式冲突的属性
delete cell.w;
```

**经验教训**：
- 单元格类型必须与值类型匹配
- 避免使用 `null` 或 `undefined` 作为单元格值
- 删除不必要的属性（如 `.w`）可以避免样式冲突

## 单元格类型对照表

| 类型 | 代码 | 值类型 | 示例 |
|---|---|---|---|
| 数字 | `'n'` | number | `{ t: 'n', v: 123 }` |
| 字符串 | `'s'` | string | `{ t: 's', v: 'Hello' }` |
| 布尔 | `'b'` | boolean | `{ t: 'b', v: true }` |
| 日期 | `'d'` | Date | `{ t: 'd', v: new Date() }` |
| 公式 | `'n'` 或 `'str'` | 计算结果 | `{ t: 'n', v: 50, f: 'B2*C2' }` |

## 公式处理最佳实践

### 1. 写入公式

```javascript
// 设置公式（不带 = 前缀）
cell.f = 'B2*C2';
cell.t = 'n';

// 计算并设置值（可选，但推荐）
cell.v = calculateFormula('B2*C2');
```

### 2. 读取公式

```javascript
// 读取时需要 cellStyles: true
const workbook = XLSX.read(buffer, { type: 'buffer', cellStyles: true });

// 公式在 .f 属性，值在 .v 属性
const formula = cell.f;  // 'B2*C2'
const value = cell.v;    // 50
```

### 3. 使用 HyperFormula 计算

```javascript
// 准备数据（公式字符串带 = 前缀）
const data = [
  ['产品', '单价', '数量', '总价'],
  ['苹果', 5, 10, '=B2*C2'],
];

// 创建实例
const hfInstance = HyperFormula.buildFromSheets({
  'Sheet1': data
}, { licenseKey: 'gpl-v3' });

// 获取计算结果
const sheetId = hfInstance.getSheetId('Sheet1');
const value = hfInstance.getCellValue({ sheet: sheetId, col: 3, row: 1 });

// 清理
hfInstance.destroy();
```

## 调试技巧

### 1. 检查单元格对象

```javascript
console.log(JSON.stringify(worksheet['D2'], null, 2));
// 输出: { "t": "n", "v": 50, "f": "B2*C2" }
```

### 2. 验证公式计算

```javascript
// 使用 excel_calc 工具验证
const result = await execute('excel_calc', { path: 'test.xlsx' });
console.log(result.formulas);
```

### 3. Excel 修复日志

如果 Excel 打开时报错，查看修复日志可以定位问题：
```xml
<repairedParts>
  <repairedPart>已修复的部件: /xl/worksheets/sheet1.xml</repairedPart>
</repairedParts>
```

## 相关文件

- 技能实现：`data/skills/xlsx/index.js`
- 技能文档：`data/skills/xlsx/SKILL.md`
- 测试脚本：`tests/test-convert-formula.js`

## 参考资料

- [SheetJS 官方文档](https://docs.sheetjs.com/)
- [HyperFormula 官方文档](https://hyperformula.handsontable.com/)
- [Excel 单元格类型规范](https://docs.microsoft.com/en-us/office/open-xml/working-with-spreadsheets)

---

*文档创建：2026-03-22*
*最后更新：2026-03-22*