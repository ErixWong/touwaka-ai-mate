# MCP 系统设计方案

> 基于 MCP 官方规范的外援系统设计

---

## 1. 概述

### 1.1 什么是 MCP？

MCP (Model Context Protocol) 是连接 AI 应用与外部系统的开源标准协议。

**核心理念**：像 USB-C 一样，提供标准化的连接方式。

### 1.2 为什么用 MCP？

| 场景 | 现有 Skill 方案 | MCP 方案 |
|------|----------------|----------|
| **调用外部 AI 模型** | 需要在主进程实现 | 独立进程，隔离稳定 |
| **复用已有能力** | 需要自己开发 | 可直接使用社区 MCP Server |
| **暴露能力给外部** | 不支持 | 可被 Claude Desktop 等使用 |

### 1.3 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Touwaka Mate (MCP Host)                          │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    MCP Client (内置)                          │    │
│  │         使用 @modelcontextprotocol/sdk                        │    │
│  │                                                               │    │
│  │  - 管理与 MCP Server 的持久连接                               │    │
│  │  - 聚合工具定义                                               │    │
│  │  - 路由工具调用                                               │    │
│  └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
            │                    │                    
            │ STDIO              │ STDIO              
            ▼                    ▼                    
┌──────────────────┐  ┌──────────────────┐  
│  Helper Server    │  │  其他 MCP Server  │  
│  (外援服务)       │  │  (可扩展)         │  
│                  │  │                  │  
│  Tools:          │  │  Tools:          │  
│  - ocr_analyze   │  │  - ...           │  
│  - coding_gen    │  │                  │  
│  - drawing_create│  │                  │  
└──────────────────┘  └──────────────────┘  
```

---

## 2. 核心概念澄清

### 2.1 MCP vs Skill

| 维度 | Skill | MCP Server |
|------|-------|------------|
| **生命周期** | 临时子进程（调用时启动，执行完退出） | 持久子进程（主应用启动时启动，随主应用退出） |
| **通信模式** | 单次 stdin→stdout | 持续双向 STDIO |
| **启动开销** | 每次都有 Node.js 启动成本 | 只启动一次 |
| **适用场景** | 数据库操作、内部逻辑（毫秒-秒级） | 外部模型调用（秒-分钟级） |
| **状态** | 无状态 | 可保持状态 |

### 2.2 同步调用 vs 异步任务

**关键认知：MCP 协议本身就是同步请求-响应模式，不需要"任务表"！**

```
┌─────────┐     tools/call      ┌─────────────┐
│  Expert │ ──────────────────► │ MCP Server  │
│         │                     │             │
│         │ ◄────────────────── │ 调用模型 API │
└─────────┘     直接返回结果     └─────────────┘
                                 (可能等待 5-60s)
