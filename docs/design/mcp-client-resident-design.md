# MCP Client 驻留技能设计方案

> 利用现有驻留式技能机制，实现通用的 MCP 客户端

---

## 1. 核心问题

### 1.1 问题清单

| # | 问题 | 答案概要 |
|---|------|----------|
| 1 | 一个驻留技能能否支持多个 MCP 服务？ | ✅ 可以，类似 SSH Session Manager 管理多个 SSH 连接 |
| 2 | 不同用户访问同一 MCP 服务需要不同凭证？ | ✅ 支持，通过用户级凭证配置实现隔离 |
| 3 | 管理界面如何设计？ | ✅ 前端面板 + 数据库存储配置 |
| 4 | 工具如何暴露给 LLM？ | ✅ 动态注入到工具列表，与 Skill 工具统一 |

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        Touwaka Mate Server                                       │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                          前端管理界面                                        ││
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          ││
│  │  │ MCP Server 列表  │  │ 添加 MCP Server  │  │ 用户凭证配置     │          ││
│  │  │ - filesystem ✓  │  │ - 名称/命令      │  │ - API Key        │          ││
│  │  │ - firecrawl ✓   │  │ - 参数/环境变量  │  │ - Token          │          ││
│  │  │ - gitea ○       │  │ - 权限设置       │  │ - 凭证状态       │          ││
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘          ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                      │                                           │
│                                      │ API                                        │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                          数据库层                                            ││
│  │                                                                              ││
│  │  mcp_servers 表 (系统级配置)                                                 ││
│  │  ┌──────────────────────────────────────────────────────────────────────┐   ││
│  │  │ id | name | command | args | env_template | is_public | created_by   │   ││
│  │  │ filesystem | npx | ["-y","@mcp/server-filesystem"] | {} | 1 | admin  │   ││
│  │  │ firecrawl | npx | ["-y","firecrawl-mcp"] | {"API_KEY":"${user.key}"} | 0 | admin │
│  │  └──────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                              ││
│  │  mcp_user_credentials 表 (用户级凭证)                                        ││
│  │  ┌──────────────────────────────────────────────────────────────────────┐   ││
│  │  │ id | user_id | mcp_server_id | credentials | is_enabled | updated_at │   ││
│  │  │ 1 | user-001 | firecrawl | {"API_KEY":"fc-xxx"} | 1 | 2026-04-10    │   ││
│  │  │ 2 | user-002 | firecrawl | {"API_KEY":"fc-yyy"} | 1 | 2026-04-10    │   ││
│  │  └──────────────────────────────────────────────────────────────────────┘   ││
│  │                                                                              ││
│  │  mcp_tools_cache 表 (工具定义缓存)                                           ││
│  │  ┌──────────────────────────────────────────────────────────────────────┐   ││
│  │  │ id | mcp_server_id | tool_name | description | input_schema | cached_at │
│  │  └──────────────────────────────────────────────────────────────────────┘   ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                      │                                           │
│                                      │ 查询/更新                                  │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                    ResidentSkillManager                                      ││
│  │                                                                              ││
│  │  管理驻留进程:                                                               ││
│  │  - mcp-client (MCP Client 驻留进程)                                         ││
│  │  - erix-ssh (SSH Session Manager)                                           ││
│  │  - ...                                                                      ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                      │                                           │
│                                      │ stdin/stdout                              │
│                                      ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                    MCP Client 驻留进程                                       ││
│  │                                                                              ││
│  │  ┌───────────────────────────────────────────────────────────────────────┐  ││
│  │  │                    MCPConnectionManager                                │  ││
│  │  │                                                                        │  ││
│  │  │  连接池:                                                               │  ││
│  │  │  ┌─────────────────────────────────────────────────────────────────┐  │  ││
│  │  │  │ serverName -> { client, config, userCredentials }               │  │  ││
│  │  │  │                                                                  │  │  ││
│  │  │  │ filesystem -> { client: Client, public: true }                  │  │  ││
│  │  │  │ firecrawl:user-001 -> { client: Client, credentials: {...} }    │  │  ││
│  │  │  │ firecrawl:user-002 -> { client: Client, credentials: {...} }    │  │  ││
│  │  │  └─────────────────────────────────────────────────────────────────┘  │  ││
│  │  │                                                                        │  ││
│  │  │  功能:                                                                 │  ││
│  │  │  - 动态启动/停止 MCP Server 进程                                       │  ││
│  │  │  - 按用户隔离凭证                                                      │  ││
│  │  │  - 聚合工具定义                                                        │  ││
│  │  │  - 路由工具调用                                                        │  ││
│  │  └───────────────────────────────────────────────────────────────────────┘  ││
│  │                                                                              ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
│                                      │                                           │
│                                      │ STDIO (MCP JSON-RPC)                      │
│                                      ▼                                           │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │ filesystem MCP   │  │ firecrawl MCP    │  │ gitea MCP        │              │
│  │ (公共，1进程)    │  │ (每用户1进程)    │  │ (每用户1进程)    │              │
│  │                  │  │                  │  │                  │              │
│  │ Tools:           │  │ Tools:           │  │ Tools:           │              │
│  │ - read_file      │  │ - crawl          │  │ - create_issue   │              │
│  │ - write_file     │  │ - search         │  │ - list_repos     │              │
│  │ - list_dir       │  │ - extract        │  │ - get_file       │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 MCP Server 类型

| 类型 | 描述 | 进程模式 | 凭证来源 |
|------|------|----------|----------|
| **公共 MCP** | 所有用户共享，无需凭证 | 单进程 | 系统配置 |
| **用户隔离 MCP** | 每用户独立进程，需要用户凭证 | 每用户一进程 | 用户配置 |
| **团队共享 MCP** | 团队内共享，团队级凭证 | 每团队一进程 | 团队配置 |

