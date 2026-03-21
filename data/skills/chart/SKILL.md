# Chart Skill - ECharts SSR 图表生成

## 概述

基于 ECharts 的服务端渲染（SSR）图表生成技能，无需浏览器环境即可生成各种类型的图表。

## 功能特性

- ✅ **20+ 图表类型**：柱状图、折线图、饼图、雷达图、仪表盘等
- ✅ **多种输出格式**：SVG、PNG、Base64、文件
- ✅ **完全 SSR**：无需浏览器，服务端直接渲染
- ✅ **简洁 API**：简化配置，快速生成图表
- ✅ **原始配置支持**：支持完整 ECharts 配置

## 依赖

```json
{
  "echarts": "^5.5.0",
  "sharp": "^0.33.0"
}
```

安装依赖：
```bash
cd data/skills/chart
npm install
```

## 使用方式

### 基础用法

```javascript
const chartSkill = require('./data/skills/chart/index.js');

// 生成柱状图
const result = await chartSkill('generate', {
  type: 'bar',
  data: [100, 200, 300, 400, 500],
  options: {
    title: 'Sales Report',
    xAxisData: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']
  },
  output: 'svg'
});

console.log(result.data); // SVG 字符串
```

### 输出格式

#### SVG 输出

```javascript
const result = await chartSkill('generate', {
  type: 'line',
  data: [10, 20, 30, 40],
  output: 'svg'
});
// result.data: SVG 字符串
// result.mimeType: 'image/svg+xml'
```

#### PNG 输出

```javascript
const result = await chartSkill('generate', {
  type: 'pie',
  data: [
    { name: 'A', value: 100 },
    { name: 'B', value: 200 },
    { name: 'C', value: 300 }
  ],
  output: 'png'
});
// result.data: PNG Buffer
// result.mimeType: 'image/png'
```

#### Base64 输出

```javascript
const result = await chartSkill('generate', {
  type: 'bar',
  data: [10, 20, 30],
  output: 'base64'
});
// result.data: 'data:image/png;base64,...'
```

#### 文件输出

```javascript
const result = await chartSkill('generate', {
  type: 'line',
  data: [10, 20, 30],
  output: 'file',
  outputPath: './output/chart.png'  // 支持相对路径
});
// result.path: 绝对路径
```

## 图表类型

### 柱状图 (bar)

```javascript
await chartSkill('generate', {
  type: 'bar',
  data: [100, 200, 300, 400],
  options: {
    title: 'Monthly Sales',
    xAxisData: ['Jan', 'Feb', 'Mar', 'Apr']
  },
  output: 'svg'
});
```

### 折线图 (line)

```javascript
await chartSkill('generate', {
  type: 'line',
  data: [100, 200, 150, 300],
  options: {
    title: 'Trend Analysis',
    xAxisData: ['Q1', 'Q2', 'Q3', 'Q4'],
    smooth: true,        // 平滑曲线
    areaStyle: true      // 区域填充
  },
  output: 'svg'
});
```

### 饼图 (pie)

```javascript
await chartSkill('generate', {
  type: 'pie',
  data: [
    { name: 'Product A', value: 335 },
    { name: 'Product B', value: 310 },
    { name: 'Product C', value: 234 }
  ],
  options: {
    title: 'Market Share',
    radius: ['40%', '70%'],  // 环形图
    center: ['50%', '50%']
  },
  output: 'svg'
});
```

### 雷达图 (radar)

```javascript
await chartSkill('generate', {
  type: 'radar',
  data: [
    { name: 'Budget', value: [80, 90, 70, 85, 95] }
  ],
  options: {
    title: 'Performance Analysis',
    indicators: [
      { name: 'Sales', max: 100 },
      { name: 'Marketing', max: 100 },
      { name: 'Development', max: 100 },
      { name: 'Support', max: 100 },
      { name: 'R&D', max: 100 }
    ]
  },
  output: 'svg'
});
```

### 仪表盘 (gauge)

