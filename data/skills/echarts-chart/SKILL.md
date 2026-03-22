---
name: echarts-chart
description: "ECharts 图表生成。用于需要可视化数据展示的场景，支持 20+ 图表类型（柱状图、折线图、饼图、雷达图等），输出 SVG/PNG/Base64/文件格式。当用户需要生成图表、数据可视化、统计图形时触发。"
---

# ECharts Chart - 图表生成

基于 ECharts SSR 的图表生成技能，无需浏览器环境。

## 工具

| 工具 | 说明 |
|------|------|
| `echarts_generate` | 生成图表（简化配置） |
| `echarts_raw` | 使用原始 ECharts 配置生成 |
| `echarts_types` | 获取支持的图表类型 |

## echarts_generate

```javascript
echarts_generate({
  type: 'bar',           // bar/line/pie/radar/gauge/funnel/scatter/...
  data: [100, 200, 300], // 数据
  options: {
    title: 'Sales',
    xAxisData: ['Q1', 'Q2', 'Q3']
  },
  output: 'svg',         // svg/png/base64/file
  outputPath: './chart.png',  // file 时需要
  width: 600,
  height: 400
})
```

## echarts_raw

```javascript
echarts_raw({
  option: {
    title: { text: 'Custom Chart' },
    xAxis: { type: 'category', data: ['A', 'B', 'C'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [10, 20, 30] }]
  },
  output: 'svg'
})
```

## 支持的图表类型

| 类型 | 说明 |
|------|------|
| `bar` | 柱状图 |
| `line` | 折线图 |
| `pie` | 饼图/环形图 |
| `scatter` | 散点图 |
| `radar` | 雷达图 |
| `gauge` | 仪表盘 |
| `funnel` | 漏斗图 |
| `heatmap` | 热力图 |
| `tree` | 树图 |
| `treemap` | 矩形树图 |
| `sunburst` | 旭日图 |
| `sankey` | 桑基图 |
| `graph` | 关系图 |
| `boxplot` | 箱线图 |
| `candlestick` | K线图 |