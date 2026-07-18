/**
 * CFA wildcard 路由验证脚本
 *
 * 验证目标：
 *   1. 正式前缀 /api/apps/current-feature-analyzer/* 可用
 *   2. rule-sets 与 config 响应结构符合统一契约
 *
 * 运行前置条件：
 *   - 必须先启动后端服务：npm run api 或 node server/index.js
 *   - 默认连接地址：http://localhost:3017
 *   - 需要有效的登录账号（默认使用 admin/password123）
 *   - 数据库中需有可用的 mini_apps 记录
 *
 * 使用方法：
 *   node scripts/test-current-feature-analyzer-prefix.js
 */
const BASE_URL = 'http://localhost:3017';
const RESULTS = {
  appPrefix: [],
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
  const allowed = Array.isArray(expectStatus) ? expectStatus : [expectStatus];
  const passed = allowed.includes(status);
  RESULTS[category].push({ 
    name, method, path, expected: expectStatus, actual: status, passed, 
    data 
  });
  console.log(`${passed ? '✅' : '❌'} ${name}: ${status} (expected ${allowed.join(' or ')})`);
  return { passed, data, status };
}

async function runTests() {
  console.log('=== Current Feature Analyzer wildcard 路由验证 ===\n');
  
  let token;
  try {
    token = await getAuthToken();
    console.log('✅ 登录成功\n');
  } catch (e) {
    console.log('❌ 登录失败:', e.message);
    console.log('\n前置条件检查：');
    console.log('  1. 请确保后端服务已启动：npm run api 或 node server/index.js');
    console.log('  2. 默认连接地址：http://localhost:3017（如端口不同需修改脚本中 BASE_URL）');
    console.log('  3. 确保数据库中有 admin 账号且密码为 password123（或修改脚本中登录凭据）');
    return;
  }

  console.log('--- Part 1: /api/apps/current-feature-analyzer/* ---');

  await testEndpoint('appPrefix', '规则集列表', 'GET', '/api/apps/current-feature-analyzer/rule-sets', token, 200);
  await testEndpoint('appPrefix', '读取配置', 'GET', '/api/apps/current-feature-analyzer/config', token, [200, 404]);

  const ruleSetsResp = await fetch(`${BASE_URL}/api/apps/current-feature-analyzer/rule-sets`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const ruleSetsData = await ruleSetsResp.json();
  const ruleSets = ruleSetsData.data?.items || [];

  if (ruleSets.length > 0) {
    const ruleSetId = ruleSets[0].id;
    console.log(`使用规则集 ID: ${ruleSetId}\n`);
    await testEndpoint('appPrefix', '规则集详情', 'GET', `/api/apps/current-feature-analyzer/rule-sets/${ruleSetId}`, token, 200);
  } else {
    console.log('⚠️ 无现有规则集，跳过规则集详情测试');
  }

  console.log('\n--- Part 2: 响应契约断言 ---');
  const ruleSetsResult = RESULTS.appPrefix.find(r => r.name === '规则集列表');
  const hasStandardEnvelope = !!ruleSetsResult?.data && typeof ruleSetsResult.data.code === 'number' && 'data' in ruleSetsResult.data;
  RESULTS.assertions.push({
    name: '规则集列表响应结构',
    expected: '包含 code/message/data',
    actual: hasStandardEnvelope ? '符合' : '不符合',
    passed: hasStandardEnvelope,
  });

  if (hasStandardEnvelope) {
    console.log('✅ 规则集列表响应结构符合统一契约');
  } else {
    console.log('❌ 规则集列表响应结构不符合统一契约');
  }

  console.log('\n=== 测试结果汇总 ===');
  
  const appPrefixPassed = RESULTS.appPrefix.filter(r => r.passed).length;
  const appPrefixFailed = RESULTS.appPrefix.filter(r => !r.passed).length;
  const assertionsPassed = RESULTS.assertions.filter(r => r.passed).length;
  const assertionsFailed = RESULTS.assertions.filter(r => !r.passed).length;
  
  console.log(`\n应用前缀测试: 通过 ${appPrefixPassed}, 失败 ${appPrefixFailed}`);
  console.log(`断言检查: 通过 ${assertionsPassed}, 失败 ${assertionsFailed}`);
  
  const totalFailed = appPrefixFailed + assertionsFailed;
  if (totalFailed > 0) {
    console.log('\n❌ 存在失败项，详见上方输出');
    console.log('\n失败的测试项:');
    RESULTS.appPrefix.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.actual} (expected ${r.expected})`));
    RESULTS.assertions.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.actual} (expected ${r.expected})`));
  } else {
    console.log('\n✅ 所有测试通过');
    console.log('\n--- 验证结论 ---');
    console.log('/api/apps/current-feature-analyzer/* 路由可用');
  }
}

runTests().catch(e => console.error('测试执行错误:', e));
