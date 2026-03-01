/**
 * 简单 API 测试脚本
 */

import http from 'http';

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Response status:', res.statusCode);
        console.log('Response body:', data);
        resolve(data);
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function testLogin() {
  console.log('Testing login API...');
  
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  const body = {
    email: 'admin@example.com',
    password: 'password123'
  };

  await makeRequest(options, body);
}

testLogin().catch(console.error);
