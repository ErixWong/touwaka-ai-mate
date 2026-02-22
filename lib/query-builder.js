/**
 * Sequelize Query Builder
 * 将 API 查询请求转换为 Sequelize 查询选项
 * 
 * @module lib/query-builder
 */

import { Op } from 'sequelize';

/**
 * 操作符后缀映射到 Sequelize Op
 * 后缀格式：字段名_操作符
 */
const OPERATOR_SUFFIX_MAP = {
  '_eq': Op.eq,
  '_ne': Op.ne,
  '_gt': Op.gt,
  '_gte': Op.gte,
  '_lt': Op.lt,
  '_lte': Op.lte,
  '_like': Op.like,
  '_ilike': Op.iLike,
  '_startswith': Op.startsWith,
  '_endswith': Op.endsWith,
  '_contains': Op.substring,
  '_in': Op.in,
  '_nin': Op.notIn,
  '_null': Op.is,
  '_notnull': Op.not,
  '_between': Op.between,
  '_notbetween': Op.notBetween,
  '_regexp': Op.regexp,
  '_notregexp': Op.notRegexp,
};

/**
 * 反向映射：Sequelize Op 到后缀
 */
const OP_TO_SUFFIX_MAP = Object.entries(OPERATOR_SUFFIX_MAP).reduce((acc, [suffix, op]) => {
  acc[op] = suffix;
  return acc;
}, {});

/**
 * 默认分页配置
 */
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const MIN_PAGE_NUMBER = 1;

/**
 * 解析单个过滤条件
 * @private
 */
function parseFilterField(key, value) {
  // 检查是否有操作符后缀
  let fieldName = key;
  let operator = Op.eq; // 默认精确匹配
  
  for (const [suffix, op] of Object.entries(OPERATOR_SUFFIX_MAP)) {
    if (key.endsWith(suffix)) {
      fieldName = key.slice(0, -suffix.length);
      operator = op;
      break;
    }
  }
  
  // 处理特殊操作符
  if (operator === Op.is) {
    // _null 后缀：true 表示 IS NULL，false 表示 IS NOT NULL
    return { fieldName, condition: value ? { [Op.is]: null } : { [Op.not]: null } };
  }
  
  if (operator === Op.not) {
    // _notnull 后缀
    return { fieldName, condition: value ? { [Op.not]: null } : { [Op.is]: null } };
  }
  
  if (operator === Op.like || operator === Op.iLike) {
    // like 操作符：如果值不包含通配符，自动添加
    const pattern = typeof value === 'string' && !value.includes('%') 
      ? `%${value}%` 
      : value;
    return { fieldName, condition: { [operator]: pattern } };
  }
  
  if (operator === Op.startsWith) {
    return { fieldName, condition: { [Op.startsWith]: value } };
  }
  
  if (operator === Op.endsWith) {
    return { fieldName, condition: { [Op.endsWith]: value } };
  }
  
  if (operator === Op.substring) {
    // _contains 后缀：包含子字符串
    return { fieldName, condition: { [Op.substring]: value } };
  }
  
  if (operator === Op.between || operator === Op.notBetween) {
    // between 操作符：value 应为数组 [min, max]
    if (!Array.isArray(value) || value.length !== 2) {
      throw new Error(`Filter '${key}' requires an array with exactly 2 elements for between operation`);
    }
    return { fieldName, condition: { [operator]: value } };
  }
  
  if (operator === Op.in || operator === Op.notIn) {
    // in 操作符：确保 value 是数组
    if (!Array.isArray(value)) {
      throw new Error(`Filter '${key}' requires an array for in/nin operation`);
    }
    return { fieldName, condition: { [operator]: value } };
  }
  
  // 默认：直接应用操作符
  return { fieldName, condition: { [operator]: value } };
}

/**
 * 解析过滤条件，转换为 Sequelize where 对象
 * @param {Object} filter - API 请求中的 filter 对象
 * @param {Object} options - 解析选项
 * @param {string[]} options.allowedFields - 允许的字段列表（白名单）
 * @param {Object} options.fieldAliases - 字段别名映射 { alias: realField }
 * @returns {Object} Sequelize where 对象
 * 
 * @example
 * parseFilter({
 *   status: 'active',
 *   created_at_gte: '2026-01-01',
 *   title_contains: '项目',
 *   tags_in: ['tech', 'news']
 * })
 * // 返回:
 * // {
 * //   status: { [Op.eq]: 'active' },
 * //   created_at: { [Op.gte]: '2026-01-01' },
 * //   title: { [Op.substring]: '项目' },
 * //   tags: { [Op.in]: ['tech', 'news'] }
 * // }
 */
