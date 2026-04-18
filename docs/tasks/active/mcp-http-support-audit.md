# MCP 配置审计报告

> **审计日期**: 2026-04-18
> **审计人员**: Maria (AI Assistant)
> **审计范围**: MCP Server 配置系统全链路
> **关联 Issue**: #601 (MCP Client 驻留技能)

---

## 一、执行摘要

### 1.1 核心问题

**当前 MCP 配置仅支持 STDIO 方式，缺乏 HTTP Stream 方式的配置能力。**

由于 App Market 中的应用可能依赖远程 HTTP MCP 服务（如第三方 SaaS 提供的 MCP Server），当前设计无法满足以下场景：
- 调用远程 HTTP-based MCP Server（如 Firecrawl Cloud、GitHub MCP 等）
- 使用 Streamable HTTP Transport 与 MCP Server 通信
- 配置 HTTP headers（如 Authorization、API-Key）

### 1.2 影响评估

| 影响维度 | 严重程度 | 说明 |
|---------|---------|------|
| **App Market 兼容性** | 🔴 高 | 无法对接 HTTP MCP 服务，限制应用生态 |
| **用户配置体验** | 🟡 中 | 用户无法配置远程 MCP 服务 |
| **技术债务** | 🟡 中 | 后期需要数据库迁移和接口变更 |

---

## 二、详细审计发现

### 2.1 数据库模型层 (`models/mcp_server.js`)

**状态**: ❌ **缺失 HTTP 相关字段**

当前模型仅支持 STDIO 配置：

```javascript
// 当前字段（仅支持 STDIO）
command: DataTypes.STRING(256),  // 启动命令
args: DataTypes.TEXT,            // 命令参数
env_template: DataTypes.TEXT,    // 环境变量模板
```

**缺失字段**:
- `transport_type` (ENUM: 'stdio' | 'http' | 'sse') - 传输类型
- `url` (VARCHAR) - HTTP MCP Server 地址
- `headers` (TEXT/JSON) - HTTP 请求头配置

**参考 MCP SDK**:
```javascript
// MCP SDK 支持的 HTTP Transport
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL("https://example.com/mcp"),
  { headers: { Authorization: "Bearer token" } }
);
```

---

### 2.2 前端类型定义 (`frontend/src/types/index.ts`)

**状态**: ❌ **未定义 HTTP 相关类型**

当前 `McpServer` 接口:
```typescript
export interface McpServer {
  id: string
  name: string
  command: string        // ❌ 仅适用于 STDIO
  args: string | null     // ❌ 仅适用于 STDIO
  env: string | null      // ❌ 仅适用于 STDIO
  is_public: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}
```

**缺失类型定义**:
```typescript
export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface McpServer {
  id: string
  name: string
  transport_type: McpTransportType  // ✅ 新增
  // STDIO 专用（transport_type='stdio' 时必填）
  command?: string
  args?: string | null
  env?: string | null
  // HTTP 专用（transport_type='http' 时必填）
  url?: string                        // ✅ 新增
  headers?: string | null             // ✅ 新增（JSON 字符串）
  // 公共字段
  is_public: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}
```

---

### 2.3 前端界面 (`frontend/src/components/settings/McpTab.vue`)

**状态**: ❌ **表单仅支持 STDIO 配置**

第 199-252 行，Server 对话框仅包含 STDIO 字段：
```vue
<div class="form-item">
  <label class="form-label">{{ $t('settings.mcp.command') }} *</label>
  <input v-model="serverForm.command" type="text" />
</div>
<div class="form-item">
  <label class="form-label">{{ $t('settings.mcp.args') }}</label>
  <textarea v-model="serverForm.args" />
</div>
```

**缺失功能**:
- 传输类型选择器（radio/select: STDIO / HTTP / SSE）
- HTTP URL 输入框
- HTTP Headers 配置（JSON 格式）
- 动态表单验证（根据 transport_type 显示不同字段）

**建议界面结构**:
```
传输类型: [○ STDIO  ○ HTTP Stream  ○ SSE]

[STDIO 模式显示:]
  启动命令: [________________]
  参数:     [________________]
  环境变量: [________________]

[HTTP 模式显示:]
  URL:      [https://example.com/mcp]
  Headers:  { Authorization: "Bearer xxx" }
```

---

### 2.4 后端 API 服务 (`frontend/src/api/services.ts`)

**状态**: ❌ **API 类型与请求体未包含 HTTP 字段**

第 906-967 行，MCP 相关类型定义:
```typescript
export interface CreateMcpServerRequest {
  name: string
  command: string        // ❌ 应改为可选
  args?: string            // ❌ STDIO 专用
  env?: string             // ❌ STDIO 专用
  is_public?: boolean
  is_active?: boolean
  // ✅ 缺失: transport_type, url, headers
}
```

---

### 2.5 MCP 客户端驻留技能 (`data/skills/mcp-client/index.js`)

**状态**: ❌ **仅实现 STDIO Transport**

第 17-18 行，仅导入 STDIO Transport:
```javascript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
```

第 197-200 行，连接逻辑仅支持 STDIO:
```javascript
const transport = new StdioClientTransport({
  command: serverConfig.command,
  args: serverConfig.args || [],
  env: env,
});
```

**缺失实现**:
```javascript
// ✅ 需要添加 HTTP Transport 导入
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ✅ 需要动态选择 Transport
function createTransport(serverConfig, credentials) {
  switch (serverConfig.transport_type) {
    case 'http':
      return new StreamableHTTPClientTransport(
        new URL(serverConfig.url),
        { 
          headers: {
            ...parseHeaders(serverConfig.headers),
            ...buildAuthHeaders(credentials)
          }
        }
      );
    case 'stdio':
    default:
      return new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args || [],
        env: buildEnv(serverConfig.env_template, credentials)
      });
  }
}
```

