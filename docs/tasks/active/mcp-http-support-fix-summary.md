# MCP HTTP 传输支持修复总结

> **修复日期**: 2026-04-18
> **修复人员**: Maria (AI Assistant)
> **关联审计**: mcp-http-support-audit.md

---

## 修复概览

本次修复解决了 MCP 配置系统**仅支持 STDIO 方式，缺乏 HTTP Stream 方式配置**的问题。现在系统支持三种传输类型：

1. **STDIO** (默认) - 本地子进程通信
2. **HTTP Stream** - 远程 HTTP MCP Server
3. **SSE** - Server-Sent Events (预留)

---

## 修改文件清单

### 1. 数据库迁移
**文件**: `scripts/upgrade-database.js`

添加迁移项 `mcp_servers.add_transport_type_and_http_fields`，包含字段：
- `transport_type` (ENUM: 'stdio', 'http', 'sse')
- `url` (VARCHAR 512) - HTTP MCP Server URL
- `headers` (TEXT) - HTTP Headers JSON

### 2. 后端模型
**文件**: `models/mcp_server.js` (自动重新生成)

模型已更新包含新字段，通过 `node scripts/generate-models.js` 重新生成。

### 3. 后端 API 路由
**文件**: `server/routes/mcp.routes.js`

- 更新创建 MCP Server 逻辑，支持按传输类型验证必填字段
- 更新 allowedFields 列表，添加 `transport_type`, `url`, `headers`
- 更新 server 列表返回，包含新字段

### 4. 内部 API
**文件**: `server/controllers/internal.controller.js`

更新 `getMcpConfig` 方法，在返回的 server 配置中包含：
- `transport_type`
- `url`
- `headers`

### 5. 前端类型定义
**文件**: `frontend/src/api/services.ts`

更新类型定义：
```typescript
export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface McpServer {
  transport_type: McpTransportType
  // STDIO 字段
  command?: string
  args?: string | null
  env?: string | null
  // HTTP 字段
  url?: string | null
  headers?: string | null
  // ...
}
```

### 6. 前端界面
**文件**: `frontend/src/components/settings/McpTab.vue`

- 添加传输类型选择器（单选按钮：STDIO / HTTP Stream / SSE）
- 根据传输类型动态显示对应字段
- 更新表单验证逻辑
- 添加传输类型选择器样式

### 7. MCP 客户端技能
**文件**: `data/skills/mcp-client/index.js`

- 导入 `StreamableHTTPClientTransport`
- 添加 `parseHeaders()` 函数解析 JSON headers
- 添加 `createTransport()` 函数根据传输类型创建对应 transport
- 更新 `connectServer()` 使用动态 transport 创建
- 支持从凭证自动添加 Authorization header

**文件**: `data/skills/mcp-client/SKILL.md`

更新文档，添加 HTTP 传输类型说明。

---

## 功能特性

### STDIO 模式
```json
{
  "transport_type": "stdio",
  "command": "npx",
  "args": "[\"-y\", \"@modelcontextprotocol/server-filesystem\", \"/data\"]",
  "env_template": "{\"NODE_ENV\": \"production\"}"
}
```

### HTTP Stream 模式
```json
{
  "transport_type": "http",
  "url": "https://api.firecrawl.dev/mcp",
  "headers": "{\"Authorization\": \"Bearer ${user.token}\"}"
}
```

### 凭证处理
HTTP 模式支持以下凭证字段自动添加到 headers：
- `api_key` → `Authorization: Bearer {api_key}`
- `token` → `Authorization: Bearer {token}`
- `API_KEY` → `X-API-Key: {API_KEY}`

---

## 测试建议

1. **数据库验证**
   ```sql
   SELECT name, transport_type, url, headers FROM mcp_servers;
   ```

2. **创建 STDIO MCP Server**
   - 进入设置 → MCP 服务
   - 选择传输类型 "STDIO"
   - 填写 command 和 args

3. **创建 HTTP MCP Server**
   - 选择传输类型 "HTTP Stream"
   - 填写 URL 和 Headers (JSON 格式)

4. **验证连接**
   - 点击"刷新工具"按钮
   - 查看是否能正确获取工具列表

---

## 后续优化建议

1. **添加更多 MCP SDK 传输类型支持**
   - WebSocket Transport (未来 MCP 版本可能支持)

2. **凭证管理增强**
   - HTTP Basic Auth 支持
   - API Key 在 query param 中的支持

3. **前端界面优化**
   - Headers JSON 编辑器（带语法检查）
   - URL 格式验证

4. **监控和日志**
   - HTTP MCP Server 连接状态监控
   - 请求/响应日志记录

---

## 参考文档

- [原始审计报告](./mcp-http-support-audit.md)
- [MCP SDK Streamable HTTP Transport](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Client SKILL.md](../../data/skills/mcp-client/SKILL.md)

---

*修复完成时间: 2026-04-18*
*状态: ✅ 已完成*

✌Bazinga！