---

## 3. 数据库设计

### 3.1 mcp_servers 表

```sql
CREATE TABLE mcp_servers (
  id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE COMMENT 'MCP Server 名称',
  display_name VARCHAR(128) COMMENT '显示名称',
  description TEXT COMMENT '描述',
  command VARCHAR(256) NOT NULL COMMENT '启动命令',
  args JSON COMMENT '命令参数',
  env_template JSON COMMENT '环境变量模板，支持 ${user.xxx} 占位符',
  is_public BIT(1) DEFAULT b'0' COMMENT '是否公共（无需用户凭证）',
  is_enabled BIT(1) DEFAULT b'1' COMMENT '是否启用',
  requires_credentials BIT(1) DEFAULT b'0' COMMENT '是否需要用户凭证',
  credential_fields JSON COMMENT '凭证字段定义，如 [{"name":"API_KEY","label":"API Key","type":"password"}]',
  created_by VARCHAR(32) COMMENT '创建者',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

**env_template 示例**:

```json
// 公共 MCP（无用户凭证）
{
  "NODE_ENV": "production"
}

// 需要用户凭证的 MCP
{
  "FIRECRAWL_API_KEY": "${user.API_KEY}",  // 占位符，从用户凭证中获取
  "FIRECRAWL_BASE_URL": "https://api.firecrawl.dev"
}
```

### 3.2 mcp_credentials 表（系统默认凭证）

```sql
CREATE TABLE mcp_credentials (
  id VARCHAR(32) PRIMARY KEY,
  mcp_server_id VARCHAR(32) NOT NULL COMMENT 'MCP Server ID',
  credentials JSON NOT NULL COMMENT '系统默认凭证（加密存储）',
  is_enabled BIT(1) DEFAULT b'1' COMMENT '是否启用',
  created_by VARCHAR(32) COMMENT '创建者（管理员）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_server (mcp_server_id),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id)
);
```

**用途**：
- 存储系统级的默认凭证，供所有用户共享使用
- 管理员可以配置默认凭证，让用户无需单独配置即可使用 MCP 服务
- 用户级凭证优先级高于系统默认凭证

### 3.3 mcp_user_credentials 表（用户私有凭证）

```sql
CREATE TABLE mcp_user_credentials (
  id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32) NOT NULL COMMENT '用户ID',
  mcp_server_id VARCHAR(32) NOT NULL COMMENT 'MCP Server ID',
  credentials JSON NOT NULL COMMENT '用户凭证（加密存储）',
  is_enabled BIT(1) DEFAULT b'1' COMMENT '是否启用',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_user_server (user_id, mcp_server_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id)
);
```

**用途**：
- 存储用户私有的凭证，实现用户隔离
- 用户可以覆盖系统默认凭证，使用自己的 API Key

### 3.4 凭证优先级

```
用户调用 MCP 工具
        │
        ▼
检查 mcp_user_credentials 表
        │
        ├─► [有用户凭证] 使用用户凭证
        │
        └─► [无用户凭证] 检查 mcp_credentials 表
                │
                ├─► [有系统默认凭证] 使用系统默认凭证
                │
                └─► [无任何凭证] 返回错误，提示用户配置
```

### 3.5 mcp_tools_cache 表

```sql
CREATE TABLE mcp_tools_cache (
  id VARCHAR(32) PRIMARY KEY,
  mcp_server_id VARCHAR(32) NOT NULL COMMENT 'MCP Server ID',
  tool_name VARCHAR(64) NOT NULL COMMENT '工具名称',
  description TEXT COMMENT '工具描述',
  input_schema JSON COMMENT '输入参数定义',
  cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uk_server_tool (mcp_server_id, tool_name),
  FOREIGN KEY (mcp_server_id) REFERENCES mcp_servers(id)
);
```

---

## 4. MCP Client 驻留进程设计

### 4.1 核心逻辑

**位置**: `data/skills/mcp-client/index.js`

```javascript
#!/usr/bin/env node
/**
 * MCP Client - Resident Process
 *
 * 管理与多个 MCP Server 的连接，支持：
 * - 公共 MCP Server（单进程共享）
 * - 用户隔离 MCP Server（每用户独立进程）
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

// 连接池: key -> { client, config, process }
// 公共 MCP: serverName -> connection
// 用户 MCP: serverName:userId -> connection
const connections = new Map();

// 工具定义缓存
const toolsCache = new Map(); // serverName -> tools[]

// 数据库文件路径（从环境变量获取）
const DB_PATH = process.env.MCP_DB_PATH || './data/mcp-db.json';

/**
 * 加载 MCP Server 配置（从数据库文件）
 */
function loadMCPServers() {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data).servers || [];
  } catch (err) {
    console.error(`[mcp-client] Failed to load config: ${err.message}`);
    return [];
  }
}

/**
 * 加载凭证（按优先级：用户凭证 > 系统默认凭证）
 * @param {string} userId - 用户ID
 * @param {string} serverId - MCP Server ID
 * @returns {Object|null} 凭证对象
 */
