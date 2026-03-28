/**
 * ECharts Skill - SSR 图表生成
 * 
 * 功能：
 * - 生成各种类型的图表（柱状图、折线图、饼图等）
 * - 支持 SVG 和 PNG 输出
 * - 支持 Base64 编码输出
 * - 完全服务端渲染，无需浏览器环境
 * 
 * 依赖：
 * - echarts: 图表库
 * - sharp: SVG 转 PNG（项目已安装）
 */

const echarts = require('echarts');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

// 用户角色检查
const IS_ADMIN = process.env.IS_ADMIN === 'true';

// 允许的基础路径
const DATA_BASE_PATH = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
const USER_ID = process.env.USER_ID || 'default';
const USER_WORK_DIR = process.env.WORKING_DIRECTORY
  ? path.join(DATA_BASE_PATH, process.env.WORKING_DIRECTORY)
  : path.join(DATA_BASE_PATH, 'work', USER_ID);

const PROJECT_ROOT = process.cwd();
const ALLOWED_BASE_PATHS = IS_ADMIN
  ? [PROJECT_ROOT, DATA_BASE_PATH]
  : [USER_WORK_DIR];

/**
 * 检查路径是否被允许
 */
function isPathAllowed(targetPath) {
  let resolved = path.resolve(targetPath);
  
  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync(resolved);
    }
  } catch (e) {
    // 路径不存在时，继续使用 path.resolve 的结果
  }
  
  return ALLOWED_BASE_PATHS.some(basePath => {
    let resolvedBase = path.resolve(basePath);
    try {
      if (fs.existsSync(resolvedBase)) {
        resolvedBase = fs.realpathSync(resolvedBase);
      }
    } catch (e) {}
    return resolved.startsWith(resolvedBase);
  });
}

/**
 * 解析路径（支持相对路径）
 */
function resolvePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    if (!isPathAllowed(relativePath)) {
      throw new Error(`Path not allowed: ${relativePath}`);
    }
    return relativePath;
  }
  
  for (const basePath of ALLOWED_BASE_PATHS) {
    const resolved = path.join(basePath, relativePath);
    if (fs.existsSync(resolved) || isPathAllowed(resolved)) {
      if (!isPathAllowed(resolved)) {
        throw new Error(`Path not allowed: ${resolved}`);
      }
      return resolved;
    }
  }
  
  const defaultPath = path.join(ALLOWED_BASE_PATHS[0], relativePath);
  if (!isPathAllowed(defaultPath)) {
    throw new Error(`Path not allowed: ${defaultPath}`);
  }
  return defaultPath;
}

/**
 * 图表类型映射
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
 * 默认主题颜色（v5 风格）
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
  backgroundColor: '#ffffff'
};

/**
 * 生成 ECharts 配置项
 */
function buildChartOption(params) {
  const { type = 'bar', data = [], options = {} } = params;
  const seriesType = CHART_TYPE_MAP[type] || 'bar';
  
  const baseOption = {
    color: DEFAULT_COLORS,
    backgroundColor: options.backgroundColor || DEFAULT_OPTIONS.backgroundColor,
    title: {
      text: options.title || '',
      left: 'center',
      textStyle: { fontSize: 16, fontWeight: 'bold' }
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
  
  if (seriesType === 'pie') {
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
        itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' }
      },
      label: { show: true, formatter: '{b}: {d}%' }
    }];
  } else if (seriesType === 'radar') {
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
      data: radarData.map(d => ({ name: d.name, value: d.value || d }))
    }];
  } else if (seriesType === 'gauge') {
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
      label: { show: true, position: 'inside' },
      data: funnelData
    }];
  } else {
    const xAxisData = options.xAxisData || options.categories ||
      (Array.isArray(data) ? data.map((_, i) => `Category ${i + 1}`) : []);
    
    baseOption.xAxis = { type: 'category', data: xAxisData, boundaryGap: seriesType === 'bar' };
    baseOption.yAxis = { type: 'value' };
    
    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
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
      const seriesMap = {};
      const categories = new Set();
      
      data.forEach(item => {
        if (!seriesMap[item.series]) seriesMap[item.series] = {};
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
      baseOption.series = [{
        type: seriesType,
        data: Array.isArray(data) ? data : [],
        smooth: seriesType === 'line' ? (options.smooth !== false) : undefined,
        areaStyle: seriesType === 'line' && options.areaStyle ? {} : undefined
      }];
    }
  }
  
  if (options.echartsOption) {
    return deepMerge(baseOption, options.echartsOption);
  }
  
  return baseOption;
}

/**
 * 深度合并对象
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
 */
function renderToSVG(option, params = {}) {
  const width = params.width || DEFAULT_OPTIONS.width;
  const height = params.height || DEFAULT_OPTIONS.height;
  
  const chart = echarts.init(null, null, {
    renderer: 'svg',
    ssr: true,
    width,
    height
  });
  
  chart.setOption(option);
  const svg = chart.renderToSVGString();
  chart.dispose();
  
  return svg;
}

/**
 * 将 SVG 转换为 PNG
 */
async function svgToPNG(svg, params = {}) {
  const width = params.width || DEFAULT_OPTIONS.width;
  const height = params.height || DEFAULT_OPTIONS.height;
  
  return await sharp(Buffer.from(svg))
    .resize(width, height)
    .png()
    .toBuffer();
}

/**
 * 生成图表（统一入口）
 * 
 * 支持两种模式：
 * 1. 简化配置模式：使用 type/data/options 参数
 * 2. 原始配置模式：使用 option 参数直接传入 ECharts 配置
 */
async function generate(params) {
  const {
    type = 'bar',
    data,
    options = {},
    option,  // 原始 ECharts 配置（高级用法）
    output = 'svg',
    outputPath,
    width = DEFAULT_OPTIONS.width,
    height = DEFAULT_OPTIONS.height
  } = params;
  
  // 确定使用哪种配置模式
  let echartsOption;
  if (option) {
    // 原始配置模式
    echartsOption = option;
  } else {
    // 简化配置模式
    if (data === undefined || data === null) {
      throw new Error('Data is required when using simplified config mode');
    }
    echartsOption = buildChartOption({ type, data, options });
  }
  
  const svg = renderToSVG(echartsOption, { width, height });
  
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
        fs.writeFileSync(resolvedPath, svg, 'utf-8');
        return { success: true, format: 'svg', path: resolvedPath, mimeType: 'image/svg+xml' };
      } else if (ext === '.png') {
        const pngData = await svgToPNG(svg, { width, height });
        fs.writeFileSync(resolvedPath, pngData);
        return { success: true, format: 'png', path: resolvedPath, mimeType: 'image/png' };
      } else {
        throw new Error(`Unsupported file format: ${ext}. Use .svg or .png`);
      }
      
    default:
      throw new Error(`Unsupported output format: ${output}. Use svg, png, base64, or file`);
  }
}

/**
 * Skill execute function - called by skill-runner
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool parameters
 * @param {object} context - Execution context
 * @returns {Promise<object>} Execution result
 */
async function execute(toolName, params, context = {}) {
  if (toolName === 'generate') {
    return await generate(params);
  }
  
  throw new Error(`Unknown tool: ${toolName}. Supported tool: generate`);
}

module.exports = { execute };