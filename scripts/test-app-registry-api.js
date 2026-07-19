const BASE_URL = 'http://localhost:3017';
const RESULTS = [];

async function getAuthToken() {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: 'admin', password: 'password123' })
  });
  const data = await resp.json();
  if (data.code !== 200) throw new Error('Login failed: ' + data.message);
  console.log('Login response:', JSON.stringify(data.data, null, 2));
  return data.data.access_token;
}

async function testEndpoint(name, method, path, token, expectStatus) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, { method, headers });
  const status = resp.status;
  const data = await resp.json().catch(() => ({}));
  
  const passed = status === expectStatus;
  RESULTS.push({ name, method, path, expected: expectStatus, actual: status, passed, data });
  
  console.log(`${passed ? '✅' : '❌'} ${name}: ${status} (expected ${expectStatus})`);
  return { passed, data };
}

async function runTests() {
  console.log('=== App Registry API 联调验证 ===\n');
  
  let token;
  try {
    token = await getAuthToken();
    console.log('✅ 登录成功\n');
  } catch (e) {
    console.log('❌ 登录失败:', e.message);
    console.log('\n请确保服务器已启动 (npm run server)');
    return;
  }

  console.log('--- 新前缀 /api/app-registry/* (Phase 1 主目标) ---');
  await testEndpoint('新前缀：列出可访问 app', 'GET', '/api/app-registry', token, 200);
  await testEndpoint('新前缀：列出已安装 app', 'GET', '/api/app-registry/installed', token, 200);
  await testEndpoint('新前缀：列出时钟注册', 'GET', '/api/app-registry/clock-registry', token, 200);

  const appsRespNew = await fetch(`${BASE_URL}/api/app-registry`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const appsDataNew = await appsRespNew.json();
  const appsNew = appsDataNew.data || [];

  if (appsNew.length > 0) {
    const appId = appsNew[0].id;
    console.log(`新前缀使用 appId: ${appId}\n`);
    
    await testEndpoint('新前缀：获取 app 详情', 'GET', `/api/app-registry/${appId}`, token, 200);
    await testEndpoint('新前缀：获取 runtime 信息', 'GET', `/api/app-registry/${appId}/runtime`, token, 200);
    await testEndpoint('新前缀：获取 manifest', 'GET', `/api/app-registry/${appId}/manifest`, token, 200);
    await testEndpoint('新前缀：验证 runtime', 'GET', `/api/app-registry/${appId}/validate-runtime`, token, 200);
    await testEndpoint('新前缀：获取配置', 'GET', `/api/app-registry/${appId}/config`, token, 200);
    await testEndpoint('新前缀：获取时钟注册', 'GET', `/api/app-registry/${appId}/clock-registry`, token, 200);
  } else {
    console.log('⚠️ 无已安装 app，跳过新前缀动态路由测试');
  }

  console.log('\n--- Legacy 兼容层 /api/apps/* (向后兼容验证) ---');
  await testEndpoint('Legacy：列出可访问 app', 'GET', '/api/apps', token, 200);
  await testEndpoint('Legacy：列出已安装 app', 'GET', '/api/apps/installed', token, 200);
  await testEndpoint('Legacy：列出时钟注册', 'GET', '/api/apps/clock-registry', token, 200);
  
  const appsRespLegacy = await fetch(`${BASE_URL}/api/apps`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const appsDataLegacy = await appsRespLegacy.json();
  const appsLegacy = appsDataLegacy.data || [];
  
  if (appsLegacy.length > 0) {
    const appId = appsLegacy[0].id;
    console.log(`Legacy 使用 appId: ${appId}\n`);
    
    await testEndpoint('Legacy：获取 app 详情', 'GET', `/api/apps/${appId}`, token, 200);
    await testEndpoint('Legacy：获取 runtime 信息', 'GET', `/api/apps/${appId}/runtime`, token, 200);
    await testEndpoint('Legacy：获取 manifest', 'GET', `/api/apps/${appId}/manifest`, token, 200);
    await testEndpoint('Legacy：验证 runtime', 'GET', `/api/apps/${appId}/validate-runtime`, token, 200);
    await testEndpoint('Legacy：获取配置', 'GET', `/api/apps/${appId}/config`, token, 200);
    await testEndpoint('Legacy：获取时钟注册', 'GET', `/api/apps/${appId}/clock-registry`, token, 200);
  } else {
    console.log('⚠️ 无已安装 app，跳过 Legacy 动态路由测试');
  }

  console.log('\n--- 错误状态码验证 ---');
  await testEndpoint('新前缀：不存在的 app', 'GET', '/api/app-registry/non-existent-app-id', token, 404);
  await testEndpoint('新前缀：不存在的 manifest', 'GET', '/api/app-registry/non-existent-app-id/manifest', token, 422);

  console.log('\n=== 测试结果汇总 ===');
  const passed = RESULTS.filter(r => r.passed).length;
  const failed = RESULTS.filter(r => !r.passed).length;
  console.log(`通过: ${passed}, 失败: ${failed}`);
  
  if (failed > 0) {
    console.log('\n失败的测试:');
    RESULTS.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.actual} (expected ${r.expected})`);
    });
  }
}

runTests().catch(e => console.error('测试执行错误:', e));