function loadCredentials(userId, serverId) {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    const dbData = JSON.parse(data);
    
    // 1. 优先查找用户私有凭证
    const userCredentials = (dbData.user_credentials || []).find(
      c => c.user_id === userId && c.mcp_server_id === serverId && c.is_enabled
    );
    if (userCredentials) {
      console.error(`[mcp-client] Using user credentials for ${serverId}`);
      return userCredentials;
    }
    
    // 2. 查找系统默认凭证
    const defaultCredentials = (dbData.default_credentials || []).find(
      c => c.mcp_server_id === serverId && c.is_enabled
    );
    if (defaultCredentials) {
      console.error(`[mcp-client] Using default credentials for ${serverId}`);
      return defaultCredentials;
    }
    
    // 3. 无凭证
    return null;
  } catch (err) {
    console.error(`[mcp-client] Failed to load credentials: ${err.message}`);
    return null;
  }
}

/**
 * 构建环境变量（替换占位符）
 */
function buildEnv(envTemplate, userCredentials) {
  const env = { ...process.env };
  
  for (const [key, value] of Object.entries(envTemplate || {})) {
    if (typeof value === 'string' && value.startsWith('${user.')) {
      // 替换用户凭证占位符
      const fieldName = value.match(/\$\{user\.(\w+)\}/)?.[1];
      if (fieldName && userCredentials?.credentials?.[fieldName]) {
        env[key] = userCredentials.credentials[fieldName];
      } else {
        console.error(`[mcp-client] Missing user credential: ${fieldName}`);
        return null; // 凭证缺失
      }
    } else {
      env[key] = value;
    }
  }
  
  return env;
}

/**
 * 连接到 MCP Server
 * @param {Object} serverConfig - MCP Server 配置
 * @param {string} userId - 用户ID（可选，公共 MCP 不需要）
 * @returns {Promise<Client>}
 */
async function connectServer(serverConfig, userId = null) {
  // 构建连接 key
  const connectionKey = userId ? `${serverConfig.name}:${userId}` : serverConfig.name;
  
  // 检查是否已连接
  if (connections.has(connectionKey)) {
    return connections.get(connectionKey).client;
  }
  
  // 获取凭证（如果需要）
  let credentials = null;
  if (serverConfig.requires_credentials) {
    credentials = loadCredentials(userId, serverConfig.id);
    if (!credentials) {
      throw new Error(`No credentials available for ${serverConfig.name}. Please configure credentials in MCP management panel.`);
    }
  }
  
  // 构建环境变量
  const env = buildEnv(serverConfig.env_template, credentials);
  if (!env) {
    throw new Error(`Missing credentials for ${serverConfig.name}`);
  }
  
  // 启动 MCP Server 进程
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env: env,
  });
  
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
  
  await client.connect(transport);
  
  // 存储连接
  connections.set(connectionKey, {
    client,
    config: serverConfig,
    userId,
    startedAt: new Date().toISOString(),
  });
  
  // 获取并缓存工具定义
  await cacheTools(serverConfig.name, client);
  
  console.error(`[mcp-client] Connected: ${connectionKey}`);
  
  return client;
}

/**
 * 缓存工具定义
 */
async function cacheTools(serverName, client) {
  try {
    const response = await client.request(
      { method: 'tools/list' },
      { method: 'tools/list' }
    );
    
    const tools = response.tools || [];
    toolsCache.set(serverName, tools);
    
    console.error(`[mcp-client] Cached ${tools.length} tools for ${serverName}`);
  } catch (err) {
    console.error(`[mcp-client] Failed to get tools from ${serverName}: ${err.message}`);
  }
}

/**
 * 获取用户可用的所有工具
 * @param {string} userId - 用户ID
 * @returns {Array} 工具列表
 */
