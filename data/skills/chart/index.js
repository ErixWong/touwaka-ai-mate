/**
 * Chart Skill - ECharts SSR 图表生成
 * 
 * 功能：
 * - 生成各种类型的图表（柱状图、折线图、饼图等）
 * - 支持 SVG 和 PNG 输出
 * - 支持 Base64 编码输出
 * - 完全服务端渲染，无需浏览器环境
 * 
 * 依赖：
 * - echarts: 图表库
 * - sharp: SVG 转 PNG
 */

const echarts = require('echarts');
const path = require('path');
const fs = require('fs').promises;

// Sharp 是可选依赖，延迟加载
let sharp = null;
async function getSharp() {
  if (!sharp) {
    sharp = require('sharp');
  }
  return sharp;
}

/**
 * 解析路径（支持相对路径）
 * @param {string} inputPath - 输入路径
 * @returns {string} 绝对路径
 */
function resolvePath(inputPath) {
  if (!inputPath) return inputPath;
  // 如果已经是绝对路径，直接返回
  if (path.isAbsolute(inputPath)) return inputPath;
  // 相对路径转换为绝对路径
  return path.resolve(process.cwd(), inputPath);
}

/**
 * 图表类型映射到 ECharts series type
 */
const CHART_TYPE_MAP = {
  bar: 'bar',
  line: 'line',
  pie: 'pie',
  scatter: 'scatter',
  radar: 'radar',
  gauge: 'gauge',
  funnel: 'funnel',
  heatmap: 'heatmap',
  tree: 'tree',
  treemap: 'treemap',
  sunburst: 'sunburst',
  sankey: 'sankey',
  graph: 'graph',
  boxplot: 'boxplot',
  candlestick: 'candlestick',
  effectScatter: 'effectScatter',
  lines: 'lines',
  themeRiver: 'themeRiver',
  custom: 'custom'
};

/**
 * 默认主题颜色
 */
const DEFAULT_COLORS = [
  '#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de',
  '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0'
];

/**
 * 默认图表配置
 */
const DEFAULT_OPTIONS = {
  width: 600,
  height: 400,
  theme: 'default',
  backgroundColor: '#ffffff'
};

/**
 * 生成 ECharts 配置项
 * @param {Object} params - 参数
 * @param {string} params.type - 图表类型
 * @param {Array} params.data - 数据
 * @param {Object} params.options - 自定义配置
 * @returns {Object} ECharts 配置
 */