```javascript
await chartSkill('generate', {
  type: 'gauge',
  data: { value: 75, name: 'Progress' },
  options: {
    title: 'Completion Rate',
    min: 0,
    max: 100
  },
  output: 'svg'
});
```

### 漏斗图 (funnel)

```javascript
await chartSkill('generate', {
  type: 'funnel',
  data: [
    { name: 'Show', value: 100 },
    { name: 'Click', value: 80 },
    { name: 'Visit', value: 60 },
    { name: 'Order', value: 40 },
    { name: 'Pay', value: 20 }
  ],
  options: {
    title: 'Conversion Funnel'
  },
  output: 'svg'
});
```

### 散点图 (scatter)

```javascript
await chartSkill('generate', {
  type: 'scatter',
  data: [
    [10, 20], [15, 30], [20, 25], [25, 40], [30, 35]
  ],
  options: {
    title: 'Correlation Analysis',
    xAxisData: ['X Axis'],
    yAxisData: ['Y Axis']
  },
  output: 'svg'
});
```

## 多系列数据

### 数组格式

```javascript
await chartSkill('generate', {
  type: 'bar',
  data: [
    [100, 200, 300],  // Series 1
    [150, 250, 350]   // Series 2
  ],
  options: {
    title: 'Multi-series Chart',
    xAxisData: ['Q1', 'Q2', 'Q3'],
    seriesNames: ['2023', '2024']
  },
  output: 'svg'
});
```

### 对象格式

```javascript
await chartSkill('generate', {
  type: 'line',
  data: [
    { series: '2023', category: 'Q1', value: 100 },
    { series: '2023', category: 'Q2', value: 200 },
    { series: '2024', category: 'Q1', value: 150 },
    { series: '2024', category: 'Q2', value: 250 }
  ],
  options: {
    title: 'Year Comparison'
  },
  output: 'svg'
});
```

## 原始 ECharts 配置

如果需要更精细的控制，可以直接使用 ECharts 原始配置：

```javascript
await chartSkill('generateRaw', {
  option: {
    title: { text: 'Custom Chart' },
    xAxis: { type: 'category', data: ['A', 'B', 'C'] },
    yAxis: { type: 'value' },
    series: [{
      type: 'bar',
      data: [10, 20, 30],
      itemStyle: { color: '#5470c6' }
    }]
  },
  output: 'svg',
  width: 800,
  height: 600
});
```

## 配置选项

### 基础参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `type` | string | 'bar' | 图表类型 |
| `data` | Array/Object | - | 图表数据 |
| `output` | string | 'svg' | 输出格式 (svg, png, base64, file) |
| `outputPath` | string | - | 输出文件路径（file 模式必需） |
| `width` | number | 600 | 图表宽度 |
| `height` | number | 400 | 图表高度 |

### options 配置

| 参数 | 类型 | 说明 |
|------|------|------|
| `title` | string | 图表标题 |
| `xAxisData` | Array | X 轴数据 |
| `categories` | Array | 分类数据（同 xAxisData） |
| `seriesNames` | Array | 系列名称 |
| `backgroundColor` | string | 背景颜色 |
| `smooth` | boolean | 平滑曲线（折线图） |
| `areaStyle` | boolean | 区域填充（折线图） |
| `radius` | Array | 半径（饼图） |
| `center` | Array | 圆心位置（饼图） |
| `indicators` | Array | 指标配置（雷达图） |
| `echartsOption` | Object | 完整 ECharts 配置（深度合并） |

## 支持的图表类型

| 类型 | 名称 | 说明 |
|------|------|------|
| `bar` | 柱状图 | 基础柱状图 |
| `line` | 折线图 | 支持平滑曲线、区域填充 |
| `pie` | 饼图 | 支持环形图 |
| `scatter` | 散点图 | 二维数据分布 |
| `radar` | 雷达图 | 多维数据对比 |
| `gauge` | 仪表盘 | 进度/指标展示 |
| `funnel` | 漏斗图 | 转化率分析 |
| `heatmap` | 热力图 | 数据密度展示 |
| `tree` | 树图 | 层级结构 |
| `treemap` | 矩形树图 | 层级占比 |
| `sunburst` | 旭日图 | 多层饼图 |
| `sankey` | 桑基图 | 流向分析 |
| `graph` | 关系图 | 网络关系 |
| `boxplot` | 箱线图 | 统计分布 |
| `candlestick` | K线图 | 股票数据 |
| `effectScatter` | 涟漪散点图 | 动态散点 |
| `lines` | 线图 | 路径/流向 |
| `themeRiver` | 主题河流图 | 时序变化 |
| `custom` | 自定义 | 自定义系列 |

