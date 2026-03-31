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
| `success` | boolean | 是否成功 |
| `invoice_number` | string | 发票号码（20位数字） |
| `invoice_date` | string | 开票日期（格式：xxxx年xx月xx日） |
| `invoice_type` | string | 发票类型（如：电子发票（增值税专用发票）） |
| `seller` | object | 销售方信息 `{ name, taxId }` |
| `buyer` | object | 购买方信息 `{ name, taxId }` |
| `total_amount` | number | 合计金额 |
| `total_tax` | number | 税额 |
| `total_with_tax` | number | 价税合计 |
| `item_count` | number | 商品明细总数 |
| `page_count` | number | PDF页数 |
| `remarks` | string | 备注信息 |
| `content` | string | 格式化后的内容（JSON或Markdown） |
| `output_file` | string | 保存的文件路径（如果指定了output参数） |

### 调用示例

```javascript
// JSON 格式输出
invoice__extract({ 
  path: "invoice.pdf", 
  format: "json" 
})

// Markdown 格式输出
invoice__extract({ 
  path: "invoice.pdf", 
  format: "markdown" 
})

// 保存到文件
invoice__extract({ 
  path: "invoice.pdf", 
  format: "json",
  output: "invoice_result.json"
})
```

### 返回示例

```json
{
  "success": true,
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
  "content": "{...}",
  "format": "json"
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

// 每个文本项包含坐标信息
const items = textContent.items.map(item => ({
  text: item.str,
  x: item.transform[4],      // x坐标
  y: item.transform[5],      // y坐标
  width: item.width,
  height: item.height
}));
```

### 发票解析算法

1. **坐标聚类**：按 y 坐标聚类识别文本行
2. **列边界检测**：基于标准发票布局定义列范围
3. **字段定位**：
   - 发票号码：20位数字，位于页面顶部
   - 开票日期：位于"开票日期"标签右侧
   - 公司信息：基于"名称："标签定位
   - 金额信息：基于"¥"符号和"价税合计"标签
4. **商品明细解析**：识别以 `*` 开头的商品行，按列分配字段

## 支持的发票类型

| 类型 | 支持状态 | 说明 |
|------|----------|------|
| 增值税专用发票 | ✅ 完整支持 | 标准布局 |
| 增值税普通发票 | ✅ 完整支持 | 与专票布局相同 |
| 电子发票 | ✅ 完整支持 | 包括电子专票和普票 |
| 多页发票 | ✅ 完整支持 | 提取每页开票人信息 |

## 限制与注意事项

1. **扫描版发票**：本技能基于文本坐标解析，对于纯图片的扫描版发票无法识别。建议先用 `pdf` 技能的 `render` 操作将页面转为图片，再使用 VL 模型识别。

2. **非标准布局**：如果发票布局与标准增值税发票差异较大，解析结果可能不准确。

3. **坐标精度**：PDF 坐标系原点在左下角，y 轴向上递增，与屏幕坐标系不同。

## 与其他技能的协作

```javascript
// 场景：扫描版发票处理
// 1. 先用 pdf skill 渲染页面
const renderResult = await pdf__read({
  path: "scanned_invoice.pdf",
  operation: "render",
  output_dir: "./invoice_images"
});

// 2. 将图片发送给 VL 模型识别文字
// 3. 如需结构化数据，可手动整理或使用 invoice skill 处理原始PDF（如果有文本层）
```

## 快速参考

| 任务 | 调用方式 |
|------|----------|
| 提取发票JSON数据 | `invoice__extract({ path: "invoice.pdf", format: "json" })` |
| 提取发票Markdown | `invoice__extract({ path: "invoice.pdf", format: "markdown" })` |
| 保存到文件 | `invoice__extract({ path: "invoice.pdf", output: "result.json" })` |

## 更新日志

- **2026-03-31**: 初始版本，支持中国增值税发票解析
  - 基于 pdfjs-dist 实现坐标提取
  - 支持单页/多页发票
  - 支持 JSON/Markdown 输出格式

---

*本技能基于 pdfjs-dist (Mozilla PDF.js) 开发，遵循 Touwaka Mate Skill 规范。*