function parseFilter(filter, options = {}) {
  if (!filter || typeof filter !== 'object') return {};
  
  const { allowedFields, fieldAliases = {} } = options;
  const where = {};
  
  for (const [key, value] of Object.entries(filter)) {
    // 跳过 undefined 和 null 值（但保留空字符串和 false）
    if (value === undefined || value === null) continue;
    
    let { fieldName, condition } = parseFilterField(key, value);
    
    // 应用字段别名
    if (fieldAliases[fieldName]) {
      fieldName = fieldAliases[fieldName];
    }
    
    // 检查字段是否在白名单中
    if (allowedFields && !allowedFields.includes(fieldName)) {
      // 静默忽略不允许的字段（或抛出错误，根据需求决定）
      continue;
    }
    
    // 合并条件（处理同一字段多个条件的情况）
    if (where[fieldName]) {
      // 如果已有条件，合并对象
      where[fieldName] = { ...where[fieldName], ...condition };
    } else {
      where[fieldName] = condition;
    }
  }
  
  return where;
}

/**
 * 解析排序参数
 * @param {Array} sort - API 请求中的 sort 数组
 * @param {Object} options - 解析选项
 * @param {string[]} options.allowedFields - 允许的排序字段列表
 * @param {Array} options.defaultSort - 默认排序 [['created_at', 'DESC']]
 * @returns {Array} Sequelize order 数组
 * 
 * @example
 * parseSort([
 *   { field: 'updated_at', order: 'DESC' },
 *   { field: 'status', order: 'ASC' }
 * ])
 * // 返回: [['updated_at', 'DESC'], ['status', 'ASC']]
 */
function parseSort(sort, options = {}) {
  const { allowedFields, defaultSort = [['created_at', 'DESC']] } = options;
  
  if (!sort || !Array.isArray(sort) || sort.length === 0) {
    return defaultSort;
  }
  
  return sort
    .filter(s => s && s.field)
    .map(s => {
      const field = s.field;
      const order = (s.order || 'ASC').toUpperCase();
      
      // 检查字段是否在白名单中
      if (allowedFields && !allowedFields.includes(field)) {
        return null;
      }
      
      // 验证排序方向
      if (!['ASC', 'DESC'].includes(order)) {
        return null;
      }
      
      return [field, order];
    })
    .filter(Boolean);
}

/**
 * 解析分页参数
 * @param {Object} page - API 请求中的 page 对象
 * @param {Object} options - 解析选项
 * @param {number} options.defaultSize - 默认每页条数
 * @param {number} options.maxSize - 最大每页条数
 * @returns {Object} 分页信息 { offset, limit, page, size }
 * 
 * @example
 * parsePage({ number: 2, size: 20 })
 * // 返回: { offset: 20, limit: 20, page: 2, size: 20 }
 */
function parsePage(page, options = {}) {
  const {
    defaultSize = DEFAULT_PAGE_SIZE,
    maxSize = MAX_PAGE_SIZE,
  } = options;
  
  const pageNumber = Math.max(MIN_PAGE_NUMBER, parseInt(page?.number) || MIN_PAGE_NUMBER);
  const pageSize = Math.min(maxSize, Math.max(1, parseInt(page?.size) || defaultSize));
  
  return {
    offset: (pageNumber - 1) * pageSize,
    limit: pageSize,
    page: pageNumber,
    size: pageSize,
  };
}

/**
 * 解析字段选择
 * @param {Array} fields - API 请求中的 fields 数组
 * @param {Object} options - 解析选项
 * @param {string[]} options.allowedFields - 允许的字段列表
 * @param {string[]} options.requiredFields - 必须包含的字段（如 id）
 * @returns {Array|undefined} Sequelize attributes
 * 
 * @example
 * parseFields(['id', 'title', 'status'])
 * // 返回: ['id', 'title', 'status']
 */
