---
name: echarts
description: "ECharts 图表生成。用于需要可视化数据展示的场景，支持 20+ 图表类型（柱状图、折线图、饼图、雷达图等），输出 SVG/PNG/Base64/文件格式。当用户需要生成图表、数据可视化、统计图形时触发。"
---

# ECharts - 图表生成

基于 ECharts SSR 的图表生成技能，无需浏览器环境。

## 工具

| 工具 | 说明 |
|------|------|
| `generate` | 生成图表 |

## generate

生成图表，支持简化配置和原始 ECharts 配置。

### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 否 | 图表类型，默认 `bar` |
| data | array/object | 是 | 图表数据 |
| options | object | 否 | 配置选项 |
| output | string | 否 | 输出格式：`svg`/`png`/`base64`/`file`，默认 `svg` |
| outputPath | string | file时必填 | 输出文件路径 |
| width | number | 否 | 宽度，默认 600 |
| height | number | 否 | 高度，默认 400 |
| option | object | 否 | 原始 ECharts 配置（高级用法） |

### 支持的图表类型

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

### options 配置项

| 配置项 | 说明 |
|------|------|
| title | 图表标题 |
| xAxisData | X 轴数据（柱状图、折线图等） |
| seriesNames | 多系列时的系列名称 |
| indicators | 雷达图指标 |
| radius | 饼图半径 |
| center | 饼图中心位置 |
| min/max | 仪表盘最小/最大值 |
| smooth | 折线图是否平滑 |
| areaStyle | 折线图是否显示面积 |
| backgroundColor | 背景颜色 |
| echartsOption | 原始 ECharts 配置合并（高级用法） |

### 使用示例

**简单柱状图**:
```javascript
generate({
  type: 'bar',
  data: [100, 200, 300],
  options: {
    title: 'Sales Report',
    xAxisData: ['Q1', 'Q2', 'Q3']
  }
})
```

**饼图**:
```javascript
generate({
  type: 'pie',
  data: [
    { name: 'Product A', value: 100 },
    { name: 'Product B', value: 200 },
    { name: 'Product C', value: 150 }
  ]
})
```

**多系列折线图**:
```javascript
generate({
  type: 'line',
  data: [
    [100, 120, 140],  // Series 1
    [80, 90, 110]     // Series 2
  ],
  options: {
    title: 'Trend Analysis',
    xAxisData: ['Jan', 'Feb', 'Mar'],
    seriesNames: ['Product A', 'Product B'],
    smooth: true
  }
})
```

**雷达图**:
```javascript
generate({
  type: 'radar',
  data: [
    { name: 'Team A', value: [80, 90, 75, 85, 70] }
  ],
  options: {
    indicators: [
      { name: 'Speed', max: 100 },
      { name: 'Quality', max: 100 },
      { name: 'Cost', max: 100 },
      { name: 'Safety', max: 100 },
      { name: 'Service', max: 100 }
    ]
  }
})
```

**输出为文件**:
```javascript
generate({
  type: 'bar',
  data: [100, 200, 300],
  options: { title: 'Sales' },
  output: 'file',
  outputPath: './charts/sales.png'
})
```

**使用原始 ECharts 配置（高级）**:
```javascript
generate({
  option: {
    title: { text: 'Custom Chart' },
    xAxis: { type: 'category', data: ['A', 'B', 'C'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [10, 20, 30] }]
  },
  output: 'svg'
})
```

**合并自定义 ECharts 配置**:
```javascript
generate({
  type: 'bar',
  data: [100, 200, 300],
  options: {
    title: 'Sales',
    xAxisData: ['Q1', 'Q2', 'Q3'],
    echartsOption: {
      animation: false,
      series: [{ itemStyle: { color: '#5470c6' } }]
    }
  }
})