# pdf-parse 升级指南

## 问题背景

在使用 pdf-parse 解析 PDF 时，遇到以下错误：

```
Failed to parse skill output: Unexpected token 'W', "Warning: T"... is not valid JSON
```

**原因分析：**
1. pdf-parse 旧版本 (v1.x) 会输出 Warning 信息到 stdout
2. 技能执行器期望输出是纯 JSON 格式
3. Warning 信息导致 JSON 解析失败

## 解决方案

### 1. 升级 pdf-parse

```bash
npm install pdf-parse@latest
```

当前版本：`^2.4.5`（从 `^1.1.1` 升级）

### 2. 使用 verbosity 参数抑制警告

新版本 pdf-parse 提供 `VerbosityLevel` 枚举来控制输出级别：

```javascript
const { PDFParse, VerbosityLevel } = require('pdf-parse');

const parser = new PDFParse({
  data: pdfBuffer,
  verbosity: VerbosityLevel.ERRORS  // 只显示错误，抑制警告
});

const result = await parser.getText();
await parser.destroy();  // 记得释放内存
```

**VerbosityLevel 选项：**

| 值 | 说明 |
|---|---|
| `VerbosityLevel.ERRORS` | 只显示错误信息 |
| `VerbosityLevel.WARNINGS` | 显示警告和错误 |
| `VerbosityLevel.INFOS` | 显示信息、警告和错误 |

## pdf-parse v1 vs v2 API 对比

### v1 API（旧版）

```javascript
// v1 - 函数式调用
const pdfParse = require('pdf-parse');
const data = await pdfParse(buffer);
console.log(data.text);
```

### v2 API（新版）

```javascript
// v2 - 类实例调用
const { PDFParse, VerbosityLevel } = require('pdf-parse');

const parser = new PDFParse({
  data: buffer,
  verbosity: VerbosityLevel.ERRORS
});

const result = await parser.getText();
console.log(result.text);

// 释放内存
await parser.destroy();
```

## 新版本新功能

### 1. `getText()` - 提取文本

```javascript
const result = await parser.getText({
  partial: [1, 3, 5]  // 只提取第 1、3、5 页
});
```

### 2. `getInfo()` - 获取元数据

```javascript
const result = await parser.getInfo({
  parsePageInfo: true  // 解析每页信息
});
console.log(result.total);        // 总页数
console.log(result.infoData);     // 元数据
console.log(result.pages);        // 每页信息
```

### 3. `getTable()` - 提取表格（新功能）

```javascript
const result = await parser.getTable();
result.pages.forEach((page, i) => {
  console.log(`Page ${i + 1} tables:`, page.tables);
});
```

### 4. `getImage()` - 提取图片（新功能）

```javascript
const result = await parser.getImage({
  imageThreshold: 80  // 过滤小于 80px 的图片
});
result.pages.forEach((page, i) => {
  page.images.forEach((img, j) => {
    console.log(`Image ${j}: ${img.width}x${img.height}`);
    // img.data 是 Buffer
  });
});
```

### 5. `getScreenshot()` - 渲染页面为图片（新功能）

```javascript
const result = await parser.getScreenshot({
  scale: 1.5,           // 缩放比例
  desiredWidth: 1024,   // 或指定目标宽度
  partial: [1, 2]       // 只渲染第 1、2 页
});

result.pages.forEach((page, i) => {
  // page.data 是 PNG Buffer
  // page.dataUrl 是 base64 Data URL
});
```

### 6. `getHeader()` - 获取远程 PDF 头信息（Node.js 专用）

```javascript
const { getHeader } = require('pdf-parse/node');

const header = await getHeader('https://example.com/doc.pdf', true);
console.log(header.status);    // HTTP 状态
console.log(header.size);      // 文件大小
console.log(header.isPdf);     // 是否为 PDF
```

## 技能代码更新

### 更新的函数

| 函数 | 更新内容 |
|---|---|
| `extractText()` | 使用 `PDFParse` 类 + `verbosity` 参数 |
| `extractTables()` | 使用 `getTable()` 实现真正的表格提取 |
| `extractImages()` | 使用 `getImage()` 实现图片提取 |
| `convertToImages()` | 使用 `getScreenshot()` 实现页面渲染 |
| `readPdf()` | 使用 `getInfo()` 获取更丰富的元数据 |

### 新增参数

所有使用 pdf-parse 的函数都支持 `suppressWarnings` 参数：

```javascript
await extractText({
  path: 'document.pdf',
  suppressWarnings: true  // 默认为 true
});
```

## 注意事项

1. **内存管理**：v2 API 需要手动调用 `parser.destroy()` 释放内存
2. **Node.js 版本**：v2 要求 Node.js >= 20.16.0 或 >= 22.3.0
3. **异常处理**：v2 提供了更多异常类型：
   - `PasswordException` - 密码错误
   - `InvalidPDFException` - 无效 PDF
   - `FormatError` - 格式错误
   - `ResponseException` - 网络响应错误

## 参考链接

- [pdf-parse npm](https://www.npmjs.com/package/pdf-parse)
- [pdf-parse GitHub](https://github.com/mehmet-kozan/pdf-parse)
- [pdf.js 文档](https://mozilla.github.io/pdf.js/)