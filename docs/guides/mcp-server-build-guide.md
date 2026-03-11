# MCP (Model Context Protocol) 开发手册

> 本手册整理自 [MCP 官方文档](https://modelcontextprotocol.io/)，作为 LLM 开发 MCP 功能的参考指南。

---

## 1. 协议概述

### 1.1 定义

MCP (Model Context Protocol) 是连接 AI 应用与外部系统的开源标准协议。

类比：MCP 就像 AI 应用的 USB-C 接口，提供标准化的连接方式。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| 连接数据源 | 本地文件、数据库 |
| 调用工具 | 搜索引擎、计算器 |
| 执行工作流 | 预定义提示词模板 |

### 1.3 应用场景

- AI Agent 访问 Google Calendar、Notion
- Claude Code 根据 Figma 设计生成 Web 应用
- 企业聊天机器人连接多个数据库
- AI 模型创建 3D 设计并发送到 3D 打印机

---

## 2. 架构

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────┐
│                     Host (宿主)                      │
│          LLM 应用 (Claude Desktop / IDE)            │
│  ┌─────────────────────────────────────────────┐    │
│  │              Client (客户端)                 │    │
│  │         维护与 Server 的 1:1 连接            │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
                          │
                          │ MCP 协议
                          ▼
┌─────────────────────────────────────────────────────┐
│                   Server (服务器)                    │
│          提供上下文、工具和提示词                     │
└─────────────────────────────────────────────────────┘
```

| 角色 | 职责 |
|------|------|
| **Host** | LLM 应用，发起连接 |
| **Client** | 在 Host 内部，维护与 Server 的 1:1 连接 |
| **Server** | 提供上下文、工具、提示词 |

### 2.2 协议层

```typescript
class Protocol<Request, Notification, Result> {
  // 处理请求
  setRequestHandler<T>(schema: T, handler: (request: T) => Promise<Result>): void
  
  // 处理通知
  setNotificationHandler<T>(schema: T, handler: (notification: T) => Promise<void>): void
  
  // 发送请求并等待响应
  request<T>(request: Request, schema: T): Promise<T>
  
  // 发送单向通知
  notification(notification: Notification): Promise<void>
}
```

### 2.3 传输层

| 类型 | 机制 | 适用场景 |
|------|------|----------|
| **Stdio** | 标准输入/输出 | 本地进程通信 |
| **Streamable HTTP** | HTTP + SSE | 远程服务通信 |

所有传输使用 JSON-RPC 2.0 消息格式。

### 2.4 消息类型

**Request（请求）：**
```typescript
interface Request {
  method: string;
  params?: { ... };
}
```

**Result（结果）：**
```typescript
interface Result {
  [key: string]: unknown;
}
```

**Error（错误）：**
```typescript
interface Error {
  code: number;
  message: string;
  data?: unknown;
}
```

**Notification（通知）：**
```typescript
interface Notification {
  method: string;
  params?: { ... };
}
```

### 2.5 连接生命周期

**初始化：**
1. Client 发送 `initialize` 请求（协议版本 + 能力）
2. Server 响应（协议版本 + 能力）
3. Client 发送 `initialized` 通知确认
4. 开始正常消息交换

**消息交换：**
- Request-Response：双向请求响应
- Notifications：单向消息

**终止：**
- 调用 `close()` 干净关闭
- 传输断开
- 错误条件

### 2.6 错误码

```typescript
enum ErrorCode {
  ParseError = -32700,      // 解析错误
  InvalidRequest = -32600,  // 无效请求
  MethodNotFound = -32601,  // 方法不存在
  InvalidParams = -32602,   // 无效参数
  InternalError = -32603,   // 内部错误
}
```

自定义错误码应大于 -32000。

---

## 3. Tools（工具）

### 3.1 概述

Tools 是 MCP 服务器的可执行函数，LLM 通过工具与外部系统交互。

关键特性：
- **发现**：`tools/list` 获取可用工具列表
- **调用**：`tools/call` 执行工具操作
- **灵活**：从简单计算到复杂 API 交互

### 3.2 工具定义

```typescript
{
  name: string;              // 唯一标识符
  description?: string;      // 描述文本
  inputSchema: {             // JSON Schema 参数定义
    type: "object",
    properties: { ... },
    required: [ ... ]
  },
  annotations?: {            // 行为提示
    title?: string;              // UI 显示标题
    readOnlyHint?: boolean;      // 是否只读
    destructiveHint?: boolean;   // 是否有破坏性
    idempotentHint?: boolean;    // 是否幂等
    openWorldHint?: boolean;     // 是否与外部交互
  }
}
```

### 3.3 工具注解

| 注解 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `title` | string | - | UI 显示标题 |
| `readOnlyHint` | boolean | false | 不修改环境 |
| `destructiveHint` | boolean | true | 可能执行破坏性更新 |
| `idempotentHint` | boolean | false | 相同参数重复调用无额外效果 |
| `openWorldHint` | boolean | true | 与外部实体交互 |

### 3.4 实现示例

```typescript
const server = new Server({
  name: "example-server",
  version: "1.0.0"
}, {
  capabilities: {
    tools: {}
  }
});

// 定义工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
      name: "calculate_sum",
      description: "Add two numbers together",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number" },
          b: { type: "number" }
        },
        required: ["a", "b"]
      },
      annotations: {
        title: "Calculate Sum",
        readOnlyHint: true,
        openWorldHint: false
      }
    }]
  };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "calculate_sum") {
    const { a, b } = request.params.arguments;
    return {
      content: [
        { type: "text", text: String(a + b) }
      ]
    };
  }
  throw new Error("Tool not found");
});
```

### 3.5 错误处理

工具错误应在结果对象中返回，而非协议级错误：

```typescript
try {
  const result = performOperation();
  return {
    content: [
      { type: "text", text: `Success: ${result}` }
    ]
  };
} catch (error) {
  return {
    isError: true,
    content: [
      { type: "text", text: `Error: ${error.message}` }
    ]
  };
}
```

### 3.6 工具类型示例

**系统操作：**
```typescript
{
  name: "execute_command",
  description: "Run a shell command",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      args: { type: "array", items: { type: "string" } }
    }
  }
}
```

**API 集成：**
```typescript
{
  name: "github_create_issue",
  description: "Create a GitHub issue",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string" },
      body: { type: "string" },
      labels: { type: "array", items: { type: "string" } }
    }
  }
}
```

**数据处理：**
```typescript
{
  name: "analyze_csv",
  description: "Analyze a CSV file",
  inputSchema: {
    type: "object",
    properties: {
      filepath: { type: "string" },
      operations: {
        type: "array",
        items: { enum: ["sum", "average", "count"] }
      }
    }
  }
}
```

### 3.7 动态发现

- Client 可随时列出可用工具
- Server 通过 `notifications/tools/list_changed` 通知工具变更
- 工具可在运行时添加或移除

---

## 4. Resources（资源）

### 4.1 概述

Resources 是 MCP 服务器暴露的数据内容，Client 可读取作为 LLM 上下文。

资源类型：
- 文件内容
- 数据库记录
- API 响应
- 实时系统数据
- 截图和图片
- 日志文件

### 4.2 资源 URI

格式：`[protocol]://[host]/[path]`