async function getUserTools(userId) {
  const servers = loadMCPServers();
  const allTools = [];
  
  for (const server of servers) {
    if (!server.is_enabled) continue;
    
    // 公共 MCP：所有用户可用
    if (server.is_public) {
      const tools = toolsCache.get(server.name) || [];
      for (const tool of tools) {
        allTools.push({
          name: `mcp_${server.name}_${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
          server_name: server.name,
          original_name: tool.name,
          is_public: true,
        });
      }
    }
    
    // 用户隔离 MCP：检查凭证（用户凭证或系统默认凭证）
    if (server.requires_credentials) {
      const credentials = loadCredentials(userId, server.id);
      if (credentials) {
        // 确保连接已建立
        const connectionKey = `${server.name}:${userId}`;
        if (!connections.has(connectionKey)) {
          try {
            await connectServer(server, userId);
          } catch (err) {
            console.error(`[mcp-client] Failed to connect ${connectionKey}: ${err.message}`);
            continue;
          }
        }
        
        const tools = toolsCache.get(server.name) || [];
        for (const tool of tools) {
          allTools.push({
            name: `mcp_${server.name}_${tool.name}`,
            description: tool.description,
            inputSchema: tool.inputSchema,
            server_name: server.name,
            original_name: tool.name,
            is_public: false,
            user_id: userId,
            credential_source: credentials.user_id ? 'user' : 'default',
          });
        }
      }
    }
  }
  
  return allTools;
}

/**
 * 调用 MCP 工具
 */
async function callTool(serverName, toolName, arguments, userId) {
  // 公共 MCP
  const connectionKey = connections.has(serverName) ? serverName : `${serverName}:${userId}`;
  
  const conn = connections.get(connectionKey);
  if (!conn) {
    throw new Error(`MCP Server '${serverName}' not connected for user ${userId}`);
  }
  
  const response = await conn.client.request(
    {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: arguments || {},
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
    };
  }
  
  return response;
}

/**
 * 处理主进程命令
 */
async function handleCommand(cmd) {
  const { command, task_id, params, user } = cmd;
  const userId = user?.userId || null;
  
  try {
    let result;
    
    switch (params.action || command) {
      case 'list_tools':
        // 获取用户可用的所有工具
        result = { tools: await getUserTools(userId) };
        break;
        
      case 'call_tool':
        // 调用 MCP 工具
        result = await callTool(params.server_name, params.tool_name, params.arguments, userId);
        break;
        
      case 'list_servers':
        // 获取 MCP Server 列表
        const servers = loadMCPServers();
        result = {
          servers: servers.map(s => ({
            id: s.id,
            name: s.name,
            display_name: s.display_name,
            is_public: s.is_public,
            requires_credentials: s.requires_credentials,
            is_enabled: s.is_enabled,
            connected: connections.has(s.name) || connections.has(`${s.name}:${userId}`),
          })),
        };
        break;
        
      case 'connect_server':
        // 连接到指定 MCP Server
        const serverConfig = loadMCPServers().find(s => s.name === params.server_name);
        if (!serverConfig) {
          throw new Error(`MCP Server '${params.server_name}' not found`);
        }
        await connectServer(serverConfig, userId);
        result = { message: `Connected to ${params.server_name}` };
        break;
        
      case 'disconnect_server':
        // 断开连接
        const disconnectKey = params.server_name.includes(':') 
          ? params.server_name 
          : (userId ? `${params.server_name}:${userId}` : params.server_name);
        
        const conn = connections.get(disconnectKey);
        if (conn) {
          await conn.client.close();
          connections.delete(disconnectKey);
          result = { message: `Disconnected from ${disconnectKey}` };
        } else {
          result = { message: `Connection ${disconnectKey} not found` };
        }
        break;
        
      case 'refresh_tools':
        // 刷新工具定义缓存
        for (const [key, conn] of connections) {
          const serverName = key.split(':')[0];
          await cacheTools(serverName, conn.client);
        }
        result = { message: 'Tools cache refreshed' };
        break;
        
      case 'ping':
        result = { pong: true, timestamp: Date.now(), connections: connections.size };
        break;
        
      case 'init':
        // 初始化：连接所有公共 MCP Server
        const allServers = loadMCPServers();
        for (const server of allServers) {
          if (server.is_public && server.is_enabled) {
            try {
              await connectServer(server);
            } catch (err) {
              console.error(`[mcp-client] Failed to init ${server.name}: ${err.message}`);
            }
          }
        }
        result = { 
          message: 'Initialized',
          public_servers: allServers.filter(s => s.is_public && s.is_enabled).map(s => s.name),
        };
        break;
        
      default:
        throw new Error(`Unknown action: ${params.action || command}`);
    }
    
    sendResponse({ task_id, result, success: true });
    
  } catch (err) {
    sendResponse({ task_id, error: err.message, success: false });
  }
}

/**
 * 发送响应到 stdout
 */
function sendResponse(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

/**
 * 主循环
 */
async function main() {
  console.error('[mcp-client] Starting MCP Client resident process...');
  
  // 初始化公共 MCP Server
  await handleCommand({
    command: 'init',
    task_id: 'init',
    params: { action: 'init' },
    user: {},
  });
  
  // 监听 stdin
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
  
  // 通知主进程已就绪
  sendResponse({
    type: 'ready',
    name: 'mcp-client',
    pid: process.pid,
    connections: connections.size,
  });
  
  for await (const line of rl) {
    if (!line.trim()) continue;
    
    try {
      const cmd = JSON.parse(line);
      handleCommand(cmd).catch(err => {
        console.error(`[mcp-client] Command error: ${err.message}`);
      });
    } catch (err) {
      console.error(`[mcp-client] Invalid JSON: ${err.message}`);
    }
  }
}

// 处理退出信号
process.on('SIGTERM', async () => {
  for (const [key, conn] of connections) {
    await conn.client.close();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  for (const [key, conn] of connections) {
    await conn.client.close();
  }
  process.exit(0);
});

main().catch(err => {
  console.error(`[mcp-client] Fatal error: ${err.message}`);
  process.exit(1);
});
```

---

## 5. 前端管理界面设计

### 5.1 界面结构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  MCP 服务管理                                                    [关闭] [帮助] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  已配置的 MCP Server                                                 │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │ 📁 filesystem                              [公共] ✓ 已连接    │  │    │
│  │  │ 文件系统操作工具                                              │  │    │
│  │  │ 工具: read_file, write_file, list_dir, search                │  │    │
│  │  │                                              [查看工具] [断开] │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │ 🔥 firecrawl                          [需凭证] ✓ 已配置      │  │    │
│  │  │ 网页爬取和搜索工具                                            │  │    │
│  │  │ 工具: crawl, search, extract                                  │  │    │
│  │  │                                              [配置凭证] [连接] │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │ 🦊 gitea                                [需凭证] ○ 未配置      │  │    │
│  │  │ Gitea 仓库管理工具                                            │  │    │
│  │  │ 工具: create_issue, list_repos, get_file                      │  │    │
│  │  │                                              [配置凭证] [连接] │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  │                                                                      │    │
│  │                                              [+ 添加 MCP Server]     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  我的凭证配置                                                         │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │ 🔥 firecrawl                                                   │  │    │
│  │  │ API Key: [fc-********************************] [显示] [测试]  │  │    │
│  │  │ 状态: ✓ 已验证                              [保存] [删除]     │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  │                                                                      │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │ 🦊 gitea                                                       │  │    │
│  │  │ Token:  [尚未配置]                              [配置凭证]     │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 功能模块

| 模块 | 功能 | API |
|------|------|-----|
| **MCP Server 列表** | 显示所有已配置的 MCP Server | `GET /api/mcp/servers` |
| **添加 MCP Server** | 添加新的 MCP Server 配置 | `POST /api/mcp/servers` |
| **查看工具** | 展开显示 MCP Server 的工具列表 | `GET /api/mcp/servers/:id/tools` |
| **配置凭证** | 用户配置自己的 API Key/Token | `POST /api/mcp/credentials` |
| **测试连接** | 测试 MCP Server 连接是否正常 | `POST /api/mcp/servers/:id/test` |
| **连接/断开** | 手动连接或断开 MCP Server | `POST /api/mcp/servers/:id/connect` |

### 5.3 API 设计

```javascript
// server/routes/mcp.routes.js

import Router from '@koa/router';

const router = new Router({ prefix: '/api/mcp' });

// 获取 MCP Server 列表
router.get('/servers', async (ctx) => {
  const MCPServer = ctx.db.getModel('mcp_server');
  const userId = ctx.state.user.id;
  
  const servers = await MCPServer.findAll({ where: { is_enabled: true }, raw: true });
  
  // 检查用户凭证状态
  const MCPCredential = ctx.db.getModel('mcp_user_credential');
  const userCreds = await MCPCredential.findAll({ where: { user_id: userId }, raw: true });
  
  const result = servers.map(server => ({
    ...server,
    has_credentials: userCreds.some(c => c.mcp_server_id === server.id && c.is_enabled),
  }));
  
  ctx.body = { servers: result };
});

// 获取 MCP Server 工具列表
router.get('/servers/:id/tools', async (ctx) => {
  const MCPToolCache = ctx.db.getModel('mcp_tools_cache');
  const tools = await MCPToolCache.findAll({ 
    where: { mcp_server_id: ctx.params.id }, 
    raw: true 
  });
  
  ctx.body = { tools };
});

// 配置用户凭证
router.post('/credentials', async (ctx) => {
  const { mcp_server_id, credentials } = ctx.request.body;
  const userId = ctx.state.user.id;
  
  const MCPCredential = ctx.db.getModel('mcp_user_credential');
  
  // 加密存储凭证
  const encryptedCredentials = encryptCredentials(credentials);
  
  await MCPCredential.upsert({
    id: `${userId}_${mcp_server_id}`,
    user_id: userId,
    mcp_server_id,
    credentials: encryptedCredentials,
    is_enabled: true,
  });
  
  ctx.body = { success: true };
});

// 测试连接
router.post('/servers/:id/test', async (ctx) => {
  const residentManager = getResidentSkillManager(ctx.db);
  
  const result = await residentManager.invokeByName('mcp-client', 'invoke', {
    action: 'connect_server',
    server_name: ctx.params.id,
  }, {
    userId: ctx.state.user.id,
    accessToken: ctx.state.token,
  });
  
  ctx.body = result;
});

// 添加 MCP Server（管理员）
router.post('/servers', async (ctx) => {
  // 验证管理员权限
  if (!ctx.state.user.is_admin) {
    ctx.status = 403;
    ctx.body = { error: 'Admin only' };
    return;
  }
  
  const MCPServer = ctx.db.getModel('mcp_server');
  const server = await MCPServer.create({
    id: ctx.db.utils.newID(16),
    ...ctx.request.body,
    created_by: ctx.state.user.id,
  });
  
  ctx.body = { success: true, server };
});
```

---

## 6. 工具暴露策略

### 6.1 方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **动态注入** | 在获取工具定义时，动态合并 MCP 工具 | 与 Skill 工具统一，LLM 直接可用 | 工具列表可能很长 |
| **探索技能** | 给 LLM 一个技能来探索 MCP 工具 | 工具列表简洁，按需探索 | 需要额外对话轮次 |
| **管理界面展开** | 用户在界面手动选择要暴露的工具 | 用户可控，精确暴露 | 需要用户手动操作 |

### 6.2 推荐方案：动态注入 + 按需加载

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          工具暴露流程                                         │
│                                                                              │
│  1. 用户打开对话                                                             │
│         │                                                                    │
│         ▼                                                                    │
│  2. ToolManager.getToolDefinitions(expertId)                                │
│         │                                                                    │
│         ├─► 获取 Skill 工具                                                  │
│         │                                                                    │
│         ├─► 调用 mcp-client list_tools (带 userId)                           │
│         │         │                                                          │
│         │         ├─► 公共 MCP 工具 ✓ 返回                                   │
│         │         │                                                          │
│         │         ├─► 用户已配置凭证的 MCP 工具 ✓ 返回                        │
│         │         │                                                          │
│         │         └─► 用户未配置凭证的 MCP 工具 ✗ 不返回                      │
│         │                                                                    │
│         ▼                                                                    │
│  3. 合并返回给 LLM                                                           │
│         │                                                                    │
│         ▼                                                                    │
│  4. LLM 看到所有可用工具（Skill + MCP）                                       │
│         │                                                                    │
│         ▼                                                                    │
│  5. LLM 调用 MCP 工具时，自动使用用户凭证                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**关键点**：
- MCP 工具与 Skill 工具统一暴露，LLM 无需区分
- 只暴露用户有权限使用的 MCP 工具
- 工具调用时自动注入用户凭证

### 6.3 System Prompt 注入（可选）

如果工具列表过长，可以在 System Prompt 中简要说明：

```
你可以使用以下 MCP 服务：
- filesystem: 文件系统操作（公共）
- firecrawl: 网页爬取（已配置）
- gitea: 仓库管理（尚未配置凭证）

如需使用 gitea，请提示用户先在 MCP 管理界面配置凭证。
```

---

## 7. 完整数据流与 LLM 交互

### 7.1 LLM 调用 MCP 工具的完整流程

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        LLM 调用 MCP 工具完整流程                                  │
└─────────────────────────────────────────────────────────────────────────────────┘

1. 用户发送消息
   ┌──────────────┐
   │    用户      │ "帮我抓取 https://example.com 的内容"
   └──────┬───────┘
          │
          ▼
2. Expert 接收消息，调用 LLM
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ Expert (ChatService)                                                         │
   │                                                                              │
   │  1. 获取工具定义                                                              │
   │     ToolManager.getToolDefinitions(expertId, userId)                         │
   │         │                                                                    │
   │         ├─► 查询 skill_tools 表获取 Skill 工具                               │
   │         │                                                                    │
   │         └─► 调用 MCP Client 驻留进程获取 MCP 工具                            │
   │              residentManager.invokeByName('mcp-client', 'invoke', {          │
   │                action: 'list_tools'                                          │
   │              }, { userId })                                                  │
   │                                                                              │
   │  2. 构建请求发送给 LLM                                                        │
   │     POST /v1/chat/completions                                                │
   │     {                                                                        │
   │       "model": "gpt-4",                                                      │
   │       "messages": [...],                                                     │
   │       "tools": [                                                             │
   │         { "type": "function", "function": { "name": "mcp_firecrawl_scrape", "description": "...", "parameters": {...} } },│
   │         ...                                                                  │
   │       ]                                                                      │
   │     }                                                                        │
   └──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
3. LLM 返回工具调用请求
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ LLM Response                                                                 │
   │                                                                              │
   │  {                                                                           │
   │    "choices": [{                                                             │
   │      "message": {                                                            │
   │        "role": "assistant",                                                  │
   │        "content": null,                                                      │
   │        "tool_calls": [{                                                      │
   │          "id": "call_abc123",                                                │
   │          "type": "function",                                                 │
   │          "function": {                                                       │
   │            "name": "mcp_firecrawl_scrape",                                   │
   │            "arguments": "{\"url\": \"https://example.com\"}"                 │
   │          }                                                                   │
   │        }]                                                                    │
   │      }                                                                       │
   │    }]                                                                        │
   │  }                                                                           │
   └──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
4. ToolManager 执行工具调用
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ ToolManager.executeTool('mcp_firecrawl_scrape', {url: 'https://example.com'})│
   │                                                                              │
   │  1. 解析工具名                                                               │
   │     serverName = 'firecrawl'                                                 │
   │     toolName = 'scrape'                                                      │
   │                                                                              │
   │  2. 检查凭证                                                                 │
   │     查询 mcp_user_credentials 表 (userId + serverId)                         │
   │     └─► 有用户凭证 → 使用用户凭证                                            │
   │     └─► 无用户凭证 → 查询 mcp_credentials 表                                 │
   │         └─► 有系统默认凭证 → 使用系统默认凭证                                │
   │         └─► 无任何凭证 → 返回错误                                            │
   │                                                                              │
   │  3. 调用驻留进程                                                             │
   │     residentManager.invokeByName('mcp-client', 'invoke', {                   │
   │       action: 'call_tool',                                                   │
   │       server_name: 'firecrawl',                                              │
   │       tool_name: 'scrape',                                                   │
   │       arguments: { url: 'https://example.com' }                              │
   │     }, { userId, accessToken })                                              │
   └──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
5. MCP Client 驻留进程处理
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ MCP Client 驻留进程                                                          │
   │                                                                              │
   │  1. 接收命令 (stdin)                                                         │
   │     { "command": "invoke", "task_id": "xxx", "params": {...}, "user": {...} }│
   │                                                                              │
   │  2. 查找连接                                                                 │
   │     connectionKey = 'firecrawl:user-001'                                     │
   │     └─► 已连接 → 使用现有连接                                                │
   │     └─► 未连接 → 启动 MCP Server 进程并连接                                  │
   │                                                                              │
   │  3. 调用 MCP Server                                                          │
   │     client.request({                                                         │
   │       method: 'tools/call',                                                  │
   │       params: { name: 'scrape', arguments: { url: '...' } }                  │
   │     })                                                                       │
   │                                                                              │
   │  4. 返回结果 (stdout)                                                        │
   │     { "task_id": "xxx", "result": {...}, "success": true }                   │
   └──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
6. MCP Server 执行并返回
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ firecrawl MCP Server                                                         │
   │                                                                              │
   │  1. 接收 MCP 请求                                                            │
   │     { "jsonrpc": "2.0", "method": "tools/call", "params": {...}, "id": 1 }   │
   │                                                                              │
   │  2. 执行工具逻辑                                                              │
   │     调用 Firecrawl API 抓取网页                                              │
   │                                                                              │
   │  3. 返回 MCP 响应                                                            │
   │     {                                                                        │
   │       "jsonrpc": "2.0", "id": 1,                                             │
   │       "result": {                                                            │
   │         "content": [                                                         │
   │           { "type": "text", "text": "# Example Domain\n\n这是抓取的内容..." } │
   │         ]                                                                    │
   │       }                                                                      │
   │     }                                                                        │
   └──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
7. 结果返回给 LLM
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ ToolManager 处理结果                                                         │
   │                                                                              │
   │  1. 解析 MCP 响应                                                            │
   │     result.content = "# Example Domain\n\n这是抓取的内容..."                  │
   │                                                                              │
   │  2. 构建工具结果消息                                                          │
   │     {                                                                        │
   │       "role": "tool",                                                        │
   │       "tool_call_id": "call_abc123",                                         │
   │       "content": "# Example Domain\n\n这是抓取的内容..."                      │
   │     }                                                                        │
   │                                                                              │
   │  3. 发送给 LLM 继续对话                                                       │
   │     POST /v1/chat/completions                                                │
   │     {                                                                        │
   │       "model": "gpt-4",                                                      │
   │       "messages": [                                                          │
   │         { "role": "user", "content": "帮我抓取..." },                        │
   │         { "role": "assistant", "tool_calls": [...] },                        │
   │         { "role": "tool", "tool_call_id": "call_abc123", "content": "..." }  │
   │       ]                                                                      │
   │     }                                                                        │
   └──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
8. LLM 生成最终回复
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │ LLM 最终回复                                                                 │
   │                                                                              │
   │  {                                                                           │
   │    "choices": [{                                                             │
   │      "message": {                                                            │
   │        "role": "assistant",                                                  │
   │        "content": "我已经抓取了 https://example.com 的内容。网页标题是..."    │
   │      }                                                                       │
   │    }]                                                                        │
   │  }                                                                           │
   └──────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
9. 返回给用户
   ┌──────────────┐
   │    用户      │ 收到回复："我已经抓取了..."
   └──────────────┘
```

### 7.2 返回消息格式

#### 7.2.1 成功响应

MCP 工具返回的内容格式：

```javascript
// MCP Server 返回格式
{
  "content": [
    { "type": "text", "text": "这是文本内容" },
    { "type": "image", "data": "base64...", "mimeType": "image/png" },
    { "type": "resource", "resource": { "uri": "file://...", "mimeType": "..." } }
  ]
}

// ToolManager 转换后返回给 LLM 的格式
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "这是文本内容"  // 只取 text 类型的内容
}
```

#### 7.2.2 错误响应

```javascript
// 凭证缺失错误
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "【错误】使用 firecrawl 服务需要配置 API 凭证。\n\n请在 MCP 服务管理面板中配置您的 Firecrawl API Key。\n\n配置路径：设置 → MCP 服务 → firecrawl → 配置凭证",
  "is_error": true
}

// 连接失败错误
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "【错误】无法连接到 firecrawl MCP Server：连接超时\n\n请检查网络连接或稍后重试。",
  "is_error": true
}

// 工具执行错误
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "【错误】工具执行失败：URL 格式无效\n\n请提供有效的 URL，例如：https://example.com",
  "is_error": true
}
```

### 7.3 驻留进程与数据库交互

**问题**：当前设计使用 JSON 文件存储配置，但应该直接查询数据库。

**解决方案**：驻留进程通过内部 API 与主进程数据库交互。

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    驻留进程与数据库交互                                           │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐         ┌──────────────────────┐
│   MCP Client         │         │     主进程            │
│   驻留进程           │         │                      │
│                      │         │  ┌────────────────┐  │
│  需要查询配置时      │         │  │   数据库       │  │
│         │            │         │  │  - mcp_servers │  │
│         │ HTTP       │         │  │  - mcp_credentials│
│         ▼            │         │  │  - mcp_user_credentials│
│  ┌────────────────┐  │  POST   │  └────────────────┘  │
│  │ callAPI()      │──┼────────►│  /internal/mcp/config│
│  │                │  │         │                      │
│  │ 获取:          │◄─┼─────────│  返回配置数据        │
│  │ - MCP Server   │  │  JSON   │                      │
│  │   配置         │  │         │                      │
│  │ - 用户凭证     │  │         │                      │
│  └────────────────┘  │         │                      │
└──────────────────────┘         └──────────────────────┘
```

**内部 API 设计**：

```javascript
// server/routes/internal.routes.js

// 获取 MCP 配置（供驻留进程调用）
router.post('/mcp/config', async (ctx) => {
  const { server_ids, user_id } = ctx.request.body;
  
  const MCPServer = ctx.db.getModel('mcp_server');
  const MCPCredential = ctx.db.getModel('mcp_credential');
  const MCPUserCredential = ctx.db.getModel('mcp_user_credential');
  
  // 获取 MCP Server 配置
  const servers = await MCPServer.findAll({
    where: { is_enabled: true },
    raw: true,
  });
  
  // 获取系统默认凭证
  const defaultCredentials = await MCPCredential.findAll({
    where: { is_enabled: true },
    raw: true,
  });
  
  // 获取用户凭证
  const userCredentials = user_id ? await MCPUserCredential.findAll({
    where: { user_id, is_enabled: true },
    raw: true,
  }) : [];
  
  ctx.body = {
    servers,
    default_credentials: defaultCredentials,
    user_credentials: userCredentials,
  };
});
```

**驻留进程调用方式**：

```javascript
// data/skills/mcp-client/index.js

const API_BASE = process.env.API_BASE || 'http://localhost:3000';

/**
 * 从主进程获取 MCP 配置
 */
async function fetchConfig(userContext) {
  const response = await fetch(`${API_BASE}/internal/mcp/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userContext.accessToken}`,
    },
    body: JSON.stringify({
      user_id: userContext.userId,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch MCP config: ${response.status}`);
  }
  
  return response.json();
}
```

### 7.4 错误处理机制

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              错误处理流程                                         │
└─────────────────────────────────────────────────────────────────────────────────┘

                    工具调用请求
                          │
                          ▼
              ┌───────────────────────┐
              │ 检查 MCP Server 是否存在 │
              └───────────┬───────────┘
                          │
            ┌─────────────┼─────────────┐
            │ 不存在                    │ 存在
            ▼                           ▼
   ┌─────────────────┐        ┌───────────────────────┐
   │ 返回错误:        │        │ 检查是否需要凭证       │
   │ "MCP Server     │        └───────────┬───────────┘
   │  未配置"        │                    │
   └─────────────────┘      ┌─────────────┼─────────────┐
                            │ 不需要                    │ 需要
                            ▼                           ▼
                   ┌─────────────────┐     ┌───────────────────────┐
                   │ 直接调用工具     │     │ 检查凭证是否存在       │
                   └─────────────────┘     └───────────┬───────────┘
                                                      │
                                        ┌─────────────┼─────────────┐
                                        │ 不存在                    │ 存在
                                        ▼                           ▼
                               ┌─────────────────┐     ┌───────────────────────┐
                               │ 返回错误:        │     │ 检查连接是否已建立     │
                               │ "请先配置凭证"   │     └───────────┬───────────┘
                               │                 │                 │
                               │ + 配置引导      │     ┌───────────┼───────────┐
                               └─────────────────┘     │ 已建立                  │ 未建立
                                                       ▼                         ▼
                                              ┌─────────────────┐   ┌───────────────────────┐
                                              │ 调用 MCP 工具   │   │ 启动 MCP Server 进程  │
                                              └────────┬────────┘   └───────────┬───────────┘
                                                       │                        │
                                                       │              ┌─────────┼─────────┐
                                                       │              │ 成功                │ 失败
                                                       │              ▼                     ▼
                                                       │     ┌─────────────────┐ ┌─────────────────┐
                                                       │     │ 调用 MCP 工具   │ │ 返回错误:        │
                                                       │     └────────┬────────┘ │ "启动失败"      │
                                                       │              │          └─────────────────┘
                                                       │              │
                                                       ▼              ▼
                                              ┌─────────────────────────────┐
                                              │        工具执行              │
                                              └─────────────┬───────────────┘
                                                            │
                                              ┌─────────────┼─────────────┐
                                              │ 成功                      │ 失败
                                              ▼                           ▼
                                     ┌─────────────────┐       ┌─────────────────┐
                                     │ 返回结果给 LLM  │       │ 返回错误给 LLM  │
                                     └─────────────────┘       └─────────────────┘
```

