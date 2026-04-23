#!/usr/bin/env node
/**
 * 测试 MCP HTTP 直连
 * 
 * 使用场景：验证 MCP Server 是否可正常连接
 */

import https from 'https';

const MCP_URL = 'https://markitdown.g.erik.top/mcp/';
const MCP_TOKEN = 'Bearer sk-a9Fbq0tS65VQhG0AA296F9E2F9Ab4975A41f5aEdF97d571a';

async function testMcpConnection() {
  console.log('=== MCP HTTP Direct Connection Test ===\n');
  console.log('URL:', MCP_URL);
  
  // 测试 1: initialize
  console.log('\n--- Test 1: initialize ---');
  const initResult = await sendRequest({
    jsonrpc: '2.0',
    method: 'initialize',
    id: 1,
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
  console.log('Result:', JSON.stringify(initResult, null, 2));
  
  // 测试 2: tools/list
  console.log('\n--- Test 2: tools/list ---');
  const toolsResult = await sendRequest({
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 2
  });
  console.log('Result:', JSON.stringify(toolsResult, null, 2));
  
  // 测试 3: 尝试调用工具
  if (toolsResult?.result?.tools?.length > 0) {
    const firstTool = toolsResult.result.tools[0];
    console.log('\n--- Test 3: call tool:', firstTool.name, '---');
    
    // 构造参数 - 假设有一个 URI 参数
    const toolArgs = { uri: 'https://example.com/test.txt' };
    
    const callResult = await sendRequest({
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 3,
      params: {
        name: firstTool.name,
        arguments: toolArgs
      }
    });
    console.log('Result:', JSON.stringify(callResult, null, 2).substring(0, 500));
  }
}

function sendRequest(body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    
    const options = {
      hostname: 'markitdown.g.erik.top',
      port: 443,
      path: '/mcp/',
      method: 'POST',
      headers: {
        'Authorization': MCP_TOKEN,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 10000
    };
    
    const req = https.request(options, (res) => {
      console.log('Status:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);
      console.log('mcp-session-id:', res.headers['mcp-session-id'] || 'none');
      
      let data = '';
      let isSSE = res.headers['content-type']?.includes('text/event-stream');
      
      res.on('data', (chunk) => {
        data += chunk;
        if (isSSE) {
          // SSE 流式数据，读取到完整事件后停止
          if (data.includes('\n\n') && data.includes('data:')) {
            // 解析 SSE 格式
            const lines = data.split('\n');
            for (const line of lines) {
              if (line.startsWith('data:')) {
                try {
                  const jsonStr = line.substring(5).trim();
                  if (jsonStr) {
                    resolve(JSON.parse(jsonStr));
                    req.destroy();
                    return;
                  }
                } catch (e) {}
              }
            }
          }
        }
      });
      
      res.on('end', () => {
        if (!isSSE) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve({ raw: data, error: 'parse failed' });
          }
        }
      });
      
      res.on('error', (e) => {
        reject(e);
      });
    });
    
    req.on('error', (e) => {
      reject(e);
    });
    
    req.on('timeout', () => {
      console.log('Request timeout after 10s');
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    req.write(postData);
    req.end();
  });
}

testMcpConnection()
  .then(() => {
    console.log('\n=== Test Complete ===');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n=== Test Failed ===');
    console.error('Error:', err.message);
    process.exit(1);
  });