示例：
- `file:///home/user/documents/report.pdf`
- `postgres://database/customers/schema`
- `screen://localhost/display1`

服务器可定义自定义 URI 方案。

### 4.3 资源类型

**文本资源：**
- UTF-8 编码文本
- 适用于：源代码、配置文件、日志、JSON/XML

**二进制资源：**
- Base64 编码原始数据
- 适用于：图片、PDF、音频、视频

### 4.4 资源定义

```typescript
{
  uri: string;           // 唯一标识符
  name: string;          // 可读名称
  description?: string;  // 描述
  mimeType?: string;     // MIME 类型
  size?: number;         // 字节大小
}
```

### 4.5 资源模板

用于动态资源：

```typescript
{
  uriTemplate: string;   // RFC 6570 URI 模板
  name: string;
  description?: string;
  mimeType?: string;
}
```

### 4.6 读取资源

Client 发送 `resources/read` 请求：

```typescript
// 请求
{ method: "resources/read", params: { uri: "file:///logs/app.log" } }

// 响应
{
  contents: [
    {
      uri: string;
      mimeType?: string;
      text?: string;    // 文本资源
      blob?: string;    // 二进制资源 (base64)
    }
  ]
}
```

### 4.7 资源更新

**列表变更：**
- Server 发送 `notifications/resources/list_changed`

**内容变更：**
1. Client 发送 `resources/subscribe` 订阅
2. Server 发送 `notifications/resources/updated` 通知
3. Client 调用 `resources/read` 获取最新内容
4. Client 发送 `resources/unsubscribe` 取消订阅

### 4.8 实现示例

```typescript
// 列出资源
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "file:///logs/app.log",
        name: "Application Logs",
        mimeType: "text/plain"
      }
    ]
  };
});

// 读取资源
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  
  if (uri === "file:///logs/app.log") {
    const logContents = await readLogFile();
    return {
      contents: [
        { uri, mimeType: "text/plain", text: logContents }
      ]
    };
  }
  
  throw new Error("Resource not found");
});
```

