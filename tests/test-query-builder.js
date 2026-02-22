/**
 * Query Builder 测试
 * 运行: node tests/test-query-builder.js
 */

import assert from 'assert';
import { Op } from 'sequelize';
import {
  parseFilter,
  parseSort,
  parsePage,
  parseFields,
  buildQueryOptions,
  buildPaginatedResponse,
  createSimpleWhere,
  validateFilterFields,
  OPERATOR_SUFFIX_MAP,
} from '../lib/query-builder.js';

console.log('🧪 Testing Query Builder...\n');

// ============ parseFilter 测试 ============
console.log('📋 Testing parseFilter...');

// 测试1: 精确匹配
let result = parseFilter({ status: 'active' });
assert.deepStrictEqual(result, { status: { [Op.eq]: 'active' } });
console.log('  ✅ Exact match (status: "active")');

// 测试2: 范围查询
result = parseFilter({ created_at_gte: '2026-01-01', created_at_lte: '2026-12-31' });
assert.ok(result.created_at[Op.gte] === '2026-01-01');
assert.ok(result.created_at[Op.lte] === '2026-12-31');
console.log('  ✅ Range query (created_at_gte, created_at_lte)');

// 测试3: 模糊查询 - contains
result = parseFilter({ title_contains: '项目' });
assert.deepStrictEqual(result, { title: { [Op.substring]: '项目' } });
console.log('  ✅ Contains query (title_contains)');

// 测试4: 模糊查询 - like (自动添加通配符)
result = parseFilter({ title_like: '项目' });
assert.deepStrictEqual(result, { title: { [Op.like]: '%项目%' } });
console.log('  ✅ Like query with auto-wildcard (title_like)');

// 测试5: 模糊查询 - like (已有通配符)
result = parseFilter({ title_like: '%项目%' });
assert.deepStrictEqual(result, { title: { [Op.like]: '%项目%' } });
console.log('  ✅ Like query with existing wildcard');

// 测试6: IN 查询
result = parseFilter({ status_in: ['active', 'archived'] });
assert.deepStrictEqual(result, { status: { [Op.in]: ['active', 'archived'] } });
console.log('  ✅ IN query (status_in)');

// 测试7: NULL 查询
result = parseFilter({ expert_id_null: true });
assert.deepStrictEqual(result, { expert_id: { [Op.is]: null } });
console.log('  ✅ NULL query (expert_id_null: true)');

result = parseFilter({ expert_id_null: false });
assert.deepStrictEqual(result, { expert_id: { [Op.not]: null } });
console.log('  ✅ NOT NULL query (expert_id_null: false)');

// 测试8: startsWith / endsWith
result = parseFilter({ title_startswith: '项目' });
assert.deepStrictEqual(result, { title: { [Op.startsWith]: '项目' } });
console.log('  ✅ StartsWith query');

result = parseFilter({ title_endswith: '讨论' });
assert.deepStrictEqual(result, { title: { [Op.endsWith]: '讨论' } });
console.log('  ✅ EndsWith query');

// 测试9: between 查询
result = parseFilter({ age_between: [18, 30] });
assert.deepStrictEqual(result, { age: { [Op.between]: [18, 30] } });
console.log('  ✅ Between query');

// 测试10: 字段白名单
result = parseFilter(
  { status: 'active', invalid_field: 'value' },
  { allowedFields: ['status'] }
);
assert.ok(result.status);
assert.ok(!result.invalid_field);
console.log('  ✅ Allowed fields filter');

// 测试11: 字段别名
result = parseFilter(
  { state: 'active' },
  { fieldAliases: { state: 'status' } }
);
assert.ok(result.status);
assert.ok(!result.state);
console.log('  ✅ Field alias');

// 测试12: 跳过 null/undefined
result = parseFilter({ status: 'active', empty: null, missing: undefined });
assert.ok(result.status);
assert.ok(!result.empty);
assert.ok(!result.missing);
console.log('  ✅ Skip null/undefined values');

// 测试13: 布尔值 false 应该保留
result = parseFilter({ is_active: false });
assert.deepStrictEqual(result, { is_active: { [Op.eq]: false } });
console.log('  ✅ Boolean false is preserved');

// 测试14: 空字符串应该保留
result = parseFilter({ name: '' });
assert.deepStrictEqual(result, { name: { [Op.eq]: '' } });
console.log('  ✅ Empty string is preserved');

console.log('');

// ============ parseSort 测试 ============
console.log('📋 Testing parseSort...');

