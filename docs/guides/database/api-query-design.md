# API 查询设计规范（基于 Sequelize）

## 概述

本文档定义后端 API 查询的两种模式及其请求/响应格式规范，专门针对 Sequelize ORM 进行优化设计。

## 查询类型分类

### 类型一：简单查询（GET）

**适用场景：**
- 不带条件或带较少条件（1-2 个）
- 期待返回固定数量或单条记录
- 条件通过 URL 参数传递

**示例：**
```
GET /api/experts                    # 获取所有专家
GET /api/experts/:id                # 获取单个专家
GET /api/experts?is_active=true     # 简单过滤
GET /api/models?provider_id=xxx     # 简单关联查询
```

**响应格式：**
```json
// 单条记录
{
  "id": "xxx",
  "name": "xxx",
  ...
}

// 多条记录（不分页）
[
  { "id": "xxx", ... },
  { "id": "xxx", ... }
]
```

---

### 类型二：复杂查询（POST /query）

**适用场景：**
- 带较多条件（3 个以上）
- 需要分页
- 需要复杂过滤（范围、模糊、组合等）
- 需要关联查询
- 条件通过请求体传递

**端点命名约定：**
```
POST /api/{resource}/query    # 复杂查询（推荐POST，便于缓存控制）
```

---

## 类型二：请求体设计

### 基础结构（与 Sequelize 兼容）

```typescript
interface QueryRequest<TFilter = Record<string, unknown>> {
  /** 分页参数 */
  page?: {
    /** 当前页码，从 1 开始，默认 1 */
    number?: number
    /** 每页条数，默认 10，最大 100 */
    size?: number
  }
  
  /** 排序参数（支持多字段） */
  sort?: Array<{
    field: string
    order: 'ASC' | 'DESC'
  }>
  
  /** 过滤条件（Sequelize WhereInput 风格） */
  filter?: TFilter
  
  /** 需要返回的字段（Sequelize attributes） */
  fields?: string[]
  
  /** 是否包含关联数据（Sequelize include） */
  include?: string[] | IncludeOption[]
}

/** 关联查询选项 */
interface IncludeOption {
  /** 关联模型名称 */
  model: string
  /** 需要返回的字段 */
  fields?: string[]
  /** 嵌套关联 */
  include?: string[] | IncludeOption[]
}
```

### 过滤条件设计（Sequelize Op 风格）

采用与 Sequelize 操作符对应的扁平结构：

```typescript
// 示例：Topics 查询过滤条件
interface TopicFilter {
  // ============ 精确匹配 ============
  expert_id?: string
  user_id?: string
  status?: 'active' | 'archived' | 'deleted'
  
  // ============ 范围查询（使用后缀映射到 Sequelize Op） ============
  created_at_gte?: string    // Op.gte >=
  created_at_lte?: string    // Op.lte <=
  created_at_gt?: string     // Op.gt  >
  created_at_lt?: string     // Op.lt  <
  
  message_count_gte?: number // Op.gte
  message_count_lte?: number // Op.lte
  
  // ============ 模糊查询 ============
  title_like?: string        // Op.like (带通配符)
  title_ilike?: string       // Op.iLike (不区分大小写，PostgreSQL)
  title_startswith?: string  // Op.startsWith
  title_endswith?: string    // Op.endsWith
  title_contains?: string    // Op.substring (包含)
  
  // ============ 数组查询 ============
  status_in?: string[]       // Op.in
  status_nin?: string[]      // Op.notIn
  
  // ============ NULL 查询 ============
  expert_id_null?: boolean   // Op.is / Op.not
  
  // ============ 布尔值 ============
  has_messages?: boolean     // 自定义逻辑
}
```

### 后缀到 Sequelize Op 映射表

