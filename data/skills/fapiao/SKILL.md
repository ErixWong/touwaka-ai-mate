---
name: fapiao
description: "发票专用解析技能。支持中国增值税发票、普通发票、电子发票的结构化提取。基于 pdfjs-dist 实现坐标提取，可提取发票号码、日期、买卖双方信息、商品明细、金额等字段。"
license: Proprietary. LICENSE.txt has complete terms
argument-hint: "extract [path] [format]"
user-invocable: true
---

# Invoice - 发票专用解析技能

> **依赖**：pdfjs-dist (Mozilla PDF.js) - 提供坐标提取能力
>
> **注意**：本技能专门用于发票解析，与通用 PDF 处理技能 (`pdf`) 分离，避免重型依赖影响通用场景性能。

## 工具

本技能提供 `extract` 工具，用于提取发票结构化数据。

### extract - 提取发票数据

**参数：**

| 参数 | 类型 | 必需 | 默认值 | 描述 |
|------|------|------|--------|------|
| `path` | string | 是 | - | PDF发票文件路径 |
| `format` | string | 否 | `json` | 输出格式：`json` 或 `markdown` |
| `output` | string | 否 | - | 输出文件路径（不指定则只返回内容） |

**返回字段：**

| 字段 | 类型 | 描述 |
|------|------|------|
| `success` | boolean | 是否成功（提取到至少一个关键字段为 true） |
| `failure_reason` | string\|null | 失败原因码（`NO_TEXT_LAYER`, `PARSE_INCOMPLETE`, `FILE_NOT_FOUND` 等） |
| `message` | string\|null | 失败时可读的消息 |
| `text_content_length` | number | 提取到的文本总长度（用于判断是否为扫描件） |
| `extraction_status` | string | 提取状态：`SUCCESS` 或 `NO_TEXT_LAYER` |
| `invoice_number` | string | 发票号码（8位或20位数字） |
| `invoice_date` | string | 开票日期（格式：xxxx年xx月xx日，支持多种输入格式） |
| `invoice_type` | string | 发票类型（识别增值税专票/普票、电子发票等多种类型） |
| `seller` | object | 销售方信息 `{ name, taxId }` |
| `buyer` | object | 购买方信息 `{ name, taxId }` |
| `total_amount` | number | 合计金额 |
| `total_tax` | number | 税额 |
| `total_with_tax` | number | 价税合计（含一致性校验） |
| `item_count` | number | 商品明细总数 |
| `page_count` | number | PDF页数 |
| `remarks` | string | 备注信息 |
| `field_sources` | object | 关键字段来源页映射 `{ invoiceNumber, invoiceDate, ... }` |
| `error` | object\|null | 异常详情 `{ code, stage, message, cause }`（仅失败时） |
| `content` | string | 格式化后的内容（JSON或Markdown） |
| `output_file` | string | 保存的文件路径（如果指定了output参数） |

### 调用示例

```javascript
// JSON 格式输出
fapiao__extract({
  path: "invoice.pdf",
  format: "json"
})

// Markdown 格式输出
fapiao__extract({
  path: "invoice.pdf",
  format: "markdown"
})

// 保存到文件
fapiao__extract({
  path: "invoice.pdf",
  format: "json",
  output: "invoice_result.json"
})
```

### 返回示例

**成功示例：**

```json
{
  "success": true,
  "failure_reason": null,
  "message": null,
  "text_content_length": 1423,
  "extraction_status": "SUCCESS",
  "invoice_number": "26512000000351324826",
  "invoice_date": "2024年03月15日",
  "invoice_type": "电子发票（增值税专用发票）",
  "seller": {
    "name": "某某科技有限公司",
    "taxId": "91110108MA00XXXXXX"
  },
  "buyer": {
    "name": "某某集团有限公司",
    "taxId": "91110000123456789X"
  },
  "total_amount": 10000.00,
  "total_tax": 1300.00,
  "total_with_tax": 11300.00,
  "item_count": 5,
  "page_count": 1,
  "remarks": "",
  "field_sources": {
    "invoiceNumber": 1,
    "invoiceDate": 1,
    "buyer": 1,
    "seller": 1,
    "amount": 1
  },
  "content": "{...}",
  "format": "json"
}
```

**扫描件示例：**

```json
{
  "success": false,
  "failure_reason": "NO_TEXT_LAYER",
  "message": "PDF has no text layer (scanned image). Use OCR or VL model first.",
  "text_content_length": 0,
  "extraction_status": "NO_TEXT_LAYER",
  "invoice_number": "",
  "invoice_date": "",
  "invoice_type": "",
  "seller": { "name": "", "taxId": "" },
  "buyer": { "name": "", "taxId": "" },
  "total_amount": 0,
  "total_tax": 0,
  "total_with_tax": 0,
  "item_count": 0,
  "page_count": 1,
  "remarks": "",
  "output_file": null,
  "content": "",
  "format": "json"
}
```

**异常示例：**

```json
{
  "success": false,
  "failure_reason": "FILE_NOT_FOUND",
  "message": "Cannot read file: /path/to/missing.pdf",
  "error": {
    "code": "FILE_NOT_FOUND",
    "stage": "pdf_read",
    "message": "Cannot read file: /path/to/missing.pdf",
    "cause": "ENOENT: no such file or directory"
  }
}
```

## 商品明细结构

对于多页发票，商品明细按页分组，每页包含：

```json
{
  "pageNumber": 1,
  "issuer": "张三",
  "itemCount": 3,
  "items": [
    {
      "category": "*软件*",
      "name": "企业管理软件",
      "model": "V3.0",
      "unit": "套",
      "quantity": 1,
      "price": 5000.00,
      "amount": 5000.00,
      "taxRate": "13%",
      "taxAmount": 650.00
    }
  ]
}
```