```

**不需要**：
- ❌ `helper_tasks` 任务表
- ❌ `helper_submit` / `helper_check` 模式
- ❌ 轮询机制

**正确做法**：
- ✅ 工具调用直接返回结果
- ✅ Expert 等待结果（超时由 Expert 控制）
- ✅ MCP Server 无状态

---

## 3. MCP Helper Server 设计

### 3.1 服务定义

**位置**：`data/mcp/helpers-server/`

```typescript
// data/mcp/helpers-server/src/index.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 创建 MCP Server 实例
const server = new McpServer({
  name: "touwaka-helpers",
  version: "1.0.0",
});
```

### 3.2 工具定义

每个外援定义为一个独立的 MCP 工具：

```typescript
// ============================================
// OCR 文字识别工具
// ============================================
server.registerTool(
  "ocr_analyze",
  {
    description: "分析图片中的文字内容，支持多种图片格式",
    inputSchema: {
      image: z.string().describe("图片 URL 或 base64 编码数据"),
      languages: z.array(z.string()).optional().describe("识别语言，如 ['zh', 'en']"),
    },
    annotations: {
      title: "OCR 文字识别",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  async ({ image, languages }) => {
    const result = await callOCRModel(image, languages);
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// ============================================
// 代码生成工具
// ============================================
server.registerTool(
  "coding_generate",
  {
    description: "根据需求生成代码，支持多种编程语言",
    inputSchema: {
      prompt: z.string().describe("编程需求描述"),
      language: z.enum(["python", "javascript", "typescript", "java", "go"]).default("python"),
      context: z.string().optional().describe("相关上下文代码"),
    },
    annotations: {
      title: "代码生成",
      readOnlyHint: true,
    },
  },
  async ({ prompt, language, context }) => {
    const result = await callCodingModel(prompt, language, context);
    return {
      content: [{ type: "text", text: result }],
    };
  }
);

// ============================================
// 图像生成工具
// ============================================
server.registerTool(
  "drawing_create",
  {
    description: "根据文字描述生成图片",
    inputSchema: {
      prompt: z.string().describe("图片描述"),
      style: z.enum(["realistic", "cartoon", "abstract", "anime"]).default("realistic"),
      size: z.enum(["1024x1024", "1792x1024", "1024x1792"]).default("1024x1024"),
    },
    annotations: {
      title: "AI 画图",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ prompt, style, size }) => {
    const result = await callDrawingModel(prompt, style, size);
    return {
      content: [
        { type: "text", text: "已生成图片：\n" },
        { type: "image", data: result.base64, mimeType: "image/png" },
      ],
    };
  }
);

// ============================================
// 启动服务器
// ============================================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Touwaka Helper MCP Server running on stdio");
}

main().catch(console.error);
```

### 3.3 配置管理

**配置文件**：`config/helpers.json`

```json
{
  "helpers": {
    "ocr": {
      "name": "文字识别",
      "model": {
        "provider": "openai",
        "name": "gpt-4o"
      },
      "prompt": "请识别图片中的文字内容。",
      "maxTokens": 4096
    },
    "coding": {
      "name": "编程外援",
      "model": {
        "provider": "anthropic",
        "name": "claude-3-5-sonnet-20241022"
      },
      "prompt": "你是一个专业的编程助手。请根据用户需求生成高质量的代码。",
      "maxTokens": 4096
    },
    "drawing": {
      "name": "画图外援",
      "model": {
        "provider": "openai",
        "name": "dall-e-3"
      }
    }
  }
}
```

**主应用可提供配置管理界面**（前端）。

---

## 4. MCP Client 集成

### 4.1 Client 实现

```typescript
// lib/mcp-client.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  
  /**
   * 启动并连接 MCP Server（持久进程）
   */
  async connectServer(config: MCPServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...config.env },
    });

    const client = new Client({
      name: "touwaka-mate",
      version: "1.0.0",
    }, {
      capabilities: {
        tools: {},
      },
    });

    await client.connect(transport);
    this.clients.set(config.name, client);
    
    console.error(`[MCP] Connected to ${config.name}`);
  }

  /**
   * 获取所有工具定义
   */
  async getAllTools(): Promise<any[]> {
    const allTools: any[] = [];

    for (const [serverName, client] of this.clients) {
      const response = await client.request(
        { method: "tools/list" },
        { method: "tools/list" }
      );
      
      if (response.tools) {
        for (const tool of response.tools) {
          allTools.push({
            type: "function",
            function: {
              name: `${serverName}_${tool.name}`,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          });
        }
      }
    }

    return allTools;
  }

  /**
   * 调用工具（同步等待结果）
   */
  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP Server '${serverName}' not connected`);
    }

    const response = await client.request(
      {
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      },
      { method: "tools/call" }
    );

    return response;
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      await client.close();
      console.error(`[MCP] Disconnected from ${name}`);
    }
    this.clients.clear();
  }
}
```

### 4.2 集成到 ToolManager

```typescript
// lib/tool-manager.ts

import { MCPClientManager } from "./mcp-client";
import SkillLoader from "./skill-loader";

export class ToolManager {
  private mcpManager: MCPClientManager;
  private skillLoader: SkillLoader;

  constructor(db: any) {
    this.mcpManager = new MCPClientManager();
    this.skillLoader = new SkillLoader(db);
  }

  /**
   * 初始化 - 启动 MCP Servers
   */
  async initialize(): Promise<void> {
    const serverConfigs = await this.loadMCPServerConfigs();
    for (const config of serverConfigs) {
      await this.mcpManager.connectServer(config);
    }
  }

  /**
   * 获取所有工具定义（Skill + MCP）
   */
  async getToolDefinitions(expertId: string): Promise<any[]> {
    const skillTools = await this.skillLoader.loadSkillsForExpert(expertId);
    const mcpTools = await this.mcpManager.getAllTools();
    return [...skillTools, ...mcpTools];
  }

  /**
   * 执行工具
   */
  async execute(toolName: string, args: any, context: any): Promise<any> {
    // MCP 工具格式：serverName_toolName
    if (toolName.includes("_")) {
      const [serverName, ...rest] = toolName.split("_");
      const mcpToolName = rest.join("_");
      
      if (this.mcpManager.hasServer(serverName)) {
        return this.mcpManager.callTool(serverName, mcpToolName, args);
      }
    }

    // 执行 Skill
    return this.skillLoader.executeSkillTool(toolName, args, context);
  }
}
```

---

## 5. 服务器配置

### 5.1 配置文件

```json
// config/mcp-servers.json
{
  "servers": [
    {
      "name": "helpers",
      "command": "node",
      "args": ["${DATA_DIR}/mcp/helpers-server/build/index.js"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}",
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
      }
    }
  ]
}
```

### 5.2 环境变量

MCP Server 通过环境变量获取 API 密钥：

```bash
# .env
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-xxx
```

---

## 6. 目录结构

```
data/
├── skills/              # 现有技能系统（同步）
│   ├── kb-search/
│   ├── kb-editor/
│   └── ...
│
└── mcp/                 # MCP Server 目录
    └── helpers-server/  # 外援 MCP Server
        ├── src/
        │   ├── index.ts          # 入口
        │   ├── model-client.ts   # 模型调用
        │   └── config.ts         # 配置读取
        ├── package.json
        └── tsconfig.json

config/
├── mcp-servers.json     # MCP Server 启动配置
└── helpers.json         # 外援模型配置
```

---

## 7. 与 Skill 系统的边界

| 能力类型 | 执行方式 | 适用场景 | 示例 |
|----------|----------|----------|------|
| **Skill** | 临时子进程，毫秒-秒级 | 数据库操作、内部逻辑 | kb-search, kb-editor |
| **MCP Tool** | 持久子进程，秒-分钟级 | 外部模型调用、AI 能力 | ocr, coding, drawing |

**原则**：
- 内部能力用 Skill
- 外部能力用 MCP Server

---

## 8. 实施步骤

| 步骤 | 任务 | 文件 | 时间 |
|------|------|------|------|
| 1 | 创建 helpers-server 项目 | `data/mcp/helpers-server/` | 0.5h |
| 2 | 实现工具定义和模型调用 | `src/index.ts`, `model-client.ts` | 2h |
| 3 | 实现 MCPClientManager | `lib/mcp-client.ts` | 1h |
| 4 | 集成到 ToolManager | `lib/tool-manager.ts` | 1h |
| 5 | 配置文件和界面 | `config/`, 前端 | 1h |
| 6 | 测试验证 | - | 1h |
| **总计** | | | **6.5h** |

---

## 9. 测试验证

### 9.1 MCP Inspector 测试

```bash
npx @modelcontextprotocol/inspector node data/mcp/helpers-server/build/index.js
```

### 9.2 Claude Desktop 集成测试

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "touwaka-helpers": {
      "command": "node",
      "args": ["/absolute/path/to/data/mcp/helpers-server/build/index.js"],
      "env": {
        "OPENAI_API_KEY": "your-key",
        "ANTHROPIC_API_KEY": "your-key"
      }
    }
  }
}
```

---

## 10. 关键修正总结

| 原设计 | 修正后 |
|--------|--------|
| `helper_tasks` 任务表 | ❌ 不需要，MCP 同步返回 |
| `helper_submit` / `helper_check` | ❌ 不需要，直接调用工具 |
| 轮询机制 | ❌ 不需要，同步等待 |
| 数据库存储配置 | ⚠️ 可选，JSON 文件更简单 |
| MCP Server 独立进程 | ✅ 正确 |
| STDIO 通信 | ✅ 正确 |

---

*创建时间: 2026-03-10*
*状态: 设计方案 v3（简化版）*