| 后缀 | Sequelize Op | SQL | 示例 |
|------|-------------|-----|------|
| `_eq` | Op.eq | = | `status_eq: 'active'` |
| `_ne` | Op.ne | != | `status_ne: 'deleted'` |
| `_gt` | Op.gt | > | `created_at_gt: '2026-01-01'` |
| `_gte` | Op.gte | >= | `created_at_gte: '2026-01-01'` |
| `_lt` | Op.lt | < | `message_count_lt: 100` |
| `_lte` | Op.lte | <= | `message_count_lte: 100` |
| `_like` | Op.like | LIKE | `title_like: '%项目%'` |
| `_ilike` | Op.iLike | ILIKE | `title_ilike: '%project%'` |
| `_startswith` | Op.startsWith | LIKE 'xxx%' | `title_startswith: '项目'` |
| `_endswith` | Op.endsWith | LIKE '%xxx' | `title_endswith: '讨论'` |
| `_contains` | Op.substring | LIKE '%xxx%' | `title_contains: '项目'` |
| `_in` | Op.in | IN (...) | `status_in: ['active', 'archived']` |
| `_nin` | Op.notIn | NOT IN (...) | `status_nin: ['deleted']` |
| `_null` | Op.is | IS NULL | `expert_id_null: true` |
| `_between` | Op.between | BETWEEN | `age_between: [18, 30]` |

**无后缀字段默认为精确匹配（Op.eq）**

---

## 请求示例

### 示例 1：基础分页查询

```json
POST /api/topics/query
{
  "page": {
    "number": 1,
    "size": 10
  },
  "sort": [
    { "field": "updated_at", "order": "DESC" }
  ],
  "filter": {
    "user_id": "user-001",
    "status": "active"
  }
}
```

### 示例 2：复杂条件查询

```json
POST /api/topics/query
{
  "page": { "number": 1, "size": 20 },
  "sort": [
    { "field": "status", "order": "ASC" },
    { "field": "updated_at", "order": "DESC" }
  ],
  "filter": {
    "expert_id": "expert-001",
    "status_in": ["active", "archived"],
    "title_contains": "项目",
    "created_at_gte": "2026-01-01T00:00:00Z",
    "created_at_lte": "2026-02-20T23:59:59Z",
    "message_count_gte": 5
  },
  "fields": ["id", "title", "status", "message_count", "updated_at"]
}
```

### 示例 3：带关联查询

```json
POST /api/topics/query
{
  "page": { "number": 1, "size": 10 },
  "filter": {
    "user_id": "user-001",
    "status": "active"
  },
  "include": [
    {
      "model": "Expert",
      "fields": ["id", "name", "introduction"]
    },
    {
      "model": "User",
      "fields": ["id", "nickname", "avatar"]
    }
  ]
}
```

### 示例 4：嵌套关联查询

```json
POST /api/messages/query
{
  "page": { "number": 1, "size": 50 },
  "filter": {
    "topic_id": "topic-001",
    "role_in": ["user", "assistant"],
    "is_deleted": false
  },
  "sort": [{ "field": "created_at", "order": "ASC" }],
  "include": [
    {
      "model": "Topic",
      "fields": ["id", "title"],
      "include": ["Expert"]
    }
  ]
}
```

---

## 类型二：响应体设计

### 基础结构

```typescript
interface QueryResponse<T> {
  /** 数据列表 */
  items: T[]
  
  /** 分页信息 */
  pagination: {
    /** 当前页码 */
    page: number
    /** 每页条数 */
    size: number
    /** 总条数 */
    total: number
    /** 总页数 */
    pages: number
    /** 是否有下一页 */
    has_next: boolean
    /** 是否有上一页 */
    has_prev: boolean
  }
  
  /** 查询摘要（可选，开发环境启用） */
  summary?: {
    /** 查询耗时（毫秒） */
    took_ms: number
    /** 应用的过滤条件数量 */
    filters_applied: number
    /** 生成的 SQL（调试用） */
    sql?: string
  }
}
```

### 响应示例

```json
{
  "items": [
    {
      "id": "topic-001",
      "title": "项目进度讨论",
      "description": "关于Q1项目的进度同步",
      "expert_id": "expert-001",
      "status": "active",
      "message_count": 15,
      "created_at": "2026-02-20T10:00:00Z",
      "updated_at": "2026-02-20T12:00:00Z",
      "expert": {
        "id": "expert-001",
        "name": "Eric",
        "introduction": "34岁程序员..."
      }
    }
  ],
  "pagination": {
    "page": 1,
    "size": 10,
    "total": 45,
    "pages": 5,
    "has_next": true,
    "has_prev": false
  },
  "summary": {
    "took_ms": 23,
    "filters_applied": 3
  }
}
```

