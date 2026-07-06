/**
 * PPTX Skill - PowerPoint 演示文稿处理技能 (重构版)
 * 
 * 工具架构（4 个工具）：
 * - pptx_file: 文件级操作 (read, create, extract)
 * - pptx_slide: 幻灯片创建（仅限新建演示文稿）
 * - pptx_object: 内容对象添加（仅限新建演示文稿）
 * - pptx_master: 模板定义（仅限新建演示文稿）
 * 
 * 重要限制：
 * - pptxgenjs 4.0 只能创建新演示文稿，无法编辑现有文件
 * - 编辑操作（update/delete/move）不支持
 * - 读取操作使用 AdmZip 解析现有 PPTX 文件
 * - 如需编辑现有文件，建议：读取内容 → 创建新文件 → 添加修改后的内容
 * 
 * 依赖：
 * - pptxgenjs 4.0+: 演示文稿创建
 * - adm-zip: ZIP 操作（读取现有 PPTX）
 * 
 * 注意：进程 cwd 已在 VM 启动时设置为正确的工作目录，技能代码直接使用相对路径即可。
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// ==================== 常量定义 ====================

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.emf', '.wmf', '.svg'];
const MEDIA_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mp3', '.wav', '.m4a'];
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const EMU_PER_INCH = 914400;
const NORMALIZED_FORMAT = 'normalized-slide-model';
const NORMALIZED_VERSION = 1;
const NORMALIZED_RECOMMENDED_WORKFLOW = [
  'file read scope=normalized',
  'edit normalized JSON',
  'file create source=normalized'
];
const NORMALIZED_WARNING_CODES = {
  INVALID_OBJECT: 'invalid-object',
  MISSING_KIND: 'missing-kind',
  MISSING_TEXT_CONTENT: 'missing-text-content',
  MISSING_TABLE_PREVIEW: 'missing-table-preview',
  MISSING_CHART_CONTENT: 'missing-chart-content',
  MISSING_NOTES_TEXT: 'missing-notes-text',
  MISSING_IMAGE_SOURCE: 'missing-image-source',
  IMAGE_RESOURCE_MAPPING_REQUIRED: 'image-resource-mapping-required',
  MEDIA_RESOURCE_MAPPING_REQUIRED: 'media-resource-mapping-required',
  INVALID_CHART_CONFIG: 'invalid-chart-config',
  UNSUPPORTED_KIND: 'unsupported-kind',
  REBUILD_ERROR: 'rebuild-error'
};
const NORMALIZED_WARNING_FIXES = {
  [NORMALIZED_WARNING_CODES.INVALID_OBJECT]: 'Pass an object that includes kind, content, source, and optional transform.',
  [NORMALIZED_WARNING_CODES.MISSING_KIND]: 'Add object.kind with a supported value such as text, image, table, chart, shape, or notes.',
  [NORMALIZED_WARNING_CODES.MISSING_TEXT_CONTENT]: 'Add content.text for the text object.',
  [NORMALIZED_WARNING_CODES.MISSING_TABLE_PREVIEW]: 'Add content.previewRows as a non-empty 2D array for the table object.',
  [NORMALIZED_WARNING_CODES.MISSING_CHART_CONTENT]: 'Add content.chartType and a non-empty content.series array for the chart object.',
  [NORMALIZED_WARNING_CODES.MISSING_NOTES_TEXT]: 'Add content.text for the notes object.',
  [NORMALIZED_WARNING_CODES.MISSING_IMAGE_SOURCE]: 'Provide image source.path, source.data, or source.embedId.',
  [NORMALIZED_WARNING_CODES.IMAGE_RESOURCE_MAPPING_REQUIRED]: 'Replace source.embedId-only with source.path or source.data before rebuilding.',
  [NORMALIZED_WARNING_CODES.MEDIA_RESOURCE_MAPPING_REQUIRED]: 'Provide media source.path, source.data, or source.assetKey with a matching assetMap entry.',
  [NORMALIZED_WARNING_CODES.INVALID_CHART_CONFIG]: 'Ensure chart content includes a supported chartType and a non-empty series array.',
  [NORMALIZED_WARNING_CODES.UNSUPPORTED_KIND]: 'Remove the unsupported object kind or convert it to a supported normalized kind.',
  [NORMALIZED_WARNING_CODES.REBUILD_ERROR]: 'Check the object fields against schema.required, schema.properties, defaults, and example, then retry.'
};
const NORMALIZED_OBJECT_SCHEMAS = {
  text: {
    level: 'full',
    required: ['kind', 'content.text'],
    defaults: {
      transform: {
        inches: { x: 0.5, y: 0.5, w: 4, h: 0.5 }
      }
    },
    example: {
      kind: 'text',
      content: { text: 'Hello World' },
      transform: { inches: { x: 0.5, y: 0.5, w: 4, h: 0.5 } }
    },
    properties: {
      kind: 'string',
      name: 'string|null',
      transform: 'object|null',
      content: {
        text: 'string'
      },
      source: 'object'
    },
    requirements: ['content.text']
  },
  image: {
    level: 'partial',
    required: ['kind'],
    defaults: {
      transform: {
        inches: { x: 0.5, y: 1, w: 4, h: 3 }
      }
    },
    example: {
      kind: 'image',
      source: { path: 'images/example.png' },
      transform: { inches: { x: 0.5, y: 1, w: 4, h: 3 } }
    },
    properties: {
      kind: 'string',
      name: 'string|null',
      transform: 'object|null',
      content: 'object',
      source: {
        path: 'string|optional',
        data: 'string|optional',
        embedId: 'string|optional',
        assetKey: 'string|optional'
      }
    },
    requirementsAnyOf: [['source.path', 'source.data', 'source.embedId', 'source.assetKey']],
    recommendedRequirementsAnyOf: [['source.path', 'source.data']],
    warningCode: NORMALIZED_WARNING_CODES.IMAGE_RESOURCE_MAPPING_REQUIRED,
    unsupportedSource: ['source.embedId-only']
  },
  table: {
    level: 'partial',
    required: ['kind', 'content.previewRows'],
    defaults: {
      transform: {
        inches: { x: 0.5, y: 1, w: 6 }
      }
    },
    example: {
      kind: 'table',
      content: { previewRows: [['A', 'B'], ['1', '2']] },
      transform: { inches: { x: 0.5, y: 1, w: 6 } }
    },
    properties: {
      kind: 'string',
      name: 'string|null',
      transform: 'object|null',
      content: {
        previewRows: 'array',
        rowCount: 'number|optional',
        columnCount: 'number|optional'
      },
      source: 'object'
    },
    requirements: ['content.previewRows'],
    notes: ['previewRows-only']
  },
  chart: {
    level: 'basic',
    required: ['kind', 'content.chartType', 'content.series'],
    defaults: {
      transform: {
        inches: { x: 1, y: 1, w: 8, h: 5 }
      }
    },
    example: {
      kind: 'chart',
      content: {
        chartType: 'bar',
        series: [{ name: 'Sales', labels: ['Q1', 'Q2'], values: [10, 20] }]
      },
      transform: { inches: { x: 1, y: 1, w: 8, h: 5 } }
    },
    properties: {
      kind: 'string',
      name: 'string|null',
      transform: 'object|null',
      content: {
        chartType: 'string',
        series: 'array',
        seriesCount: 'number|optional'
      },
      source: 'object'
    },
    requirements: ['content.chartType', 'content.series']
  },
  shape: {
    level: 'basic',
    required: ['kind'],
    defaults: {
      content: {
        shapeType: 'rect',
        fill: { color: 'CCCCCC' },
        line: { color: '000000', width: 1 }
      },
      transform: {
        inches: { x: 0, y: 0, w: 1, h: 1 }
      }
    },
    example: {
      kind: 'shape',
      content: {
        shapeType: 'rect',
        fill: { color: 'CCCCCC' },
        line: { color: '000000', width: 1 }
      },
      transform: { inches: { x: 0, y: 0, w: 1, h: 1 } }
    },
    properties: {
      kind: 'string',
      name: 'string|null',
      transform: 'object|null',
      content: {
        shapeType: 'string|optional',
        fill: 'object|optional',
        line: 'object|optional'
      },
      source: 'object'
    },
    requirements: ['content.shapeType or default rect']
  },
  notes: {
    level: 'full',
    required: ['kind', 'content.text'],
    example: {
      kind: 'notes',
      content: { text: 'speaker note' }
    },
    properties: {
      kind: 'string',
      name: 'string|null',
      transform: 'object|null',
      content: {
        text: 'string',
        texts: 'array|optional'
      },
      source: 'object'
    },
    requirements: ['content.text']
  },
  media: {
    level: 'partial',
    required: ['kind'],
    example: {
      kind: 'media',
      source: { type: 'relationship', target: 'ppt/media/media1.mp4', assetKey: 'ppt__media__media1.mp4' }
    },
    properties: {
      kind: 'string',
      source: {
        path: 'string|optional',
        data: 'string|optional',
        assetKey: 'string|optional',
        target: 'string|optional'
      }
    },
    requirementsAnyOf: [['source.path', 'source.data', 'source.assetKey']],
    recommendedRequirementsAnyOf: [['source.path', 'source.data']],
    warningCode: NORMALIZED_WARNING_CODES.MEDIA_RESOURCE_MAPPING_REQUIRED
  }
};
const NORMALIZED_PRESENTATION_SCHEMA = {
  required: ['path', 'slideCount'],
  example: {
    path: 'presentation.pptx',
    slideCount: 1
  },
  properties: {
    path: 'string',
    slideCount: 'number',
    assetMap: 'object|optional'
  }
};
const NORMALIZED_SLIDE_SCHEMA = {
  required: ['number', 'summary', 'objects'],
  example: {
    number: 1,
    summary: {
      textObjectCount: 1,
      preview: 'Hello World'
    },
    objects: [
      {
        kind: 'text',
        content: { text: 'Hello World' },
        transform: { inches: { x: 0.5, y: 0.5, w: 4, h: 0.5 } }
      }
    ]
  },
  properties: {
    number: 'number',
    summary: {
      textObjectCount: 'number|optional',
      imageObjectCount: 'number|optional',
      tableObjectCount: 'number|optional',
      chartObjectCount: 'number|optional',
      shapeObjectCount: 'number|optional',
      mediaObjectCount: 'number|optional',
      noteObjectCount: 'number|optional',
      noteCount: 'number|optional',
      textCharCount: 'number|optional',
      noteCharCount: 'number|optional',
      tableCellCount: 'number|optional',
      chartSeriesCount: 'number|optional',
      preview: 'string|optional'
    },
    objects: 'array',
    notes: 'array|optional'
  }
};
const NORMALIZED_SUPPORT_MATRIX = {
  normalizedRead: {
    level: 'full'
  },
  normalizedCreate: NORMALIZED_OBJECT_SCHEMAS
};

// 延迟加载 pptxgenjs
let pptxgenjs = null;

function getPptxGenJS() {
  if (!pptxgenjs) {
    pptxgenjs = require('pptxgenjs');
  }
  return pptxgenjs;
}

// ==================== 路径处理 ====================

/**
 * Resolve path - VM 已设置 cwd，直接使用相对路径即可（与 FS 技能一致）
 */