---

## 5. Prompts（提示词）

### 5.1 概述

Prompts 是服务器定义的可复用提示词模板和工作流。

功能：
- 接受动态参数
- 包含资源上下文
- 链式多轮交互
- 引导特定工作流
- 作为 UI 元素（斜杠命令）

### 5.2 提示词定义

```typescript
{
  name: string;              // 唯一标识符
  description?: string;      // 描述
  arguments?: [              // 参数列表
    {
      name: string;          // 参数标识
      description?: string;  // 参数描述
      required?: boolean;    // 是否必需
    }
  ]
}
```

### 5.3 发现提示词

```typescript
// 请求
{ method: "prompts/list" }

// 响应
{
  prompts: [
    {
      name: "analyze-code",
      description: "Analyze code for potential improvements",
      arguments: [
        {
          name: "language",
          description: "Programming language",
          required: true
        }
      ]
    }
  ]
}
```

### 5.4 获取提示词

```typescript
// 请求
{
  method: "prompts/get",
  params: {
    name: "analyze-code",
    arguments: { language: "python" }
  }
}

// 响应
{
  description: "Analyze Python code for potential improvements",
  messages: [
    {
      role: "user",
      content: {
        type: "text",
        text: "Please analyze the following Python code..."
      }
    }
  ]
}
```

### 5.5 动态提示词

**嵌入资源上下文：**

```typescript
{
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "Analyze these system logs:"
      }
    },
    {
      "role": "user",
      "content": {
        "type": "resource",
        "resource": {
          "uri": "logs://recent?timeframe=1h",
          "text": "[2024-03-14 15:32:11] ERROR: Connection timeout",
          "mimeType": "text/plain"
        }
      }
    }
  ]
}
```

**多步工作流：**

```typescript
const debugWorkflow = {
  name: "debug-error",
  async getMessages(error: string) {
    return [
      { role: "user", content: { type: "text", text: `Error: ${error}` } },
      { role: "assistant", content: { type: "text", text: "What have you tried?" } },
      { role: "user", content: { type: "text", text: "I've tried restarting..." } }
    ];
  }
};
```

### 5.6 实现示例

```typescript
const PROMPTS = {
  "git-commit": {
    name: "git-commit",
    description: "Generate a Git commit message",
    arguments: [
      { name: "changes", description: "Git diff or description", required: true }
    ]
  }
};

// 列出提示词
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return { prompts: Object.values(PROMPTS) };
});

// 获取提示词
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = PROMPTS[request.params.name];
  if (!prompt) throw new Error(`Prompt not found: ${request.params.name}`);
  
  if (request.params.name === "git-commit") {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Generate a commit message:\n\n${request.params.arguments?.changes}`
          }
        }
      ]
    };
  }
  
  throw new Error("Prompt implementation not found");
});
```

### 5.7 更新通知

- Server 能力：`prompts.listChanged`
- 通知：`notifications/prompts/list_changed`

---

## 6. 构建服务器

### 6.1 TypeScript 实现

**依赖：**
```bash
npm install @modelcontextprotocol/sdk zod
npm install -D @types/node typescript
```

**package.json：**
```json
{
  "type": "module",
  "bin": { "my-server": "./build/index.js" },
  "scripts": { "build": "tsc" }
}
```

**tsconfig.json：**
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

**src/index.ts：**
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

server.registerTool(
  "tool_name",
  {
    description: "Tool description",
    inputSchema: {
      param: z.string().describe("Parameter description"),
    },
  },
  async ({ param }) => {
    return {
      content: [{ type: "text", text: `Result: ${param}` }],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Server started"); // 日志写入 stderr
}

main().catch(console.error);
```

### 6.2 Python 实现

**依赖：**
```bash
pip install "mcp[cli]"
# 或
uv add "mcp[cli]"
```

**server.py：**
```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
async def tool_name(param: str) -> str:
    """Tool description
    
    Args:
        param: Parameter description
    """
    return f"Result: {param}"

def main():
    mcp.run(transport="stdio")

if __name__ == "__main__":
    main()
```

### 6.3 ⚠️ STDIO 日志规则

**约束：STDIO 传输模式下，禁止向 stdout 写入任何非协议数据。**

```typescript
// ❌ 禁止
console.log("debug message");

// ✅ 正确
console.error("debug message");
```

```python
# ❌ 禁止
print("debug message")

# ✅ 正确
print("debug message", file=sys.stderr)
```