---

### 2.6 内部 API 配置接口 (`server/controllers/internal.controller.js`)

**状态**: ❌ **配置响应未包含 HTTP 相关字段**

第 632-703 行，`getMcpConfig` 方法返回的 server 配置:
```javascript
ctx.success({
  servers: servers.map(s => ({
    id: s.id,
    name: s.name,
    command: s.command,      // ✅ STDIO
    args: s.args,            // ✅ STDIO
    env_template: s.env_template,  // ✅ STDIO
    // ❌ 缺失: transport_type, url, headers
  })),
  // ...
});
```

---

### 2.7 App Market 依赖检查 (`server/services/app-market.service.js`)

**状态**: ✅ **当前实现正确，但需考虑 HTTP MCP 兼容性**

第 237-244 行，`getConfiguredMcpServices` 方法:
```javascript
async getConfiguredMcpServices() {
  const servers = await this.models.McpServer.findAll({
    where: { is_enabled: true },
    attributes: ['name']
  });
  return servers.map(s => s.name);
}
```

**潜在问题**: 当前仅检查 `name`，如果 HTTP MCP 需要额外的连通性检查，可能需要扩展。

---

## 三、修复建议

### 3.1 数据库迁移

```javascript
// scripts/upgrade-database.js
{
  name: 'mcp_servers.add_transport_type_and_http_fields',
  check: async (conn) => {
    return await hasColumn(conn, 'mcp_servers', 'transport_type');
  },
  migrate: async (conn) => {
    await conn.execute(`
      ALTER TABLE mcp_servers 
      ADD COLUMN transport_type ENUM('stdio', 'http', 'sse') DEFAULT 'stdio' COMMENT '传输类型'
    `);
    await conn.execute(`
      ALTER TABLE mcp_servers 
      ADD COLUMN url VARCHAR(512) NULL COMMENT 'HTTP MCP Server URL'
    `);
    await conn.execute(`
      ALTER TABLE mcp_servers 
      ADD COLUMN headers TEXT NULL COMMENT 'HTTP Headers (JSON格式)'
    `);
  }
}
```

### 3.2 后端模型更新

修改 `models/mcp_server.js` 添加字段，然后运行 `node scripts/generate-models.js`。

### 3.3 前端类型更新

```typescript
// frontend/src/types/index.ts
export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface McpServer {
  id: string
  name: string
  transport_type: McpTransportType
  // STDIO
  command?: string
  args?: string | null
  env?: string | null
  // HTTP
  url?: string
  headers?: string | null
  // 公共
  is_public: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}
```

### 3.4 MCP 客户端技能更新

```javascript
// data/skills/mcp-client/index.js
// 1. 导入 HTTP Transport
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// 2. 动态创建 Transport
async function createTransport(serverConfig, credentials) {
  const type = serverConfig.transport_type || 'stdio';
  
  if (type === 'http') {
    const headers = parseHeaders(serverConfig.headers);
    // 合并凭证中的认证信息
    if (credentials?.api_key) {
      headers['Authorization'] = `Bearer ${credentials.api_key}`;
    }
    return new StreamableHTTPClientTransport(
      new URL(serverConfig.url),
      { headers }
    );
  }
  
  // STDIO (默认)
  return new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args || [],
    env: buildEnv(serverConfig.env_template, credentials)
  });
}
```

---

## 四、架构设计考量

### 4.1 传输类型枚举设计

| 类型 | 适用场景 | 安全性 | 复杂度 |
|------|---------|--------|--------|
| `stdio` | 本地/容器内 MCP Server | 高（进程隔离） | 低 |
| `http` | 远程 HTTP MCP Server | 中（TLS + Auth） | 中 |
| `sse` | Server-Sent Events 流 | 中 | 高 |

### 4.2 凭证处理策略

HTTP MCP 的凭证应支持：
1. **Header 注入**: 在 `headers` 字段配置 `Authorization`
2. **URL 嵌入**: 支持 `${user.API_KEY}` 占位符替换（如某些 MCP 服务使用 query param）
3. **凭证优先级**: 用户凭证 > 系统默认凭证 > 无凭证报错

---

## 五、实施计划

| 优先级 | 任务 | 文件/模块 | 预估工时 |
|--------|------|----------|---------|
| P0 | 数据库迁移 | `scripts/upgrade-database.js` | 1h |
| P0 | 后端模型更新 | `models/mcp_server.js` | 0.5h |
| P0 | 前端类型更新 | `frontend/src/types/index.ts` | 0.5h |
| P1 | 后端 API 更新 | `server/controllers/mcp.controller.js` | 1h |
| P1 | 内部 API 更新 | `server/controllers/internal.controller.js` | 0.5h |
| P1 | 前端界面更新 | `frontend/src/components/settings/McpTab.vue` | 2h |
| P1 | API 服务更新 | `frontend/src/api/services.ts` | 0.5h |
| P2 | MCP 客户端技能更新 | `data/skills/mcp-client/index.js` | 3h |
| P2 | 测试验证 | 全链路测试 | 2h |
| **总计** | | | **11h** |

---

## 六、参考文档

- [MCP Client 驻留技能设计方案](../design/mcp-client-resident-design.md)
- [MCP SDK Transport 文档](https://github.com/modelcontextprotocol/typescript-sdk)
- [代码审计清单](./code-review-checklist.md)

---

*审计完成时间: 2026-04-18*
*审计人员: Maria 🌸*
*下次复查: 修复完成后*

✌Bazinga！