function resolvePath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Absolute path not allowed: ${relativePath}. Use relative path instead.`);
  }

  const normalizedPath = path.normalize(relativePath);
  const pathParts = normalizedPath.split(path.sep);

  for (const part of pathParts) {
    if (part === '..') {
      throw new Error(`Path traversal not allowed: ${relativePath}. Relative paths must stay within working directory.`);
    }
  }

  return normalizedPath;
}

/**
 * 确保目录存在
 */
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function decodeXmlText(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTextRuns(xml) {
  const textMatches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
  return textMatches.map(m => decodeXmlText(m.replace(/<a:t>|<\/a:t>/g, '')));
}

function getSlideEntries(zip, entries, slideNumbers) {
  const slides = [];

  for (const entry of entries) {
    const match = entry.entryName.match(/ppt\/slides\/slide(\d+)\.xml/);
    if (!match) {
      continue;
    }

    const slideNum = parseInt(match[1]);
    if (slideNumbers && !slideNumbers.includes(slideNum)) {
      continue;
    }

    slides.push({
      number: slideNum,
      entryName: entry.entryName,
      xml: zip.readAsText(entry.entryName)
    });
  }

  slides.sort((a, b) => a.number - b.number);
  return slides;
}

function getSlideRelationships(zip, slideNumber) {
  const relPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;

  try {
    const relXml = zip.readAsText(relPath);
    if (!relXml) {
      return [];
    }

    const relationships = [];
    const relMatches = relXml.match(/<Relationship\s+[^>]*Id="[^"]+"[^>]*\/>/g) || [];

    for (const rel of relMatches) {
      const idMatch = rel.match(/Id="([^"]+)"/);
      const typeMatch = rel.match(/Type="([^"]+)"/);
      const targetMatch = rel.match(/Target="([^"]+)"/);

      if (idMatch && targetMatch) {
        relationships.push({
          id: idMatch[1],
          type: typeMatch ? typeMatch[1] : null,
          target: targetMatch[1]
        });
      }
    }

    return relationships;
  } catch (e) {
    return [];
  }
}

function normalizeRelationshipTarget(basePath, target) {
  let sourcePath = basePath;

  if (basePath.includes('/_rels/') && basePath.endsWith('.rels')) {
    sourcePath = basePath
      .replace('/_rels/', '/')
      .replace(/\.rels$/, '');
  }

  return path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target));
}

function buildPackageAssetKey(packagePath) {
  return packagePath ? packagePath.replace(/[\/]/g, '__') : null;
}

function buildInlineAssetMap(entries) {
  const assetMap = {};

  for (const entry of entries) {
    if (entry.isDirectory || !entry.entryName.startsWith('ppt/media/')) {
      continue;
    }

    const packagePath = entry.entryName;
    const ext = path.extname(packagePath).toLowerCase();
    const assetKey = buildPackageAssetKey(packagePath);
    const fileData = entry.getData();
    const mimeTypeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.mp4': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m4a': 'audio/mp4'
    };
    const mimeType = mimeTypeMap[ext] || 'application/octet-stream';

    assetMap[assetKey] = {
      packagePath,
      fileName: path.basename(packagePath),
      data: `${mimeType};base64,${fileData.toString('base64')}`,
      encoding: 'base64',
      extension: ext,
      mimeType
    };
  }

  return assetMap;
}

function extractNonVisualName(xml) {
  const nameMatch = xml.match(/<p:cNvPr[^>]*name="([^"]*)"/);
  return nameMatch ? decodeXmlText(nameMatch[1]) : null;
}

function extractTransformInfo(xml) {
  const offMatch = xml.match(/<a:off[^>]*x="([^"]+)"[^>]*y="([^"]+)"/);
  const extMatch = xml.match(/<a:ext[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/);

  if (!offMatch && !extMatch) {
    return null;
  }

  return {
    emu: {
      x: offMatch ? Number(offMatch[1]) : null,
      y: offMatch ? Number(offMatch[2]) : null,
      cx: extMatch ? Number(extMatch[1]) : null,
      cy: extMatch ? Number(extMatch[2]) : null
    },
    inches: {
      x: offMatch ? Number((Number(offMatch[1]) / EMU_PER_INCH).toFixed(3)) : null,
      y: offMatch ? Number((Number(offMatch[2]) / EMU_PER_INCH).toFixed(3)) : null,
      w: extMatch ? Number((Number(extMatch[1]) / EMU_PER_INCH).toFixed(3)) : null,
      h: extMatch ? Number((Number(extMatch[2]) / EMU_PER_INCH).toFixed(3)) : null
    }
  };
}

function createStructuredObject(type, objectIndex, payload = {}) {
  return {
    objectIndex,
    objectKey: `${type}-${objectIndex}`,
    type,
    kind: type,
    content: {},
    source: {},
    ...payload
  };
}

function extractTableData(slideXml) {
  const tables = [];
  const tableMatches = slideXml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || [];

  for (const tableXml of tableMatches) {
    const rows = [];
    const rowMatches = tableXml.match(/<a:tr[^>]*>[\s\S]*?<\/a:tr>/g) || [];

    for (const rowXml of rowMatches) {
      const cells = [];
      const cellMatches = rowXml.match(/<a:tc[^>]*>[\s\S]*?<\/a:tc>/g) || [];

      for (const cellXml of cellMatches) {
        cells.push(extractTextRuns(cellXml).join(' '));
      }

      if (cells.length > 0) {
        rows.push(cells);
      }
    }

    tables.push({
      rowCount: rows.length,
      columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
      rows
    });
  }

  return tables;
}

function extractChartRefs(slideXml) {
  const refs = [];
  const chartMatches = slideXml.match(/<c:chart[^>]*r:id="([^"]+)"[^>]*\/>/g) || [];

  for (const chartXml of chartMatches) {
    const idMatch = chartXml.match(/r:id="([^"]+)"/);
    if (idMatch) {
      refs.push({ relationId: idMatch[1] });
    }
  }

  return refs;
}

function extractChartSeries(chartXml) {
  const series = [];
  const seriesMatches = chartXml.match(/<c:ser>[\s\S]*?<\/c:ser>/g) || [];

  for (const seriesXml of seriesMatches) {
    const nameMatch = seriesXml.match(/<c:tx>[\s\S]*?<c:v>([^<]*)<\/c:v>[\s\S]*?<\/c:tx>/);
    const labelMatches = seriesXml.match(/<c:cat>[\s\S]*?<c:v>([^<]*)<\/c:v>[\s\S]*?<\/c:cat>/g) || [];
    const valueMatches = seriesXml.match(/<c:val>[\s\S]*?<c:v>([^<]*)<\/c:v>[\s\S]*?<\/c:val>/g) || [];

    const labels = [];
    for (const match of labelMatches) {
      const values = match.match(/<c:v>([^<]*)<\/c:v>/g) || [];
      for (const valueXml of values) {
        labels.push(decodeXmlText(valueXml.replace(/<c:v>|<\/c:v>/g, '')));
      }
    }

    const values = [];
    for (const match of valueMatches) {
      const valueNodes = match.match(/<c:v>([^<]*)<\/c:v>/g) || [];
      for (const valueXml of valueNodes) {
        const raw = valueXml.replace(/<c:v>|<\/c:v>/g, '');
        const numeric = Number(raw);
        values.push(Number.isNaN(numeric) ? raw : numeric);
      }
    }

    series.push({
      name: nameMatch ? decodeXmlText(nameMatch[1]) : null,
      labels,
      values
    });
  }

  return series;
}

function getChartDataForSlide(zip, slideNumber, slideXml) {
  const rels = getSlideRelationships(zip, slideNumber);
  const chartRefs = extractChartRefs(slideXml);

  return chartRefs.map(chartRef => {
    const rel = rels.find(item => item.id === chartRef.relationId);
    if (!rel) {
      return { relationId: chartRef.relationId, target: null, series: [] };
    }

    const targetPath = normalizeRelationshipTarget(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, rel.target);

    try {
      const chartXml = zip.readAsText(targetPath);
      const typeMatch = chartXml.match(/<c:(barChart|lineChart|pieChart|doughnutChart|areaChart|scatterChart|radarChart|bubbleChart|stockChart)/);
      return {
        relationId: chartRef.relationId,
        target: targetPath,
        chartType: typeMatch ? typeMatch[1].replace('Chart', '') : null,
        series: extractChartSeries(chartXml)
      };
    } catch (e) {
      return {
        relationId: chartRef.relationId,
        target: targetPath,
        chartType: null,
        series: [],
        error: e.message
      };
    }
  });
}

function getImageAssetForSlide(zip, slideNumber, embedId) {
  const rels = getSlideRelationships(zip, slideNumber);
  const rel = rels.find(item => item.id === embedId);
  if (!rel) {
    return null;
  }

  const packagePath = normalizeRelationshipTarget(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, rel.target);
  return {
    relationId: embedId,
    packagePath,
    assetKey: buildPackageAssetKey(packagePath)
  };
}

function getMediaReferencesForSlide(zip, slideNumber) {
  const rels = getSlideRelationships(zip, slideNumber);
  return rels
    .filter(rel => rel.target && rel.target.includes('../media/'))
    .filter(rel => !(rel.type || '').includes('/image'))
    .map(rel => ({
      relationId: rel.id,
      target: normalizeRelationshipTarget(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, rel.target),
      packagePath: normalizeRelationshipTarget(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, rel.target),
      assetKey: buildPackageAssetKey(normalizeRelationshipTarget(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, rel.target)),
      type: rel.type
    }));
}

function extractNotesText(zip, slideNumber) {
  const notesPath = `ppt/notesSlides/notesSlide${slideNumber}.xml`;

  try {
    const notesXml = zip.readAsText(notesPath);
    if (!notesXml) {
      return [];
    }

    return extractTextRuns(notesXml).filter(text => text.trim());
  } catch (e) {
    return [];
  }
}

function dedupeAssetObjects(objects) {
  const result = [];
  const assetMap = new Map();

  function getPreferredKind(object) {
    const packagePath = object.source?.packagePath || object.source?.target || '';
    const ext = path.extname(packagePath).toLowerCase();
    const isImageExt = IMAGE_EXTENSIONS.includes(ext);
    const isMediaExt = MEDIA_EXTENSIONS.includes(ext);

    if (object.kind === 'image' && isMediaExt) {
      return 'media';
    }
    if (object.kind === 'media' && isImageExt && object.transform) {
      return 'image';
    }
    return object.kind;
  }

  for (const object of objects) {
    if (object.kind !== 'image' && object.kind !== 'media') {
      result.push(object);
      continue;
    }

    const assetKey = object.source?.assetKey || null;
    if (!assetKey) {
      result.push(object);
      continue;
    }

    const existing = assetMap.get(assetKey);
    if (!existing) {
      object.kind = getPreferredKind(object);
      object.type = object.kind;
      object.source.references = object.source.references || [];
      object.source.references.push({
        relationId: object.source.relationId || object.source.embedId || null,
        kind: object.kind,
        target: object.source.target || object.source.packagePath || null
      });
      assetMap.set(assetKey, object);
      result.push(object);
      continue;
    }

    existing.source.references = existing.source.references || [];
    existing.source.references.push({
      relationId: object.source.relationId || object.source.embedId || null,
      kind: object.kind,
      target: object.source.target || object.source.packagePath || null
    });

    const existingPreferred = getPreferredKind(existing);
    const currentPreferred = getPreferredKind(object);

    if (existingPreferred !== currentPreferred && currentPreferred === 'image') {
      existing.kind = currentPreferred;
      existing.type = currentPreferred;
      existing.name = object.name || existing.name;
      existing.transform = object.transform || existing.transform;
      existing.embedId = object.embedId || existing.embedId;
      existing.source.embedId = object.source?.embedId || existing.source.embedId;
      existing.source.type = object.source?.type || existing.source.type;
    }
  }

  return result;
}

function buildNormalizedSlides(zip, entries, slideNumbers) {
  const slides = [];

  for (const slideEntry of getSlideEntries(zip, entries, slideNumbers)) {
    const slideNum = slideEntry.number;
    const slideXml = slideEntry.xml;
    const mediaRefs = getMediaReferencesForSlide(zip, slideNum);
    let objectIndex = 1;

    const shapes = [];
    const shapeMatches = slideXml.match(/<p:sp[^>]*>[\s\S]*?<\/p:sp>/g) || [];

    for (const shapeXml of shapeMatches) {
      const texts = extractTextRuns(shapeXml);
      const name = extractNonVisualName(shapeXml);
      const transform = extractTransformInfo(shapeXml);

      if (texts.length > 0) {
        const text = texts.join(' ');
        shapes.push(createStructuredObject('text', objectIndex++, {
          name,
          text,
          content: { text },
          transform
        }));
      } else {
        shapes.push(createStructuredObject('shape', objectIndex++, { name, transform }));
      }
    }

    const picMatches = slideXml.match(/<p:pic[^>]*>[\s\S]*?<\/p:pic>/g) || [];
        for (const picXml of picMatches) {
          const embedMatch = picXml.match(/r:embed="([^"]+)"/);
          if (embedMatch) {
            const asset = getImageAssetForSlide(zip, slideNum, embedMatch[1]);
            shapes.push(createStructuredObject('image', objectIndex++, {
              name: extractNonVisualName(picXml),
              embedId: embedMatch[1],
              source: {
                type: 'embed',
                embedId: embedMatch[1],
                packagePath: asset?.packagePath || null,
                assetKey: asset?.assetKey || null
              },
              transform: extractTransformInfo(picXml)
            }));
          }
        }

    const tables = extractTableData(slideXml);
    const tableMatches = slideXml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/g) || [];
    for (let i = 0; i < tables.length; i++) {
      const preview = tables[i].rows.slice(0, 3);
      shapes.push(createStructuredObject('table', objectIndex++, {
        rowCount: tables[i].rowCount,
        columnCount: tables[i].columnCount,
        preview,
        content: { previewRows: preview, rowCount: tables[i].rowCount, columnCount: tables[i].columnCount },
        transform: extractTransformInfo(tableMatches[i] || '')
      }));
    }

    const charts = getChartDataForSlide(zip, slideNum, slideXml);
    for (const chart of charts) {
      shapes.push(createStructuredObject('chart', objectIndex++, {
        relationId: chart.relationId,
        chartType: chart.chartType,
        seriesCount: chart.series.length,
        target: chart.target,
        content: { series: chart.series, seriesCount: chart.series.length, chartType: chart.chartType },
        source: { type: 'relationship', relationId: chart.relationId, target: chart.target }
      }));
    }

        for (const mediaRef of mediaRefs) {
          shapes.push(createStructuredObject('media', objectIndex++, {
            relationId: mediaRef.relationId,
            target: mediaRef.target,
            source: {
              type: 'relationship',
              relationId: mediaRef.relationId,
              target: mediaRef.target,
              packagePath: mediaRef.packagePath,
              assetKey: mediaRef.assetKey
            }
          }));
        }

    const normalizedObjects = dedupeAssetObjects(shapes);
    const textObjects = normalizedObjects.filter(item => item.type === 'text');
    const imageObjects = normalizedObjects.filter(item => item.type === 'image');
    const tableObjects = normalizedObjects.filter(item => item.type === 'table');
    const chartObjects = normalizedObjects.filter(item => item.type === 'chart');
    const shapeObjects = normalizedObjects.filter(item => item.type === 'shape');
    const mediaObjects = normalizedObjects.filter(item => item.type === 'media');
    const allTextContent = textObjects
      .map(item => item.text)
      .filter(Boolean)
      .join(' ')
      .trim();
    const tablePreviewText = tableObjects
      .flatMap(item => item.preview || [])
      .flatMap(row => row)
      .filter(Boolean)
      .join(' ')
      .trim();
    const chartPreviewText = chartObjects
      .map(item => `${item.chartType || 'chart'}:${item.seriesCount}`)
      .join(' ')
      .trim();
    const noteTexts = extractNotesText(zip, slideNum);
    const notePreviewText = noteTexts.join(' ').trim();
    const combinedPreview = [allTextContent, tablePreviewText, chartPreviewText, notePreviewText]
      .filter(Boolean)
      .join(' ')
      .trim();

    if (noteTexts.length > 0) {
      normalizedObjects.push(createStructuredObject('notes', objectIndex++, {
        content: { texts: noteTexts, text: notePreviewText },
        source: { type: 'notesSlide', slideNumber: slideNum }
      }));
    }

    const noteObjects = normalizedObjects.filter(item => item.type === 'notes');

    slides.push({
      number: slideNum,
      shapeCount: normalizedObjects.length,
      objectCount: normalizedObjects.length,
      summary: {
        textObjectCount: textObjects.length,
        imageObjectCount: imageObjects.length,
        tableObjectCount: tableObjects.length,
        chartObjectCount: chartObjects.length,
        shapeObjectCount: shapeObjects.length,
        mediaObjectCount: mediaObjects.length,
        noteObjectCount: noteObjects.length,
        noteCount: noteTexts.length,
        textCharCount: allTextContent.length,
        noteCharCount: notePreviewText.length,
        tableCellCount: tableObjects.reduce((sum, item) => sum + ((item.rowCount || 0) * (item.columnCount || 0)), 0),
        chartSeriesCount: chartObjects.reduce((sum, item) => sum + (item.seriesCount || 0), 0),
        preview: combinedPreview.substring(0, 160)
      },
      mediaReferenceCount: mediaRefs.length,
      notes: noteTexts,
      objects: normalizedObjects,
      shapes: normalizedObjects
    });
  }

  slides.sort((a, b) => a.number - b.number);
  return slides;
}

function toNormalizedExport(slides, resolvedPath) {
  return {
    success: true,
    path: resolvedPath,
    format: NORMALIZED_FORMAT,
    version: NORMALIZED_VERSION,
    schema: {
      presentation: NORMALIZED_PRESENTATION_SCHEMA,
      slide: NORMALIZED_SLIDE_SCHEMA,
      object: NORMALIZED_OBJECT_SCHEMAS
    },
    recommended_edit_scope: 'normalized',
    recommended_create_source: 'normalized',
    recommended_workflow: NORMALIZED_RECOMMENDED_WORKFLOW,
    supportMatrix: NORMALIZED_SUPPORT_MATRIX,
    presentation: {
      path: resolvedPath,
      slideCount: slides.length
    },
    slides: slides.map(slide => ({
      number: slide.number,
      summary: slide.summary,
      objects: slide.objects.map(object => ({
        objectIndex: object.objectIndex,
        objectKey: object.objectKey,
        kind: object.kind,
        name: object.name || null,
        transform: object.transform || null,
        content: object.content || {},
        source: object.source || {}
      }))
    }))
  };
}

// ==================== pptx_file ====================

/**
 * 文件级操作
 * @param {object} params
 * @param {string} params.action - 操作: 'read' | 'create' | 'extract'
 * @param {string} params.path - 文件路径
 * @param {string} [params.scope] - 读取范围 (read): 'info' | 'text' | 'structure' | 'media'
 * @param {number[]} [params.slideNumbers] - 幻灯片编号列表
 * @param {string} [params.source] - 创建来源 (create): 'data' | 'markdown'
 * @param {Array} [params.slides] - 幻灯片数据
 * @param {string} [params.markdown] - Markdown 内容
 * @param {object} [params.properties] - 文档属性
 * @param {string} [params.outputDir] - 提取输出目录 (extract)
 * @param {string} [params.extractType] - 提取类型 (extract): 'images' | 'media' | 'all'
 */
async function pptxFile(params) {
  const { action, path: filePath } = params;
  
  switch (action) {
    case 'read':
      return await fileRead(params);
    case 'create':
      return await fileCreate(params);
    case 'extract':
      return await fileExtract(params);
    default:
      throw new Error(`Invalid action: ${action}. Must be 'read', 'create', or 'extract'`);
  }
}

/**
 * 安全打开 ZIP 文件
 * @param {string} resolvedPath - 已解析的文件路径
 * @returns {{ zip: AdmZip, entries: Array, error: string|null }}
 */
function safeOpenZip(resolvedPath) {
  try {
    // 检查文件大小
    const stats = fs.statSync(resolvedPath);
    if (stats.size > MAX_FILE_SIZE) {
      return {
        zip: null,
        entries: null,
        error: `File too large: ${Math.round(stats.size / 1024 / 1024)}MB. Maximum allowed: ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`
      };
    }
    
    const zip = new AdmZip(resolvedPath);
    const entries = zip.getEntries();
    
    // 验证 PPTX 结构
    const hasPptDir = entries.some(e => e.entryName.startsWith('ppt/'));
    if (!hasPptDir) {
      return { zip: null, entries: null, error: 'Invalid PPTX file: missing ppt/ directory' };
    }
    
    return { zip, entries, error: null };
  } catch (e) {
    return { zip: null, entries: null, error: `Failed to open file: ${e.message}` };
  }
}

/**
 * 读取演示文稿
 */
async function fileRead(params) {
  const { path: filePath, scope = 'info', slideNumbers, includeAssets = false } = params;
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  // 读取基本信息
  if (scope === 'info') {
    const slideEntries = getSlideEntries(zip, entries);
    const slides = slideEntries.map(slide => {
      const texts = extractTextRuns(slide.xml);
      return {
        number: slide.number,
        textCount: texts.length,
        preview: texts.slice(0, 5).join(' ').substring(0, 100)
      };
    });
    
    // 读取元数据
    let metadata = {};
    try {
      const coreXml = zip.readAsText('docProps/core.xml');
      if (coreXml) {
        const titleMatch = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
        const authorMatch = coreXml.match(/<dc:creator>([^<]*)<\/dc:creator>/);
        const createdMatch = coreXml.match(/<dcterms:created>([^<]*)<\/dcterms:created>/);
        const modifiedMatch = coreXml.match(/<dcterms:modified>([^<]*)<\/dcterms:modified>/);
        
        metadata = {
          title: titleMatch ? titleMatch[1] : null,
          author: authorMatch ? authorMatch[1] : null,
          created: createdMatch ? createdMatch[1] : null,
          modified: modifiedMatch ? modifiedMatch[1] : null
        };
      }
    } catch (e) {
      // 元数据读取失败，忽略
    }
    
    return {
      success: true,
      path: resolvedPath,
      slideCount: slides.length,
      slides,
      metadata
    };
  }
  
  // 提取文本
  if (scope === 'text') {
    const allTexts = getSlideEntries(zip, entries, slideNumbers).map(slide => ({
      slide: slide.number,
      texts: extractTextRuns(slide.xml)
    }));
    
    return {
      success: true,
      path: resolvedPath,
      slides: allTexts,
      totalTexts: allTexts.reduce((sum, s) => sum + s.texts.length, 0)
    };
  }
  
  // 提取结构
  if (scope === 'structure') {
    const slides = buildNormalizedSlides(zip, entries, slideNumbers);
    
    return {
      success: true,
      path: resolvedPath,
      slideCount: slides.length,
      view: 'analysis',
      slides
    };
  }

  if (scope === 'normalized') {
    const slides = buildNormalizedSlides(zip, entries, slideNumbers);
    const result = toNormalizedExport(slides, resolvedPath);
    if (includeAssets) {
      result.presentation.assetMap = buildInlineAssetMap(entries);
    }
    return result;
  }
  
  // 提取媒体信息
  if (scope === 'media') {
    const images = [];
    const media = [];
    
    for (const entry of entries) {
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      
      if (entryName.startsWith('ppt/media/')) {
        const fileName = path.basename(entryName);
        
        if (IMAGE_EXTENSIONS.includes(ext)) {
          images.push({ originalPath: entryName, fileName, size: entry.header.size });
        } else if (MEDIA_EXTENSIONS.includes(ext)) {
          media.push({ originalPath: entryName, fileName, size: entry.header.size });
        }
      }
    }

    const slideReferences = getSlideEntries(zip, entries, slideNumbers).map(slide => ({
      slide: slide.number,
      references: getMediaReferencesForSlide(zip, slide.number)
    }));
    
    return {
      success: true,
      path: resolvedPath,
      imageCount: images.length,
      mediaCount: media.length,
      images,
      media,
      slideReferences
    };
  }

  if (scope === 'tables') {
    const slides = getSlideEntries(zip, entries, slideNumbers).map(slide => {
      const tables = extractTableData(slide.xml);
      return {
        slide: slide.number,
        tableCount: tables.length,
        tables
      };
    });

    return {
      success: true,
      path: resolvedPath,
      slides,
      totalTables: slides.reduce((sum, slide) => sum + slide.tableCount, 0)
    };
  }

  if (scope === 'charts') {
    const slides = getSlideEntries(zip, entries, slideNumbers).map(slide => {
      const charts = getChartDataForSlide(zip, slide.number, slide.xml);
      return {
        slide: slide.number,
        chartCount: charts.length,
        charts
      };
    });

    return {
      success: true,
      path: resolvedPath,
      slides,
      totalCharts: slides.reduce((sum, slide) => sum + slide.chartCount, 0)
    };
  }

  if (scope === 'notes') {
    const slides = getSlideEntries(zip, entries, slideNumbers).map(slide => {
      const notes = extractNotesText(zip, slide.number);
      return {
        slide: slide.number,
        noteCount: notes.length,
        notes
      };
    });

    return {
      success: true,
      path: resolvedPath,
      slides,
      totalNotes: slides.reduce((sum, slide) => sum + slide.noteCount, 0)
    };
  }
   
  throw new Error(`Invalid scope: ${scope}. Must be 'info', 'text', 'structure', 'normalized', 'media', 'tables', 'charts', or 'notes'`);
}

/**
 * 创建演示文稿
 */
async function fileCreate(params) {
  const { path: filePath, source = 'data', slides = [], markdown, normalized, properties = {} } = params;
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  const warnings = [];
  const rebuildStats = {
    totalSlides: 0,
    totalObjects: 0,
    rebuiltObjects: 0,
    skippedObjects: 0,
    textObjects: 0,
    tableObjects: 0,
    chartObjects: 0,
    shapeObjects: 0,
    notesObjects: 0,
    imageObjects: 0,
    mediaObjects: 0
  };
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || '';
  pptx.subject = properties.subject || '';
  pptx.company = properties.company || '';
  
  // 设置布局
  if (properties.layout) {
    pptx.layout = properties.layout; // 'LAYOUT_16x9', 'LAYOUT_4x3', etc.
  }
  
  // 从数据创建
  if (source === 'data') {
    for (const slideData of slides) {
      warnings.push(...addSlideFromData(pptx, slideData));
    }
    
    // 如果没有幻灯片，创建空白
    if (pptx.slides.length === 0) {
      pptx.addSlide();
    }
  }
  
  // 从 Markdown 创建
  if (source === 'markdown') {
    if (!markdown) {
      throw new Error('markdown content is required when source is "markdown"');
    }
    createFromMarkdown(pptx, markdown);
  }

  if (source === 'normalized') {
    validateNormalizedModel(normalized);
    const assetMap = (
      (normalized.assetMap && typeof normalized.assetMap === 'object' && normalized.assetMap) ||
      (normalized.presentation?.assetMap && typeof normalized.presentation.assetMap === 'object' && normalized.presentation.assetMap) ||
      {}
    );

    for (let index = 0; index < normalized.slides.length; index++) {
      const slideModel = normalized.slides[index];
      validateNormalizedSlide(slideModel, index);
      const result = addSlideFromNormalized(pptx, slideModel, assetMap);
      warnings.push(...result.warnings);
      rebuildStats.totalSlides += 1;
      rebuildStats.totalObjects += result.stats.totalObjects;
      rebuildStats.rebuiltObjects += result.stats.rebuiltObjects;
      rebuildStats.skippedObjects += result.stats.skippedObjects;
      rebuildStats.textObjects += result.stats.textObjects;
      rebuildStats.tableObjects += result.stats.tableObjects;
      rebuildStats.chartObjects += result.stats.chartObjects;
      rebuildStats.shapeObjects += result.stats.shapeObjects;
      rebuildStats.notesObjects += result.stats.notesObjects;
      rebuildStats.imageObjects += result.stats.imageObjects;
      rebuildStats.mediaObjects += result.stats.mediaObjects;
    }

    if (pptx.slides.length === 0) {
      pptx.addSlide();
    }
  }
  
  const outputPath = resolvePath(filePath);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    slideCount: pptx.slides.length,
    warnings,
    rebuildStats: source === 'normalized' ? rebuildStats : undefined,
    normalizedFormat: source === 'normalized' ? NORMALIZED_FORMAT : undefined,
    normalizedVersion: source === 'normalized' ? NORMALIZED_VERSION : undefined,
    schema: source === 'normalized' ? {
      presentation: NORMALIZED_PRESENTATION_SCHEMA,
      slide: NORMALIZED_SLIDE_SCHEMA,
      object: NORMALIZED_OBJECT_SCHEMAS
    } : undefined,
    recommended_edit_scope: source === 'normalized' ? 'normalized' : undefined,
    recommended_create_source: source === 'normalized' ? 'normalized' : undefined,
    recommended_workflow: source === 'normalized' ? NORMALIZED_RECOMMENDED_WORKFLOW : undefined,
    supportMatrix: source === 'normalized' ? NORMALIZED_SUPPORT_MATRIX : undefined,
    note: 'Created with pptxgenjs 4.0. Editing existing files is not supported.'
  };
}

/**
 * 提取文件内容
 */
async function fileExtract(params) {
  const { path: filePath, outputDir, extractType = 'all' } = params;
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  const outputPath = outputDir ? resolvePath(outputDir) : path.dirname(resolvedPath);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  
  const results = {
    images: [],
    media: [],
    other: []
  };
  
  for (const entry of entries) {
    if (!entry.isDirectory && entry.entryName.startsWith('ppt/media/')) {
      const fileName = path.basename(entry.entryName);
      const ext = path.extname(fileName).toLowerCase();
      
      const shouldExtract =
        extractType === 'all' ||
        (extractType === 'images' && IMAGE_EXTENSIONS.includes(ext)) ||
        (extractType === 'media' && MEDIA_EXTENSIONS.includes(ext));
      
      if (shouldExtract) {
        const outFile = path.join(outputPath, fileName);
        fs.writeFileSync(outFile, entry.getData());
        
        if (IMAGE_EXTENSIONS.includes(ext)) {
          results.images.push({ fileName, outputPath: outFile, size: entry.header.size });
        } else if (MEDIA_EXTENSIONS.includes(ext)) {
          results.media.push({ fileName, outputPath: outFile, size: entry.header.size });
        } else {
          results.other.push({ fileName, outputPath: outFile, size: entry.header.size });
        }
      }
    }
  }
  
  return {
    success: true,
    sourcePath: resolvedPath,
    outputDir: outputPath,
    extractType,
    imageCount: results.images.length,
    mediaCount: results.media.length,
    results
  };
}

// ==================== pptx_slide ====================

/**
 * 幻灯片创建（仅限新建演示文稿）
 * 
 * 注意：此工具用于在创建新演示文稿时添加幻灯片
 * 无法编辑现有 PPTX 文件
 * 
 * @param {object} params
 * @param {string} params.action - 操作: 'add' (仅支持添加到新演示文稿)
 * @param {string} params.output - 输出文件路径
 * @param {string} [params.master] - 母版名称
 * @param {string} [params.title] - 标题
 * @param {string|string[]} [params.content] - 内容
 * @param {object} [params.background] - 背景
 * @param {object} [params.properties] - 文档属性
 * @param {Array} [params.slides] - 多个幻灯片数据（批量添加）
 */
async function pptxSlide(params) {
  const { action } = params;
  
  if (action !== 'add') {
    throw new Error(`Invalid action: ${action}. Only 'add' is supported for new presentations. Editing existing files is not supported by pptxgenjs 4.0.`);
  }
  
  return await slideCreate(params);
}

/**
 * 创建包含幻灯片的演示文稿
 */
async function slideCreate(params) {
  const { output, master, slides, properties = {} } = params;
  const warnings = [];
  
  if (!output) {
    throw new Error('output path is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || '';
  pptx.subject = properties.subject || '';
  pptx.company = properties.company || '';
  
  if (properties.layout) {
    pptx.layout = properties.layout;
  }
  
  // 定义母版（如果提供）
  if (master) {
    pptx.defineSlideMaster({
      title: master.name || 'CustomMaster',
      background: master.background || { color: 'FFFFFF' },
      objects: master.objects || [],
      slideNumber: master.slideNumber || { x: 9, y: 5, fontSize: 12 }
    });
  }
  
  // 添加幻灯片
  if (slides && Array.isArray(slides)) {
    for (const slideData of slides) {
      warnings.push(...addSlideFromData(pptx, slideData, master?.name));
    }
  } else {
    // 单个幻灯片参数
    const slideOptions = master?.name ? { masterName: master.name } : {};
    const slide = pptx.addSlide(slideOptions);
    
    if (params.background) {
      slide.background = params.background;
    }
    
    if (params.title) {
      slide.addText(params.title, {
        x: 0.5,
        y: 0.5,
        w: '90%',
        h: 1,
        fontSize: 36,
        bold: true,
        color: '363636'
      });
    }
    
    if (params.content) {
      if (Array.isArray(params.content)) {
        slide.addText(params.content.map(t => ({ text: t, options: { bullet: true } })), {
          x: 0.5,
          y: 1.5,
          w: '90%',
          h: 4,
          fontSize: 18
        });
      } else {
        slide.addText(params.content, {
          x: 0.5,
          y: 1.5,
          w: '90%',
          h: 4,
          fontSize: 18
        });
      }
    }
  }
  
  // 如果没有幻灯片，创建空白
  if (pptx.slides.length === 0) {
    pptx.addSlide();
  }
  
  const outputPath = resolvePath(output);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    slideCount: pptx.slides.length,
    warnings,
    note: 'Created new presentation. Editing existing files is not supported.'
  };
}

// ==================== pptx_object ====================

/**
 * 内容对象添加（仅限新建演示文稿）
 * 
 * 注意：此工具用于在创建新演示文稿时添加内容对象
 * 无法编辑现有 PPTX 文件
 * 
 * @param {object} params
 * @param {string} params.action - 操作: 'add' | 'extract'
 * @param {string} [params.output] - 输出文件路径 (add)
 * @param {string} [params.path] - 现有文件路径 (extract)
 * @param {number} [params.slideNumber] - 幻灯片编号 (add)
 * @param {string} params.type - 对象类型: 'text' | 'image' | 'table' | 'chart' | 'shape' | 'media' | 'notes'
 * @param {string} [params.text] - 文本内容
 * @param {object} [params.options] - 文本选项
 * @param {object} [params.image] - 图片配置
 * @param {object} [params.table] - 表格配置
 * @param {object} [params.chart] - 图表配置
 * @param {object} [params.shape] - 形状配置
 * @param {object} [params.media] - 媒体配置
 * @param {string} [params.notes] - 演讲者备注
 * @param {object} [params.properties] - 文档属性
 * @param {string} [params.outputDir] - 提取输出目录 (extract)
 */
async function pptxObject(params) {
  const { action } = params;
  
  switch (action) {
    case 'add':
      return await objectAdd(params);
    case 'extract':
      return await objectExtract(params);
    default:
      throw new Error(`Invalid action: ${action}. Must be 'add' or 'extract'. Editing existing files is not supported.`);
  }
}

/**
 * 添加对象到新演示文稿
 */
async function objectAdd(params) {
  const { output, slideNumber = 1, type, properties = {} } = params;
  
  if (!output) {
    throw new Error('output path is required');
  }

  if (slideNumber !== 1) {
    throw new Error('slideNumber is not supported for object add. This tool always creates one new slide in a new presentation.');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || '';
  
  if (properties.layout) {
    pptx.layout = properties.layout;
  }
  
  // 创建幻灯片
  const slide = pptx.addSlide();
  
  // 添加对象
  switch (type) {
    case 'text':
      addObjectText(slide, params);
      break;
    case 'image':
      addObjectImage(slide, params);
      break;
    case 'table':
      addObjectTable(slide, params);
      break;
    case 'chart':
      addObjectChart(slide, params);
      break;
    case 'shape':
      addObjectShape(slide, params);
      break;
    case 'media':
      addObjectMedia(slide, params);
      break;
    case 'notes':
      addObjectNotes(slide, params);
      break;
    default:
      throw new Error(`Invalid type: ${type}. Must be 'text', 'image', 'table', 'chart', 'shape', 'media', or 'notes'`);
  }
  
  const outputPath = resolvePath(output);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    objectAdded: type,
    slideNumber,
    note: 'Created new presentation with object. Editing existing files is not supported.'
  };
}

/**
 * 添加文本
 */
function addObjectText(slide, params) {
  const { text, options = {} } = params;
  
  if (!text) {
    throw new Error('text is required for type "text"');
  }
  
  const defaultOptions = {
    x: 0.5,
    y: 0.5,
    w: '90%',
    h: 0.5,
    fontSize: 18,
    color: '363636'
  };
  
  slide.addText(text, { ...defaultOptions, ...options });
}

/**
 * 添加图片
 */
function addObjectImage(slide, params) {
  const { image } = params;
  
  if (!image) {
    throw new Error('image config is required for type "image"');
  }
  
  // 支持路径或 base64
  const imageConfig = {
    x: image.x || 0.5,
    y: image.y || 1,
    w: image.w || 4,
    h: image.h || 3,
    sizing: image.sizing
  };
  
  if (image.path) {
    const imgPath = resolvePath(image.path);
    imageConfig.path = imgPath;
  } else if (image.data) {
    imageConfig.data = image.data;
  } else {
    throw new Error('image.path or image.data is required');
  }
  
  slide.addImage(imageConfig);
}

/**
 * 添加表格
 */
function addObjectTable(slide, params) {
  const { table } = params;
  
  if (!table || !table.rows) {
    throw new Error('table.rows is required for type "table"');
  }
  
  slide.addTable(table.rows, {
    x: table.x || 0.5,
    y: table.y || 1,
    w: table.w || 9,
    colW: table.colW,
    border: table.border || { pt: 1, color: 'CFCFCF' },
    fontFace: table.fontFace || 'Arial',
    fontSize: table.fontSize || 12,
    align: table.align || 'left'
  });
}

/**
 * 添加图表
 */
function addObjectChart(slide, params) {
  const { chart } = params;
  
  if (!chart || !chart.type || !chart.data) {
    throw new Error('chart.type and chart.data are required for type "chart"');
  }
  
  // 支持的图表类型
  const validTypes = [
    'bar', 'bar3D', 'line', 'line3D', 'pie', 'pie3D', 
    'doughnut', 'area', 'area3D', 'scatter', 'bubble', 
    'radar', 'radar3D', 'bubble3D'
  ];
  
  if (!validTypes.includes(chart.type)) {
    throw new Error(`Invalid chart type: ${chart.type}. Valid types: ${validTypes.join(', ')}`);
  }
  
  // 转换数据格式
  const chartData = chart.data.map(series => ({
    name: series.name,
    labels: series.labels,
    values: series.values
  }));
  
  slide.addChart(chart.type, chartData, {
    x: chart.x || 1,
    y: chart.y || 1,
    w: chart.w || 8,
    h: chart.h || 5,
    title: chart.title,
    showLegend: chart.showLegend !== false,
    legendPos: chart.legendPos || 'r',
    chartColors: chart.colors
  });
}

/**
 * 添加形状
 */
function addObjectShape(slide, params) {
  const { shape } = params;
  
  if (!shape) {
    throw new Error('shape config is required for type "shape"');
  }
  
  slide.addShape(shape.type || 'rect', {
    x: shape.x || 0,
    y: shape.y || 0,
    w: shape.w || 1,
    h: shape.h || 1,
    fill: shape.fill || { color: 'CCCCCC' },
    line: shape.line || { color: '000000', width: 1 }
  });
}

/**
 * 添加媒体
 */
function addObjectMedia(slide, params) {
  const { media } = params;
  
  if (!media) {
    throw new Error('media config is required for type "media"');
  }
  
  const mediaConfig = {
    type: media.type || 'video',
    x: media.x || 1,
    y: media.y || 1,
    w: media.w || 6,
    h: media.h || 4
  };
  
  if (media.path) {
    const mediaPath = resolvePath(media.path);
    mediaConfig.path = mediaPath;
  } else if (media.data) {
    mediaConfig.data = media.data;
  } else {
    throw new Error('media.path or media.data is required');
  }
  
  slide.addMedia(mediaConfig);
}

/**
 * 添加演讲者备注
 */
function addObjectNotes(slide, params) {
  const { notes } = params;
  
  if (!notes) {
    throw new Error('notes is required for type "notes"');
  }
  
  slide.addNotes(notes);
}

/**
 * 提取对象
 */
async function objectExtract(params) {
  const { path: filePath, type, outputDir } = params;
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  const outputPath = outputDir ? resolvePath(outputDir) : null;
  if (outputPath && !fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  
  const results = [];
  
  if (type === 'image' || type === 'images') {
    for (const entry of entries) {
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      
      if (entryName.startsWith('ppt/media/') && IMAGE_EXTENSIONS.includes(ext)) {
        const fileName = path.basename(entryName);
        
        if (outputPath) {
          const outFile = path.join(outputPath, fileName);
          fs.writeFileSync(outFile, entry.getData());
        }
        
        results.push({
          originalPath: entryName,
          fileName,
          extracted: outputPath ? true : false
        });
      }
    }
  }
  
  if (type === 'media') {
    for (const entry of entries) {
      const entryName = entry.entryName;
      const ext = path.extname(entryName).toLowerCase();
      
      if (entryName.startsWith('ppt/media/') && MEDIA_EXTENSIONS.includes(ext)) {
        const fileName = path.basename(entryName);
        
        if (outputPath) {
          const outFile = path.join(outputPath, fileName);
          fs.writeFileSync(outFile, entry.getData());
        }
        
        results.push({
          originalPath: entryName,
          fileName,
          extracted: outputPath ? true : false
        });
      }
    }
  }
  
  if (type === 'text') {
    for (const entry of entries) {
      const match = entry.entryName.match(/ppt\/slides\/slide(\d+)\.xml/);
      if (match) {
        const slideNum = parseInt(match[1]);
        const slideXml = zip.readAsText(entry.entryName);
        const textMatches = slideXml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
        const texts = textMatches.map(m => m.replace(/<a:t>|<\/a:t>/g, ''));
        
        results.push({
          slide: slideNum,
          texts
        });
      }
    }
    
    // 按幻灯片编号排序
    results.sort((a, b) => a.slide - b.slide);
  }
  
  return {
    success: true,
    path: resolvedPath,
    type,
    count: results.length,
    outputDir: outputPath,
    items: results
  };
}

// ==================== pptx_master ====================

/**
 * 模板定义（仅限新建演示文稿）
 * 
 * 注意：此工具用于在创建新演示文稿时定义母版
 * 无法编辑现有 PPTX 文件
 * 
 * @param {object} params
 * @param {string} params.action - 操作: 'define' | 'list'
 * @param {string} [params.path] - 现有文件路径 (list)
 * @param {string} [params.output] - 输出文件路径 (define)
 * @param {string} [params.name] - 母版名称
 * @param {object} [params.background] - 背景
 * @param {Array} [params.objects] - 母版对象
 * @param {object} [params.slideNumber] - 幻灯片编号配置
 * @param {object} [params.margin] - 边距
 * @param {object} [params.properties] - 文档属性
 */
async function pptxMaster(params) {
  const { action } = params;
  
  switch (action) {
    case 'define':
      return await masterDefine(params);
    case 'list':
      return await masterList(params);
    default:
      throw new Error(`Invalid action: ${action}. Must be 'define' or 'list'. Editing existing files is not supported.`);
  }
}

/**
 * 定义母版并创建演示文稿
 */
async function masterDefine(params) {
  const { output, name, background, objects, slideNumber, margin, properties = {} } = params;
  
  if (!name) {
    throw new Error('name is required for master definition');
  }
  
  if (!output) {
    throw new Error('output path is required');
  }
  
  const PptxGenJS = getPptxGenJS();
  const pptx = new PptxGenJS();
  
  // 设置文档属性
  pptx.author = properties.author || 'Touwaka Mate';
  pptx.title = properties.title || name;
  
  if (properties.layout) {
    pptx.layout = properties.layout;
  }
  
  // 定义母版
  const masterDef = {
    title: name,
    background: background || { color: 'FFFFFF' },
    objects: objects || [],
    slideNumber: slideNumber || { x: 9, y: 5, fontSize: 12 }
  };
  
  if (margin) {
    masterDef.margin = margin;
  }
  
  pptx.defineSlideMaster(masterDef);
  
  // 创建一个使用该母版的示例幻灯片
  pptx.addSlide({ masterName: name });
  
  const outputPath = resolvePath(output);
  ensureDir(outputPath);
  await pptx.writeFile({ fileName: outputPath });
  
  return {
    success: true,
    path: outputPath,
    masterName: name,
    slideCount: pptx.slides.length,
    note: 'Created new presentation with master. Editing existing files is not supported.'
  };
}

/**
 * 列出母版
 */
async function masterList(params) {
  const { path: filePath } = params;
  
  if (!filePath) {
    throw new Error('path is required for listing masters');
  }
  
  const resolvedPath = resolvePath(filePath);
  const { zip, entries, error } = safeOpenZip(resolvedPath);
  
  if (error) {
    return { success: false, error };
  }
  
  const masters = [];
  
  for (const entry of entries) {
    if (entry.entryName.match(/ppt\/slideLayouts\/slideLayout\d+\.xml/)) {
      const layoutXml = zip.readAsText(entry.entryName);
      
      // 提取布局名称
      const nameMatch = layoutXml.match(/<p:cSld name="([^"]*)"/);
      const name = nameMatch ? nameMatch[1] : path.basename(entry.entryName, '.xml');
      
      masters.push({
        name,
        path: entry.entryName
      });
    }
  }
  
  return {
    success: true,
    path: resolvedPath,
    masterCount: masters.length,
    masters
  };
}

// ==================== 辅助函数 ====================

/**
 * 从数据添加幻灯片
 */
function addSlideFromData(pptx, slideData, masterName) {
  const slideOptions = masterName ? { masterName } : {};
  const slide = pptx.addSlide(slideOptions);
  const warnings = [];
  
  // 背景
  if (slideData.background) {
    slide.background = slideData.background;
  }
  
  // 标题
  if (slideData.title) {
    slide.addText(slideData.title, {
      x: 0.5,
      y: 0.5,
      w: '90%',
      h: 1,
      fontSize: 36,
      bold: true,
      color: '363636'
    });
  }
  
  // 内容
  if (slideData.content) {
    slide.addText(slideData.content, {
      x: 0.5,
      y: 1.5,
      w: '90%',
      h: 4,
      fontSize: 18,
      color: '666666'
    });
  }
  
  // 文本列表
  if (slideData.texts && Array.isArray(slideData.texts)) {
    let yPos = slideData.title ? 1.5 : 0.5;
    for (const textItem of slideData.texts) {
      if (typeof textItem === 'string') {
        slide.addText(textItem, { x: 0.5, y: yPos, w: '90%', fontSize: 18 });
        yPos += 0.8;
      } else {
        slide.addText(textItem.text || '', {
          x: textItem.x || 0.5,
          y: textItem.y || yPos,
          w: textItem.w || '90%',
          h: textItem.h || 0.5,
          fontSize: textItem.fontSize || 18,
          bold: textItem.bold,
          italic: textItem.italic,
          color: textItem.color,
          align: textItem.align
        });
      }
    }
  }
  
  // 图片
  if (slideData.images && Array.isArray(slideData.images)) {
    for (const img of slideData.images) {
      try {
        const imgConfig = {
          x: img.x || 0.5,
          y: img.y || 1,
          w: img.w || 4,
          h: img.h || 3
        };
        
        if (img.path) {
          imgConfig.path = resolvePath(img.path);
        } else if (img.data) {
          imgConfig.data = img.data;
        }
        
        slide.addImage(imgConfig);
      } catch (e) {
        warnings.push({
          type: 'image',
          path: img.path || null,
          error: e.message
        });
      }
    }
  }
  
  // 表格
  if (slideData.tables && Array.isArray(slideData.tables)) {
    for (const tableData of slideData.tables) {
      slide.addTable(tableData.rows || [], {
        x: tableData.x || 0.5,
        y: tableData.y || 1,
        w: tableData.w || 9,
        colW: tableData.colW,
        border: tableData.border || { pt: 1, color: 'CFCFCF' },
        fontFace: tableData.fontFace || 'Arial',
        fontSize: tableData.fontSize || 12
      });
    }
  }
  
  // 形状
  if (slideData.shapes && Array.isArray(slideData.shapes)) {
    for (const shape of slideData.shapes) {
      slide.addShape(shape.type || 'rect', {
        x: shape.x || 0,
        y: shape.y || 0,
        w: shape.w || 1,
        h: shape.h || 1,
        fill: shape.fill || { color: 'CCCCCC' },
        line: shape.line
      });
    }
  }
  
  // 图表
  if (slideData.charts && Array.isArray(slideData.charts)) {
    for (const chartData of slideData.charts) {
      const chartDataFormatted = chartData.data.map(series => ({
        name: series.name,
        labels: series.labels,
        values: series.values
      }));
      
      slide.addChart(chartData.type, chartDataFormatted, {
        x: chartData.x || 1,
        y: chartData.y || 1,
        w: chartData.w || 8,
        h: chartData.h || 5,
        title: chartData.title,
        showLegend: chartData.showLegend !== false
      });
    }
  }
  
  // 演讲者备注
  if (slideData.notes) {
    slide.addNotes(slideData.notes);
  }

  return warnings;
}

function transformToOptions(transform, defaults = {}) {
  const inches = transform?.inches || {};
  return {
    ...defaults,
    x: inches.x ?? defaults.x,
    y: inches.y ?? defaults.y,
    w: inches.w ?? defaults.w,
    h: inches.h ?? defaults.h
  };
}

function buildNormalizedChartConfig(object) {
  const chartType = object.content?.chartType || object.chartType;
  const series = object.content?.series;

  if (!chartType || !Array.isArray(series) || series.length === 0) {
    return null;
  }

  const options = transformToOptions(object.transform, {
    x: 1,
    y: 1,
    w: 8,
    h: 5
  });

  return {
    type: chartType,
    data: series,
    x: options.x,
    y: options.y,
    w: options.w,
    h: options.h,
    title: object.name || ''
  };
}

function buildNormalizedShapeConfig(object) {
  const shapeType = object.content?.shapeType || 'rect';
  const options = transformToOptions(object.transform, {
    x: 0,
    y: 0,
    w: 1,
    h: 1
  });

  return {
    type: shapeType,
    x: options.x,
    y: options.y,
    w: options.w,
    h: options.h,
    fill: object.content?.fill || { color: 'CCCCCC' },
    line: object.content?.line || { color: '000000', width: 1 }
  };
}

function createNormalizedWarning(object, code, message, extra = {}) {
  return {
    objectKey: object?.objectKey || null,
    type: object?.kind || object?.type || null,
    code,
    message,
    suggestedFix: NORMALIZED_WARNING_FIXES[code] || null,
    ...extra
  };
}

function validateNormalizedModel(normalized) {
  if (!normalized || typeof normalized !== 'object') {
    throw new Error('normalized model must be an object');
  }

  if (!Array.isArray(normalized.slides)) {
    throw new Error('normalized.slides is required when source is "normalized"');
  }
}

function validateNormalizedSlide(slideModel, slideIndex) {
  if (!slideModel || typeof slideModel !== 'object') {
    throw new Error(`normalized slide at index ${slideIndex} must be an object`);
  }

  if (!Array.isArray(slideModel.objects)) {
    throw new Error(`normalized slide at index ${slideIndex} requires objects array`);
  }
}

function getNestedValue(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => (value == null ? undefined : value[key]), object);
}

function hasValueAtPath(object, dottedPath) {
  const value = getNestedValue(object, dottedPath);
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== undefined && value !== null && value !== '';
}

function validateNormalizedObject(object) {
  if (!object || typeof object !== 'object') {
    return { valid: false, code: NORMALIZED_WARNING_CODES.INVALID_OBJECT, message: 'normalized object must be an object' };
  }

  if (!object.kind || typeof object.kind !== 'string') {
    return { valid: false, code: NORMALIZED_WARNING_CODES.MISSING_KIND, message: 'normalized object.kind is required' };
  }

  const schema = NORMALIZED_OBJECT_SCHEMAS[object.kind];
  if (!schema) {
    return { valid: true };
  }

  if (Array.isArray(schema.requirements)) {
    for (const requirement of schema.requirements) {
      if (requirement.includes(' or ')) {
        continue;
      }
      if (!hasValueAtPath(object, requirement)) {
        const codeMap = {
          text: NORMALIZED_WARNING_CODES.MISSING_TEXT_CONTENT,
          table: NORMALIZED_WARNING_CODES.MISSING_TABLE_PREVIEW,
          chart: NORMALIZED_WARNING_CODES.MISSING_CHART_CONTENT,
          notes: NORMALIZED_WARNING_CODES.MISSING_NOTES_TEXT
        };
        return {
          valid: false,
          code: codeMap[object.kind] || NORMALIZED_WARNING_CODES.INVALID_OBJECT,
          message: `${object.kind} object requires ${requirement}`
        };
      }
    }
  }

  if (Array.isArray(schema.requirementsAnyOf)) {
    for (const group of schema.requirementsAnyOf) {
      const satisfied = group.some(path => hasValueAtPath(object, path));
      if (!satisfied) {
        return {
          valid: false,
          code: NORMALIZED_WARNING_CODES.MISSING_IMAGE_SOURCE,
          message: `${object.kind} object requires one of: ${group.join(', ')}`
        };
      }
    }
  }

  return { valid: true };
}

function addSlideFromNormalized(pptx, slideModel, assetMap = {}) {
  const slide = pptx.addSlide();
  const warnings = [];
  const objects = Array.isArray(slideModel?.objects) ? slideModel.objects : [];
  const stats = {
    totalObjects: objects.length,
    rebuiltObjects: 0,
    skippedObjects: 0,
    textObjects: 0,
    tableObjects: 0,
    chartObjects: 0,
    shapeObjects: 0,
    notesObjects: 0,
    imageObjects: 0,
    mediaObjects: 0
  };

  for (const object of objects) {
    try {
      const validation = validateNormalizedObject(object);
      if (!validation.valid) {
        warnings.push(createNormalizedWarning(object, validation.code, validation.message));
        stats.skippedObjects += 1;
        continue;
      }

      switch (object.kind) {
        case 'text': {
          const text = object.content?.text;
          slide.addText(text, transformToOptions(object.transform, {
            x: 0.5,
            y: 0.5,
            w: 4,
            h: 0.5,
            fontSize: 18,
            color: '363636'
          }));
          stats.rebuiltObjects += 1;
          stats.textObjects += 1;
          break;
        }
        case 'image': {
          const image = {};
          if (object.source?.path) {
            image.path = object.source.path;
          } else if (object.source?.data) {
            image.data = object.source.data;
          } else if (object.source?.assetKey && assetMap[object.source.assetKey]) {
            const mapped = assetMap[object.source.assetKey];
            if (mapped.path) {
              image.path = mapped.path;
            } else if (mapped.data) {
              image.data = mapped.data;
            }
          } else {
            warnings.push(createNormalizedWarning(object, NORMALIZED_WARNING_CODES.IMAGE_RESOURCE_MAPPING_REQUIRED, 'normalized image with embed source still requires external file/data mapping; skipped'));
            stats.skippedObjects += 1;
            stats.imageObjects += 1;
            break;
          }

          const options = transformToOptions(object.transform, {
            x: 0.5,
            y: 1,
            w: 4,
            h: 3
          });

          image.x = options.x;
          image.y = options.y;
          image.w = options.w;
          image.h = options.h;

          addObjectImage(slide, { image });
          stats.rebuiltObjects += 1;
          stats.imageObjects += 1;
          break;
        }
        case 'table': {
          const previewRows = object.content?.previewRows;
          slide.addTable(previewRows, transformToOptions(object.transform, {
            x: 0.5,
            y: 1,
            w: 6
          }));
          stats.rebuiltObjects += 1;
          stats.tableObjects += 1;
          break;
        }
        case 'chart': {
          const chart = buildNormalizedChartConfig(object);
          if (!chart) {
            warnings.push(createNormalizedWarning(object, NORMALIZED_WARNING_CODES.INVALID_CHART_CONFIG, 'chart object missing normalized chart content; skipped'));
            stats.skippedObjects += 1;
            break;
          }
          addObjectChart(slide, { chart });
          stats.rebuiltObjects += 1;
          stats.chartObjects += 1;
          break;
        }
        case 'shape': {
          const shape = buildNormalizedShapeConfig(object);
          addObjectShape(slide, { shape });
          stats.rebuiltObjects += 1;
          stats.shapeObjects += 1;
          break;
        }
        case 'notes': {
          const noteText = object.content?.text;
          slide.addNotes(noteText);
          stats.rebuiltObjects += 1;
          stats.notesObjects += 1;
          break;
        }
        case 'media': {
          const media = {};
          if (object.source?.path) {
            media.path = object.source.path;
          } else if (object.source?.data) {
            media.data = object.source.data;
          } else if (object.source?.assetKey && assetMap[object.source.assetKey]) {
            const mapped = assetMap[object.source.assetKey];
            if (mapped.path) {
              media.path = mapped.path;
            } else if (mapped.data) {
              media.data = mapped.data;
            }
          } else {
            warnings.push(createNormalizedWarning(object, NORMALIZED_WARNING_CODES.MEDIA_RESOURCE_MAPPING_REQUIRED, 'normalized media requires source.path, source.data, or assetMap mapping; skipped'));
            stats.skippedObjects += 1;
            break;
          }

          const options = transformToOptions(object.transform, {
            x: 1,
            y: 1,
            w: 6,
            h: 4
          });

          media.x = options.x;
          media.y = options.y;
          media.w = options.w;
          media.h = options.h;
          media.type = object.content?.mediaType || 'video';

          addObjectMedia(slide, { media });
          stats.rebuiltObjects += 1;
          stats.mediaObjects += 1;
          break;
        }
        default:
          warnings.push(createNormalizedWarning(object, NORMALIZED_WARNING_CODES.UNSUPPORTED_KIND, 'unsupported normalized object kind; skipped'));
          stats.skippedObjects += 1;
      }
    } catch (e) {
      warnings.push(createNormalizedWarning(object, NORMALIZED_WARNING_CODES.REBUILD_ERROR, e.message));
      stats.skippedObjects += 1;
    }
  }

  return { warnings, stats };
}

/**
 * 从 Markdown 创建演示文稿
 */
function createFromMarkdown(pptx, markdown) {
  const lines = markdown.split('\n');
  let currentSlide = null;
  let slideContent = [];
  
  for (const line of lines) {
    // 一级标题 = 新幻灯片
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      if (currentSlide) {
        finalizeMarkdownSlide(pptx, currentSlide, slideContent);
      }
      
      currentSlide = { title: line.substring(2) };
      slideContent = [];
    }
    // 二级标题 = 内容标题
    else if (line.startsWith('## ')) {
      if (currentSlide) {
        slideContent.push({ type: 'heading', text: line.substring(3) });
      }
    }
    // 列表项
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      slideContent.push({ type: 'bullet', text: line.substring(2) });
    }
    // 普通文本
    else if (line.trim() && currentSlide) {
      slideContent.push({ type: 'text', text: line });
    }
  }
  
  // 处理最后一个幻灯片
  if (currentSlide) {
    finalizeMarkdownSlide(pptx, currentSlide, slideContent);
  }
  
  // 如果没有幻灯片，创建空白
  if (pptx.slides.length === 0) {
    pptx.addSlide();
  }
}

/**
 * 完成 Markdown 幻灯片
 */
function finalizeMarkdownSlide(pptx, slideInfo, content) {
  const slide = pptx.addSlide();
  
  // 标题
  if (slideInfo.title) {
    slide.addText(slideInfo.title, {
      x: 0.5,
      y: 0.5,
      w: '90%',
      h: 1,
      fontSize: 36,
      bold: true
    });
  }
  
  // 内容
  if (content.length > 0) {
    const headingItems = content.filter(c => c.type === 'heading');
    const textItems = content.filter(c => c.type === 'text');
    const bulletItems = content
      .filter(c => c.type === 'bullet')
      .map(c => ({ text: c.text, options: { bullet: true } }));
    let yPos = 1.5;

    for (const item of headingItems) {
      slide.addText(item.text, {
        x: 0.5,
        y: yPos,
        w: '90%',
        h: 0.5,
        fontSize: 24,
        bold: true,
        color: '363636'
      });
      yPos += 0.7;
    }

    for (const item of textItems) {
      slide.addText(item.text, {
        x: 0.5,
        y: yPos,
        w: '90%',
        h: 0.45,
        fontSize: 18,
        color: '666666'
      });
      yPos += 0.55;
    }
    
    if (bulletItems.length > 0) {
      slide.addText(bulletItems, {
        x: 0.5,
        y: yPos,
        w: '90%',
        h: 4,
        fontSize: 18
      });
    }
  }
}

// ==================== 技能入口 ====================

/**
 * Skill execute function - called by skill-runner
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool parameters
 * @param {object} context - Execution context
 * @returns {Promise<object>} Execution result
 */
async function execute(toolName, params, context = {}) {
  switch (toolName) {
    case 'file':
      return await pptxFile(params);
      
    case 'slide':
      return await pptxSlide(params);
      
    case 'object':
      return await pptxObject(params);
      
    case 'master':
      return await pptxMaster(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}. Supported tools: file, slide, object, master`);
  }
}