function buildChartOption(params) {
  const { type = 'bar', data = [], options = {} } = params;
  
  // 获取 ECharts series type
  const seriesType = CHART_TYPE_MAP[type] || 'bar';
  
  // 基础配置
  const baseOption = {
    color: DEFAULT_COLORS,
    backgroundColor: options.backgroundColor || DEFAULT_OPTIONS.backgroundColor,
    title: {
      text: options.title || '',
      left: 'center',
      textStyle: {
        fontSize: 16,
        fontWeight: 'bold'
      }
    },
    tooltip: {
      trigger: seriesType === 'pie' ? 'item' : 'axis',
      confine: true
    },
    legend: {
      orient: 'horizontal',
      bottom: 10,
      data: []
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '15%',
      top: '15%',
      containLabel: true
    }
  };
  
  // 根据图表类型构建配置
  if (seriesType === 'pie') {
    // 饼图配置
    const pieData = Array.isArray(data) ? data.map((item, index) => {
      if (typeof item === 'object' && item !== null) {
        return { name: item.name || `Item ${index + 1}`, value: item.value || item };
      }
      return { name: `Item ${index + 1}`, value: item };
    }) : [];
    
    baseOption.legend.data = pieData.map(d => d.name);
    baseOption.series = [{
      type: 'pie',
      radius: options.radius || ['40%', '70%'],
      center: options.center || ['50%', '50%'],
      data: pieData,
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      },
      label: {
        show: true,
        formatter: '{b}: {d}%'
      }
    }];
  } else if (seriesType === 'radar') {
    // 雷达图配置
    const radarData = Array.isArray(data) ? data : [];
    const indicators = options.indicators || radarData.map(d => ({
      name: d.name || d.dimension || 'Unknown',
      max: d.max || 100
    }));
    
    baseOption.radar = {
      indicator: indicators,
      shape: options.shape || 'polygon',
      splitNumber: options.splitNumber || 5
    };
    baseOption.series = [{
      type: 'radar',
      data: radarData.map(d => ({
        name: d.name,
        value: d.value || d
      }))
    }];
  } else if (seriesType === 'gauge') {
    // 仪表盘配置
    const gaugeData = Array.isArray(data) ? data[0] : data;
    baseOption.series = [{
      type: 'gauge',
      detail: { formatter: '{value}%' },
      data: [{ value: gaugeData.value || gaugeData, name: gaugeData.name || '' }],
      min: options.min || 0,
      max: options.max || 100,
      progress: { show: true },
      axisLine: { lineStyle: { width: 20 } }
    }];
  } else if (seriesType === 'funnel') {
    // 漏斗图配置
    const funnelData = Array.isArray(data) ? data.map((item, index) => {
      if (typeof item === 'object' && item !== null) {
        return { name: item.name || `Item ${index + 1}`, value: item.value || item };
      }
      return { name: `Item ${index + 1}`, value: item };
    }) : [];
    
    baseOption.legend.data = funnelData.map(d => d.name);
    baseOption.series = [{
      type: 'funnel',
      left: '10%',
      top: '15%',
      bottom: '15%',
      width: '80%',
      min: 0,
      max: 100,
      minSize: '0%',
      maxSize: '100%',
      sort: 'descending',
      gap: 2,
      label: {
        show: true,
        position: 'inside'
      },
      data: funnelData
    }];
  } else {
    // 柱状图、折线图等通用配置
    const xAxisData = options.xAxisData || options.categories || 
      (Array.isArray(data) ? data.map((_, i) => `Category ${i + 1}`) : []);
    
    baseOption.xAxis = {
      type: 'category',
      data: xAxisData,
      boundaryGap: seriesType === 'bar'
    };
    baseOption.yAxis = {
      type: 'value'
    };
    
    // 支持多系列数据
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      // 多系列数据 [[series1_data], [series2_data], ...]
      const seriesNames = options.seriesNames || data.map((_, i) => `Series ${i + 1}`);
      baseOption.legend.data = seriesNames;
      baseOption.series = data.map((seriesData, index) => ({
        name: seriesNames[index],
        type: seriesType,
        data: seriesData,
        smooth: seriesType === 'line' ? (options.smooth !== false) : undefined,
        areaStyle: seriesType === 'line' && options.areaStyle ? {} : undefined
      }));
    } else if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0].series) {
      // 对象格式数据 [{series: 'A', category: 'Q1', value: 100}, ...]
      const seriesMap = {};
      const categories = new Set();
      
      data.forEach(item => {
        if (!seriesMap[item.series]) {
          seriesMap[item.series] = {};
        }
        seriesMap[item.series][item.category] = item.value;
        categories.add(item.category);
      });
      
      const seriesNames = Object.keys(seriesMap);
      const categoryList = Array.from(categories);
      
      baseOption.legend.data = seriesNames;
      baseOption.xAxis.data = categoryList;
      baseOption.series = seriesNames.map(name => ({
        name,
        type: seriesType,
        data: categoryList.map(cat => seriesMap[name][cat] || 0),
        smooth: seriesType === 'line' ? (options.smooth !== false) : undefined
      }));
    } else {
      // 单系列数据
      baseOption.series = [{
        type: seriesType,
        data: Array.isArray(data) ? data : [],
        smooth: seriesType === 'line' ? (options.smooth !== false) : undefined,
        areaStyle: seriesType === 'line' && options.areaStyle ? {} : undefined
      }];
    }
  }
  
  // 合并用户自定义配置
  if (options.echartsOption) {
    return deepMerge(baseOption, options.echartsOption);
  }
  
  return baseOption;
}

/**
 * 深度合并对象
 * @param {Object} target - 目标对象
 * @param {Object} source - 源对象
 * @returns {Object} 合并后的对象
 */
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key] = source[key];
    }
  }
  
  return result;
}

/**
 * 创建 ECharts 实例并生成图表
 * @param {Object} option - ECharts 配置
 * @param {Object} params - 参数
 * @returns {string} SVG 字符串
 */
function renderToSVG(option, params = {}) {
  const width = params.width || DEFAULT_OPTIONS.width;
  const height = params.height || DEFAULT_OPTIONS.height;
  
  // 创建 ECharts 实例（SSR 模式）
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width,
    height
  });
  
  // 设置配置
  chart.setOption(option);
  
  // 渲染 SVG
  const svg = chart.renderToSVGString();
  
  // 销毁实例
  chart.dispose();
  
  return svg;
}

/**
 * 将 SVG 转换为 PNG
 * @param {string} svg - SVG 字符串
 * @param {Object} params - 参数
 * @returns {Promise<Buffer>} PNG Buffer
 */
async function svgToPNG(svg, params = {}) {
  const sharpLib = await getSharp();
  const width = params.width || DEFAULT_OPTIONS.width;
  const height = params.height || DEFAULT_OPTIONS.height;
  
  const pngBuffer = await sharpLib(Buffer.from(svg))
    .resize(width, height)
    .png()
    .toBuffer();
  
  return pngBuffer;
}

/**
 * 生成图表
 * @param {Object} params - 参数
 * @param {string} params.type - 图表类型 (bar, line, pie, scatter, radar, gauge, funnel, etc.)
 * @param {Array|Object} params.data - 图表数据
 * @param {Object} params.options - 配置选项
 * @param {string} params.output - 输出格式 (svg, png, base64, file)
 * @param {string} params.outputPath - 输出文件路径（仅 file 模式）
 * @param {number} params.width - 图表宽度
 * @param {number} params.height - 图表高度
 * @returns {Promise<Object>} 生成结果
 */
