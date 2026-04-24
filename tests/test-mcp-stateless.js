#!/usr/bin/env node
/**
 * 测试 StatelessHTTP MCP Server 连接
 * 
 * 验证：
 * 1. StatelessHTTPTransport 能正常连接
 * 2. 能获取工具列表
 * 3. 能调用工具
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import StatelessHTTPTransport from '../lib/mcp-stateless-http.js';

const MCP_URL = 'https://markitdown.g.erik.top/mcp/';
const MCP_TOKEN = 'Bearer sk-a9Fbq0tS65VQhG0AA296F9E2F9Ab4975A41f5aEdF97d571a';

console.log('=== StatelessHTTP MCP Connection Test ===\n');
console.log('URL:', MCP_URL);

async function testConnection() {
  // 创建 Transport
  const headers = {
    'Authorization': MCP_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  
  const transport = new StatelessHTTPTransport(new URL(MCP_URL), {
    requestInit: { headers }
  });
  
  console.log('\n1. Creating Client...');
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} }
  );
  
  console.log('\n2. Connecting...');
  const connectPromise = client.connect(transport);
  
  // 设置超时
  const timeout = setTimeout(() => {
    console.log('TIMEOUT after 10s!');
    process.exit(1);
  }, 10000);
  
await connectPromise;
  clearTimeout(timeout);
  console.log('✅ Connected!');
  
  console.log('\n3. Listing tools...');
  const toolsResult = await client.listTools();
  console.log('Tools:', toolsResult.tools.map(t => t.name));
  
  if (toolsResult.tools.length > 0) {
    const firstTool = toolsResult.tools[0];
    console.log('\n4. Calling tool:', firstTool.name);
    
    try {
      const callResult = await client.callTool({
        name: firstTool.name,
        arguments: { uri: 'https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/master/README.md' }
      });
      
      console.log('Result type:', callResult.content?.[0]?.type);
      const preview = callResult.content?.[0]?.text?.substring(0, 300) || '(empty)';
      console.log('Content preview:', preview);
    } catch (e) {
      console.log('Call error:', e.message);
    }
  }
  
  console.log('\n=== Test Complete ===');
  process.exit(0);
}

testConnection().catch((err) => {
  console.error('Test failed:', err.message);
  process.exit(1);
});