### 7.5 凭证缺失时的友好提示

当用户调用需要凭证的 MCP 工具但未配置时，返回给 LLM 的消息应该包含引导信息：

```javascript
// ToolManager.executeMcpTool()

async executeMcpTool(toolName, args, context) {
  const { serverName, originalToolName } = parseMcpToolName(toolName);
  
  // 检查凭证
  const hasCredentials = await this.checkCredentials(serverName, context.userId);
  
  if (!hasCredentials) {
    // 返回友好的引导信息
    return {
      error: 'credentials_required',
      message: `使用 ${serverName} 服务需要配置 API 凭证。`,
      instructions: [
        `1. 打开 MCP 服务管理面板`,
        `2. 找到 ${serverName} 服务`,
        `3. 点击"配置凭证"`,
        `4. 输入您的 API Key`,
      ],
      help_url: `/settings/mcp/${serverName}`,
    };
  }
  
  // ... 继续执行
}
```

LLM 收到这个错误后，会生成友好的提示：

```
抱歉，使用 firecrawl 服务需要先配置 API 凭证。

请按以下步骤操作：
1. 打开 MCP 服务管理面板
2. 找到 firecrawl 服务
3. 点击"配置凭证"
4. 输入您的 Firecrawl API Key

如果您没有 API Key，可以在 https://firecrawl.dev 注册获取。
```