async function generate(params) {
  const {
    type = 'bar',
    data,
    options = {},
    output = 'svg',
    outputPath,
    width = DEFAULT_OPTIONS.width,
    height = DEFAULT_OPTIONS.height
  } = params;
  
  // 验证数据
  if (data === undefined || data === null) {
    throw new Error('Data is required');
  }
  
  // 构建 ECharts 配置
  const option = buildChartOption({ type, data, options });
  
  // 渲染 SVG
  const svg = renderToSVG(option, { width, height });
  
  // 根据输出格式处理
  switch (output) {
    case 'svg':
      return {
        success: true,
        format: 'svg',
        data: svg,
        mimeType: 'image/svg+xml'
      };
      
    case 'png':
      const pngBuffer = await svgToPNG(svg, { width, height });
      return {
        success: true,
        format: 'png',
        data: pngBuffer,
        mimeType: 'image/png'
      };
      
    case 'base64':
      const base64Png = await svgToPNG(svg, { width, height });
      return {
        success: true,
        format: 'base64',
        data: `data:image/png;base64,${base64Png.toString('base64')}`,
        mimeType: 'image/png'
      };
      
    case 'file':
      if (!outputPath) {
        throw new Error('outputPath is required for file output');
      }
      
      const resolvedPath = resolvePath(outputPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      
      if (ext === '.svg') {
        await fs.writeFile(resolvedPath, svg, 'utf-8');
        return {
          success: true,
          format: 'svg',
          path: resolvedPath,
          mimeType: 'image/svg+xml'
        };
      } else if (ext === '.png') {
        const pngData = await svgToPNG(svg, { width, height });
        await fs.writeFile(resolvedPath, pngData);
        return {
          success: true,
          format: 'png',
          path: resolvedPath,
          mimeType: 'image/png'
        };
      } else {
        throw new Error(`Unsupported file format: ${ext}. Use .svg or .png`);
      }
      
    default:
      throw new Error(`Unsupported output format: ${output}. Use svg, png, base64, or file`);
  }
}

/**
 * 使用原始 ECharts 配置生成图表
 * @param {Object} params - 参数
 * @param {Object} params.option - ECharts 原始配置
 * @param {string} params.output - 输出格式
 * @param {string} params.outputPath - 输出文件路径
 * @param {number} params.width - 图表宽度
 * @param {number} params.height - 图表高度
 * @returns {Promise<Object>} 生成结果
 */
async function generateRaw(params) {
  const {
    option,
    output = 'svg',
    outputPath,
    width = DEFAULT_OPTIONS.width,
    height = DEFAULT_OPTIONS.height
  } = params;
  
  if (!option) {
    throw new Error('ECharts option is required');
  }
  
  // 渲染 SVG
  const svg = renderToSVG(option, { width, height });
  
  // 根据输出格式处理
  switch (output) {
    case 'svg':
      return {
        success: true,
        format: 'svg',
        data: svg,
        mimeType: 'image/svg+xml'
      };
      
    case 'png':
      const pngBuffer = await svgToPNG(svg, { width, height });
      return {
        success: true,
        format: 'png',
        data: pngBuffer,
        mimeType: 'image/png'
      };
      
    case 'base64':
      const base64Png = await svgToPNG(svg, { width, height });
      return {
        success: true,
        format: 'base64',
        data: `data:image/png;base64,${base64Png.toString('base64')}`,
        mimeType: 'image/png'
      };
      
    case 'file':
      if (!outputPath) {
        throw new Error('outputPath is required for file output');
      }
      
      const resolvedPath = resolvePath(outputPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      
      if (ext === '.svg') {
        await fs.writeFile(resolvedPath, svg, 'utf-8');
        return {
          success: true,
          format: 'svg',
          path: resolvedPath,
          mimeType: 'image/svg+xml'
        };
      } else if (ext === '.png') {
        const pngData = await svgToPNG(svg, { width, height });
        await fs.writeFile(resolvedPath, pngData);
        return {
          success: true,
          format: 'png',
          path: resolvedPath,
          mimeType: 'image/png'
        };
      } else {
        throw new Error(`Unsupported file format: ${ext}. Use .svg or .png`);
      }
      
    default:
      throw new Error(`Unsupported output format: ${output}. Use svg, png, base64, or file`);
  }
}

/**
 * 获取支持的图表类型
 * @returns {Array<string>} 图表类型列表
 */
function getSupportedTypes() {
  return Object.keys(CHART_TYPE_MAP);
}

/**
 * 技能入口函数
 * @param {string} action - 操作类型
 * @param {Object} params - 参数
 * @returns {Promise<Object>} 执行结果
 */
module.exports = async function chartSkill(action, params = {}) {
  switch (action) {
    case 'generate':
      return await generate(params);
      
    case 'generateRaw':
      return await generateRaw(params);
      
    case 'types':
      return {
        success: true,
        types: getSupportedTypes()
      };
      
    default:
      throw new Error(`Unknown action: ${action}. Supported actions: generate, generateRaw, types`);
  }
};

// 导出辅助函数
module.exports.generate = generate;
module.exports.generateRaw = generateRaw;
module.exports.getSupportedTypes = getSupportedTypes;
module.exports.buildChartOption = buildChartOption;
module.exports.resolvePath = resolvePath;