### 6.4 Streamable HTTP 传输

**适用场景：** 远程服务、Web 应用、需要 HTTP 兼容性

#### 6.4.1 基本概念

服务器作为独立进程运行，可处理多个客户端连接。

- 使用 HTTP POST 发送消息到服务器
- 使用 HTTP GET 打开 SSE 流接收服务器消息
- 服务器可选支持 Server-Sent Events (SSE) 流式传输

#### 6.4.2 端点要求

服务器必须提供单一 HTTP 端点（MCP 端点），支持 POST 和 GET 方法：

```
https://example.com/mcp
```

#### 6.4.3 发送消息到服务器（POST）

**请求规范：**

1. 使用 HTTP POST 发送 JSON-RPC 消息
2. 必须包含 `Accept` 头：`application/json, text/event-stream`
3. 请求体可以是：
   - 单个 JSON-RPC 请求/通知/响应
   - 批量请求数组
   - 批量响应数组

**响应规范：**

| 输入类型 | 响应 |
|----------|------|
| 仅响应/通知 | HTTP 202 Accepted（无 body） |
| 包含请求 | `Content-Type: text/event-stream` 或 `application/json` |

**SSE 流响应：**

当服务器返回 SSE 流时：
- 流中应包含每个请求对应的 JSON-RPC 响应
- 服务器可在响应前发送请求和通知
- 所有响应发送后应关闭流
- 断开连接不应视为取消请求

#### 6.4.4 接收服务器消息（GET）

**请求规范：**

1. 客户端可发送 HTTP GET 到 MCP 端点
2. 必须包含 `Accept: text/event-stream` 头

**响应规范：**

- 成功：返回 `Content-Type: text/event-stream`
- 不支持：返回 HTTP 405 Method Not Allowed

**SSE 流规范：**

- 服务器可发送请求和通知
- 不应发送响应（除非恢复之前的流）
- 服务器或客户端可随时关闭流

#### 6.4.5 会话管理

**会话 ID：**

服务器可在初始化时分配会话 ID：

```
HTTP 响应头：Mcp-Session-Id: <session-id>
```

会话 ID 要求：
- 全局唯一且加密安全（UUID、JWT 或加密哈希）
- 仅包含可见 ASCII 字符（0x21-0x7E）

**客户端使用：**

客户端必须在后续所有请求中携带会话 ID：

```
HTTP 请求头：Mcp-Session-Id: <session-id>
```

**会话终止：**

- 服务器可随时终止会话（返回 HTTP 404）
- 客户端可发送 HTTP DELETE 显式终止会话
- 收到 404 后客户端必须重新初始化

#### 6.4.6 可恢复性和重传

**事件 ID：**

服务器可为 SSE 事件附加 `id` 字段：

```
event: message
id: <unique-event-id>
data: {...}
```

**恢复连接：**

客户端断开后可使用 `Last-Event-ID` 头恢复：

```
HTTP 请求头：Last-Event-ID: <last-received-event-id>
```

服务器应重放该 ID 之后的消息。

#### 6.4.7 安全要求

**必须实现：**

1. 验证所有请求的 `Origin` 头（防止 DNS 重绑定攻击）
2. 本地运行时仅绑定 localhost（127.0.0.1）
3. 实现适当的认证机制

#### 6.4.8 TypeScript 实现

```typescript
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const app = express();
const server = new McpServer({ name: "http-server", version: "1.0.0" });

// MCP 端点
const MCP_ENDPOINT = "/mcp";

// POST - 接收客户端消息
app.post(MCP_ENDPOINT, express.json(), async (req, res) => {
  const transport = new SSEServerTransport(MCP_ENDPOINT, res);
  await server.connect(transport);
  // 处理请求并可能启动 SSE 流
});

// GET - 打开 SSE 流
app.get(MCP_ENDPOINT, async (req, res) => {
  const transport = new SSEServerTransport(MCP_ENDPOINT, res);
  await server.connect(transport);
  // 发送服务器消息到客户端
});

// DELETE - 终止会话
app.delete(MCP_ENDPOINT, (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  // 终止会话逻辑
  res.status(204).send();
});

app.listen(3000, () => {
  console.error("MCP HTTP Server listening on port 3000");
});
```

#### 6.4.9 Python 实现

```python
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.routing import Route

mcp = FastMCP("http-server")

# 定义工具
@mcp.tool()
async def example_tool(param: str) -> str:
    return f"Result: {param}"

# 创建 Starlette 应用
app = Starlette(
    routes=[
        Route("/mcp", endpoint=mcp.sse_app(), methods=["GET", "POST"]),
    ]
)
```

