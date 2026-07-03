/**
 * 清洗阶段表格格式修复 — 样本验证脚本
 * 覆盖审计报告要求的 4 类坏表样本
 * 用法：node tests/table-repair-samples.mjs
 */

import DocumentCleanService from '../lib/document-clean-service.js';

// 创建一个最小化的 service 实例用于测试（不需要 db）
const service = new DocumentCleanService(null);

let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✓ ${description}`);
  } else {
    failed++;
    console.log(`  ✗ ${description}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function runSample(name, input, expected) {
  console.log(`\n${name}`);
  const result = service.normalizeMarkdownTable(input);
  assert('output matches expected', result, expected);
}

// ── 样本 1: 列数少 1-2 列（缺损） ──
runSample(
  '样本1: 列数缺损 — 部分数据行缺少1列',
  [
    '| 姓名 | 部门 | 职位 | 入职日期 |',
    '|------|------|------|----------|',
    '| 张三 | 技术部 | 工程师 | 2020-01-15 |',
    '| 李四 | 市场部 |',                           // 缺少 2 列
    '| 王五 | 财务部 | 经理 | 2019-06-01 |',
    '| 赵六 |',                                     // 缺少 3 列
  ].join('\n'),
  [
    '| 姓名 | 部门 | 职位 | 入职日期 |',
    '| --- | --- | --- | --- |',
    '| 张三 | 技术部 | 工程师 | 2020-01-15 |',
    '| 李四 | 市场部 |  |  |',
    '| 王五 | 财务部 | 经理 | 2019-06-01 |',
    '| 赵六 |  |  |  |',
  ].join('\n')
);

// ── 样本 2: 列数多 1-3 列（OCR 串行） ──
runSample(
  '样本2: 列数溢出(串行) — 部分数据行多出列',
  [
    '| 产品 | 规格 | 单价 |',
    '|------|------|------|',
    '| A001 | 100ml | 25.00 |',
    '| A002 | 200ml | 30.00 | 赠品 |',              // 多出 1 列（串行）
    '| A003 | 500ml | 45.00 | 新品 | 热销 |',       // 多出 2 列
    '| A004 | 50ml | 15.00 |',
  ].join('\n'),
  [
    '| 产品 | 规格 | 单价 |',
    '| --- | --- | --- |',
    '| A001 | 100ml | 25.00 |',
    '| A002 | 200ml | 30.00 赠品 |',                // 超出的并入最后一列
    '| A003 | 500ml | 45.00 新品 热销 |',
    '| A004 | 50ml | 15.00 |',
  ].join('\n')
);

// ── 样本 3: 分隔行缺失或异常 ──
runSample(
  '样本3a: 分隔行缺失 — 表头后直接跟数据行',
  [
    '| 序号 | 文件名 | 大小 |',
    '| 1 | report.pdf | 2.3MB |',
    '| 2 | data.xlsx | 1.1MB |',
    '| 3 | notes.txt | 0.5MB |',
  ].join('\n'),
  [
    '| 序号 | 文件名 | 大小 |',
    '| --- | --- | --- |',
    '| 1 | report.pdf | 2.3MB |',
    '| 2 | data.xlsx | 1.1MB |',
    '| 3 | notes.txt | 0.5MB |',
  ].join('\n')
);

runSample(
  '样本3b: 分隔行异常 — 分隔符不是标准 --- 格式',
  [
    '| 城市 | 人口 | 面积 |',
    '| 北京 | 2154万 | 16410 |',                     // 分隔行被替换成了数据行
    '| 上海 | 2487万 | 6340 |',
    '| 广州 | 1868万 | 7434 |',
  ].join('\n'),
  [
    '| 城市 | 人口 | 面积 |',
    '| --- | --- | --- |',
    '| 北京 | 2154万 | 16410 |',
    '| 上海 | 2487万 | 6340 |',
    '| 广州 | 1868万 | 7434 |',
  ].join('\n')
);

// ── 样本 4: 正常表格 — 不应被改动（happy path 快速通过） ──
runSample(
  '样本4: 正常表格 — 不应被错误修改（回归验证）',
  [
    '| 项目 | 预算 | 实际 | 差异 |',
    '|------|------|------|------|',
    '| Q1 | 100 | 95 | -5 |',
    '| Q2 | 120 | 130 | +10 |',
    '| Q3 | 110 | 108 | -2 |',
  ].join('\n'),
  [
    '| 项目 | 预算 | 实际 | 差异 |',
    '| --- | --- | --- | --- |',
    '| Q1 | 100 | 95 | -5 |',
    '| Q2 | 120 | 130 | +10 |',
    '| Q3 | 110 | 108 | -2 |',
  ].join('\n')
);

// ── 边界情况 ──
runSample(
  '边界: 单行表格 — 保持原样回退',
  '| 单列 |',
  '| 单列 |'
);

console.log(`\n${'='.repeat(50)}`);
console.log(`结果: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  process.exit(1);
}
