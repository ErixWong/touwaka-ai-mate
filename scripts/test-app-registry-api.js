const BASE_URL = 'http://localhost:3000';
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

  console.log('--- 基础接口 ---');
  await testEndpoint('列出可访问 app', 'GET', '/api/apps', token, 200);
  await testEndpoint('列出已安装 app', 'GET', '/api/apps/installed', token, 200);
  await testEndpoint('列出时钟注册', 'GET', '/api/apps/clock-registry', token, 200);

  console.log('\n--- 动态路由（需真实 appId）---');
  const appsResp = await fetch(`${BASE_URL}/api/apps`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const appsData = await appsResp.json();
  const apps = appsData.data || [];
  
  if (apps.length > 0) {
    const appId = apps[0].id;
    console.log(`使用 appId: ${appId}\n`);
    
    await testEndpoint('获取 app 详情', 'GET', `/api/apps/${appId}`, token, 200);
    await testEndpoint('获取 runtime 信息', 'GET', `/api/apps/${appId}/runtime`, token, 200);
    await testEndpoint('获取 manifest', 'GET', `/api/apps/${appId}/manifest`, token, 200);
    await testEndpoint('验证 runtime', 'GET', `/api/apps/${appId}/validate-runtime`, token, 200);
    await testEndpoint('获取配置', 'GET', `/api/apps/${appId}/config`, token, 200);
    await testEndpoint('获取时钟注册', 'GET', `/api/apps/${appId}/clock-registry`, token, 200);
  } else {
    console.log('⚠️ 无已安装 app，跳过动态路由测试');
  }

  console.log('\n--- 错误状态码验证 ---');
  await testEndpoint('不存在的 app', 'GET', '/api/apps/non-existent-app-id', token, 404);
  await testEndpoint('不存在的 manifest', 'GET', '/api/apps/non-existent-app-id/manifest', token, 422);

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