---

## Sequelize 查询构建器实现

### 核心工具类

```javascript
// lib/query-builder.js
const { Op } = require('sequelize');

/**
 * 操作符后缀映射
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
  '_between': Op.between,
  '_notbetween': Op.notBetween,
};

/**
 * 解析过滤条件，转换为 Sequelize where 对象
 * @param {Object} filter - API 请求中的 filter 对象
 * @returns {Object} Sequelize where 对象
 */
function parseFilter(filter) {
  if (!filter || typeof filter !== 'object') return {};
  
  const where = {};
  
  for (const [key, value] of Object.entries(filter)) {
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
      where[fieldName] = value ? { [Op.is]: null } : { [Op.not]: null };
    } else if (operator === Op.like || operator === Op.iLike || operator === Op.substring) {
      // like 类操作符：自动添加通配符
      if (operator === Op.substring) {
        where[fieldName] = { [Op.substring]: value }; // 包含
      } else if (operator === Op.like) {
        where[fieldName] = { [Op.like]: value.includes('%') ? value : `%${value}%` };
      } else {
        where[fieldName] = { [operator]: value.includes('%') ? value : `%${value}%` };
      }
    } else if (operator === Op.startsWith) {
      where[fieldName] = { [Op.startsWith]: value };
    } else if (operator === Op.endsWith) {
      where[fieldName] = { [Op.endsWith]: value };
    } else if (operator === Op.between) {
      where[fieldName] = { [Op.between]: value }; // value 应为数组 [min, max]
    } else {
      where[fieldName] = { [operator]: value };
    }
  }
  
  return where;
}

/**
 * 解析排序参数
 * @param {Array} sort - API 请求中的 sort 数组
 * @returns {Array} Sequelize order 数组
 */
function parseSort(sort) {
  if (!sort || !Array.isArray(sort)) return [['created_at', 'DESC']];
  
  return sort.map(s => [s.field, s.order.toUpperCase()]);
}

/**
 * 解析分页参数
 * @param {Object} page - API 请求中的 page 对象
 * @returns {Object} Sequelize offset 和 limit
 */
function parsePage(page) {
  const number = Math.max(1, page?.number || 1);
  const size = Math.min(100, Math.max(1, page?.size || 10));
  
  return {
    offset: (number - 1) * size,
    limit: size,
    page: number,
    size,
  };
}

/**
 * 解析字段选择
 * @param {Array} fields - API 请求中的 fields 数组
 * @returns {Array|undefined} Sequelize attributes
 */
function parseFields(fields) {
  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return undefined;
  }
  return fields;
}

/**
 * 构建完整的 Sequelize 查询选项
 * @param {Object} queryRequest - API 查询请求
 * @param {Object} options - 额外选项
 * @returns {Object} Sequelize 查询选项
 */
function buildQueryOptions(queryRequest, options = {}) {
  const { filter, sort, page, fields, include } = queryRequest;
  const { defaultSort, maxLimit = 100, includeMap } = options;
  
  const { offset, limit, page: pageNumber, size: pageSize } = parsePage(page);
  const where = parseFilter(filter);
  const order = sort?.length > 0 ? parseSort(sort) : (defaultSort || [['created_at', 'DESC']]);
  const attributes = parseFields(fields);
  
  const queryOptions = {
    where,
    order,
    offset,
    limit,
    attributes,
    distinct: true, // 避免关联查询时重复计数
  };
  
  // 处理关联
  if (include && includeMap) {
    queryOptions.include = buildInclude(include, includeMap);
  }
  
  return {
    queryOptions,
    pagination: { page: pageNumber, size: pageSize },
  };
}

/**
 * 构建关联查询选项
 * @param {Array} include - API 请求中的 include 数组
 * @param {Object} includeMap - 模型关联映射
 * @returns {Array} Sequelize include 数组
 */
function buildInclude(include, includeMap) {
  if (!include || !Array.isArray(include)) return undefined;
  
  return include.map(item => {
    const modelName = typeof item === 'string' ? item : item.model;
    const modelConfig = includeMap[modelName];
    
    if (!modelConfig) {
      throw new Error(`Unknown include model: ${modelName}`);
    }
    
    const includeOption = {
      model: modelConfig.model,
      as: modelConfig.as || modelName.toLowerCase(),
      attributes: item.fields || modelConfig.defaultFields,
    };
    
    // 递归处理嵌套关联
    if (item.include) {
      includeOption.include = buildInclude(item.include, modelConfig.includeMap || includeMap);
    }
    
    return includeOption;
  });
}

/**
 * 构建分页响应
 * @param {Object} result - Sequelize findAndCountAll 结果
 * @param {Object} pagination - 分页信息
 * @param {number} startTime - 查询开始时间
 * @returns {Object} API 响应对象
 */
function buildPaginatedResponse(result, pagination, startTime) {
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
  
  // 开发环境添加摘要
  if (process.env.NODE_ENV === 'development') {
    response.summary = {
      took_ms: Date.now() - startTime,
    };
  }
  
  return response;
}

module.exports = {
  parseFilter,
  parseSort,
  parsePage,
  parseFields,
  buildQueryOptions,
  buildInclude,
  buildPaginatedResponse,
  OPERATOR_SUFFIX_MAP,
};
```