function parseFields(fields, options = {}) {
  const { allowedFields, requiredFields = [] } = options;
  
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return undefined;
  }
  
  let result = fields;
  
  // 过滤只保留允许的字段
  if (allowedFields) {
    result = result.filter(f => allowedFields.includes(f));
  }
  
  // 确保必须字段存在
  for (const rf of requiredFields) {
    if (!result.includes(rf)) {
      result.unshift(rf);
    }
  }
  
  return result.length > 0 ? result : undefined;
}

/**
 * 构建关联查询选项
 * @param {Array} include - API 请求中的 include 数组
 * @param {Object} includeMap - 模型关联映射配置
 * @param {Object} includeMap[modelName].model - Sequelize 模型
 * @param {string} includeMap[modelName].as - 关联别名
 * @param {string[]} includeMap[modelName].defaultFields - 默认返回字段
 * @param {Object} includeMap[modelName].includeMap - 嵌套关联映射
 * @returns {Array} Sequelize include 数组
 * 
 * @example
 * const includeMap = {
 *   'User': { model: User, as: 'user', defaultFields: ['id', 'name'] },
 *   'Messages': { model: Message, as: 'messages' }
 * };
 * 
 * buildInclude(['User', { model: 'Messages', fields: ['id', 'content'] }], includeMap)
 */
function buildInclude(include, includeMap) {
  if (!include || !Array.isArray(include) || !includeMap) {
    return undefined;
  }
  
  return include.map(item => {
    const modelName = typeof item === 'string' ? item : item?.model;
    const modelConfig = includeMap[modelName];
    
    if (!modelConfig) {
      // 静默忽略未配置的关联
      return null;
    }
    
    const includeOption = {
      model: modelConfig.model,
      as: modelConfig.as,
    };
    
    // 处理字段选择
    if (item.fields) {
      includeOption.attributes = item.fields;
    } else if (modelConfig.defaultFields) {
      includeOption.attributes = modelConfig.defaultFields;
    }
    
    // 递归处理嵌套关联
    if (item.include && modelConfig.includeMap) {
      const nestedInclude = buildInclude(item.include, modelConfig.includeMap);
      if (nestedInclude) {
        includeOption.include = nestedInclude;
      }
    }
    
    return includeOption;
  }).filter(Boolean);
}

/**
 * 构建完整的 Sequelize 查询选项
 * @param {Object} queryRequest - API 查询请求
 * @param {Object} queryRequest.filter - 过滤条件
 * @param {Object} queryRequest.sort - 排序参数
 * @param {Object} queryRequest.page - 分页参数
 * @param {Array} queryRequest.fields - 字段选择
 * @param {Array} queryRequest.include - 关联查询
 * @param {Object} options - 额外配置
 * @param {Object} options.filterOptions - parseFilter 的选项
 * @param {Object} options.sortOptions - parseSort 的选项
 * @param {Object} options.pageOptions - parsePage 的选项
 * @param {Object} options.fieldsOptions - parseFields 的选项
 * @param {Object} options.includeMap - buildInclude 的映射配置
 * @param {Object} options.baseWhere - 基础 where 条件（如用户ID过滤）
 * @returns {Object} { queryOptions, pagination }
 * 
 * @example
 * const { queryOptions, pagination } = buildQueryOptions(
 *   {
 *     filter: { status: 'active' },
 *     sort: [{ field: 'created_at', order: 'DESC' }],
 *     page: { number: 1, size: 10 }
 *   },
 *   {
 *     baseWhere: { user_id: 'user-001' },
 *     includeMap: { 'Expert': { model: Expert, as: 'expert' } }
 *   }
 * );
 * 
 * const result = await Model.findAndCountAll(queryOptions);
 */
function buildQueryOptions(queryRequest, options = {}) {
  const {
    filterOptions,
    sortOptions,
    pageOptions,
    fieldsOptions,
    includeMap,
    baseWhere,
  } = options;
  
  const { filter, sort, page, fields, include } = queryRequest || {};
  
  // 解析各部分
  const { offset, limit, page: pageNumber, size: pageSize } = parsePage(page, pageOptions);
  const whereFilter = parseFilter(filter, filterOptions);
  const order = parseSort(sort, sortOptions);
  const attributes = parseFields(fields, fieldsOptions);
  const includeOptions = buildInclude(include, includeMap);
  
  // 合并 where 条件
  const where = baseWhere 
    ? { ...baseWhere, ...whereFilter }
    : whereFilter;
  
  // 构建查询选项
  const queryOptions = {
    where,
    order,
    offset,
    limit,
    distinct: true, // 避免关联查询时重复计数
  };
  
  // 添加可选属性
  if (attributes) queryOptions.attributes = attributes;
  if (includeOptions) queryOptions.include = includeOptions;
  
  return {
    queryOptions,
    pagination: {
      page: pageNumber,
      size: pageSize,
    },
  };
}

