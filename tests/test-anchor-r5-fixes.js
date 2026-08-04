/**
 * R5 回归验证：测试 _buildCharNormMap 全量去空白 + _findFuzzy end 修正
 * 用法: node tests/test-anchor-r5-fixes.js
 */

import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 动态 import service.js（ESM）
const servicePath = pathToFileURL(path.resolve(__dirname, '../apps/standard-mgr/server/service.js')).href;
const { default: StandardMgrService } = await import(servicePath);

// 创建一个最小化的 mock db（只测试纯算法，不触发 DB）
const mockDb = {
  query: async () => [[]],
  getOne: async () => null,
  execute: async () => ({}),
  beginTransaction: async () => ({}),
  commit: async () => {},
  rollback: async () => {},
};
const svc = new StandardMgrService(mockDb);

let passed = 0;
let failed = 0;

function assert(desc, condition) {
  if (condition) { passed++; console.log(`  ✅ ${desc}`); }
  else { failed++; console.error(`  ❌ ${desc}`); }
}

// ═══════════════════════════════════════
// R5-1: _buildCharNormMap 全量去空白
// ═══════════════════════════════════════

console.log('\n── R5-1: _buildCharNormMap 全量去空白 ──');

// Case N1-a: ASCII↔CJK 边界空格（核心回归 case）
{
  const { normalized } = svc._buildCharNormMap('按ISO 7637-1 规定的试验');
  assert('N1-a: ASCII↔CJK space removed', normalized === '按ISO7637-1规定的试验');
}
{
  const { normalized } = svc._buildCharNormMap('按ISO 7637-1规定的试验');
  assert('N1-a2: no-space variant same output', normalized === '按ISO7637-1规定的试验');
}

// Case: CJK-CJK 间空格（原有能力不能退化）
{
  const { normalized } = svc._buildCharNormMap('试 验');
  assert('CJK-CJK space removed', normalized === '试验');
}

// Case: 全角空格
{
  const { normalized } = svc._buildCharNormMap('按\u3000ISO 7637-1');
  assert('fullwidth space removed', normalized === '按ISO7637-1');
}

// Case: 换行
{
  const { normalized } = svc._buildCharNormMap('按ISO\n7637-1');
  assert('newline removed', normalized === '按ISO7637-1');
}

// Case: 全角→半角 映射（验证 FW_MAP 依然生效 — 仅限标点符号）
{
  const { normalized } = svc._buildCharNormMap('必\u3000须，符合ISO：7637-1。要求');
  // \u3000→空格(被去白)  ，→,  ：→:  。→.
  assert('fullwidth→halfwidth mapping', normalized === '必须,符合ISO:7637-1.要求');
}

// origPos 映射正确性
{
  const { normalized, origPos } = svc._buildCharNormMap('按ISO 7637-1 规定');
  // 原文:  按 I S O   7 6 3 7 - 1   规 定
  // 索引:  0  1 2 3 4 5 6 7 8 9 10 11 12 13
  // norm:  按 I S O 7 6 3 7 - 1 规 定
  // oPos:  0  1 2 3 5 6 7 8 9 10 12 13
  assert('origPos: 按→0', origPos[0] === 0);
  assert('origPos: ISO→1,2,3', origPos[1] === 1 && origPos[2] === 2 && origPos[3] === 3);
  assert('origPos: 7→5 (跳过空格)', origPos[4] === 5);
  assert('origPos: 规→12 (跳过空格)', normalized.indexOf('规') > 0 && origPos[normalized.indexOf('规')] === 12);
}

// ═══════════════════════════════════════
// R5-2: _findFuzzy end 修正
// ═══════════════════════════════════════

console.log('\n── R5-2: _findFuzzy end 修正 ──');

// Case N2: end 不应跳过匹配区间后的空白
{
  const text = '按ISO 7637-1 规定的试验\n标准要求';
  const result = svc._findFuzzy(text, 'ISO 7637-1');
  assert('N2: finds match', result !== null);
  if (result) {
    // "ISO 7637-1" 在原文中：按ISO 7637-1 规定的试验
    //  位置:  I=1, 空格=10
    // 归一化后 "ISO7637-1" 在位置 1-8（原文index 1,2,3,5,6,7,8,9,10）
    // end 应为最后一个字符 "-1" 位置 (10) + 1 = 11（即空格处）
    assert('N2: end points right after match (not past whitespace)',
      result.end === 11);
    console.log(`    pos=${result.pos}, end=${result.end}, expected end=11`);
  }
}

// Case: 匹配在最末尾
{
  const text = '标准要求见ISO 7637-1';
  const result = svc._findFuzzy(text, 'ISO 7637-1');
  assert('end-at-boundary: finds match', result !== null);
  if (result) {
    assert('end-at-boundary: end === text.length',
      result.end === text.length);
    console.log(`    pos=${result.pos}, end=${result.end}, expected=${text.length}`);
  }
}

// Case: fromIndex 偏移
{
  const text = '第一处ISO 7637-1规定；第二处ISO 7637-1要求';
  const r1 = svc._findFuzzy(text, 'ISO 7637-1');
  const r2 = svc._findFuzzy(text, 'ISO 7637-1', r1.end);
  assert('fromIndex second match', r2 !== null && r2.pos > r1.pos);
}

// ═══════════════════
// 汇总
// ═══════════════════

console.log(`\n${'='.repeat(40)}`);
console.log(`  ✅ ${passed} passed  ❌ ${failed} failed`);
console.log(`${'='.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
