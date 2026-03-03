/**
 * 测试脚本：发送消息给专家并查看错误
 */

const API_BASE = 'http://localhost:3000';

// 测试账号
const TEST_USER = {
  account: 'admin',
  password: 'password123'
};

async function login() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TEST_USER)
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || '登录失败');
    }
    console.log('✅ 登录成功');
    return data.data.access_token;
  } catch (err) {
    console.error('❌ 登录失败:', err.message);
    process.exit(1);
  }
}

async function getMessagesByExpert(token, expertId) {
  try {
    const res = await fetch(`${API_BASE}/api/messages/expert/${expertId}?page=1&limit=50`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    console.log('✅ 获取消息成功:', JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.error('❌ 获取消息失败:', err.message);
    return null;
  }
}

async function sendMessage(token, content, expertId) {
  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ content, expert_id: expertId })
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('❌ 发送消息失败:');
      console.error('   Status:', res.status);
      console.error('   Data:', JSON.stringify(data, null, 2));
      return null;
    }
    console.log('✅ 发送消息成功:', JSON.stringify(data, null, 2));
    return data;
  } catch (err) {
    console.error('❌ 发送消息失败:', err.message);
    return null;
  }
}

async function main() {
  console.log('=== 测试专家消息 API ===\n');

  // 1. 登录获取 token
  const token = await login();
  console.log('Token:', token.substring(0, 20) + '...\n');

  // 数据库中实际的专家 ID
  const EXPERT_ID = 'mm4kbf53e98c3laoqaxn';

  // 2. 测试获取专家的消息
  console.log('=== 测试获取专家消息 ===');
  await getMessagesByExpert(token, EXPERT_ID);

  // 3. 测试发送消息
  console.log('\n=== 测试发送消息 ===');
  await sendMessage(token, '你好，测试一下', EXPERT_ID);
}

main();