/**
 * 构建分页响应
 * @param {Object} result - Sequelize findAndCountAll 结果
 * @param {number} result.count - 总条数
 * @param {Array} result.rows - 数据行
 * @param {Object} pagination - 分页信息
 * @param {number} pagination.page - 当前页码
 * @param {number} pagination.size - 每页条数
 * @param {number} [startTime] - 查询开始时间（用于计算耗时）
 * @param {Object} [options] - 额外选项
 * @param {boolean} options.includeSummary - 是否包含摘要信息
 * @param {boolean} options.includeSql - 是否包含 SQL（开发模式）
 * @returns {Object} API 响应对象
 * 
 * @example
 * const startTime = Date.now();
 * const result = await Model.findAndCountAll(queryOptions);
 * const response = buildPaginatedResponse(result, pagination, startTime);
 * // 返回:
 * // {
 * //   items: [...],
 * //   pagination: { page: 1, size: 10, total: 100, pages: 10, has_next: true, has_prev: false }
 * // }
 */
function buildPaginatedResponse(result, pagination, startTime, options = {}) {
  const { page, size } = pagination;
  const total = result.count;
  const pages = Math.ceil(total / size);
  
  const response = {
    items: result.rows,
    pagination: {
      page,
      size,
      total,
      pages,
      has_next: page < pages,
      has_prev: page > 1,
    },
  };
  
  // 添加摘要信息
  if (options.includeSummary || process.env.NODE_ENV === 'development') {
    response.summary = {
      took_ms: startTime ? Date.now() - startTime : undefined,
    };
    
    // 开发模式下可以包含 SQL
    if (options.includeSql && result.query) {
      response.summary.sql = result.query;
    }
  }
  
  return response;
}

/**
 * 创建简单的 where 条件（用于 GET 请求）
 * @param {Object} params - 查询参数对象
 * @param {string[]} allowedFields - 允许的字段列表
 * @returns {Object} Sequelize where 对象
 * 
 * @example
 * // GET /api/topics?status=active&expert_id=xxx
 * const where = createSimpleWhere(ctx.query, ['status', 'expert_id']);
 * // 返回: { status: 'active', expert_id: 'xxx' }
 */
function createSimpleWhere(params, allowedFields) {
  if (!params || typeof params !== 'object') return {};
  
  const where = {};
  
  for (const field of allowedFields) {
    const value = params[field];
    if (value !== undefined && value !== null && value !== '') {
      where[field] = value;
    }
  }
  
  return where;
}

/**
 * 验证过滤条件字段名
 * @param {Object} filter - 过滤条件
 * @param {string[]} allowedFields - 允许的字段列表
 * @throws {Error} 如果包含不允许的字段
 */
function validateFilterFields(filter, allowedFields) {
  if (!filter || !allowedFields) return;
  
  for (const key of Object.keys(filter)) {
    // 提取字段名（去除操作符后缀）
    let fieldName = key;
    for (const suffix of Object.keys(OPERATOR_SUFFIX_MAP)) {
      if (key.endsWith(suffix)) {
        fieldName = key.slice(0, -suffix.length);
        break;
      }
    }
    
    if (!allowedFields.includes(fieldName)) {
      throw new Error(`Invalid filter field: ${fieldName}`);
    }
  }
}

export {
  // 核心函数
  parseFilter,
  parseSort,
  parsePage,
  parseFields,
  buildInclude,
  buildQueryOptions,
  buildPaginatedResponse,
  
  // 辅助函数
  createSimpleWhere,
  validateFilterFields,
  
  // 常量
  OPERATOR_SUFFIX_MAP,
  OP_TO_SUFFIX_MAP,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_NUMBER,
};