## 技术实现

### 坐标提取原理

本技能基于 `pdfjs-dist` 的底层 API 实现坐标提取：

```javascript
const page = await pdfDocument.getPage(1);
const textContent = await page.getTextContent();

const items = textContent.items.map(item => ({
  text: item.str,
  x: item.transform[4],      // x坐标
  y: item.transform[5],      // y坐标
  width: item.width,
  height: item.height
}));
```

### 发票解析算法

1. **路径安全**：使用 `path.relative` + `..` 边界判断 + `realpath` 双端校验，防止前缀欺骗和软链绕过
2. **坐标聚类**：按 y 坐标聚类识别文本行
3. **列边界检测**：基于标准发票布局定义列范围
4. **字段定位**：
   - 发票号码：支持 8/20 位数字 + "发票号码"标签邻域提取
   - 开票日期：支持 `YYYY年MM月DD日`、`YYYY-MM-DD`、`YYYY.MM.DD`、`YYYY/MM/DD` 及 token 拼接
   - 公司信息：基于"名称："标签定位，支持右列搜索
   - 金额信息：基于 `¥`/`￥` 符号 + "价税合计"/"小写"标签 + 合计行 + 一致性校验
5. **商品明细解析**：基于列覆盖率和坐标聚类判行，不强制 `*` 起始，允许 category 为空
6. **多页策略**：全页扫描候选字段打分，自动选取最优值，保留字段来源页映射
7. **异常模型**：统一 `{ code, stage, message, cause }` 结构化异常

## 支持的发票类型

| 类型 | 支持状态 | 说明 |
|------|----------|------|
| 增值税专用发票 | ✅ 完整支持 | 标准布局 |
| 增值税普通发票 | ✅ 完整支持 | 与专票布局相同 |
| 电子发票（专票） | ✅ 完整支持 | 关键字识别 |
| 电子发票（普票） | ✅ 完整支持 | 关键字识别 |
| 机动车销售统一发票 | ✅ 支持 | 关键字识别 |
| 二手车销售统一发票 | ✅ 支持 | 关键字识别 |
| 多页发票 | ✅ 完整支持 | 提取每页开票人信息 |

## 限制与注意事项

1. **扫描版发票**：本技能基于文本坐标解析。当 `extraction_status === 'NO_TEXT_LAYER'` 时表示没有文本层（纯图片扫描件），返回 `success: false`。建议先用 `pdf` 技能的 `render` 操作将页面转为图片，再使用 VL 模型识别。

2. **非标准布局**：如果发票布局与标准增值税发票差异较大，解析结果可能不准确。

3. **坐标精度**：PDF 坐标系原点在左下角，y 轴向上递增，与屏幕坐标系不同。

## 与其他技能的协作

```javascript
// 场景：扫描版发票处理
// 1. 先用 fapiao 技能尝试提取（会返回 NO_TEXT_LAYER 状态）
const result = await fapiao__extract({ path: "scanned_invoice.pdf" });
if (result.extraction_status === 'NO_TEXT_LAYER') {
  // 处理扫描件...
}

// 2. 用 pdf skill 渲染页面
const renderResult = await pdf__read({
  path: "scanned_invoice.pdf",
  operation: "render",
  output_dir: "./invoice_images"
});

// 3. 将图片发送给 VL 模型识别文字
```

## 错误码参考

| 错误码 | 描述 |
|--------|------|
| `NO_TEXT_LAYER` | PDF 无文本层（扫描件） |
| `PARSE_INCOMPLETE` | 解析不完整，未提取到关键字段 |
| `PATH_NOT_ALLOWED` | 路径不在允许范围内（含前缀欺骗/软链绕过检测） |
| `FILE_NOT_FOUND` | 文件不存在或不可读 |
| `PDF_READ_ERROR` | PDF 解析失败 |
| `UNEXPECTED_ERROR` | 未预期的运行时错误 |

## 快速参考

| 任务 | 调用方式 |
|------|----------|
| 提取发票JSON数据 | `fapiao__extract({ path: "invoice.pdf", format: "json" })` |
| 提取发票Markdown | `fapiao__extract({ path: "invoice.pdf", format: "markdown" })` |
| 保存到文件 | `fapiao__extract({ path: "invoice.pdf", output: "result.json" })` |

## 更新日志

- **2026-05-30**: 架构审计修复版本
  - 修复路径安全：`path.relative` + `realpath` 双端校验替代 `startsWith`
  - 增加扫描件显式分类：`text_content_length` + `extraction_status`（`NO_TEXT_LAYER`）
  - 修正 `success` 语义：失败返回 `success: false` + `failure_reason`
  - 强化发票号解析：支持 8/20 位 + "发票号码"标签邻域提取
  - 强化日期解析：支持 `-`、`.`、`/` 及 token 拼接多格式
  - 强化金额解析：统一清洗 + 合计一致性校验
  - 强化明细解析：列覆盖率判行，允许 category 为空
  - 扩展发票类型识别：专票/普票/机动车/二手车等关键词集
  - 多页字段选取优化：全页候选打分，保留 `field_sources` 来源页
  - 异常模型结构化：统一 `{ code, stage, message, cause }`

- **2026-03-31**: 初始版本，支持中国增值税发票解析
  - 基于 pdfjs-dist 实现坐标提取
  - 支持单页/多页发票
  - 支持 JSON/Markdown 输出格式

---

*本技能基于 pdfjs-dist (Mozilla PDF.js) 开发，遵循 Touwaka Mate Skill 规范。*