---

## 8. 实施步骤

| 步骤 | 任务 | 文件 | 预估时间 |
|------|------|------|----------|
| 1 | 创建数据库表 | `scripts/upgrade-database.js` | 1h |
| 2 | 创建 MCP Client 驻留进程 | `data/skills/mcp-client/index.js` | 3h |
| 3 | 创建 MCP API 路由 | `server/routes/mcp.routes.js` | 2h |
| 4 | 创建前端管理界面 | `frontend/src/components/MCPPanel.vue` | 4h |
| 5 | 修改 ToolManager 集成 | `lib/tool-manager.js` | 1h |
| 6 | 测试验证 | - | 2h |
| **总计** | | | **13h** |

---

## 8. 总结

### 8.1 问题解答

| 问题 | 答案 |
|------|------|
| 一个驻留技能能否支持多个 MCP 服务？ | ✅ 可以，通过连接池管理多个 MCP Server |
| 不同用户访问同一 MCP 服务需要不同凭证？ | ✅ 支持，通过 `mcp_user_credentials` 表隔离 |
| 管理界面如何设计？ | ✅ 前端面板 + API，支持添加服务、配置凭证 |
| 工具如何暴露给 LLM？ | ✅ 动态注入到工具列表，与 Skill 工具统一 |

### 8.2 核心设计要点

1. **多 MCP 支持**: 一个驻留进程管理多个 MCP Server 连接
2. **凭证三级优先级**: 用户私有凭证 > 系统默认凭证 > 无凭证报错
3. **公共 MCP**: 单进程共享，无需用户凭证
4. **工具动态注入**: 根据用户权限动态暴露 MCP 工具

### 8.3 数据库表总结

| 表名 | 用途 | 凭证来源 |
|------|------|----------|
| `mcp_servers` | MCP Server 定义 | 系统配置 |
| `mcp_credentials` | 系统默认凭证 | 管理员配置 |
| `mcp_user_credentials` | 用户私有凭证 | 用户配置 |
| `mcp_tools_cache` | 工具定义缓存 | 自动缓存 |

---

*创建时间: 2026-04-10*
*状态: 设计方案 v2（完整版）*
*相关 Issue: #601*