// 测试1: 单字段排序
result = parseSort([{ field: 'created_at', order: 'DESC' }]);
assert.deepStrictEqual(result, [['created_at', 'DESC']]);
console.log('  ✅ Single field sort');

// 测试2: 多字段排序
result = parseSort([
  { field: 'status', order: 'ASC' },
  { field: 'created_at', order: 'DESC' }
]);
assert.deepStrictEqual(result, [['status', 'ASC'], ['created_at', 'DESC']]);
console.log('  ✅ Multi-field sort');

// 测试3: 默认排序
result = parseSort(null);
assert.deepStrictEqual(result, [['created_at', 'DESC']]);
console.log('  ✅ Default sort');

// 测试4: 自定义默认排序
result = parseSort(null, { defaultSort: [['updated_at', 'ASC']] });
assert.deepStrictEqual(result, [['updated_at', 'ASC']]);
console.log('  ✅ Custom default sort');

// 测试5: 排序字段白名单
result = parseSort(
  [{ field: 'created_at', order: 'DESC' }, { field: 'invalid', order: 'ASC' }],
  { allowedFields: ['created_at'] }
);
assert.deepStrictEqual(result, [['created_at', 'DESC']]);
console.log('  ✅ Sort with allowed fields');

// 测试6: 小写 order 自动转换
result = parseSort([{ field: 'created_at', order: 'desc' }]);
assert.deepStrictEqual(result, [['created_at', 'DESC']]);
console.log('  ✅ Lowercase order conversion');

console.log('');

// ============ parsePage 测试 ============
console.log('📋 Testing parsePage...');

// 测试1: 基础分页
result = parsePage({ number: 2, size: 20 });
assert.deepStrictEqual(result, { offset: 20, limit: 20, page: 2, size: 20 });
console.log('  ✅ Basic pagination');

// 测试2: 默认值
result = parsePage(null);
assert.deepStrictEqual(result, { offset: 0, limit: 10, page: 1, size: 10 });
console.log('  ✅ Default pagination');

// 测试3: 最大限制
result = parsePage({ number: 1, size: 200 });
assert.strictEqual(result.size, 100);
assert.strictEqual(result.limit, 100);
console.log('  ✅ Max size limit');

// 测试4: 最小页码
result = parsePage({ number: -1, size: 10 });
assert.strictEqual(result.page, 1);
console.log('  ✅ Min page number');

// 测试5: 自定义默认大小
result = parsePage(null, { defaultSize: 20 });
assert.strictEqual(result.size, 20);
console.log('  ✅ Custom default size');

console.log('');

// ============ parseFields 测试 ============
console.log('📋 Testing parseFields...');

// 测试1: 基础字段选择
result = parseFields(['id', 'title', 'status']);
assert.deepStrictEqual(result, ['id', 'title', 'status']);
console.log('  ✅ Basic fields selection');

// 测试2: 空数组返回 undefined
result = parseFields([]);
assert.strictEqual(result, undefined);
console.log('  ✅ Empty array returns undefined');

// 测试3: null 返回 undefined
result = parseFields(null);
assert.strictEqual(result, undefined);
console.log('  ✅ Null returns undefined');

// 测试4: 字段白名单
result = parseFields(['id', 'title', 'invalid'], { allowedFields: ['id', 'title'] });
assert.deepStrictEqual(result, ['id', 'title']);
console.log('  ✅ Fields with allowed list');

// 测试5: 必须字段
result = parseFields(['title'], { requiredFields: ['id'] });
assert.deepStrictEqual(result, ['id', 'title']);
console.log('  ✅ Required fields are added');

console.log('');

// ============ buildQueryOptions 测试 ============
console.log('📋 Testing buildQueryOptions...');

// 模拟 includeMap
const mockIncludeMap = {
  'User': {
    model: { name: 'User' },
    as: 'user',
    defaultFields: ['id', 'name'],
  },
  'Expert': {
    model: { name: 'Expert' },
    as: 'expert',
    defaultFields: ['id', 'name', 'introduction'],
  },
};

// 测试1: 完整查询构建
const { queryOptions, pagination } = buildQueryOptions(
  {
    filter: { status: 'active', created_at_gte: '2026-01-01' },
    sort: [{ field: 'updated_at', order: 'DESC' }],
    page: { number: 1, size: 20 },
    fields: ['id', 'title', 'status'],
  },
  {
    baseWhere: { user_id: 'user-001' },
    includeMap: mockIncludeMap,
  }
);