---

## Controller 实现示例

### Topics Controller

```javascript
// server/controllers/topic.controller.js
const { Op } = require('sequelize');
const logger = require('../../lib/logger');
const { 
  buildQueryOptions, 
  buildPaginatedResponse 
} = require('../../lib/query-builder');

class TopicController {
  constructor(models) {
    this.Topic = models.Topic;
    this.User = models.User;
    this.Expert = models.Expert;
    this.Message = models.Message;
    
    // 关联映射配置
    this.includeMap = {
      'User': {
        model: this.User,
        as: 'user',
        defaultFields: ['id', 'nickname', 'avatar'],
      },
      'Expert': {
        model: this.Expert,
        as: 'expert',
        defaultFields: ['id', 'name', 'introduction'],
      },
      'Messages': {
        model: this.Message,
        as: 'messages',
        defaultFields: ['id', 'role', 'content', 'created_at'],
      },
    };
  }

  /**
   * 复杂查询 - POST /api/topics/query
   */
  async query(ctx) {
    const startTime = Date.now();
    
    try {
      const { filter, sort, page, fields, include } = ctx.request.body;
      
      // 强制过滤当前用户的数据（安全考虑）
      const secureFilter = {
        ...filter,
        user_id: ctx.state.userId,
      };
      
      const { queryOptions, pagination } = buildQueryOptions(
        { filter: secureFilter, sort, page, fields, include },
        {
          defaultSort: [['updated_at', 'DESC']],
          includeMap: this.includeMap,
        }
      );
      
      const result = await this.Topic.findAndCountAll(queryOptions);
      
      ctx.success(buildPaginatedResponse(result, pagination, startTime));
    } catch (error) {
      logger.error('Query topics error:', error);
      ctx.error('查询话题失败', 500);
    }
  }

  /**
   * 简单查询 - GET /api/topics
   */
  async list(ctx) {
    try {
      const { status, expert_id } = ctx.query;
      
      const where = {
        user_id: ctx.state.userId,
      };
      
      if (status) where.status = status;
      if (expert_id) where.expert_id = expert_id;
      
      const topics = await this.Topic.findAll({
        where,
        order: [['updated_at', 'DESC']],
        limit: 50,
      });
      
      ctx.success(topics);
    } catch (error) {
      logger.error('List topics error:', error);
      ctx.error('获取话题列表失败', 500);
    }
  }

  /**
   * 获取单个 - GET /api/topics/:id
   */
  async get(ctx) {
    try {
      const { id } = ctx.params;
      
      const topic = await this.Topic.findOne({
        where: {
          id,
          user_id: ctx.state.userId,
        },
        include: [
          {
            model: this.Expert,
            as: 'expert',
            attributes: ['id', 'name', 'introduction'],
          },
        ],
      });
      
      if (!topic) {
        ctx.error('话题不存在或无权限', 404);
        return;
      }
      
      ctx.success(topic);
    } catch (error) {
      logger.error('Get topic error:', error);
      ctx.error('获取话题失败', 500);
    }
  }

  /**
   * 创建 - POST /api/topics
   */
  async create(ctx) {
    try {
      const { title, expertId, providerName, modelName, description } = ctx.request.body;
      
      if (!title) {
        ctx.error('标题不能为空');
        return;
      }
      
      const topic = await this.Topic.create({
        id: Utils.newID(20),
        user_id: ctx.state.userId,
        expert_id: expertId || null,
        provider_name: providerName,
        model_name: modelName,
        title,
        description,
        status: 'active',
        message_count: 0,
      });
      
      ctx.status = 201;
      ctx.success(topic, '创建成功');
    } catch (error) {
      logger.error('Create topic error:', error);
      ctx.error('创建话题失败', 500);
    }
  }

  /**
   * 更新 - PUT /api/topics/:id
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const { title, status, description } = ctx.request.body;
      
      const topic = await this.Topic.findOne({
        where: { id, user_id: ctx.state.userId },
      });
      
      if (!topic) {
        ctx.error('话题不存在或无权限', 404);
        return;
      }
      
      await topic.update({
        ...(title !== undefined && { title }),
        ...(status !== undefined && { status }),
        ...(description !== undefined && { description }),
      });
      
      ctx.success(topic, '更新成功');
    } catch (error) {
      logger.error('Update topic error:', error);
      ctx.error('更新话题失败', 500);
    }
  }

  /**
   * 删除 - DELETE /api/topics/:id
   */
  async delete(ctx) {
    try {
      const { id } = ctx.params;
      
      const result = await this.Topic.destroy({
        where: { id, user_id: ctx.state.userId },
      });
      
      if (result === 0) {
        ctx.error('话题不存在或无权限', 404);
        return;
      }
      
      ctx.status = 204;
    } catch (error) {
      logger.error('Delete topic error:', error);
      ctx.error('删除话题失败', 500);
    }
  }
}

module.exports = TopicController;
```