// ============================================
// 工具定义
// ============================================

function getTools() {
  return [
    {
      name: 'file',
      description: '文件级操作，支持read、create、extract',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['read', 'create', 'extract'], description: '操作类型' },
          path: { type: 'string', description: '文件路径' },
          scope: { type: 'string', enum: ['info', 'text', 'structure', 'normalized', 'media', 'tables', 'charts', 'notes'], description: '读取范围（read操作）' },
          includeAssets: { type: 'boolean', description: '是否在 normalized 读取中内联 presentation.assetMap（read + scope=normalized）' },
          slideNumbers: { type: 'array', items: { type: 'number' }, description: '幻灯片编号列表（read操作）' },
          source: { type: 'string', enum: ['data', 'markdown', 'normalized'], description: '创建来源（create操作）' },
          slides: { type: 'array', description: '幻灯片数据（create操作）' },
          markdown: { type: 'string', description: 'Markdown内容（create操作）' },
          normalized: { type: 'object', description: '标准化 slide object model（create操作）' },
          properties: { type: 'object', description: '文档属性' },
          outputDir: { type: 'string', description: '提取输出目录（extract操作）' },
          extractType: { type: 'string', enum: ['images', 'media', 'all'], description: '提取类型（extract操作）' }
        },
        required: ['action', 'path']
      }
    },
    {
      name: 'slide',
      description: '幻灯片创建（仅限新建演示文稿），支持add操作',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add'], description: '操作类型' },
          output: { type: 'string', description: '输出文件路径' },
          master: { type: 'object', description: '母版配置' },
          slides: { type: 'array', description: '多个幻灯片数据（批量添加）' },
          title: { type: 'string', description: '标题' },
          content: {
            anyOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ],
            description: '内容，支持字符串或字符串数组'
          },
          background: { type: 'object', description: '背景配置' },
          properties: { type: 'object', description: '文档属性' }
        },
        required: ['action', 'output']
      }
    },
    {
      name: 'object',
      description: '内容对象添加（仅限新建演示文稿），支持add、extract',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'extract'], description: '操作类型' },
          output: { type: 'string', description: '输出文件路径（add操作）' },
          path: { type: 'string', description: '现有文件路径（extract操作）' },
          slideNumber: { type: 'number', description: '幻灯片编号（add操作）' },
          type: { type: 'string', enum: ['text', 'image', 'table', 'chart', 'shape', 'media', 'notes'], description: '对象类型（add操作）' },
          text: { type: 'string', description: '文本内容（text类型）' },
          options: { type: 'object', description: '文本选项（text类型）' },
          image: { type: 'object', description: '图片配置（image类型）' },
          table: { type: 'object', description: '表格配置（table类型）' },
          chart: { type: 'object', description: '图表配置（chart类型）' },
          shape: { type: 'object', description: '形状配置（shape类型）' },
          media: { type: 'object', description: '媒体配置（media类型）' },
          notes: { type: 'string', description: '演讲者备注（notes类型）' },
          properties: { type: 'object', description: '文档属性' },
          outputDir: { type: 'string', description: '提取输出目录（extract操作）' }
        },
        required: ['action']
      }
    },
    {
      name: 'master',
      description: '模板定义（仅限新建演示文稿），支持define、list',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['define', 'list'], description: '操作类型' },
          path: { type: 'string', description: '现有文件路径（list操作）' },
          output: { type: 'string', description: '输出文件路径（define操作）' },
          name: { type: 'string', description: '母版名称' },
          background: { type: 'object', description: '背景配置' },
          objects: { type: 'array', description: '母版对象' },
          slideNumber: { type: 'object', description: '幻灯片编号配置' },
          margin: { type: 'object', description: '边距' },
          properties: { type: 'object', description: '文档属性' }
        },
        required: ['action']
      }
    }
  ];
}

module.exports = { execute, getTools };