---

## 7. 调试

### 7.1 调试工具

| 工具 | 用途 |
|------|------|
| **MCP Inspector** | 交互式调试界面 |
| **Claude Desktop DevTools** | 集成测试、日志收集 |
| **Server Logging** | 自定义日志实现 |

### 7.2 Claude Desktop 日志

```bash
# macOS
tail -n 20 -F ~/Library/Logs/Claude/mcp*.log

# Windows
type %APPDATA%\Claude\logs\mcp*.log
```

日志内容：
- 服务器连接事件
- 配置问题
- 运行时错误
- 消息交换

### 7.3 Chrome DevTools

启用 DevTools：

```bash
echo '{"allowDevTools": true}' > ~/Library/Application\ Support/Claude/developer_settings.json
```

快捷键：`Command-Option-Shift-i`

### 7.4 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 找不到服务器 | 路径错误 | 使用绝对路径 |
| stdout 污染 | 使用 console.log | 改用 console.error |
| 配置不生效 | 未重启 Claude | 完全退出后重启 |
| 环境变量缺失 | 未配置 env | 在配置中添加 env 字段 |

### 7.5 环境变量配置

```json
{
  "myserver": {
    "command": "mcp-server-myapp",
    "env": {
      "MYAPP_API_KEY": "some_key"
    }
  }
}
```

---

## 8. MCP Inspector

### 8.1 启动方式

```bash
# 基本用法
npx @modelcontextprotocol/inspector <command>

# npm 包
npx @modelcontextprotocol/inspector npx @modelcontextprotocol/server-filesystem /Users/username/Desktop

# Python 包
npx @modelcontextprotocol/inspector uvx mcp-server-git --repository ~/code/mcp/servers.git

# 本地 TypeScript 服务器
npx @modelcontextprotocol/inspector node path/to/server/index.js

# 本地 Python 服务器
npx @modelcontextprotocol/inspector uv --directory path/to/server run package-name
```

### 8.2 功能面板

| 面板 | 功能 |
|------|------|
| **Server Connection** | 选择传输方式、配置参数和环境变量 |
| **Resources** | 列出资源、查看元数据、检查内容、测试订阅 |
| **Prompts** | 显示模板、查看参数、测试自定义参数、预览消息 |
| **Tools** | 列出工具、查看 Schema、测试输入、显示结果 |
| **Notifications** | 显示服务器日志和通知 |

### 8.3 开发工作流

1. 启动 Inspector 连接服务器
2. 验证基本连接
3. 检查能力协商
4. 迭代测试：
   - 修改服务器代码
   - 重新构建
   - 重新连接 Inspector
   - 测试受影响功能
5. 边缘情况测试：
   - 无效输入
   - 缺失参数
   - 并发操作
   - 错误处理

---

## 9. Claude Desktop 集成

### 9.1 配置文件路径

| 系统 | 路径 |
|------|------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

### 9.2 配置格式

**Node.js 服务器：**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/absolute/path/to/build/index.js"]
    }
  }
}
```

**Python 服务器：**
```json
{
  "mcpServers": {
    "my-python-server": {
      "command": "uv",
      "args": [
        "--directory", "/absolute/path/to/project",
        "run", "server.py"
      ]
    }
  }
}
```

**带环境变量：**
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/build/index.js"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

### 9.3 验证集成

1. 完全退出 Claude Desktop（Cmd+Q）
2. 重新启动 Claude
3. 点击 "+" 按钮 → "Connectors" 查看服务器

---

## 10. SDK 参考

| 语言 | 包名 | 版本要求 |
|------|------|----------|
| TypeScript | `@modelcontextprotocol/sdk` | ≥1.0.0 |
| Python | `mcp[cli]` | ≥1.2.0 |
| Java | `spring-ai-starter-mcp-server` | Spring Boot ≥3.3 |
| Kotlin | `io.modelcontextprotocol:kotlin-sdk` | ≥0.4.0 |
| C# | `ModelContextProtocol` | .NET ≥8 |
| Rust | `rmcp` | ≥0.3 |

---

## 11. 开发检查清单

- [ ] STDIO 模式下所有日志写入 stderr
- [ ] 工具名称使用 snake_case
- [ ] 工具描述清晰明确
- [ ] 参数使用 JSON Schema 或 Zod 验证
- [ ] 返回格式符合规范（content 数组）
- [ ] 错误情况返回 `isError: true`
- [ ] Claude 配置使用绝对路径
- [ ] 使用 MCP Inspector 测试验证
- [ ] 实现适当的错误处理和超时
- [ ] 敏感数据不记录到日志