---

## 路由配置

```javascript
// server/routes/topic.routes.js
const Router = require('@koa/router');
const TopicController = require('../controllers/topic.controller');
const { authenticate } = require('../middlewares/auth');

module.exports = (models) => {
  const router = new Router({ prefix: '/api/topics' });
  const controller = new TopicController(models);
  
  // 简单查询
  router.get('/', authenticate, controller.list.bind(controller));
  router.get('/:id', authenticate, controller.get.bind(controller));
  
  // 复杂查询
  router.post('/query', authenticate, controller.query.bind(controller));
  
  // CRUD
  router.post('/', authenticate, controller.create.bind(controller));
  router.put('/:id', authenticate, controller.update.bind(controller));
  router.delete('/:id', authenticate, controller.delete.bind(controller));
  
  return router;
};
```

---

## 各资源 Filter 定义

### Topics Filter

```typescript
interface TopicFilter {
  // 精确匹配
  user_id?: string
  expert_id?: string
  status?: 'active' | 'archived' | 'deleted'
  category?: string
  
  // 范围查询
  created_at_gte?: string
  created_at_lte?: string
  updated_at_gte?: string
  updated_at_lte?: string
  message_count_gte?: number
  message_count_lte?: number
  
  // 模糊查询
  title_contains?: string
  title_startswith?: string
  description_contains?: string
  
  // 数组查询
  status_in?: string[]
  expert_id_in?: string[]
  
  // NULL 查询
  expert_id_null?: boolean
}
```

### Messages Filter

```typescript
interface MessageFilter {
  // 精确匹配
  topic_id?: string
  user_id?: string
  expert_id?: string
  role?: 'system' | 'user' | 'assistant'
  content_type?: 'text' | 'image' | 'file'
  is_deleted?: boolean
  
  // 范围查询
  created_at_gte?: string
  created_at_lte?: string
  tokens_gte?: number
  tokens_lte?: number
  cost_gte?: number
  cost_lte?: number
  
  // 模糊查询
  content_contains?: string
  
  // 数组查询
  role_in?: string[]
  topic_id_in?: string[]
}
```

