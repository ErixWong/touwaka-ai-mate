/**
 * test-title-extraction.mjs — 标题提取与回写规则验证脚本
 *
 * 验证 document-clean-service.js 中 _extractTitleFromCleanedText 和 _tryWriteBackTitle 的规则。
 * 可独立运行，不依赖数据库或服务启动。
 *
 * 用法：node tests/test-title-extraction.mjs
 */

// 从 document-clean-service.js 移植的标题提取逻辑（保持完全一致）
function extractTitleFromCleanedText(cleanedText) {
  if (!cleanedText || !cleanedText.trim()) return null;

  const lines = cleanedText.split(/\r?\n/);

  // 策略 1：第一个 H1 标题
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) {
      const title = h1Match[1].trim();
      if (title.length > 0 && title.length <= 200) return title;
    }
  }

  // 策略 2：第一个有意义的非空行
  const NON_TITLE_PATTERNS = [
    /^---\s*$/,
    /^\s*[-–—]+\s*$/,
    /^\d{1,4}\s*$/,
    /^第[一二三四五六七八九十\d]+页\s*$/,
    /^\[?\[TABLE_BLOCK_\d+\]\]?\s*$/,
    /^\[?\[FORMULA_(BLOCK|INLINE)_\d+\]\]?\s*$/,
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (NON_TITLE_PATTERNS.some(p => p.test(trimmed))) continue;
    if (trimmed.length <= 200) return trimmed;
    return trimmed.substring(0, 200);
  }

  return null;
}

function shouldWriteBack(currentTitle, extractedTitle) {
  const isPlaceholder = /^(Intake|Document)\s+\w+/i.test(currentTitle);
  const hasChinese = /[\u4e00-\u9fff]/.test(currentTitle);

  if (!isPlaceholder && hasChinese) {
    return { write: false, reason: '已经含中文 → 视为已定稿' };
  }
  if (!isPlaceholder && !hasChinese) {
    return { write: false, reason: '非占位非中文 → 保守跳过（可能是英文文档名或用户手改）' };
  }
  if (isPlaceholder && extractedTitle) {
    return { write: true, reason: `占位值 "${currentTitle}" → 回写为 "${extractedTitle}"` };
  }
  return { write: false, reason: '未满足回写条件' };
}

// 测试用例
const testCases = [
  // 场景 1：H1 标题提取
  {
    name: 'H1 标题在清洗后文本首行',
    text: '# 汽车车身术语 GB/T 4780—2020\n\n## 1 范围\n本文适用于...',
    expectedTitle: '汽车车身术语 GB/T 4780—2020',
  },
  // 场景 2：无 H1，首行有意义文本
  {
    name: '无 H1，首行即是文档标题',
    text: '汽车车身术语\n\n一、范围\n本标准规定了...',
    expectedTitle: '汽车车身术语',
  },
  // 场景 3：跳过 YAML front matter
  {
    name: '跳过 YAML front matter 分隔符',
    text: '---\n# 合同管理办法\n\n第一条...',
    expectedTitle: '合同管理办法',
  },
  // 场景 4：跳过页码
  {
    name: '跳过纯页码行',
    text: '1\n# 采购合同\n\n甲方：',
    expectedTitle: '采购合同',
  },
  // 场景 5：跳过表格占位符
  {
    name: '跳过 TABLE_BLOCK 占位符',
    text: '[[TABLE_BLOCK_1]]\n设备采购技术规范\n\n1. 总则',
    expectedTitle: '设备采购技术规范',
  },
  // 场景 6：空文本
  {
    name: '空文本',
    text: '',
    expectedTitle: null,
  },
  // 场景 7：纯占位符文本
  {
    name: '只有占位符的文本',
    text: '[[TABLE_BLOCK_1]]\n[[FORMULA_INLINE_1]]\n\n# 终于有标题了',
    expectedTitle: '终于有标题了',
  },
  // 场景 8：H1 后紧跟无意义行
  {
    name: 'H1 后的内容再复杂',
    text: '# 2024年度审计报告\n\n审计单位：XX会计师事务所\n\n一、审计意见',
    expectedTitle: '2024年度审计报告',
  },
];

// ——— 标题提取测试 ———
console.log('='.repeat(60));
console.log('P1-3 标题提取规则验证');
console.log('='.repeat(60));

let passCount = 0;
let failCount = 0;

for (const tc of testCases) {
  const result = extractTitleFromCleanedText(tc.text);
  const pass = result === tc.expectedTitle;
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${tc.name}`);
  if (!pass) {
    console.log(`   期望: ${JSON.stringify(tc.expectedTitle)}`);
    console.log(`   实际: ${JSON.stringify(result)}`);
    failCount++;
  } else {
    passCount++;
  }
}

console.log(`\n提取测试: ${passCount} 通过 / ${failCount} 失败 / ${testCases.length} 总计`);

// ——— 回写规则测试 ———
console.log('\n' + '='.repeat(60));
console.log('回写规则验证');
console.log('='.repeat(60));

const writeTests = [
  { current: 'Intake src_abc123', extracted: '采购合同', expectWrite: true, desc: '占位值 Intake xxx → 应回写' },
  { current: 'Document src_xyz789', extracted: '技术规范', expectWrite: true, desc: '占位值 Document xxx → 应回写' },
  { current: '采购合同管理办法', extracted: '采购合同', expectWrite: false, desc: '中文标题 → 不应覆盖' },
  { current: 'contract_2024_v2', extracted: '采购合同', expectWrite: false, desc: '非占位非中文 → 保守跳过' },
  { current: 'Intake src_def456', extracted: null, expectWrite: false, desc: '占位值但提取失败 → 不应回写' },
  { current: 'GB/T 4780 汽车车身术语', extracted: '汽车车身术语', expectWrite: false, desc: '已含中文的正式标题 → 不覆盖' },
];

let writePass = 0;
let writeFail = 0;
for (const wt of writeTests) {
  const result = shouldWriteBack(wt.current, wt.extracted);
  const pass = result.write === wt.expectWrite;
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${wt.desc}`);
  if (!pass) {
    console.log(`   current: "${wt.current}", extracted: "${wt.extracted}"`);
    console.log(`   期望 write=${wt.expectWrite}, 实际 write=${result.write}`);
    writeFail++;
  } else {
    writePass++;
  }
}

console.log(`\n回写测试: ${writePass} 通过 / ${writeFail} 失败 / ${writeTests.length} 总计`);

// 总结
const totalPass = passCount + writePass;
const totalFail = failCount + writeFail;
const totalTests = testCases.length + writeTests.length;
console.log('\n' + '='.repeat(60));
console.log(`总计: ${totalPass} 通过 / ${totalFail} 失败 / ${totalTests} 总计`);
if (totalFail > 0) process.exit(1);
