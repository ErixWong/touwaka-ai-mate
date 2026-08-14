/**
 * 文档访问权限语义矩阵测试（task-20260814 审计 P0-1.1）
 *
 * 覆盖修复点：DocAccessService.getAccessibleCollectionIds 原先自建部门可见性规则，
 * 遗漏 department_scope 判定，导致 scope=self 的上游部门集合被下级部门用户越权读取。
 * 修复后委托 CollectionAccessService.buildAccessibleCollectionsWhere，语义唯一。
 *
 * 测试目标：
 *   1. 语义正确性：部门可见性矩阵（self / self_and_descendants / public / owner）
 *   2. 一致性：DocAccessService 与 CollectionAccessService 对同一矩阵给出相同结果
 *
 * 运行：node tests/doc-access-permission.test.js
 * 前置：临时 stub 位于 lib/node_modules/sequelize（测试后删除）
 */

import { Op } from '../lib/node_modules/sequelize/index.js';
import DocAccessService from '../lib/doc-access-service.js';
import CollectionAccessService from '../lib/collection-access-service.js';

let passed = 0;
let failed = 0;

function assert(cond, name, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    console.error(`  ❌ ${name} ${detail}`);
  }
}

// ============================================================
// 迷你 Sequelize where 求值器（仅支持本测试矩阵用到的操作符）
// ============================================================

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function evaluateWhere(where, record) {
  if (where == null) return true;

  // 本层级 Symbol 操作符（Op.or / Op.and），与普通字段条件同时生效（AND 关系）
  for (const sym of Object.getOwnPropertySymbols(where)) {
    if (sym === Op.or) {
      if (!where[sym].some(b => evaluateWhere(b, record))) return false;
    } else if (sym === Op.and) {
      if (!where[sym].every(b => evaluateWhere(b, record))) return false;
    } else {
      throw new Error(`Unsupported top-level operator: ${String(sym)}`);
    }
  }

  // 普通字段条件
  for (const [field, value] of Object.entries(where)) {
    const recordValue = record[field];
    if (isPlainObject(value)) {
      const inKey = Object.getOwnPropertySymbols(value).find(s => s === Op.in);
      if (inKey) {
        if (!(Array.isArray(value[inKey]) && value[inKey].includes(recordValue))) return false;
        continue;
      }
      const eqKey = Object.getOwnPropertySymbols(value).find(s => s === Op.eq);
      if (eqKey) {
        if (recordValue !== value[eqKey]) return false;
        continue;
      }
      const likeKey = Object.getOwnPropertySymbols(value).find(s => s === Op.like);
      if (likeKey) {
        const pattern = String(value[likeKey]);
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`);
        if (!re.test(String(recordValue ?? ''))) return false;
        continue;
      }
      throw new Error(`Unsupported operator in where: ${Object.getOwnPropertySymbols(value).map(String).join(',')}`);
    }
    if (recordValue !== value) return false;
  }
  return true;
}

// ============================================================
// Mock DB
// ============================================================

function makeDb({ users, departments, collections }) {
  const models = {
    user: {
      findOne: async ({ where }) => {
        const key = where.id || where.id;
        const user = users.find(u => u.id === key);
        return user ? { ...user } : null;
      },
    },
    department: {
      findOne: async ({ where }) => {
        const dept = departments.find(d => d.id === where.id);
        return dept ? { ...dept } : null;
      },
    },
    document_collection: {
      findAll: async ({ where }) => {
        return collections.filter(c => evaluateWhere(where, c)).map(c => ({ ...c }));
      },
      findOne: async ({ where }) => {
        const found = collections.find(c => evaluateWhere(where, c));
        return found ? { ...found } : null;
      },
    },
    document: {
      findOne: async () => null,
      findAll: async () => [],
    },
  };
  return {
    getModel: (name) => models[name],
    sequelize: {},
  };
}

// ============================================================
// 测试矩阵
// ============================================================

async function run() {
  console.log('\n[P0-1.1] 部门可见性语义矩阵（用户部门 B，path=/A/B）\n');

  const departments = [
    { id: 'deptA', path: '/deptA' },
    { id: 'deptB', path: '/deptA/deptB' },
    { id: 'deptC', path: '/deptC' },
  ];

  const users = [
    { id: 'u1', department_id: 'deptB' },   // B 部门用户（A 的下级）
    { id: 'u2', department_id: null },       // 无部门用户
    { id: 'u3', department_id: 'deptA' },    // A 部门用户
  ];

  // 集合矩阵
  const collections = [
    { id: 'c1', owner_id: 'u1', visibility: 'private', department_id: 'deptB', department_scope: null },      // u1 私有
    { id: 'c2', owner_id: 'u99', visibility: 'public', department_id: null, department_scope: null },          // 公共
    { id: 'c3', owner_id: 'u99', visibility: 'department', department_id: 'deptA', department_scope: 'self' }, // A 本部门私有（上级）
    { id: 'c4', owner_id: 'u99', visibility: 'department', department_id: 'deptB', department_scope: 'self' }, // B 本部门私有（本部门）
    { id: 'c5', owner_id: 'u99', visibility: 'department', department_id: 'deptA', department_scope: 'self_and_descendants' }, // A 及下级
    { id: 'c6', owner_id: 'u99', visibility: 'department', department_id: 'deptC', department_scope: 'self_and_descendants' }, // C 及下级（无关）
    { id: 'c7', owner_id: 'u99', visibility: 'department', department_id: 'deptB', department_scope: null },   // B 部门、scope 为空（按 self）
    { id: 'c8', owner_id: 'u99', visibility: 'department', department_id: 'deptA', department_scope: null },   // A 部门、scope 为空（按 self）
    { id: 'c9', owner_id: 'u2', visibility: 'private', department_id: null, department_scope: null },          // u2 私有
  ];

  const db = makeDb({ users, departments, collections });
  const docAccess = new DocAccessService(db);
  const collectionAccess = new CollectionAccessService(db);

  // ---- u1（B 部门，A 的下级）----
  const u1Expected = new Set(['c1', 'c2', 'c4', 'c5', 'c7']); // owner/公共/本部门self/上级self_and_descendants
  const u1Doc = new Set(await docAccess.getAccessibleCollectionIds('u1'));
  const u1CollWhere = await collectionAccess.buildAccessibleCollectionsWhere('u1');
  const u1Coll = new Set(collections.filter(c => evaluateWhere(u1CollWhere, c)).map(c => c.id));

  assert(
    JSON.stringify([...u1Doc].sort()) === JSON.stringify([...u1Expected].sort()),
    `u1 可访问集合 === 期望集 ${JSON.stringify([...u1Expected].sort())}`,
    `实际: ${JSON.stringify([...u1Doc].sort())}`
  );
  assert(!u1Doc.has('c3'), 'u1 不能读 A 部门 scope=self 的集合 c3（越权修复点）');
  assert(!u1Doc.has('c6'), 'u1 不能读无关部门 C 的集合 c6');
  assert(!u1Doc.has('c8'), 'u1 不能读 A 部门 scope 为空的集合 c8（空 scope 按 self）');
  assert(
    JSON.stringify([...u1Doc].sort()) === JSON.stringify([...u1Coll].sort()),
    'u1：DocAccessService 与 CollectionAccessService 结果一致',
    `doc=${JSON.stringify([...u1Doc].sort())} coll=${JSON.stringify([...u1Coll].sort())}`
  );

  // ---- u2（无部门）----
  const u2Expected = new Set(['c2', 'c9']); // 只能看 public + 自己的私有集合
  const u2Doc = new Set(await docAccess.getAccessibleCollectionIds('u2'));
  const u2CollWhere = await collectionAccess.buildAccessibleCollectionsWhere('u2');
  const u2Coll = new Set(collections.filter(c => evaluateWhere(u2CollWhere, c)).map(c => c.id));

  assert(
    JSON.stringify([...u2Doc].sort()) === JSON.stringify([...u2Expected].sort()),
    `u2（无部门）可访问集合 === 期望集 ${JSON.stringify([...u2Expected].sort())}`,
    `实际: ${JSON.stringify([...u2Doc].sort())}`
  );
  assert(
    JSON.stringify([...u2Doc].sort()) === JSON.stringify([...u2Coll].sort()),
    'u2：DocAccessService 与 CollectionAccessService 结果一致'
  );

  // ---- u3（A 部门，上级）----
  const u3Expected = new Set(['c2', 'c3', 'c5', 'c8']); // public + A 本部门 self + A 及下级 self_and_descendants + A 空 scope
  const u3Doc = new Set(await docAccess.getAccessibleCollectionIds('u3'));
  const u3CollWhere = await collectionAccess.buildAccessibleCollectionsWhere('u3');
  const u3Coll = new Set(collections.filter(c => evaluateWhere(u3CollWhere, c)).map(c => c.id));

  assert(
    JSON.stringify([...u3Doc].sort()) === JSON.stringify([...u3Expected].sort()),
    `u3（A 部门）可访问集合 === 期望集 ${JSON.stringify([...u3Expected].sort())}`,
    `实际: ${JSON.stringify([...u3Doc].sort())}`
  );
  assert(
    JSON.stringify([...u3Doc].sort()) === JSON.stringify([...u3Coll].sort()),
    'u3：DocAccessService 与 CollectionAccessService 结果一致'
  );

  console.log(`\n结果: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
