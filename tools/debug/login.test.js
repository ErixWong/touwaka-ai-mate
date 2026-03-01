/**
 * 登录测试脚本
 * 测试用户登录功能和 Token 验证
 */

import http from 'http';

// 配置
const config = {
  host: 'localhost',
  port: 3000,
  testAccounts: [
    { email: 'admin@example.com', password: 'password123', description: '管理员账号' },
    { email: 'test@example.com', password: 'password123', description: '测试用户账号' },
  ]
};

/**
 * 发送 HTTP 请求
 */
function makeRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = {
            statusCode: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          };
          resolve(parsed);
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * 测试登录
 */
async function testLogin(account) {
  console.log(`\n========================================`);
  console.log(`测试账号: ${account.email} (${account.description})`);
  console.log(`========================================`);

  const options = {
    hostname: config.host,
    port: config.port,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  try {
    const response = await makeRequest(options, {
      email: account.email,
      password: account.password
    });

    console.log(`状态码: ${response.statusCode}`);
    
    if (response.statusCode === 200 && response.body?.code === 200) {
      console.log(`✅ 登录成功!`);
      console.log(`用户信息:`);
      console.log(`  - ID: ${response.body.data?.user?.id}`);
      console.log(`  - 邮箱: ${response.body.data?.user?.email}`);
      console.log(`  - 昵称: ${response.body.data?.user?.nickname}`);
      console.log(`Token 信息:`);
      console.log(`  - accessToken: ${response.body.data?.accessToken?.substring(0, 50)}...`);
      console.log(`  - refreshToken: ${response.body.data?.refreshToken?.substring(0, 50)}...`);
      return { success: true, data: response.body.data };
    } else {
      console.log(`❌ 登录失败!`);
      console.log(`响应: ${JSON.stringify(response.body, null, 2)}`);
      return { success: false, error: response.body };
    }
  } catch (error) {
    console.log(`❌ 请求失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 测试 Token 验证 - 获取当前用户信息
 */
async function testTokenVerification(accessToken) {
  console.log(`\n----------------------------------------`);
  console.log(`测试 Token 验证 (GET /api/auth/me)`);
  console.log(`----------------------------------------`);

  const options = {
    hostname: config.host,
    port: config.port,
    path: '/api/auth/me',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    }
  };

  try {
    const response = await makeRequest(options);
    console.log(`状态码: ${response.statusCode}`);
    
    if (response.statusCode === 200 && response.body?.code === 200) {
      console.log(`✅ Token 验证成功!`);
      console.log(`用户详情: ${JSON.stringify(response.body.data, null, 2)}`);
      return { success: true };
    } else {
      console.log(`❌ Token 验证失败!`);
      console.log(`响应: ${JSON.stringify(response.body, null, 2)}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`❌ 请求失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 测试无 Token 访问受保护接口
 */
async function testNoTokenAccess() {
  console.log(`\n----------------------------------------`);
  console.log(`测试无 Token 访问受保护接口`);
  console.log(`----------------------------------------`);

  const options = {
    hostname: config.host,
    port: config.port,
    path: '/api/auth/me',
    method: 'GET',
    headers: {}
  };

  try {
    const response = await makeRequest(options);
    console.log(`状态码: ${response.statusCode}`);
    
    if (response.statusCode === 401) {
      console.log(`✅ 正确拒绝无 Token 访问!`);
      console.log(`响应: ${JSON.stringify(response.body, null, 2)}`);
      return { success: true };
    } else {
      console.log(`❌ 预期返回 401，实际返回 ${response.statusCode}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`❌ 请求失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 测试无效 Token
 */
async function testInvalidToken() {
  console.log(`\n----------------------------------------`);
  console.log(`测试无效 Token 访问`);
  console.log(`----------------------------------------`);

  const options = {
    hostname: config.host,
    port: config.port,
    path: '/api/auth/me',
    method: 'GET',
    headers: {
      'Authorization': 'Bearer invalid_token_here',
    }
  };

  try {
    const response = await makeRequest(options);
    console.log(`状态码: ${response.statusCode}`);
    
    if (response.statusCode === 403 || response.statusCode === 401) {
      console.log(`✅ 正确拒绝无效 Token!`);
      console.log(`响应: ${JSON.stringify(response.body, null, 2)}`);
      return { success: true };
    } else {
      console.log(`❌ 预期返回 401/403，实际返回 ${response.statusCode}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`❌ 请求失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 测试错误密码
 */
async function testWrongPassword() {
  console.log(`\n----------------------------------------`);
  console.log(`测试错误密码登录`);
  console.log(`----------------------------------------`);

  const options = {
    hostname: config.host,
    port: config.port,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  try {
    const response = await makeRequest(options, {
      email: 'admin@example.com',
      password: 'wrongpassword'
    });

    console.log(`状态码: ${response.statusCode}`);
    
    if (response.statusCode === 401) {
      console.log(`✅ 正确返回 401 未授权!`);
      console.log(`响应: ${JSON.stringify(response.body, null, 2)}`);
      return { success: true };
    } else {
      console.log(`❌ 预期返回 401，实际返回 ${response.statusCode}`);
      console.log(`响应: ${JSON.stringify(response.body, null, 2)}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`❌ 请求失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 测试 Token 刷新
 */
async function testTokenRefresh(refreshToken) {
  console.log(`\n----------------------------------------`);
  console.log(`测试 Token 刷新 (POST /api/auth/refresh)`);
  console.log(`----------------------------------------`);

  const options = {
    hostname: config.host,
    port: config.port,
    path: '/api/auth/refresh',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  try {
    const response = await makeRequest(options, { refreshToken });
    console.log(`状态码: ${response.statusCode}`);
    
    if (response.statusCode === 200 && response.body?.code === 200) {
      console.log(`✅ Token 刷新成功!`);
      console.log(`新 Token:`);
      console.log(`  - accessToken: ${response.body.data?.accessToken?.substring(0, 50)}...`);
      console.log(`  - refreshToken: ${response.body.data?.refreshToken?.substring(0, 50)}...`);
      return { success: true, data: response.body.data };
    } else {
      console.log(`❌ Token 刷新失败!`);
      console.log(`响应: ${JSON.stringify(response.body, null, 2)}`);
      return { success: false };
    }
  } catch (error) {
    console.log(`❌ 请求失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * 主测试函数
 */
async function runTests() {
  console.log('========================================');
  console.log('       登录功能测试');
  console.log('========================================');
  console.log(`服务器: http://${config.host}:${config.port}`);
  console.log(`时间: ${new Date().toLocaleString('zh-CN')}`);

  const loginResults = [];
  let firstAccessToken = null;
  let firstRefreshToken = null;

  // 1. 测试所有账号登录
  for (const account of config.testAccounts) {
    const result = await testLogin(account);
    loginResults.push({ account: account.email, ...result });
    
    // 保存第一个成功登录的 token
    if (result.success && result.data?.accessToken && !firstAccessToken) {
      firstAccessToken = result.data.accessToken;
      firstRefreshToken = result.data.refreshToken;
    }
  }

  // 2. 测试 Token 验证
  const tokenTests = [];
  if (firstAccessToken) {
    tokenTests.push(await testTokenVerification(firstAccessToken));
  }

  // 3. 测试无 Token 访问
  tokenTests.push(await testNoTokenAccess());

  // 4. 测试无效 Token
  tokenTests.push(await testInvalidToken());

  // 5. 测试错误密码
  tokenTests.push(await testWrongPassword());

  // 6. 测试 Token 刷新
  if (firstRefreshToken) {
    const refreshResult = await testTokenRefresh(firstRefreshToken);
    tokenTests.push(refreshResult);
    
    // 用新 Token 验证
    if (refreshResult.success && refreshResult.data?.accessToken) {
      console.log(`\n----------------------------------------`);
      console.log(`使用刷新后的 Token 验证`);
      console.log(`----------------------------------------`);
      tokenTests.push(await testTokenVerification(refreshResult.data.accessToken));
    }
  }

  // 汇总结果
  console.log('\n========================================');
  console.log('       测试结果汇总');
  console.log('========================================');
  
  const loginSuccess = loginResults.filter(r => r.success).length;
  const tokenSuccess = tokenTests.filter(r => r.success).length;
  
  console.log(`登录测试: ${loginSuccess}/${loginResults.length} 通过`);
  console.log(`Token 测试: ${tokenSuccess}/${tokenTests.length} 通过`);

  if (loginSuccess === loginResults.length && tokenSuccess === tokenTests.length) {
    console.log('\n✅ 所有测试通过!');
    process.exit(0);
  } else {
    console.log('\n❌ 部分测试失败!');
    process.exit(1);
  }
}

// 运行测试
runTests().catch(error => {
  console.error('测试执行出错:', error);
  process.exit(1);
});
