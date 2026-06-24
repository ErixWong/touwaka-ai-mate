const BASE_URL = 'http://localhost:3000';
const RESULTS = {
  newPrefix: [],
  legacyPrefix: [],
  assertions: []
};

async function getAuthToken() {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'password123' })
  });
  const data = await resp.json();
  if (data.code !== 200) throw new Error('Login failed: ' + data.message);
  return data.data.access_token;
}

async function testEndpoint(category, name, method, path, token, expectStatus, body = null) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  
  const url = `${BASE_URL}${path}`;
  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);
  
  const resp = await fetch(url, options);
  const status = resp.status;
  const data = await resp.json().catch(() => ({}));
  const deprecatedHeader = resp.headers.get('X-Deprecated');
  
  const allowed = Array.isArray(expectStatus) ? expectStatus : [expectStatus];
  const passed = allowed.includes(status);
  RESULTS[category].push({ 
    name, method, path, expected: expectStatus, actual: status, passed, 
    deprecated: deprecatedHeader,
    data 
  });
  
  const deprecatedMark = deprecatedHeader ? ' [DEPRECATED]' : '';
  console.log(`${passed ? '✅' : '❌'} ${name}: ${status} (expected ${allowed.join(' or ')})${deprecatedMark}`);
  return { passed, data, status, deprecated: deprecatedHeader };
}

function assertDeprecatedHeader(result, testName) {
  const passed = result.deprecated === 'true';
  RESULTS.assertions.push({
    name: testName,
    expected: 'X-Deprecated: true',
    actual: result.deprecated || '(not set)',
    passed
  });
  
  if (!passed) {
    console.log(`❌ ${testName}: X-Deprecated header not set (expected 'true', got '${result.deprecated || '(not set)'}')`);
  } else {
    console.log(`✅ ${testName}: X-Deprecated header correctly set`);
  }
  
  return passed;
}

async function runTests() {
  console.log('=== Current Feature Analyzer 前缀迁移验证 ===\n');
  
  let token;
  try {
    token = await getAuthToken();
    console.log('✅ 登录成功\n');
  } catch (e) {
    console.log('❌ 登录失败:', e.message);
    console.log('\n请确保服务器已启动 (node server/index.js)');
    return;
  }

  console.log('--- Part 0: 新前缀 /api/current-feature-analyzer/* (Phase 1 主目标) ---');
  
  await testEndpoint('newPrefix', '新前缀：获取规则集列表', 'GET', '/api/current-feature-analyzer/rule-sets', token, 200);
  await testEndpoint('newPrefix', '新前缀：获取配置', 'GET', '/api/current-feature-analyzer/config', token, [200, 404]);

  const ruleSetsResp = await fetch(`${BASE_URL}/api/current-feature-analyzer/rule-sets`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const ruleSetsData = await ruleSetsResp.json();
  const ruleSets = ruleSetsData.data?.items || [];

  if (ruleSets.length > 0) {
    const ruleSetId = ruleSets[0].id;
    console.log(`使用规则集 ID: ${ruleSetId}\n`);
    await testEndpoint('newPrefix', '新前缀：获取规则集详情', 'GET', `/api/current-feature-analyzer/rule-sets/${ruleSetId}`, token, 200);
  } else {
    console.log('⚠️ 无现有规则集，跳过规则集详情测试');
  }

  console.log('\n--- Part 1: Legacy 兼容层 /api/apps/current-feature-analyzer/* ---');
  
  const legacyResult1 = await testEndpoint('legacyPrefix', 'Legacy：获取规则集列表', 'GET', '/api/apps/current-feature-analyzer/rule-sets', token, 200);
  const legacyResult2 = await testEndpoint('legacyPrefix', 'Legacy：获取配置', 'GET', '/api/apps/current-feature-analyzer/config', token, [200, 404]);

  console.log('\n--- Part 1.5: Deprecated Header 断言 ---');
  assertDeprecatedHeader(legacyResult1, 'Legacy 规则集列表 deprecated header');
  assertDeprecatedHeader(legacyResult2, 'Legacy 配置 deprecated header');

  if (ruleSets.length > 0) {
    const ruleSetId = ruleSets[0].id;
    const legacyDetailResult = await testEndpoint('legacyPrefix', 'Legacy：获取规则集详情', 'GET', `/api/apps/current-feature-analyzer/rule-sets/${ruleSetId}`, token, 200);
    assertDeprecatedHeader(legacyDetailResult, 'Legacy 规则集详情 deprecated header');
  }

  console.log('\n--- Part 2: 前缀响应一致性验证 ---');
  
  const newPrefixRuleSets = RESULTS.newPrefix.find(r => r.name === '新前缀：获取规则集列表');
  const legacyRuleSets = RESULTS.legacyPrefix.find(r => r.name === 'Legacy：获取规则集列表');
  
  if (newPrefixRuleSets && legacyRuleSets && newPrefixRuleSets.data && legacyRuleSets.data) {
    const newItems = newPrefixRuleSets.data?.data?.items || [];
    const legacyItems = legacyRuleSets.data?.data?.items || [];
    
    const consistencyPassed = JSON.stringify(newItems) === JSON.stringify(legacyItems);
    RESULTS.assertions.push({
      name: '新旧前缀规则集列表响应一致性',
      expected: 'JSON.stringify 相等',
      actual: consistencyPassed ? '一致' : '不一致',
      passed: consistencyPassed
    });
    
    if (consistencyPassed) {
      console.log('✅ 新旧前缀规则集列表响应一致');
    } else {
      console.log('❌ 新旧前缀规则集列表响应不一致');
      console.log(`   新前缀 items count: ${newItems.length}`);
      console.log(`   Legacy items count: ${legacyItems.length}`);
    }
  }

  console.log('\n=== 测试结果汇总 ===');
  
  const newPrefixPassed = RESULTS.newPrefix.filter(r => r.passed).length;
  const newPrefixFailed = RESULTS.newPrefix.filter(r => !r.passed).length;
  const legacyPassed = RESULTS.legacyPrefix.filter(r => r.passed).length;
  const legacyFailed = RESULTS.legacyPrefix.filter(r => !r.passed).length;
  const assertionsPassed = RESULTS.assertions.filter(r => r.passed).length;
  const assertionsFailed = RESULTS.assertions.filter(r => !r.passed).length;
  
  console.log(`\n新前缀测试: 通过 ${newPrefixPassed}, 失败 ${newPrefixFailed}`);
  console.log(`Legacy 兼容层: 通过 ${legacyPassed}, 失败 ${legacyFailed}`);
  console.log(`断言检查: 通过 ${assertionsPassed}, 失败 ${assertionsFailed}`);
  
  const totalFailed = newPrefixFailed + legacyFailed + assertionsFailed;
  if (totalFailed > 0) {
    console.log('\n❌ 存在失败项，详见上方输出');
    console.log('\n失败的测试项:');
    RESULTS.newPrefix.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.actual} (expected ${r.expected})`));
    RESULTS.legacyPrefix.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.actual} (expected ${r.expected})`));
    RESULTS.assertions.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.actual} (expected ${r.expected})`));
  } else {
    console.log('\n✅ 所有测试通过');
    console.log('\n--- Phase 1 验证结论 ---');
    console.log('/api/current-feature-analyzer/* 新前缀可用');
    console.log('/api/apps/current-feature-analyzer/* legacy 兼容层可用并带有 deprecated 标记');
  }
}

runTests().catch(e => console.error('测试执行错误:', e));