## 与其他技能集成

### 在 xlsx 中使用

```javascript
const chartSkill = require('../chart/index.js');

// 生成图表
const chartResult = await chartSkill('generate', {
  type: 'bar',
  data: salesData,
  output: 'base64'
});

// 插入到 Excel
const imageId = workbook.addImage({
  base64: chartResult.data,
  extension: 'png'
});

worksheet.addImage(imageId, {
  tl: { col: 5, row: 1 },
  ext: { width: 400, height: 300 }
});
```

### 在 docx 中使用

```javascript
const chartSkill = require('../chart/index.js');

// 生成图表
const chartResult = await chartSkill('generate', {
  type: 'line',
  data: trendData,
  output: 'base64'
});

// 插入到 Word
const doc = new Document({
  sections: [{
    children: [
      new Paragraph({
        children: [
          new ImageRun({
            data: Buffer.from(chartResult.data.split(',')[1], 'base64'),
            transformation: { width: 400, height: 300 }
          })
        ]
      })
    ]
  }]
});
```

### 在 pptx 中使用

```javascript
const chartSkill = require('../chart/index.js');

// 生成图表
const chartResult = await chartSkill('generate', {
  type: 'pie',
  data: marketShareData,
  output: 'base64'
});

// 插入到 PPT
const slide = pptx.addSlide();
slide.addImage({
  data: chartResult.data,
  x: 1,
  y: 1,
  w: 6,
  h: 4
});
```

### 在 pdf 中使用

```javascript
const chartSkill = require('../chart/index.js');
const { PDFDocument } = require('pdf-lib');

// 生成图表
const chartResult = await chartSkill('generate', {
  type: 'bar',
  data: reportData,
  output: 'png'
});

// 插入到 PDF
const pdfDoc = await PDFDocument.create();
const chartImage = await pdfDoc.embedPng(chartResult.data);
const page = pdfDoc.addPage([600, 400]);
page.drawImage(chartImage, {
  x: 50,
  y: 50,
  width: 500,
  height: 300
});
```

## 路径规范

所有文件路径支持相对路径，相对于当前工作目录：

```javascript
// ✅ 正确：相对路径
await chartSkill('generate', {
  type: 'bar',
  data: [10, 20, 30],
  output: 'file',
  outputPath: './output/chart.png'  // 相对于 process.cwd()
});

// ✅ 正确：绝对路径
await chartSkill('generate', {
  type: 'bar',
  data: [10, 20, 30],
  output: 'file',
  outputPath: '/home/user/output/chart.png'
});
```

## 错误处理

```javascript
try {
  const result = await chartSkill('generate', {
    type: 'bar',
    data: [10, 20, 30],
    output: 'file',
    outputPath: './chart.png'
  });
  console.log('Success:', result.path);
} catch (error) {
  console.error('Error:', error.message);
  // 常见错误：
  // - "Data is required"
  // - "outputPath is required for file output"
  // - "Unsupported file format: .jpg. Use .svg or .png"
  // - "Unknown action: xxx"
}
```

## 性能建议

1. **SVG vs PNG**：SVG 文件更小，适合矢量图形；PNG 适合需要像素级控制的场景
2. **批量生成**：复用 ECharts 配置，减少初始化开销
3. **缓存**：对于静态图表，考虑缓存生成结果

## 版本历史

- **1.0.0** - 初始版本
  - 支持 20+ 图表类型
  - 支持 SVG/PNG/Base64/文件输出
  - 完整 SSR 支持