assert.ok(queryOptions.where.user_id === 'user-001');
assert.ok(queryOptions.where.status);
assert.ok(queryOptions.where.created_at);
assert.ok(queryOptions.order);
assert.strictEqual(queryOptions.offset, 0);
assert.strictEqual(queryOptions.limit, 20);
assert.ok(queryOptions.attributes);
assert.strictEqual(queryOptions.distinct, true);
assert.deepStrictEqual(pagination, { page: 1, size: 20 });
console.log('  ✅ Full query options build');

// 测试2: 带 include 的查询
const { queryOptions: queryWithInclude } = buildQueryOptions(
  {
    include: ['User', { model: 'Expert', fields: ['id', 'name'] }],
  },
  { includeMap: mockIncludeMap }
);

assert.ok(queryWithInclude.include);
assert.strictEqual(queryWithInclude.include.length, 2);
console.log('  ✅ Query with includes');

console.log('');

// ============ buildPaginatedResponse 测试 ============
console.log('📋 Testing buildPaginatedResponse...');

// 模拟 Sequelize 结果
const mockResult = {
  count: 45,
  rows: [
    { id: 1, title: 'Topic 1' },
    { id: 2, title: 'Topic 2' },
  ],
};

const startTime = Date.now() - 50; // 模拟 50ms 前开始

result = buildPaginatedResponse(
  mockResult,
  { page: 1, size: 10 },
  startTime,
  { includeSummary: true }
);

assert.strictEqual(result.items.length, 2);
assert.strictEqual(result.pagination.page, 1);
assert.strictEqual(result.pagination.size, 10);
assert.strictEqual(result.pagination.total, 45);
assert.strictEqual(result.pagination.pages, 5);
assert.strictEqual(result.pagination.has_next, true);
assert.strictEqual(result.pagination.has_prev, false);
assert.ok(result.summary);
assert.ok(result.summary.took_ms >= 50);
console.log('  ✅ Paginated response build');

// 测试2: 最后一页
result = buildPaginatedResponse(
  { count: 45, rows: [] },
  { page: 5, size: 10 },
  startTime
);
assert.strictEqual(result.pagination.has_next, false);
assert.strictEqual(result.pagination.has_prev, true);
console.log('  ✅ Last page pagination');

console.log('');

// ============ createSimpleWhere 测试 ============
console.log('📋 Testing createSimpleWhere...');

result = createSimpleWhere(
  { status: 'active', expert_id: 'exp-001', invalid: 'value' },
  ['status', 'expert_id']
);
assert.deepStrictEqual(result, { status: 'active', expert_id: 'exp-001' });
console.log('  ✅ Simple where creation');

// 测试: 空字符串被过滤
result = createSimpleWhere(
  { status: '', expert_id: 'exp-001' },
  ['status', 'expert_id']
);
assert.deepStrictEqual(result, { expert_id: 'exp-001' });
console.log('  ✅ Empty string filtered');

console.log('');

// ============ validateFilterFields 测试 ============
console.log('📋 Testing validateFilterFields...');

// 测试: 有效字段
try {
  validateFilterFields({ status: 'active' }, ['status', 'created_at']);
  console.log('  ✅ Valid fields pass');
} catch (e) {
  console.log('  ❌ Valid fields should pass');
}

// 测试: 无效字段
try {
  validateFilterFields({ invalid_field: 'value' }, ['status']);
  console.log('  ❌ Invalid fields should throw');
} catch (e) {
  assert.ok(e.message.includes('Invalid filter field'));
  console.log('  ✅ Invalid fields throw error');
}

// 测试: 带操作符后缀的字段
try {
  validateFilterFields({ status_in: ['active'] }, ['status']);
  console.log('  ✅ Suffix fields validated correctly');
} catch (e) {
  console.log('  ❌ Suffix fields should be validated');
}

console.log('');

// ============ OPERATOR_SUFFIX_MAP 测试 ============
console.log('📋 Testing OPERATOR_SUFFIX_MAP...');

assert.ok(OPERATOR_SUFFIX_MAP['_eq'] === Op.eq);
assert.ok(OPERATOR_SUFFIX_MAP['_gte'] === Op.gte);
assert.ok(OPERATOR_SUFFIX_MAP['_in'] === Op.in);
assert.ok(OPERATOR_SUFFIX_MAP['_like'] === Op.like);
console.log('  ✅ Operator suffix map is correct');

console.log('\n✅ All tests passed!\n');
