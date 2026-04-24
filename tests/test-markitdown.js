import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const MCP_URL = 'https://ocr1.g.erik.top/mcp';
const MCP_TOKEN = 'Bearer sk-a9Fbq0tS65VQhG0AA296F9E2F9Ab4975A41f5aEdF97d571a';
const PDF_PATH = resolve('D:\\tmp\\奇瑞质量协议签章版.pdf');

console.log('=== markitdown MCP 诊断测试 ===\n');

async function postMCP(message) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Authorization': MCP_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify(message),
  });

  console.log(`  HTTP ${res.status} ${res.statusText}`);
  console.log(`  Content-Type: ${res.headers.get('content-type')}`);

  const text = await res.text();

  if (!res.ok) {
    console.log(`  响应体 (前500字): ${text.substring(0, 500)}`);
    return null;
  }

  if (!text || text.trim() === '') {
    console.log('  (空响应体)');
    return null;
  }

  return text;
}

function parseSSE(text) {
  const results = [];
  for (const block of text.split('\n\n')) {
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        const data = line.substring(5).trim();
        if (data) {
          try { results.push(JSON.parse(data)); } catch {}
        }
      }
    }
  }
  return results;
}

async function run() {
  // Step 0: 检查 PDF 文件
  console.log('0. 检查测试文件...');
  if (!existsSync(PDF_PATH)) {
    console.error(`  ❌ 文件不存在: ${PDF_PATH}`);
    process.exit(1);
  }
  const pdfBuf = readFileSync(PDF_PATH);
  const pdfBase64 = pdfBuf.toString('base64');
  console.log(`  ✅ PDF 文件: ${pdfBuf.length} bytes (${(pdfBuf.length / 1024).toFixed(1)} KB)\n`);

  // Step 1: 基础连通性 - GET 请求
  console.log('1. GET 连通性测试...');
  try {
    const getRes = await fetch(MCP_URL, {
      method: 'GET',
      headers: { 'Authorization': MCP_TOKEN },
    });
    console.log(`  HTTP ${getRes.status} ${getRes.statusText}`);
    const getBody = await getRes.text();
    console.log(`  响应 (前200字): ${getBody.substring(0, 200)}\n`);
  } catch (e) {
    console.log(`  ❌ GET 失败: ${e.message}\n`);
  }

  // Step 2: initialize
  console.log('2. MCP initialize...');
  const initMsg = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-script', version: '1.0.0' },
    },
  };

  const initResult = await postMCP(initMsg);
  if (!initResult) {
    console.log('  ❌ initialize 失败，终止测试\n');
    process.exit(1);
  }

  let initData;
  const ct = 'application/json';
  try {
    initData = JSON.parse(initResult);
  } catch {
    const parsed = parseSSE(initResult);
    initData = parsed[0];
  }
  console.log(`  服务端信息: ${JSON.stringify(initData?.result?.serverInfo || initData)}\n`);

  // Step 3: initialized notification
  console.log('3. 发送 initialized notification...');
  await postMCP({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  });
  console.log();

  // Step 4: list tools
  console.log('4. 列出工具...');
  const toolsResult = await postMCP({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });

  if (!toolsResult) {
    console.log('  ❌ 获取工具列表失败\n');
    process.exit(1);
  }

  let toolsData;
  try { toolsData = JSON.parse(toolsResult); } catch { toolsData = parseSSE(toolsResult)[0]; }
  const tools = toolsData?.result?.tools || [];
  console.log(`  工具数量: ${tools.length}`);
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description || '(无描述)'}`);
    if (t.inputSchema?.properties) {
      console.log(`    参数: ${Object.keys(t.inputSchema.properties).join(', ')}`);
    }
  }
  console.log();

  // Step 5: 调用工具 - 用 PDF
  console.log('5. 调用工具 (PDF 第6-8页)...');

  // 找到合适的工具和参数
  const convertTool = tools.find(t => t.name.includes('convert') || t.name.includes('markit') || t.name.includes('read') || t.name.includes('parse'));
  if (!convertTool) {
    console.log('  ❌ 没找到可用的转换工具');
    console.log('  可用工具:', tools.map(t => t.name));
    process.exit(1);
  }

  console.log(`  使用工具: ${convertTool.name}`);
  const inputProps = convertTool.inputSchema?.properties || {};
  console.log(`  工具参数: ${JSON.stringify(Object.keys(inputProps))}`);

  // 构建参数
  const toolArgs = {};

  // 尝试不同的参数名
  if (inputProps.uri) {
    toolArgs.uri = `data:application/pdf;base64,${pdfBase64}`;
  }
  if (inputProps.file) {
    toolArgs.file = { content: pdfBase64, mime_type: 'application/pdf' };
  }
  if (inputProps.content) {
    toolArgs.content = pdfBase64;
  }
  if (inputProps.data) {
    toolArgs.data = pdfBase64;
  }
  if (inputProps.pages) {
    toolArgs.pages = '6-8';
  }
  if (inputProps.page_range) {
    toolArgs.page_range = '6-8';
  }
  if (inputProps.pageRange) {
    toolArgs.pageRange = '6-8';
  }
  if (inputProps.url) {
    toolArgs.url = `data:application/pdf;base64,${pdfBase64}`;
  }
  if (inputProps.path) {
    toolArgs.path = PDF_PATH;
  }

  console.log(`  调用参数: ${Object.keys(toolArgs).join(', ')}`);

  const callResult = await postMCP({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: convertTool.name,
      arguments: toolArgs,
    },
  });

  if (callResult) {
    let callData;
    try { callData = JSON.parse(callResult); } catch { callData = parseSSE(callResult)[0]; }
    const content = callData?.result?.content;
    if (content) {
      for (const c of content) {
        if (c.type === 'text') {
          console.log(`\n  === 转换结果 (前1500字) ===`);
          console.log(c.text.substring(0, 1500));
          console.log(`  ... (总长: ${c.text.length} 字符)`);
        } else {
          console.log(`  content type: ${c.type}`, JSON.stringify(c).substring(0, 200));
        }
      }
    } else {
      console.log('  原始响应:', JSON.stringify(callData).substring(0, 500));
    }
  }

  console.log('\n=== 测试完成 ===');
}

run().catch(err => {
  console.error('测试异常:', err.message);
  process.exit(1);
});
