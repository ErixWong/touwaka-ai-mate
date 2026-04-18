# MCP Client

name: mcp-client

> 通用 MCP (Model Context Protocol) 客户端，支持多 MCP Server 连接管理（STDIO / HTTP Stream）

## 功能概述

本技能作为驻留进程运行，管理与多个 MCP Server 的连接，支持：

- **传输类型**:
  - **STDIO**: 本地子进程通信（默认）
  - **HTTP Stream**: 远程 HTTP MCP Server（MCP Streamable HTTP Transport）
  - **SSE**: Server-Sent Events 传输（预留）

- **Server 类型**:
  - **公共 MCP Server**：所有用户共享，无需凭证
  - **用户隔离 MCP Server**：每用户独立进程，需要用户配置凭证

## 技能类型

`resident` - 驻留式技能

## 工具列表

本技能不直接暴露工具给 LLM，而是动态注入 MCP 工具到工具列表中。

MCP 工具命名格式：`mcp_{serverName}_{toolName}`

例如：
- `mcp_filesystem_read_file` - 读取文件
- `mcp_firecrawl_crawl` - 爬取网页
- `mcp_gitea_create_issue` - 创建 Issue

## 命令接口

驻留进程通过 stdin/stdout 接收和发送 JSON 命令。

### 命令格式

```json
{
  "command": "invoke",
  "task_id": "task-xxx",
  "params": {
    "action": "list_tools",
    ...
  },
  "user": {
    "userId": "user-001",
    "accessToken": "jwt-xxx"
  }
}
```

### 支持的操作

| action | 描述 | 参数 |
|--------|------|------|
| `list_tools` | 获取用户可用的所有 MCP 工具 | - |
| `call_tool` | 调用 MCP 工具 | `server_name`, `tool_name`, `arguments` |
| `list_servers` | 获取 MCP Server 列表 | - |
| `connect_server` | 连接到指定 MCP Server | `server_name` |
| `disconnect_server` | 断开 MCP Server 连接 | `server_name` |
| `refresh_tools` | 刷新工具定义缓存 | - |
| `init` | 初始化（连接所有公共 MCP） | - |
| `shutdown` | 关闭所有连接 | - |

### 响应格式

```json
{
  "task_id": "task-xxx",
  "result": { ... },
  "success": true
}
```

或错误时：

```json
{
  "task_id": "task-xxx",
  "error": "错误信息",
  "success": false
}
```

## 配置管理

MCP Server 配置存储在数据库中：

- `mcp_servers` - MCP Server 定义
  - `transport_type`: ENUM('stdio', 'http', 'sse')
  - `command`, `args`, `env_template`: STDIO 模式使用
  - `url`, `headers`: HTTP 模式使用
- `mcp_credentials` - 系统默认凭证
- `mcp_user_credentials` - 用户私有凭证
- `mcp_tools_cache` - 工具定义缓存

驻留进程通过内部 API `/internal/mcp/config` 获取配置。

## 传输类型配置

### STDIO 模式（默认）

适合本地/容器内 MCP Server：

```json
{
  "transport_type": "stdio",
  "command": "npx",
  "args": "[\"-y\", \"@modelcontextprotocol/server-filesystem\", \"/data\"]",
  "env_template": "{\"NODE_ENV\": \"production\"}"
}
```

### HTTP Stream 模式

适合远程 SaaS MCP Server：

```json
{
  "transport_type": "http",
  "url": "https://api.firecrawl.dev/mcp",
  "headers": "{\"Authorization\": \"Bearer ${user.token}\"}"
}
```

Headers 支持占位符，会被用户凭证中的对应字段替换：
- `${user.api_key}` → 替换为凭证中的 `api_key`
- `${user.token}` → 替换为凭证中的 `token`

## 凭证优先级

1. 用户私有凭证（`mcp_user_credentials`）
2. 系统默认凭证（`mcp_credentials`）
3. 无凭证报错

### HTTP 模式凭证处理

凭证中的以下字段会自动添加到 HTTP headers：
- `api_key` → `Authorization: Bearer {api_key}`
- `token` → `Authorization: Bearer {token}`
- `API_KEY` → `X-API-Key: {API_KEY}`

**安全提示**: 敏感信息（Authorization、X-API-Key）在日志中会被自动脱敏显示为 `***`。

## 环境变量模板（STDIO 模式）

MCP Server 配置中的 `env_template` 支持占位符：

```json
{
  "API_KEY": "${user.API_KEY}",
  "BASE_URL": "https://api.example.com"
}
```

`${user.FIELD_NAME}` 会被替换为用户凭证中对应的字段值。

## 依赖

- `@modelcontextprotocol/sdk` - MCP SDK（支持 STDIO 和 StreamableHTTP Transport）

## 相关文档

- [MCP Client 驻留技能设计方案](../../docs/design/mcp-client-resident-design.md)
- [驻留技能设计](../../docs/design/resident-skill-design.md)
- [MCP Streamable HTTP Transport](https://github.com/modelcontextprotocol/typescript-sdk)

---

*Issue: #601*