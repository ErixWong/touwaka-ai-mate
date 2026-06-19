const BASE_URL = 'http://localhost:3000';
const RESULTS = {
  interface: [],
  clock: [],
  compatibility: []
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

async function testInterface(name, method, path, token, expectStatus) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, { method, headers });
  const status = resp.status;
  const data = await resp.json().catch(() => ({}));
  
  const passed = status === expectStatus;
  RESULTS.interface.push({ name, method, path, expected: expectStatus, actual: status, passed, data });
  
  console.log(`${passed ? '✅' : '❌'} ${name}: ${status} (expected ${expectStatus})`);
  return { passed, data, status };
}

async function testClockInterface(name, method, path, token, expectStatus) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  
  const url = `${BASE_URL}${path}`;
  const resp = await fetch(url, { method, headers });
  const status = resp.status;
  const data = await resp.json().catch(() => ({}));
  
  const passed = status === expectStatus;
  RESULTS.clock.push({ name, method, path, expected: expectStatus, actual: status, passed, data });
  
  console.log(`${passed ? '✅' : '❌'} ${name}: ${status} (expected ${expectStatus})`);
  return { passed, data, status };
}

async function testForceTick(appId, token) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  
  const url = `${BASE_URL}/api/app-clock/force-tick/${appId}`;
  const resp = await fetch(url, { method: 'POST', headers });
  const status = resp.status;
  const data = await resp.json().catch(() => ({}));
  
  const passed = status === 200 || status === 201;
  RESULTS.clock.push({ name: `force-tick ${appId}`, method: 'POST', path: url, expected: '200/201', actual: status, passed, data });
  
  console.log(`${passed ? '✅' : '❌'} force-tick ${appId}: ${status}`);
  return { passed, data, status };
}

async function getAppManifestStatus(appId) {
  const manifestPath = `apps/${appId}/manifest.json`;
  try {
    const fs = await import('fs/promises');
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);
    const hasTick = manifest.runtime?.tick || !!(await import('fs')).default.existsSync(`apps/${appId}/tick/index.js`);
    return { exists: true, hasRuntimeTick: !!manifest.runtime?.tick, hasLegacyTick: hasTick };
  } catch {
    const hasLegacyTick = (await import('fs')).default.existsSync(`apps/${appId}/tick/index.js`);
    return { exists: false, hasRuntimeTick: false, hasLegacyTick };
  }
}

async function runTests() {
  console.log('=== App Runtime 完整联调验证 ===\n');
  
  let token;
  try {
    token = await getAuthToken();
    console.log('✅ 登录成功\n');
  } catch (e) {
    console.log('❌ 登录失败:', e.message);
    console.log('\n请确保服务器已启动 (node server/index.js)');
    return;
  }

  console.log('--- Part 1: 基础接口测试 ---');
  await testInterface('列出可访问 app', 'GET', '/api/apps', token, 200);
  await testInterface('列出已安装 app', 'GET', '/api/apps/installed', token, 200);
  await testInterface('列出时钟注册', 'GET', '/api/apps/clock-registry', token, 200);

  console.log('\n--- Part 2: AppClock 接口测试 ---');
  await testClockInterface('获取时钟状态', 'GET', '/api/app-clock/status', token, 200);

  console.log('\n--- Part 3: 动态路由接口（真实 appId）---');
  const appsResp = await fetch(`${BASE_URL}/api/apps`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const appsData = await appsResp.json();
  const apps = appsData.data || [];
  
  const testApps = ['contract-mgr-v2', 'contract-mgr', 'invoice-mgr', 'ocr-tool', 'doc-ocr-pipeline'];
  
  for (const appId of testApps) {
    if (apps.some(a => a.id === appId)) {
      console.log(`\n测试 app: ${appId}`);
      await testInterface(`获取 ${appId} 详情`, 'GET', `/api/apps/${appId}`, token, 200);
      await testInterface(`获取 ${appId} runtime`, 'GET', `/api/apps/${appId}/runtime`, token, 200);
      await testInterface(`获取 ${appId} manifest`, 'GET', `/api/apps/${appId}/manifest`, token, appId === 'doc-ocr-pipeline' ? 422 : 200);
      await testInterface(`验证 ${appId} runtime`, 'GET', `/api/apps/${appId}/validate-runtime`, token, appId === 'doc-ocr-pipeline' ? 422 : 200);
      await testClockInterface(`获取 ${appId} 时钟状态`, 'GET', `/api/app-clock/status/${appId}`, token, 200);
    } else {
      console.log(`⚠️ app ${appId} 未安装，跳过`);
    }
  }

  console.log('\n--- Part 4: 错误状态码验证 ---');
  await testInterface('不存在的 app', 'GET', '/api/apps/non-existent-app-id', token, 404);
  await testInterface('不存在 app manifest', 'GET', '/api/apps/non-existent-app-id/manifest', token, 422);

  console.log('\n--- Part 5: legacy 兼容性验证 ---');
  for (const appId of testApps) {
    const status = await getAppManifestStatus(appId);
    console.log(`\n${appId}:`);
    console.log(`  manifest 存在: ${status.exists}`);
    console.log(`  runtime.tick 声明: ${status.hasRuntimeTick}`);
    console.log(`  legacy tick/index.js: ${status.hasLegacyTick}`);
    
    if (status.hasLegacyTick) {
      console.log('  尝试 force-tick...');
      await testForceTick(appId, token);
    } else {
      console.log('  ⚠️ 无 tick，跳过 force-tick');
      RESULTS.compatibility.push({ appId, manifest: status.exists, runtimeTick: status.hasRuntimeTick, legacyTick: status.hasLegacyTick, forceTickPassed: false, reason: 'no tick' });
    }
  }

  console.log('\n=== 测试结果汇总 ===');
  
  const interfacePassed = RESULTS.interface.filter(r => r.passed).length;
  const interfaceFailed = RESULTS.interface.filter(r => !r.passed).length;
  const clockPassed = RESULTS.clock.filter(r => r.passed).length;
  const clockFailed = RESULTS.clock.filter(r => !r.passed).length;
  
  console.log(`\nPart 1-4 接口测试: 通过 ${interfacePassed}, 失败 ${interfaceFailed}`);
  console.log(`Part 5 AppClock 测试: 通过 ${clockPassed}, 失败 ${clockFailed}`);
  
  console.log('\n--- Legacy 兼容性矩阵 ---');
  for (const item of RESULTS.compatibility) {
    console.log(`${item.appId}: manifest=${item.manifest}, runtimeTick=${item.runtimeTick}, legacyTick=${item.legacyTick}, forceTick=${item.forceTickPassed}`);
  }
  
  if (interfaceFailed > 0 || clockFailed > 0) {
    console.log('\n❌ 存在失败项，详见上方输出');
  } else {
    console.log('\n✅ 所有测试通过');
  }
}

runTests().catch(e => console.error('测试执行错误:', e));