### Users Filter（管理员）

```typescript
interface UserFilter {
  // 精确匹配
  status?: 'active' | 'inactive' | 'banned'
  
  // 范围查询
  created_at_gte?: string
  created_at_lte?: string
  last_login_gte?: string
  last_login_lte?: string
  
  // 模糊查询
  username_contains?: string
  email_contains?: string
  nickname_contains?: string
  
  // 数组查询
  status_in?: string[]
}
```

### Experts Filter

```typescript
interface ExpertFilter {
  // 精确匹配
  is_active?: boolean
  expressive_model_id?: string
  reflective_model_id?: string
  
  // 范围查询
  created_at_gte?: string
  created_at_lte?: string
  
  // 模糊查询
  name_contains?: string
  introduction_contains?: string
  emotional_tone_contains?: string
  
  // 数组查询
  id_in?: string[]
}
```

### AI Models Filter

```typescript
interface AIModelFilter {
  // 精确匹配
  provider_id?: string
  is_active?: boolean
  
  // 范围查询
  max_tokens_gte?: number
  max_tokens_lte?: number
  cost_per_1k_input_lte?: number
  cost_per_1k_output_lte?: number
  
  // 模糊查询
  name_contains?: string
  model_name_contains?: string
  description_contains?: string
  
  // 数组查询
  provider_id_in?: string[]
}
```

---

## TypeScript 类型定义文件

```typescript
// types/query.ts

import { Op } from 'sequelize';

/** 分页参数 */
export interface PageParams {
  number?: number;  // 页码，从 1 开始，默认 1
  size?: number;    // 每页条数，默认 10，最大 100
}

/** 排序参数 */
export interface SortParams {
  field: string;
  order: 'ASC' | 'DESC';
}

/** 关联查询选项 */
export interface IncludeOption {
  model: string;
  fields?: string[];
  include?: IncludeOption[];
}

/** 查询请求基类 */
export interface QueryRequest<TFilter = Record<string, unknown>> {
  page?: PageParams;
  sort?: SortParams[];
  filter?: TFilter;
  fields?: string[];
  include?: (string | IncludeOption)[];
}

/** 分页响应信息 */
export interface PaginationInfo {
  page: number;
  size: number;
  total: number;
  pages: number;
  has_next: boolean;
  has_prev: boolean;
}

/** 查询响应基类 */
export interface QueryResponse<T> {
  items: T[];
  pagination: PaginationInfo;
  summary?: QuerySummary;
}

/** 查询摘要 */
export interface QuerySummary {
  took_ms: number;
  filters_applied?: number;
  sql?: string;
}

/** Sequelize 操作符后缀类型 */
export type OperatorSuffix = 
  | '_eq' | '_ne' | '_gt' | '_gte' | '_lt' | '_lte'
  | '_like' | '_ilike' | '_startswith' | '_endswith' | '_contains'
  | '_in' | '_nin' | '_null' | '_between';
```

---

## 最佳实践

### 1. 安全性

- **始终在服务端强制添加用户过滤条件**，不信任客户端传入的 user_id
- 使用 Sequelize 的参数化查询防止 SQL 注入
- 限制最大分页大小（100）

### 2. 性能优化

- 为常用过滤字段创建数据库索引
- 使用 `fields` 参数减少返回数据量
- 复杂关联查询时使用 `distinct: true` 避免重复计数
- 考虑为高频查询添加缓存

### 3. 错误处理

- 验证 filter 字段名是否合法（防止任意字段查询）
- 验证 include 模型是否允许（防止越权关联查询）
- 提供清晰的错误信息

### 4. 日志记录

- 记录慢查询（>1s）
- 开发环境输出 SQL 语句

---

## 迁移指南

### 从现有 mysql2 迁移

1. **Phase 1**: 安装 Sequelize，定义模型
2. **Phase 2**: 创建 query-builder.js 工具类
3. **Phase 3**: 新增 `/query` 端点，与现有端点并存
4. **Phase 4**: 前端逐步迁移到新 API
5. **Phase 5**: 移除旧的复杂查询端点

---

*文档版本: v1.0*
*创建日期: 2026-02-20*
*基于 Sequelize v6.x*
