#!/usr/bin/env node
/**
 * MCP Client - Resident Process
 *
 * 管理与多个 MCP Server 的连接，支持：
 * - 公共 MCP Server（单进程共享）
 * - 用户隔离 MCP Server（每用户独立进程）
 *
 * 通信协议：
 * - stdin: 接收 JSON 命令（JSON Lines 格式）
 * - stdout: 发送 JSON 响应
 * - stderr: 日志和调试输出
 *
 * Issue #601: MCP Client 驻留技能实现
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = new URL('.', import.meta.url).pathname;

// ============== 全局状态 ==============

// 连接池: key -> { client, transport, config, startedAt }
// 公共 MCP: serverName -> connection
// 用户 MCP: serverName:userId -> connection
const connections = new Map();

// 工具定义缓存: serverName -> tools[]
const toolsCache = new Map();

// API 基础 URL（从环境变量获取）
const API_BASE = process.env.API_BASE || 'http://localhost:3000';

// ============== 日志函数 ==============

/**
 * 日志到 stderr（不干扰 stdout 通信）
 */
function log(message, ...args) {
  process.stderr.write(`[mcp-client] ${new Date().toISOString()} ${message}`);
  if (args.length > 0) {
    process.stderr.write(' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
  }
  process.stderr.write('\n');
}

// ============== 响应函数 ==============

let buffer = '';

/**
 * 发送 JSON 响应到 stdout
 */
function sendResponse(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

// ============== 配置获取 ==============

/**
 * 从主进程获取 MCP 配置
 * @param {object} userContext - 用户上下文 { userId, accessToken }
 * @returns {Promise<object>} 配置数据
 */
async function fetchConfig(userContext = {}) {
  const accessToken = userContext.accessToken || process.env.INTERNAL_TOKEN || '';
  
  try {
    const response = await fetch(`${API_BASE}/internal/mcp/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        user_id: userContext.userId || null,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (err) {
    log(`Failed to fetch config: ${err.message}`);
    throw err;
  }
}

/**
 * 获取凭证（按优先级：用户凭证 > 系统默认凭证）
 * @param {string} userId - 用户ID
 * @param {string} serverId - MCP Server ID
 * @param {object} configData - 配置数据
 * @returns {object|null} 凭证对象
 */
function getCredentials(userId, serverId, configData) {
  // 1. 优先查找用户私有凭证
  if (userId) {
    const userCredential = (configData.user_credentials || []).find(
      c => c.mcp_server_id === serverId && c.is_enabled
    );
    if (userCredential) {
      log(`Using user credentials for ${serverId}`);
      return userCredential.credentials;
    }
  }
  
  // 2. 查找系统默认凭证
  const defaultCredential = (configData.default_credentials || []).find(
    c => c.mcp_server_id === serverId && c.is_enabled
  );
  if (defaultCredential) {
    log(`Using default credentials for ${serverId}`);
    return defaultCredential.credentials;
  }
  
  // 3. 无凭证
  return null;
}

// ============== 环境变量构建 ==============

/**
 * 构建环境变量（替换占位符）
 * @param {object} envTemplate - 环境变量模板
 * @param {object} credentials - 凭证数据
 * @returns {object|null} 环境变量对象
 */
function buildEnv(envTemplate, credentials) {
  const env = { ...process.env };
  
  for (const [key, value] of Object.entries(envTemplate || {})) {
    if (typeof value === 'string' && value.startsWith('${user.')) {
      // 替换用户凭证占位符 ${user.FIELD_NAME}
      const fieldName = value.match(/\$\{user\.(\w+)\}/)?.[1];
      if (fieldName && credentials?.[fieldName]) {
        env[key] = credentials[fieldName];
      } else {
        log(`Missing credential field: ${fieldName}`);
        return null; // 凭证缺失
      }
    } else {
      env[key] = value;
    }
  }
  
  return env;
}

// ============== Transport 创建 ==============

/**
 * 解析 headers 字符串为对象
 * @param {string} headersStr - JSON 格式的 headers 字符串
 * @returns {object} headers 对象
 */
function parseHeaders(headersStr) {
  if (!headersStr) return {};
  try {
    return JSON.parse(headersStr);
  } catch (err) {
    log(`Failed to parse headers: ${err.message}`);
    return {};
  }
}

/**
 * 创建 Transport（根据传输类型）
 * @param {object} serverConfig - MCP Server 配置
 * @param {object} credentials - 凭证数据（可选）
 * @returns {Promise<Transport>} transport 实例
 */
async function createTransport(serverConfig, credentials = null) {
  const transportType = serverConfig.transport_type || 'stdio';
  
  if (transportType === 'http') {
    // HTTP/SSE 模式
    if (!serverConfig.url) {
      throw new Error(`HTTP MCP Server '${serverConfig.name}' missing URL`);
    }
    
    // 解析 headers 并合并凭证
    const headers = parseHeaders(serverConfig.headers);
    
    // 如果凭证中有 api_key 或 token，添加到 headers
    if (credentials?.api_key) {
      headers['Authorization'] = `Bearer ${credentials.api_key}`;
    } else if (credentials?.token) {
      headers['Authorization'] = `Bearer ${credentials.token}`;
    } else if (credentials?.API_KEY) {
      headers['X-API-Key'] = credentials.API_KEY;
    }
    
    // 脱敏 headers 用于日志
    const sanitizedHeaders = { ...headers };
    if (sanitizedHeaders.Authorization) {
      sanitizedHeaders.Authorization = 'Bearer ***';
    }
    if (sanitizedHeaders['X-API-Key']) {
      sanitizedHeaders['X-API-Key'] = '***';
    }
    
    log(`Creating HTTP transport for ${serverConfig.name}: ${serverConfig.url}`);
    log(`HTTP headers: ${JSON.stringify(sanitizedHeaders)}`);
    
    return new StreamableHTTPClientTransport(
      new URL(serverConfig.url),
      { headers }
    );
  }
  
  // STDIO 模式（默认）
  const env = buildEnv(serverConfig.env_template, credentials);
  if (!env) {
    throw new Error(`Missing credentials for ${serverConfig.name}`);
  }
  
  log(`Creating STDIO transport: ${serverConfig.command} ${(serverConfig.args || []).join(' ')}`);
  
  return new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env: env,
  });
}

// ============== MCP Server 连接管理 ==============

/**
 * 连接到 MCP Server
 * @param {object} serverConfig - MCP Server 配置
 * @param {string} userId - 用户ID（可选，公共 MCP 不需要）
 * @param {object} credentials - 凭证数据（可选）
 * @returns {Promise<Client>}
 */
async function connectServer(serverConfig, userId = null, credentials = null) {
  // 构建连接 key
  const connectionKey = userId ? `${serverConfig.name}:${userId}` : serverConfig.name;
  
  // 检查是否已连接
  if (connections.has(connectionKey)) {
    log(`Already connected: ${connectionKey}`);
    return connections.get(connectionKey).client;
  }
  
  log(`Connecting to ${connectionKey} (transport: ${serverConfig.transport_type || 'stdio'})...`);
  
  // 创建 MCP Client
  const client = new Client({
    name: 'touwaka-mate-mcp-client',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  });
  
  // 创建 Transport（根据传输类型）
  const transport = await createTransport(serverConfig, credentials);
  
  // 连接
  await client.connect(transport);
  
  // 存储连接
  connections.set(connectionKey, {
    client,
    transport,
    config: serverConfig,
    userId,
    startedAt: new Date().toISOString(),
  });
  
  // 获取并缓存工具定义
  await cacheTools(serverConfig.name, client);
  
  log(`Connected: ${connectionKey}`);
  
  return client;
}

/**
 * 断开 MCP Server 连接
 * @param {string} connectionKey - 连接 key
 */
async function disconnectServer(connectionKey) {
  const conn = connections.get(connectionKey);
  if (!conn) {
    return { message: `Connection ${connectionKey} not found` };
  }
  
  try {
    await conn.client.close();
  } catch (err) {
    log(`Error closing connection ${connectionKey}: ${err.message}`);
  }
  
  connections.delete(connectionKey);
  log(`Disconnected: ${connectionKey}`);
  
  return { message: `Disconnected from ${connectionKey}` };
}

// ============== 工具定义缓存 ==============

/**
 * 缓存工具定义
 * @param {string} serverName - MCP Server 名称
 * @param {Client} client - MCP Client
 */
async function cacheTools(serverName, client) {
  try {
    const response = await client.request(
      { method: 'tools/list' },
      { method: 'tools/list' }
    );
    
    const tools = response.tools || [];
    toolsCache.set(serverName, tools);
    
    log(`Cached ${tools.length} tools for ${serverName}`);
    
    // 返回工具列表
    return tools;
  } catch (err) {
    log(`Failed to get tools from ${serverName}: ${err.message}`);
    return [];
  }
}

/**
 * 获取用户可用的所有工具
 * @param {string} userId - 用户ID
 * @param {object} configData - 配置数据
 * @returns {Promise<Array>} 工具列表
 */
async function getUserTools(userId, configData) {
  const servers = configData.servers || [];
  const allTools = [];
  
  for (const server of servers) {
    if (!server.is_enabled) continue;
    
    // 公共 MCP：所有用户可用
    if (server.is_public) {
      // 确保公共连接已建立
      if (!connections.has(server.name)) {
        try {
          await connectServer(server);
        } catch (err) {
          log(`Failed to connect public server ${server.name}: ${err.message}`);
          continue;
        }
      }
      
      const tools = toolsCache.get(server.name) || [];
      for (const tool of tools) {
        allTools.push({
          name: `mcp_${server.name}_${tool.name}`,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
          server_name: server.name,
          original_name: tool.name,
          is_public: true,
          server_id: server.id,
        });
      }
    }
    
    // 用户隔离 MCP：检查凭证
    if (server.requires_credentials) {
      const credentials = getCredentials(userId, server.id, configData);
      if (credentials) {
        // 确保用户连接已建立
        const connectionKey = `${server.name}:${userId}`;
        if (!connections.has(connectionKey)) {
          try {
            await connectServer(server, userId, credentials);
          } catch (err) {
            log(`Failed to connect ${connectionKey}: ${err.message}`);
            continue;
          }
        }
        
        const tools = toolsCache.get(server.name) || [];
        for (const tool of tools) {
          allTools.push({
            name: `mcp_${server.name}_${tool.name}`,
            description: tool.description || '',
            inputSchema: tool.inputSchema || {},
            server_name: server.name,
            original_name: tool.name,
            is_public: false,
            user_id: userId,
            server_id: server.id,
          });
        }
      }
    }
  }
  
  return allTools;
}

// ============== 工具调用 ==============

/**
 * 调用 MCP 工具
 * @param {string} serverName - MCP Server 名称
 * @param {string} toolName - 工具名称
 * @param {object} args - 工具参数
 * @param {string} userId - 用户ID
 * @param {object} configData - 配置数据
 * @returns {Promise<object>} 工具结果
 */
async function callTool(serverName, toolName, args, userId, configData) {
  // 查找连接
  let connectionKey = serverName; // 先尝试公共连接
  let conn = connections.get(connectionKey);
  
  // 如果公共连接不存在，尝试用户连接
  if (!conn && userId) {
    connectionKey = `${serverName}:${userId}`;
    conn = connections.get(connectionKey);
  }
  
  // 如果连接不存在，尝试建立连接
  if (!conn) {
    const serverConfig = (configData.servers || []).find(s => s.name === serverName);
    if (!serverConfig) {
      throw new Error(`MCP Server '${serverName}' not found`);
    }
    
    // 获取凭证
    const credentials = getCredentials(userId, serverConfig.id, configData);
    
    // 建立连接
    if (serverConfig.is_public) {
      await connectServer(serverConfig);
      conn = connections.get(serverName);
    } else if (credentials) {
      await connectServer(serverConfig, userId, credentials);
      conn = connections.get(`${serverName}:${userId}`);
    } else {
      throw new Error(`No credentials available for ${serverName}. Please configure credentials in MCP management panel.`);
    }
  }
  
  log(`Calling tool ${serverName}/${toolName} with args:`, JSON.stringify(args));
  
  // 调用工具
  const response = await conn.client.request(
    {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args || {},
      },
    },
    { method: 'tools/call' }
  );
  
  // 处理响应内容
  if (response.content) {
    const textContent = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    
    return {
      content: textContent,
      raw: response.content,
      is_error: response.isError || false,
    };
  }
  
  return response;
}

// ============== 命令处理 ==============

/**
 * 处理命令
 * @param {string} command - 命令名称
 * @param {object} params - 命令参数
 * @param {object} user - 用户上下文
 */
async function processCommand(command, params, user) {
  const userId = user.userId || null;
  const accessToken = user.accessToken || null;
  
  switch (command) {
    case 'invoke':
      // invoke 是各种操作的包装器
      const action = params.action || 'list_tools';
      return await processAction(action, params, userId, accessToken);
    
    case 'ping':
      return { 
        pong: true, 
        timestamp: Date.now(), 
        connections: connections.size,
        tools_cached: toolsCache.size,
      };
    
    default:
      return await processAction(command, params, userId, accessToken);
  }
}

/**
 * 处理具体操作
 */
async function processAction(action, params, userId, accessToken) {
  // 获取配置数据
  const configData = await fetchConfig({ userId, accessToken });
  
  switch (action) {
    case 'list_tools':
      // 获取用户可用的所有工具
      const tools = await getUserTools(userId, configData);
      return { tools };
    
    case 'call_tool':
      // 调用 MCP 工具
      return await callTool(
        params.server_name,
        params.tool_name,
        params.arguments,
        userId,
        configData
      );
    
    case 'list_servers':
      // 获取 MCP Server 列表
      const servers = configData.servers || [];
      return {
        servers: servers.map(s => ({
          id: s.id,
          name: s.name,
          display_name: s.display_name,
          description: s.description,
          transport_type: s.transport_type || 'stdio',  // 新增
          is_public: s.is_public,
          requires_credentials: s.requires_credentials,
          is_enabled: s.is_enabled,
          connected: connections.has(s.name) || (userId && connections.has(`${s.name}:${userId}`)),
          tools_count: (toolsCache.get(s.name) || []).length,
        })),
      };
    
    case 'connect_server':
      // 连接到指定 MCP Server
      const serverConfig = (configData.servers || []).find(s => s.name === params.server_name);
      if (!serverConfig) {
        throw new Error(`MCP Server '${params.server_name}' not found`);
      }
      
      const credentials = getCredentials(userId, serverConfig.id, configData);
      await connectServer(serverConfig, userId, credentials);
      return { message: `Connected to ${params.server_name}` };
    
    case 'disconnect_server':
      // 断开连接
      const disconnectKey = userId ? `${params.server_name}:${userId}` : params.server_name;
      return await disconnectServer(disconnectKey);
    
    case 'refresh_tools':
      // 刷新工具定义缓存
      for (const [key, conn] of connections) {
        const serverName = key.split(':')[0];
        await cacheTools(serverName, conn.client);
      }
      return { message: 'Tools cache refreshed', servers_refreshed: connections.size };
    
    case 'init':
      // 初始化：连接所有公共 MCP Server
      const initResults = [];
      for (const server of (configData.servers || [])) {
        if (server.is_public && server.is_enabled) {
          try {
            await connectServer(server);
            initResults.push({ server: server.name, status: 'connected' });
          } catch (err) {
            log(`Failed to init ${server.name}: ${err.message}`);
            initResults.push({ server: server.name, status: 'failed', error: err.message });
          }
        }
      }
      return {
        message: 'Initialized',
        public_servers: initResults,
      };
    
    case 'shutdown':
      // 关闭所有连接
      for (const [key] of connections) {
        await disconnectServer(key);
      }
      return { message: 'All connections closed' };
    
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ============== 命令行处理 ==============

/**
 * 处理单行 JSON 命令
 */
async function processCommandLine(line) {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch (err) {
    sendResponse({
      task_id: null,
      error: `Invalid JSON: ${err.message}`,
      success: false
    });
    return;
  }
  
  const { command, task_id, params, user } = cmd;
  
  try {
    const result = await processCommand(command || 'invoke', params || {}, user || {});
    sendResponse({
      task_id: task_id,
      result: result,
      success: true
    });
  } catch (err) {
    sendResponse({
      task_id: task_id,
      error: err.message,
      success: false
    });
  }
}

// ============== 生命周期 ==============

/**
 * 初始化
 */
async function initialize() {
  log('Starting MCP Client resident process...');
  
  // 初始化公共 MCP Server
  try {
    const configData = await fetchConfig({});
    await processAction('init', {}, null, null);
    log(`Initialized with ${connections.size} public connections`);
  } catch (err) {
    log(`Init failed: ${err.message}`);
  }
}

/**
 * 关闭所有连接
 */
async function shutdown() {
  log('Shutting down...');
  
  for (const [key] of connections) {
    try {
      await disconnectServer(key);
    } catch (err) {
      log(`Error disconnecting ${key}: ${err.message}`);
    }
  }
  
  process.exit(0);
}

// ============== 主函数 ==============

async function main() {
  // 初始化
  await initialize();
  
  // 监听 stdin
  process.stdin.setEncoding('utf8');
  
  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        processCommandLine(line).catch(err => {
          log('Error processing command:', err.message);
        });
      }
    }
  });
  
  process.stdin.on('end', () => {
    shutdown();
  });
  
  // 处理退出信号
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  
  // 通知主进程已就绪
  sendResponse({
    type: 'ready',
    name: 'mcp-client',
    pid: process.pid,
    connections: connections.size,
    timestamp: Date.now(),
  });
  
  log('Ready, waiting for commands on stdin');
}

// 启动
main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});