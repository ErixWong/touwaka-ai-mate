# MCP Client

name: mcp-client

> 通用 MCP (Model Context Protocol) 客户端，支持多 MCP Server 连接管理

## 功能概述

本技能作为驻留进程运行，管理与多个 MCP Server 的连接，支持：

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
- `mcp_credentials` - 系统默认凭证
- `mcp_user_credentials` - 用户私有凭证
- `mcp_tools_cache` - 工具定义缓存

驻留进程通过内部 API `/internal/mcp/config` 获取配置。

## 凭证优先级

1. 用户私有凭证（`mcp_user_credentials`）
2. 系统默认凭证（`mcp_credentials`）
3. 无凭证报错

## 环境变量模板

MCP Server 配置中的 `env_template` 支持占位符：

```json
{
  "API_KEY": "${user.API_KEY}",
  "BASE_URL": "https://api.example.com"
}
```

`${user.FIELD_NAME}` 会被替换为用户凭证中对应的字段值。

## 依赖

- `@modelcontextprotocol/sdk` - MCP SDK

## 相关文档

- [MCP Client 驻留技能设计方案](../../docs/design/mcp-client-resident-design.md)
- [驻留技能设计](../../docs/design/resident-skill-design.md)

---

*Issue: #601*