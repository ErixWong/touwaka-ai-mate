# 开源Claw项目深度分析报告

## 概述

本报告对4个开源Claw项目（NanoClaw、OpenClaw、PicoClaw、ZeroClaw）进行深度技术分析和比较，涵盖上下文与记忆系统、Skill和MCP对接实现、用户界面、以及消息系统与第三方平台对接等核心维度。

| 项目 | 语言 | 定位 | 特点 |
|------|------|------|------|
| **NanoClaw** | TypeScript | 容器化极简助手 | 基于Apple Container的沙箱隔离、WhatsApp优先 |
| **OpenClaw** | TypeScript | 企业级多代理平台 | OpenProse DSL多代理编排、丰富的插件生态 |
| **PicoClaw** | Go | 轻量级便携助手 | 单二进制、多通道支持、OAuth认证 |
| **ZeroClaw** | Rust | 极速边缘部署 | <5MB内存、<10ms启动、向量化记忆 |

---

## 一、上下文与记忆系统

### 1.1 架构对比

| 维度 | NanoClaw | OpenClaw | PicoClaw | ZeroClaw |
|------|----------|----------|----------|----------|
| **存储介质** | SQLite + 文件系统 | 文件系统 + PostgreSQL(可选) | 工作区文件 | SQLite + 向量数据库 |
| **记忆类型** | 对话历史、任务状态 | 对话历史、代理状态、程序状态 | 结构化笔记 | 核心/日常/对话/自定义分类 |
| **持久化方式** | 关系型数据库 | 文件级持久化 | Markdown文件 | 混合型(SQLite+Embedding) |
| **检索机制** | 时间戳游标 | 会话列表索引 | 文件遍历 | FTS5 + 向量相似度混合搜索 |
| **上下文窗口** | 基于消息队列 | OpenProse VM管理 | 简单追加 | 智能上下文压缩 |

### 1.2 详细实现分析

#### NanoClaw - 数据库驱动的记忆

```typescript
// src/db.ts - 核心表结构
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  sender_name TEXT,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  is_from_me BOOLEAN DEFAULT 0
);

CREATE TABLE sessions (
  group_folder TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**特点：**
- 使用SQLite持久化所有消息和会话状态
- 按群组分离的会话管理（`sessions`表）
- 基于时间戳的消息游标机制（`lastAgentTimestamp`）
- 支持任务调度状态存储（`scheduled_tasks`表）

**重要局限：没有向LLM提供的"中长期记忆"**

NanoClaw虽然持久化存储了所有消息历史，但这些数据**不会以"记忆"的形式提供给LLM**：

```typescript
// index.ts - LLM只能看到"未处理的消息"
const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
const prompt = formatMessages(missedMessages);  // 直接格式化，无加工
```

**关键区别：**

| 能力 | NanoClaw | 其他项目 |
|------|----------|----------|
| 长期存储 | ✅ 原始消息在SQLite | ✅ 都有 |
| 向LLM提供历史摘要 | ❌ **没有** | ✅ PicoClaw/ZeroClaw/OpenClaw |
| 记忆压缩/总结 | ❌ **没有** | ✅ 都有 |

**实际影响：**

假设3天前群里讨论过"项目预算"，今天有人@Assistant问"那个预算后来定了多少？"

- **NanoClaw**：如果这3天内消息不多且没被截断，LLM能从原始消息里找到；如果消息太多或超出上下文窗口，LLM就"失忆"了
- **PicoClaw**：会触发摘要机制，LLM能看到"预算讨论摘要"
- **ZeroClaw**：通过RAG召回"预算"相关的记忆片段
- **OpenClaw**：状态文件里有对预算的引用，LLM可以读取

**设计哲学：** NanoClaw采用极简主义设计，假设WhatsApp对话是线性的，LLM从原始消息流中自行推断上下文即可。这种设计在短平快的聊天场景中有效，但不适合需要长期话题跟踪的场景。

#### OpenClaw - 文件系统+状态后端

**OpenProse VM状态管理：**
- **filesystem模式**（默认）：`.prose/runs/{id}/` 文件存储
- **in-context模式**：对话历史中保持状态
- **SQLite模式**（实验性）：`.prose/runs/{id}/state.db`
- **PostgreSQL模式**（实验性）：支持并发写入和团队协作

**多代理状态：**
```typescript
// sessions_list, sessions_history, sessions_send 工具
interface SessionState {
  sessionId: string;
  status: 'running' | 'completed' | 'error';
  output: string;
  artifacts: Artifact[];
}
```

#### PicoClaw - 文件驱动的轻量记忆

**工作区结构：**
```
~/picoclaw-workspace/
├── CLAUDE.md          # 系统提示
├── MEMORY.md          # 记忆文件
├── NOTES/
│   └── *.md          # 结构化笔记
└── .env              # 环境配置
```

**特点：**
- 纯文本/Markdown存储，便于版本控制
- 简单的文件追加模式
- 通过`read_file`/`edit_file`工具操作记忆

#### ZeroClaw - 向量化混合记忆（最先进）

**架构设计（`src/memory/sqlite.rs`）：**

```rust
pub struct SqliteMemory {
    conn: Mutex<Connection>,
    embedder: Arc<dyn EmbeddingProvider>,
    vector_weight: f32,      // 默认0.7
    keyword_weight: f32,     // 默认0.3
    cache_max: usize,        // 默认10,000
}
```

**核心特性：**

1. **双引擎搜索：**
   - **FTS5全文搜索**：BM25评分算法
   - **向量相似度**：余弦相似度计算
   - **混合融合**：加权合并两种搜索结果

2. **Embedding缓存：**
   ```sql
   CREATE TABLE embedding_cache (
       content_hash TEXT PRIMARY KEY,
       embedding BLOB NOT NULL,
       created_at TEXT NOT NULL,
       accessed_at TEXT NOT NULL
   );
   ```
   - LRU淘汰策略
   - SHA-256内容哈希
   - 避免重复API调用

3. **记忆分类：**
   ```rust
   enum MemoryCategory {
       Core,        // 核心长期记忆
       Daily,       // 日常事务
       Conversation, // 对话历史
       Custom(String), // 用户自定义
   }
   ```

---

## 二、Skill系统与MCP对接

### 2.1 Skill系统架构对比

| 特性 | NanoClaw | OpenClaw | PicoClaw | ZeroClaw |
|------|----------|----------|----------|----------|
| **定义格式** | Markdown (CLAUDE.md) | OpenProse (.prose) | Markdown (SKILL.md) | TOML (SKILL.toml) / Markdown |
| **技能仓库** | 本地文件系统 | 内置+扩展 | 本地文件系统 | GitHub open-skills + 本地 |
| **动态加载** | 容器启动时 | VM运行时 | 启动时 | 运行时热加载 |
| **工具定义** | 系统提示中声明 | prose原生语法 | 代码硬编码 | TOML声明式定义 |
| **社区生态** | 无 | OpenProse Registry | 无 | open-skills自动同步 |

### 2.2 详细实现

#### OpenClaw - OpenProse DSL（最具创新性）

**核心设计哲学：**
> "LLMs are simulators—when given a detailed system description, they don't just describe it, they _simulate_ it."

**语法示例：**
```prose
session "Researcher" {
  agent name: researcher
  provider: anthropic:claude-3-5-sonnet-latest
  prompt: """
    You are a research assistant. Search for information about {{topic}}.
  """
  tools: [web_search, web_fetch]
}

session "Writer" {
  agent name: writer
  depends_on: [researcher]
  prompt: """
    Based on the research, write a comprehensive report.
    Input: {{researcher.output}}
  """
}
```

**VM到OpenClaw工具映射：**
| OpenProse VM | OpenClaw工具 |
|--------------|--------------|
| `task` | `sessions_spawn` |
| `read`/`write` | `read`/`write` |
| `fetch` | `web_fetch` |

**执行流程：**
1. 加载`prose.md`定义VM语义
2. 解析.prose程序为执行计划
3. 按依赖图调度会话（session）
4. 每个会话触发LLM调用
5. 状态通过narration protocol同步

#### ZeroClaw - TOML声明式技能

**SKILL.toml结构：**
```toml
[skill]
name = "web-search"
description = "Search the web using DuckDuckGo"
version = "1.0.0"
author = "zeroclaw"
tags = ["web", "search"]

[[tools]]
name = "search"
description = "Perform web search"
kind = "shell"
command = "ddgr --json"
args = { query = "{{input}}" }
```

**open-skills集成：**
- 自动克隆`besoeasy/open-skills`仓库
- 每周自动同步更新
- 支持`ZEROCLAW_OPEN_SKILLS_ENABLED`开关
- 支持自定义仓库路径`ZEROCLAW_OPEN_SKILLS_DIR`

**技能加载流程：**
```rust
pub fn load_skills(workspace_dir: &Path) -> Vec<Skill> {
    let mut skills = Vec::new();
    // 1. 加载open-skills
    if let Some(open_dir) = ensure_open_skills_repo() {
        skills.extend(load_open_skills(&open_dir));
    }
    // 2. 加载工作区技能
    skills.extend(load_workspace_skills(workspace_dir));
    skills
}
```

### 2.3 MCP（Model Context Protocol）对接

#### NanoClaw - IPC桥接模式

**架构设计：**
```
┌─────────────────┐     IPC/Named Pipe     ┌──────────────────┐
│   Main Process  │ ◄─────────────────────► │ Container Agent  │
│   (index.ts)    │                         │  (claude-code)   │
└─────────────────┘                         └──────────────────┘
        │                                              │
        ▼                                              ▼
┌─────────────────┐                           ┌──────────────┐
│  SQLite Store   │                           │  Group Files │
└─────────────────┘                           └──────────────┘
```

**MCP工具暴露：**
通过`groups/main/CLAUDE.md`定义：
- `mcp__nanoclaw__send_message` - 即时消息发送
- `schedule_task` - 任务调度
- `web_search` / `fetch_url` - 网络访问
- `agent-browser` - 浏览器自动化

**容器隔离：**
- 每个群组运行在独立Apple Container中
- 通过`/workspace/ipc/`目录进行文件级IPC
- 容器只能访问被挂载的目录

#### OpenClaw - 原生MCP集成

**双运行时架构：**
```
┌─────────────────────────────────────────────────────────────┐
│                        Gateway                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Pi Agent   │  │  Pi Agent   │  │  OpenProse VM       │  │
│  │  (MCP Tools)│  │  (MCP Tools)│  │  (sessions_spawn)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         └─────────────────┴────────────────────┘             │
│                           │                                  │
│                    WebSocket RPC                             │
│                           │                                  │
└───────────────────────────┼──────────────────────────────────┘
                            │
                    ┌───────▼────────┐
                    │  openclaw CLI  │
                    │  (MCP Client)  │
                    └────────────────┘
```

**MCP工具集：**
- `sessions_list` / `sessions_history` / `sessions_send` - 多代理管理
- `read` / `write` / `edit` / `delete` - 文件操作
- `web_search` / `web_fetch` - 网络工具
- `agent-browser` - 浏览器自动化
- `run_command` / `run_in_context` - 命令执行

#### ZeroClaw - 模块化工具系统

**工具注册表（`src/tools/mod.rs`）：**
```rust
pub fn all_tools(
    security: &Arc<SecurityPolicy>,
    memory: Arc<dyn Memory>,
    composio_key: Option<&str>,
    browser_config: &BrowserConfig,
) -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(ShellTool::new(security.clone(), runtime)),
        Box::new(FileReadTool::new(security.clone())),
        Box::new(FileWriteTool::new(security.clone())),
        Box::new(MemoryStoreTool::new(memory.clone())),
        Box::new(MemoryRecallTool::new(memory.clone())),
        Box::new(MemoryForgetTool::new(memory)),
        Box::new(BrowserTool::new(security.clone(), allowed_domains)),
        Box::new(ComposioTool::new(key)), // 第三方MCP集成
    ]
}
```

**Composio集成：**
- 支持900+工具集成
- API Key配置驱动
- 自动工具发现

---

## 三、用户界面

### 3.1 交互模型对比

| 项目 | 界面类型 | 交互模式 | 配置方式 |
|------|----------|----------|----------|
| **NanoClaw** | 命令行 + 聊天界面 | 消息触发式 | 环境变量 + 配置文件 |
| **OpenClaw** | CLI + TUI + 桌面App | 命令驱动+对话 | `openclaw config` + 交互式配置 |
| **PicoClaw** | CLI | 命令驱动 | 工作区文件 + 环境变量 |
| **ZeroClaw** | CLI | 命令驱动 | TOML配置 + 命令行参数 |

### 3.2 详细分析

#### OpenClaw - 最丰富的界面生态

**CLI命令结构：**
```bash
# 配置管理
openclaw config set gateway.host localhost
openclaw config get gateway.port

# 网关控制
openclaw gateway run --bind loopback --port 18789
openclaw gateway status

# 通道管理
openclaw channels status --probe
openclaw channels add whatsapp
openclaw channels remove telegram

# 代理交互
openclaw send "Hello" --channel whatsapp
openclaw history --limit 50
```

**交互式元素：**
- 使用`@clack/prompts`实现美观的交互提示
- 自定义表格渲染（`src/terminal/table.ts`）
- 进度条和spinner（`src/cli/progress.ts`）

**macOS桌面应用：**
- SwiftUI实现
- Menu Bar常驻
- 网关自动管理
- 日志查看器（`scripts/clawlog.sh`）

#### ZeroClaw - 简洁高效的CLI

**命令结构：**
```bash
# 初始化
zeroclaw onboard --provider anthropic --model claude-sonnet-4

# 代理模式
zeroclaw agent --prompt "Explain this codebase" --path ./src

# 网关模式
zeroclaw gateway --port 8080 --cors

# 通道管理
zeroclaw channel start telegram
zeroclaw channel start discord --background
zeroclaw channel stop telegram

# 技能管理
zeroclaw skills list
zeroclaw skills install https://github.com/user/skill-repo
zeroclaw skills remove my-skill
```

**特色功能：**
- `zeroclaw doctor` - 诊断工具
- `zeroclaw status` - 状态检查
- `zeroclaw cron` - 定时任务管理

#### PicoClaw - 极简CLI

**命令结构：**
```bash
# 引导配置
picoclaw onboard

# 代理模式
picoclaw agent --prompt "Hello"

# 网关模式
picoclaw gateway

# 定时任务
picoclaw cron add "0 9 * * 1" "Weekly report"
picoclaw cron list

# 通道管理（代码中可见但未完全暴露）
```

**特点：**
- 单二进制，无依赖
- 自动OAuth认证流程
- 心跳服务集成

---

## 四、消息系统与第三方平台对接

### 4.1 通道支持对比

| 平台 | NanoClaw | OpenClaw | PicoClaw | ZeroClaw |
|------|:--------:|:--------:|:--------:|:--------:|
| **WhatsApp** | ✅ 核心 | ✅ | ✅ | ✅ |
| **Telegram** | ❌ | ✅ 内置 | ✅ | ✅ |
| **Slack** | ❌ | ✅ 内置 | ✅ | ✅ |
| **Discord** | ❌ | ✅ 内置 | ✅ | ✅ |
| **Signal** | ❌ | ✅ 扩展 | ❌ | ✅ |
| **Matrix** | ❌ | ✅ 扩展 | ✅ | ✅ |
| **iMessage** | ❌ | ✅ 内置 | ✅ | ✅ |
| **Email** | ❌ | ✅ 扩展 | ✅ | ✅ |
| **IRC** | ❌ | ❌ | ✅ | ✅ |
| **Nostr** | ❌ | ✅ 扩展 | ❌ | ❌ |
| **MS Teams** | ❌ | ✅ 扩展 | ❌ | ❌ |
| **Webhook** | ❌ | ✅ | ❌ | ✅ |

### 4.2 架构模式对比

#### OpenClaw - 插件化通道架构

**Channel Plugin SDK：**
```typescript
// extensions/whatsapp/src/channel.ts
export class WhatsAppChannel implements ChannelPlugin {
  async initialize(config: ChannelConfig): Promise<void>
  async sendMessage(recipient: string, content: string): Promise<void>
  async handleIncoming(handler: MessageHandler): Promise<void>
  async start(): Promise<void>
  async stop(): Promise<void>
}
```

**统一接口设计：**
- 所有通道实现`ChannelPlugin`接口
- 内置通道：`telegram`, `discord`, `slack`, `signal`, `imessage`, `web`
- 扩展通道：`msteams`, `matrix`, `zalo`, `nostr`

**扩展机制：**
```json
// openclaw.plugin.json
{
  "id": "whatsapp",
  "name": "WhatsApp",
  "entry": "index.ts",
  "capabilities": ["messaging", "group"]
}
```

#### ZeroClaw - Trait-based通道抽象

**通道Trait定义（`src/channels/mod.rs`）：**
```rust
#[async_trait]
pub trait Channel: Send + Sync {
    fn name(&self) -> &str;
    async fn start(&self, handler: MessageHandler) -> Result<()>;
    async fn stop(&self) -> Result<()>;
    async fn send(&self, recipient: &str, content: &str) -> Result<()>;
}
```

**监督式监听器：**
```rust
// 指数退避重连
async fn supervised_listen(
    channel: Arc<dyn Channel>,
    handler: MessageHandler,
    max_retries: u32,
) {
    let mut backoff = Duration::from_secs(1);
    loop {
        match channel.start(handler.clone()).await {
            Ok(()) => break,
            Err(e) if retries < max_retries => {
                sleep(backoff).await;
                backoff *= 2;
                retries += 1;
            }
        }
    }
}
```

#### NanoClaw - 单一深度集成

**WhatsApp Baileys集成：**
```typescript
// src/channels/whatsapp.ts
export class WhatsAppChannel {
  private sock: WASocket;
  
  async connect() {
    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
    });
    
    this.sock.ev.on('messages.upsert', async ({ messages }) => {
      // 处理入站消息
    });
  }
  
  async sendMessage(jid: string, text: string) {
    await this.sock.sendMessage(jid, { text: formatOutbound(text) });
  }
}
```

**群组管理机制：**
- 主群组（main）：无需触发词，处理所有消息
- 普通群组：需要`@AssistantName`触发
- 个人聊天：可配置`requiresTrigger: false`

### 4.3 消息格式与处理

#### 格式支持

| 格式 | NanoClaw | OpenClaw | PicoClaw | ZeroClaw |
|------|----------|----------|----------|----------|
| **纯文本** | ✅ | ✅ | ✅ | ✅ |
| **Markdown** | 受限* | ✅ | ✅ | ✅ |
| **代码块** | ✅ | ✅ | ✅ | ✅ |
| **图片** | 计划中 | ✅ | ❌ | ✅ |
| **语音** | ❌ | ✅ | ✅(Groq转录) | ❌ |
| **文件** | ❌ | ✅ | ❌ | ✅ |

*NanoClaw限制：WhatsApp中不使用`##`标题，仅用`*粗体*`（非`**`）

#### 消息路由

**NanoClaw的GroupQueue：**
```typescript
class GroupQueue {
  private queues: Map<string, Message[]>;
  private activeProcesses: Map<string, ChildProcess>;
  
  enqueueMessageCheck(jid: string): void {
    if (!this.processing.has(jid)) {
      this.processNext(jid);
    }
  }
  
  // 单容器串行处理，保证消息顺序
}
```

**OpenClaw的路由系统：**
- 基于`allowlist`的访问控制
- 配对流程（pairing）验证
- 命令门控（command gating）

---

## 五、安全模型

### 5.1 安全架构对比

| 项目 | 安全模型 | 沙箱方式 | 文件访问控制 |
|------|----------|----------|--------------|
| **NanoClaw** | 容器隔离 | Apple Container | 挂载点白名单 |
| **OpenClaw** | 可配置 | Docker（可选） | 工作区限制 |
| **PicoClaw** | 工作区限制 | 无 | 仅工作区内 |
| **ZeroClaw** | 策略驱动 | 无（原生运行） | Allowlist/Denylist |

### 5.2 详细安全特性

#### NanoClaw - 容器级隔离

**挂载安全配置：**
```typescript
// containerConfig.additionalMounts
{
  hostPath: "~/projects/webapp",
  containerPath: "webapp",
  readonly: false
}
```

**容器内路径：**
- `/workspace/project` - 项目根目录
- `/workspace/group` - 群组专属目录
- `/workspace/ipc` - IPC通信目录
- `/workspace/extra/*` - 额外挂载目录

#### ZeroClaw - 策略驱动安全

**SecurityPolicy：**
```rust
pub struct SecurityPolicy {
    allowed_paths: Vec<PathBuf>,
    denied_paths: Vec<PathBuf>,
    allow_shell: bool,
    allow_network: bool,
    browser_allowed_domains: Vec<String>,
}
```

**工具级安全检查：**
```rust
impl ShellTool {
    async fn execute(&self, command: &str) -> Result<ToolResult> {
        if !self.security.allow_shell {
            return Err("Shell execution disabled".into());
        }
        // 路径验证...
    }
}
```

---

## 六、性能与部署

### 6.1 资源占用

| 指标 | NanoClaw | OpenClaw | PicoClaw | ZeroClaw |
|------|----------|----------|----------|----------|
| **内存占用** | 中等（Node+Container） | 高（Node+多代理） | 低（Go运行时） | 极低（<5MB） |
| **启动时间** | 中等（~秒级） | 中等（~秒级） | 快（~百毫秒） | 极快（<10ms） |
| **二进制大小** | N/A | N/A | ~20MB | ~3.4MB |
| **依赖** | Node+Container | Node | 无 | 无 |

### 6.2 部署模式

```
┌─────────────────────────────────────────────────────────────────┐
│                      NanoClaw                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Gateway   │───►│  Scheduler  │───►│  Container  │         │
│  │   (index)   │    │  (cron)     │    │  (Agent)    │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      OpenClaw                                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   Gateway   │◄──►│  Pi Agents  │◄──►│  OpenProse  │         │
│  │  (ws:18789) │    │  (Multi)    │    │  VM         │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│        ▲                                                        │
│   ┌────┴────┬────────┬────────┬────────┐                       │
│   ▼         ▼        ▼        ▼        ▼                       │
│ WhatsApp Telegram Discord Signal Matrix ...                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      ZeroClaw                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Core (Rust)                           │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │   │
│  │  │ Memory  │ │ Channel │ │  Tool   │ │   Skill     │   │   │
│  │  │(SQLite) │ │ (Trait) │ │(Registry│ │  (TOML)     │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 七、总结与建议

### 7.1 各项目最佳适用场景

| 项目 | 最佳场景 | 不推荐场景 |
|------|----------|------------|
| **NanoClaw** | macOS用户、WhatsApp重度用户、需要强隔离 | 多平台需求、复杂工作流 |
| **OpenClaw** | 企业团队、多代理编排、复杂自动化工作流 | 资源受限环境、简单个人使用 |
| **PicoClaw** | 便携部署、边缘设备、快速启动需求 | 复杂记忆需求、高级安全要求 |
| **ZeroClaw** | 边缘AI、IoT设备、极致性能要求 | 复杂GUI需求、重型工作流 |

### 7.2 技术选型建议

**如果你是：**

1. **个人macOS用户，主要用WhatsApp**
   - 选择 **NanoClaw**
   - 理由：原生容器隔离、深度WhatsApp集成、简单可靠

2. **技术团队，需要多代理协作**
   - 选择 **OpenClaw**
   - 理由：OpenProse DSL业界领先、丰富插件生态、企业级功能

3. **需要极简部署，资源受限**
   - 选择 **ZeroClaw**
   - 理由：<5MB内存、向量化记忆、Rust安全性

4. **需要Go生态集成**
   - 选择 **PicoClaw**
   - 理由：单二进制、OAuth内置、多通道支持

### 7.3 可借鉴的最佳实践

1. **记忆系统**：ZeroClaw的FTS5+向量混合搜索
2. **多代理编排**：OpenClaw的OpenProse DSL设计
3. **通道抽象**：ZeroClaw的Trait-based通道设计
4. **安全模型**：NanoClaw的容器隔离
5. **技能生态**：ZeroClaw的open-skills自动同步
6. **MCP集成**：OpenClaw的双运行时架构

---

## 附录：核心文件索引

| 项目 | 核心文件 | 功能 |
|------|----------|------|
| **NanoClaw** | `src/index.ts` | 主循环与消息路由 |
| | `src/db.ts` | SQLite数据库层 |
| | `src/channels/whatsapp.ts` | WhatsApp集成 |
| | `src/container-runner.ts` | 容器代理执行 |
| | `groups/main/CLAUDE.md` | 系统提示定义 |
| **OpenClaw** | `AGENTS.md` | 项目结构与指南 |
| | `extensions/open-prose/skills/prose/SKILL.md` | OpenProse规范 |
| | `extensions/whatsapp/src/channel.ts` | WhatsApp通道插件 |
| | `src/provider-web.ts` | Web Provider |
| **PicoClaw** | `cmd/picoclaw/main.go` | 完整实现（1,412行） |
| **ZeroClaw** | `src/main.rs` | CLI入口 |
| | `src/memory/sqlite.rs` | 向量化记忆 |
| | `src/channels/mod.rs` | 通道抽象（1,344行） |
| | `src/skills/mod.rs` | 技能系统（927行） |
| | `src/tools/mod.rs` | 工具注册表 |

---

## 八、提示词生成与历史对话压缩机制（专题分析）

本节专门分析四个项目如何生成当前提示词（Prompt Generation）以及如何处理历史对话的上下文窗口管理（History Compression）。

### 8.1 提示词生成架构对比

| 维度 | NanoClaw | OpenClaw | PicoClaw | ZeroClaw |
|------|----------|----------|----------|----------|
| **系统提示构建** | 静态CLAUDE.md模板 | OpenProse VM语义层 | 动态文件组合 | Markdown文件加载 |
| **上下文注入** | 游标式消息历史 | 会话状态映射 | Session+Summary | RAG记忆召回 |
| **动态组件** | 任务快照、群组快照 | VM narration协议 | 技能摘要、工具列表 | 记忆检索结果 |
| **提示词分隔符** | 自然语言 | `[Position]/[Binding]`标记 | `---`分隔线 | 系统/用户/助手角色 |
| **工具描述方式** | Markdown列表 | 原生DSL语法 | 动态工具摘要 | TOML声明 |

### 8.2 各项目提示词生成机制详解

#### 8.2.1 NanoClaw - 静态模板+游标历史

**系统提示构建（`groups/main/CLAUDE.md`）：**

```markdown
# NanoClaw Agent - Group: {{GROUP_NAME}}

You are {{ASSISTANT_NAME}}, an agent in a WhatsApp group.

## Core Principles
1. Use tools for actions — never pretend to act
2. Prefer `read_file` over `edit_file` for information gathering
3. Iterate and refine when uncertain

## Memory & Tasks
- Access MEMORY.md at `/workspace/group/MEMORY.md`
- Check scheduled tasks at `/workspace/group/tasks.json`
- Available groups listed at `/workspace/group/groups.json`

## Messaging
- Send messages via `mcp__nanoclaw__send_message`
- Use @mentions for specific users
- Emojis are OK
```

**消息格式化（`src/router.ts`）：**

```typescript
export function formatMessages(messages: NewMessage[]): string {
  return messages
    .map((m) => {
      const sender = m.is_from_me ? ASSISTANT_NAME : m.sender_name || 'User';
      return `[${sender}]: ${m.content}`;
    })
    .join('\n\n');
}
```

**特点：**
- **模板静态化**：系统提示在容器启动时固定，通过文件注入动态数据
- **游标机制**：使用`lastAgentTimestamp`记录每个群组最后处理的消息时间戳
- **增量拉取**：只拉取`lastAgentTimestamp`之后的新消息，避免重复处理
- **状态快照**：任务和群组信息通过JSON文件注入，而非实时数据库查询

#### 8.2.2 OpenClaw - OpenProse VM语义层

**核心设计哲学：**
> "The VM never holds full binding values. It tracks locations and passes references."

**Narration Protocol（`prose.md`）：**

OpenClaw的提示词构建通过**叙述协议（Narration Protocol）**实现，VM在对话中插入结构化标记：

```
[Position] Statement 3: let research = session: researcher
   Spawning session, will write to state.md
   [Task tool call]
[Success] Session complete, binding written to state.md
[Binding] research = <stored in .prose/runs/.../state.md>
```

**标记类型：**

| 标记 | 含义 | 用途 |
|------|------|------|
| `[Position]` | 当前执行位置 | VM工作记忆 |
| `[Binding]` | 变量绑定 | 状态跟踪 |
| `[Success]` | 操作成功 | 执行确认 |
| `[Frame+]` / `[Frame-]` | 进入/退出作用域 | 块级状态管理 |

**状态管理模式：**

```prose
let analysis = session "Analyze data" {
  agent name: data_analyst
  tools: [read_file, write_file]
}

[Execution]
VM Prompt: "[Position] Statement 1: let analysis = session..."
           "Spawning subagent 'data_analyst'..."

Subagent receives: Full context + Task instruction
Subagent outputs: "Binding written: analysis = ..."

VM Prompt: "[Success] Session complete"
           "[Binding] analysis = <reference to output>"
```

**特点：**
- **VM即记忆**：对话历史本身就是VM的工作记忆
- **引用传递**：VM不存储完整值，只跟踪位置引用
- **状态外置**：根据程序复杂度选择4种状态后端（in-context/filesystem/SQLite/PostgreSQL）

#### 8.2.3 PicoClaw - 动态文件组合

**系统提示构建（`pkg/agent/context.go`）：**

```go
func (cb *ContextBuilder) BuildSystemPrompt() string {
    parts := []string{}
    
    // 1. 核心身份（动态生成，含时间、运行时、工具列表）
    parts = append(parts, cb.getIdentity())
    
    // 2. 引导文件（AGENTS.md, SOUL.md, USER.md, IDENTITY.md）
    bootstrapContent := cb.LoadBootstrapFiles()
    parts = append(parts, bootstrapContent)
    
    // 3. 技能摘要（AI可通过read_file读取完整内容）
    skillsSummary := cb.skillsLoader.BuildSkillsSummary()
    parts = append(parts, skillsSummary)
    
    // 4. 记忆上下文
    memoryContext := cb.memory.GetMemoryContext()
    parts = append(parts, memoryContext)
    
    // 使用"---"连接各部分
    return strings.Join(parts, "\n\n---\n\n")
}
```

**动态组件生成：**

```go
func (cb *ContextBuilder) getIdentity() string {
    now := time.Now().Format("2006-01-02 15:04 (Monday)")
    runtime := fmt.Sprintf("%s %s, Go %s", runtime.GOOS, runtime.GOARCH, runtime.Version())
    toolsSection := cb.buildToolsSection() // 动态工具列表
    
    return fmt.Sprintf(`# picoclaw 🦞
You are picoclaw, a helpful AI assistant.

## Current Time
%s

## Runtime
%s

## Workspace
Your workspace is at: %s
...
%s`, now, runtime, workspacePath, toolsSection)
}
```

**消息组装（`BuildMessages`）：**

```go
func (cb *ContextBuilder) BuildMessages(
    history []providers.Message,  // 完整历史
    summary string,               // 对话摘要
    currentMessage string,        // 当前用户消息
    channel, chatID string,       // 会话标识
) []providers.Message {
    messages := []providers.Message{}
    
    // 1. 构建系统提示
    systemPrompt := cb.BuildSystemPrompt()
    
    // 2. 添加会话信息
    systemPrompt += fmt.Sprintf("\n\n## Current Session\nChannel: %s\nChat ID: %s", channel, chatID)
    
    // 3. 如果有摘要，追加到系统提示
    if summary != "" {
        systemPrompt += "\n\n## Summary of Previous Conversation\n\n" + summary
    }
    
    // 4. 组装消息序列
    messages = append(messages, providers.Message{Role: "system", Content: systemPrompt})
    messages = append(messages, history...)
    messages = append(messages, providers.Message{Role: "user", Content: currentMessage})
    
    return messages
}
```

**特点：**
- **动态构建**：每次请求都重新构建系统提示，包含最新时间和工具状态
- **分层组合**：基础身份 → 引导文件 → 技能 → 记忆，层级清晰
- **摘要集成**：将对话摘要直接注入系统提示，而非保留完整历史

#### 8.2.4 ZeroClaw - RAG驱动的记忆召回

**系统提示构建（`src/agent/loop_.rs`）：**

```rust
pub async fn agent_turn(
    &self,
    messages: Vec<Message>,
    tools: Vec<ToolDefinition>,
) -> Result<AgentResponse> {
    // 1. 从工作区加载系统提示
    let system_prompt = build_system_prompt(&self.workspace_dir);
    
    // 2. 构建完整上下文
    let mut context = self.build_context(messages).await?;
    
    // 3. 执行LLM调用
    let response = self.llm.chat(&context, &tools).await?;
    ...
}
```

**RAG记忆召回：**

```rust
async fn build_context(&self, messages: Vec<Message>) -> Vec<Message> {
    let mut context = vec![];
    
    // 系统提示
    context.push(Message::system(&self.system_prompt));
    
    // 历史消息（已截断）
    let history = self.trim_history(messages);
    context.extend(history);
    
    // 记忆召回 - 基于最后一条用户消息检索相关记忆
    if let Some(last_user_msg) = messages.iter().rev().find(|m| m.role == "user") {
        let memories = self.memory.recall(&last_user_msg.content, 5).await;
        if !memories.is_empty() {
            let memory_context = format_memories(&memories);
            context.push(Message::system(&memory_context));
        }
    }
    
    context
}
```

**工作区系统提示加载：**

```rust
pub fn build_system_prompt(workspace_dir: &Path) -> String {
    let mut prompt = String::new();
    
    // 加载 CLAUDE.md
    if let Ok(content) = fs::read_to_string(workspace_dir.join("CLAUDE.md")) {
        prompt.push_str(&content);
    }
    
    // 加载其他系统提示文件
    for file in &["MEMORY.md", "PREFERENCES.md"] {
        if let Ok(content) = fs::read_to_string(workspace_dir.join(file)) {
            prompt.push_str("\n\n");
            prompt.push_str(&content);
        }
    }
    
    prompt
}
```

**特点：**
- **文件驱动**：系统提示从工作区Markdown文件加载
- **RAG增强**：基于用户查询动态召回相关记忆，注入上下文
- **混合搜索**：向量相似度 + 关键词匹配的混合记忆检索

### 8.3 历史对话压缩机制对比

#### 8.3.1 压缩策略总览

| 项目 | 压缩触发条件 | 压缩方法 | 保留策略 | 摘要存储 |
|------|--------------|----------|----------|----------|
| **NanoClaw** | 无显式压缩 | 游标截断（仅处理新消息） | 数据库全保留 | 无 |
| **OpenClaw** | 会话完成 | VM状态持久化 | 引用追踪 | 状态文件 |
| **PicoClaw** | 消息数>20 或 Token>75% | 异步LLM摘要 | 最近4条消息 | Session存储 |
| **ZeroClaw** | 消息数>50 | 滑动窗口截断 | 系统提示+最近消息 | SQLite+向量库 |

#### 8.3.2 NanoClaw - 游标式截断

**机制：**
- 不压缩历史对话，完整保留在SQLite数据库
- 使用`lastAgentTimestamp`游标只拉取"未处理"消息
- 容器内代理看到的是增量消息流

```typescript
// src/index.ts
const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
const missedMessages = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);

// 更新游标
lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
```

**优点：**
- 实现简单，无信息丢失
- 完整历史可供审计

**缺点：**
- 长期运行后历史膨胀
- 上下文窗口无上限控制

#### 8.3.3 OpenClaw - VM状态持久化

**机制：**
- 不直接压缩对话历史，而是将**状态外置**
- 通过Narration Protocol在对话中嵌入状态标记
- 根据场景选择4种状态后端

**In-Context模式（<30条语句）：**

```
[Position] Statement 15: parallel:
[Frame+] Entering parallel block
  [Position] Branch A: let a = session "Task A"
  [Success] a = <result A>
  [Position] Branch B: let b = session "Task B"
  [Success] b = <result B>
[Frame-] Exiting parallel block
[Binding] results = [a, b]
```

**Filesystem模式（复杂程序）：**

```
.prose/runs/20260116-143052-a7b3c9/
├── state.md          # 完整状态快照
├── bindings/         # 变量绑定
│   ├── research.md
│   └── analysis.md
└── execution.log     # 执行日志
```

**状态恢复：**

```rust
// 恢复时读取state.md而非重放历史
let state = fs::read_to_string(".prose/runs/{id}/state.md")?;
vm.restore_from_narration(&state)?;
```

**优点：**
- 状态与对话解耦
- 支持程序级断点恢复
- 多代理状态隔离

**缺点：**
- 架构复杂
- 需要维护narration协议一致性

#### 8.3.4 PicoClaw - 异步LLM摘要（最精细）

**触发条件（`maybeSummarize`）：**

```go
func (al *AgentLoop) maybeSummarize(sessionKey string) {
    newHistory := al.sessions.GetHistory(sessionKey)
    tokenEstimate := al.estimateTokens(newHistory)
    threshold := al.contextWindow * 75 / 100  // 75%阈值
    
    // 消息数>20 或 Token数>75%阈值
    if len(newHistory) > 20 || tokenEstimate > threshold {
        go al.summarizeSession(sessionKey)  // 异步执行
    }
}
```

**摘要生成（`summarizeSession`）：**

```go
func (al *AgentLoop) summarizeSession(sessionKey string) {
    history := al.sessions.GetHistory(sessionKey)
    summary := al.sessions.GetSummary(sessionKey)
    
    // 保留最近4条消息保证连续性
    if len(history) <= 4 {
        return
    }
    toSummarize := history[:len(history)-4]
    
    // 超大消息保护：跳过超过50%上下文窗口的消息
    maxMessageTokens := al.contextWindow / 2
    validMessages := []providers.Message{}
    for _, m := range toSummarize {
        msgTokens := len(m.Content) / 4
        if msgTokens <= maxMessageTokens {
            validMessages = append(validMessages, m)
        }
    }
    
    // 分段摘要（消息>10条时分段）
    var finalSummary string
    if len(validMessages) > 10 {
        mid := len(validMessages) / 2
        part1 := al.summarizeBatch(validMessages[:mid], "")
        part2 := al.summarizeBatch(validMessages[mid:], "")
        
        // 合并两段摘要
        finalSummary = al.mergeSummaries(part1, part2)
    } else {
        finalSummary = al.summarizeBatch(validMessages, summary)
    }
    
    // 保存摘要并截断历史
    al.sessions.SetSummary(sessionKey, finalSummary)
    al.sessions.TruncateHistory(sessionKey, 4)
    al.sessions.Save(sessionKey)
}
```

**Token估算：**

```go
func (al *AgentLoop) estimateTokens(messages []providers.Message) int {
    total := 0
    for _, m := range messages {
        // 使用rune计数（CJK字符处理更准确）
        total += utf8.RuneCountInString(m.Content) / 3
    }
    return total
}
```

**摘要合并：**

```go
func (al *AgentLoop) mergeSummaries(s1, s2 string) string {
    mergePrompt := fmt.Sprintf(
        "Merge these two conversation summaries into one cohesive summary:\n\n1: %s\n\n2: %s",
        s1, s2,
    )
    resp, _ := al.provider.Chat(ctx, []providers.Message{
        {Role: "user", Content: mergePrompt},
    }, nil, al.model, map[string]interface{}{"max_tokens": 1024, "temperature": 0.3})
    return resp.Content
}
```

**特点：**
- **异步执行**：不阻塞用户响应
- **分段摘要**：长对话分段处理再合并
- **超大消息保护**：避免单条消息耗尽上下文
- **最近消息保留**：保证对话连续性

#### 8.3.5 ZeroClaw - 滑动窗口+RAG召回

**历史截断（`trim_history`）：**

```rust
const MAX_HISTORY_MESSAGES: usize = 50;

fn trim_history(&self, messages: Vec<Message>) -> Vec<Message> {
    if messages.len() <= MAX_HISTORY_MESSAGES {
        return messages;
    }
    
    // 保留系统提示
    let system_msgs: Vec<_> = messages.iter()
        .filter(|m| m.role == "system")
        .cloned()
        .collect();
    
    // 保留最近消息
    let recent_msgs: Vec<_> = messages.iter()
        .filter(|m| m.role != "system")
        .rev()
        .take(MAX_HISTORY_MESSAGES)
        .rev()
        .cloned()
        .collect();
    
    let mut result = system_msgs;
    result.extend(recent_msgs);
    result
}
```

**记忆召回补偿：**

```rust
// 即使截断了历史，仍通过记忆召回获取相关信息
async fn recall_relevant_memories(&self, query: &str) -> Vec<Memory> {
    // 1. 向量搜索
    let query_embedding = self.embedder.embed(query).await;
    let vector_results = self.vector_search(&query_embedding, 5);
    
    // 2. 关键词搜索
    let keyword_results = self.fts_search(query, 5);
    
    // 3. 混合融合
    let merged = self.hybrid_merge(vector_results, keyword_results, 0.7, 0.3);
    
    merged.into_iter().take(5).collect()
}
```

**记忆卫生（`memory/hygiene.rs`）：**

```rust
const HYGIENE_INTERVAL_HOURS: i64 = 12;

pub async fn run_hygiene(&self) {
    // 1. 清理过期对话
    self.prune_conversation_rows(retention_days).await?;
    
    // 2. 压缩旧记忆文件
    self.archive_old_memories(archive_after_days).await?;
    
    // 3. 清理embedding缓存
    self.purge_embedding_cache(max_cache_size).await?;
}
```

**特点：**
- **硬截断+软补偿**：截断历史但用RAG召回补偿
- **记忆分类管理**：核心/日常/对话/自定义分类处理
- **自动清理**：定期维护记忆存储

### 8.4 提示词生成最佳实践总结

#### 8.4.1 系统提示构建原则

| 实践 | NanoClaw | OpenClaw | PicoClaw | ZeroClaw |
|------|:--------:|:--------:|:--------:|:--------:|
| **静态vs动态** | 静态模板 | 语义层 | 动态组合 | 文件加载 |
| **组件分离** | ❌ | ✅ VM标记 | ✅ `---`分隔 | ❌ |
| **时间信息** | ❌ | ❌ | ✅ | ❌ |
| **工具动态列表** | ❌ | ❌ | ✅ | ✅ |
| **运行时信息** | ❌ | ✅ | ✅ | ❌ |

#### 8.4.2 历史压缩最佳实践

| 场景 | 推荐方案 |
|------|----------|
| **短对话（<20轮）** | PicoClaw式全保留 |
| **中等对话（20-100轮）** | PicoClaw异步摘要 |
| **长对话（>100轮）** | ZeroClaw截断+RAG |
| **多代理协作** | OpenClaw状态外置 |
| **审计需求强** | NanoClaw数据库全保留 |

#### 8.4.3 可借鉴的具体技术

**从PicoClaw借鉴：**
- 动态系统提示构建（时间、运行时、工具列表）
- 异步摘要机制（不阻塞主流程）
- 分段摘要+合并策略
- 超大消息保护（50%窗口阈值）

**从ZeroClaw借鉴：**
- RAG召回补偿截断历史
- 记忆分类（核心/日常/对话）
- 混合搜索（向量+关键词）

**从OpenClaw借鉴：**
- 状态外置架构（VM对话≠工作记忆）
- Narration Protocol标记语言
- 多状态后端选择策略

---

## 九、向量搜索实现策略（基于四项目分析的综合方案）

本章节基于对ZeroClaw向量化记忆架构的深入研究，结合NanoClaw的数据库设计模式，提出一套**多数据库兼容的向量搜索实现策略**。

### 9.1 数据库版本能力矩阵

| 数据库 | 版本 | VECTOR类型 | VECTOR INDEX | 推荐策略 |
|--------|------|:----------:|:------------:|----------|
| **MariaDB** | 11.7+ | ✅ | ✅ HNSW | **原生向量索引** |
| **MariaDB** | <11.7 | ❌ | ❌ | 应用层计算 |
| **MySQL** | 9.x+ | ✅ | ❌ | 应用层计算 |
| **MySQL** | <9.x | ❌ | ❌ | 应用层计算 |
| **SQLite** | 3.41+ | ❌ | ❌ FTS5 | 应用层计算+FTS5混合 |

**关键发现：**
- **MariaDB 11.7+** 原生支持 `VECTOR` 类型和 `VECTOR INDEX`，使用 HNSW 算法实现近似最近邻搜索
- **MySQL 9** 虽然引入了 `VECTOR` 类型，但**不支持向量索引**，只能用于存储和余弦相似度计算
- **ZeroClaw** 的混合搜索架构（向量+FTS5）在SQLite上效果很好，可作为降级方案参考

### 9.2 兼容性架构设计

采用**策略模式**实现自动检测和降级：

```javascript
// lib/vector-search.js - 向量搜索兼容层
class VectorSearchProvider {
    constructor(db, config) {
        this.db = db;
        this.strategy = null;
    }

    async initialize() {
        this.strategy = await this.detectStrategy();
        console.log(`✅ 向量搜索策略: ${this.strategy}`);
    }

    async detectStrategy() {
        // 检测MariaDB 11.7+
        const [versionResult] = await this.db.query('SELECT VERSION() as v');
        const version = versionResult.v.toLowerCase();
        
        if (version.includes('mariadb')) {
            const major = parseInt(version.match(/(\d+)\.(\d+)/)?.[1] || 0);
            const minor = parseInt(version.match(/(\d+)\.(\d+)/)?.[2] || 0);
            
            if (major > 11 || (major === 11 && minor >= 7)) {
                // 验证VECTOR索引是否可用
                try {
                    await this.db.query('CREATE TABLE IF NOT EXISTS _vector_test (v VECTOR(3))');
                    await this.db.query('ALTER TABLE _vector_test ADD VECTOR INDEX (v)');
                    await this.db.query('DROP TABLE _vector_test');
                    return 'mariadb_native';
                } catch (e) {
                    console.warn('MariaDB版本支持VECTOR但功能不可用:', e.message);
                }
            }
        }
        
        return 'application_layer';
    }

    async searchTopics(queryText, embeddingDim = 1536, limit = 3) {
        if (this.strategy === 'mariadb_native') {
            return this.searchMariaDBNative(queryText, embeddingDim, limit);
        }
        return this.searchApplicationLayer(queryText, limit);
    }

    // 方案1: MariaDB 11.7+ 原生向量索引
    async searchMariaDBNative(queryText, embeddingDim, limit) {
        const queryVector = await this.getEmbedding(queryText);
        const vectorString = `[${queryVector.join(',')}]`;
        
        return this.db.query(`
            SELECT
                topic_id,
                topic_name,
                description,
                embedding MATCH ? AS similarity
            FROM topics
            WHERE embedding MATCH ?
            ORDER BY similarity DESC
            LIMIT ?
        `, [vectorString, vectorString, limit]);
    }

    // 方案2: 应用层计算（兼容所有版本）
    async searchApplicationLayer(queryText, limit) {
        const queryVector = await this.getEmbedding(queryText);
        
        // 加载有embedding的topics（topic表通常数据量小，全表扫描可接受）
        const topics = await this.db.query(`
            SELECT topic_id, topic_name, description, embedding
            FROM topics
            WHERE embedding IS NOT NULL
        `);

        return topics
            .map(t => ({
                ...t,
                similarity: this.cosineSimilarity(
                    queryVector,
                    this.bytesToVector(t.embedding)
                )
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
    }

    // 余弦相似度计算
    cosineSimilarity(a, b) {
        let dot = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    // Float32数组 ↔ BLOB 转换
    vectorToBytes(vector) {
        const buffer = Buffer.alloc(vector.length * 4);
        for (let i = 0; i < vector.length; i++) {
            buffer.writeFloatLE(vector[i], i * 4);
        }
        return buffer;
    }

    bytesToVector(buffer) {
        const vector = [];
        for (let i = 0; i < buffer.length; i += 4) {
            vector.push(buffer.readFloatLE(i));
        }
        return vector;
    }

    async getEmbedding(text) {
        // 调用LLM Embedding API
        // 返回 Float32Array
    }
}
```

### 9.3 数据库迁移脚本

```sql
-- migrations/003_add_topic_embedding.sql
-- 自动适配MariaDB 11.7+和其他版本

DELIMITER //

CREATE PROCEDURE add_topic_embedding_support()
BEGIN
    DECLARE is_mariadb_native BOOLEAN DEFAULT FALSE;
    
    -- 检测MariaDB 11.7+且支持VECTOR
    SELECT COUNT(*) > 0 INTO is_mariadb_native
    FROM information_schema.ENGINES
    WHERE ENGINE = 'VECTOR' AND SUPPORT IN ('YES', 'DEFAULT');
    
    IF is_mariadb_native THEN
        -- MariaDB 11.7+: 使用原生VECTOR类型和索引
        SET @sql = 'ALTER TABLE topics ADD COLUMN IF NOT EXISTS embedding VECTOR(1536)';
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        
        -- 添加VECTOR索引
        SET @sql = 'ALTER TABLE topics ADD VECTOR INDEX IF NOT EXISTS idx_embedding (embedding)';
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        
        SELECT '✅ MariaDB原生向量索引已配置' AS status;
    ELSE
        -- 其他版本: 使用BLOB存储embedding
        ALTER TABLE topics ADD COLUMN IF NOT EXISTS embedding BLOB;
        ALTER TABLE topics ADD INDEX IF NOT EXISTS idx_embedding_blob (embedding(10));
        
        SELECT '⚠️ 应用层向量计算模式（建议使用MariaDB 11.8获得最佳性能）' AS status;
    END IF;
END //

DELIMITER ;

CALL add_topic_embedding_support();
DROP PROCEDURE add_topic_embedding_support;
```

### 9.4 部署建议

| 环境 | 推荐数据库 | 策略 | 预期性能 |
|------|------------|------|----------|
| **生产环境** | MariaDB 11.8 LTS | 原生向量索引 | 毫秒级（~5-10ms） |
| **开发环境** | MariaDB 11.8 或 SQLite | 原生或应用层 | - |
| **客户私有化** | 自动检测 | 自动降级 | 根据环境适配 |
| **边缘设备** | SQLite | 应用层+FTS5 | 秒级（~100-500ms） |

### 9.5 与参考项目的架构对比

| 特性 | ZeroClaw | 本方案（touwaka-mate-v2） |
|------|----------|---------------------------|
| **存储粒度** | 单条记忆entry | Topic级别聚合 |
| **向量索引** | SQLite BLOB+应用层计算 | MariaDB原生VECTOR INDEX |
| **混合搜索** | FTS5 BM25 + 向量融合 | 可选（扩展预留） |
| **Embedding缓存** | 有（LRU策略） | 可扩展实现 |
| **数据量假设** | 单用户记忆库 | 多Topic，Topic数量有限 |

### 9.6 启动时检查代码

```javascript
// index.js - 启动时初始化
async function initializeVectorSearch() {
    const provider = new VectorSearchProvider(db);
    await provider.initialize();
    
    if (provider.strategy === 'mariadb_native') {
        console.log('✅ 使用MariaDB原生向量索引（高性能）');
    } else {
        console.log('⚠️ 使用应用层向量计算（建议升级到MariaDB 11.8）');
    }
    
    // 全局注册
    global.vectorSearch = provider;
    return provider;
}
```

### 9.7 总结

本方案的核心优势：

1. **向后兼容**：自动检测数据库能力，MariaDB 11.8用户获得最佳性能，其他用户功能不丢失
2. **平滑迁移**：升级数据库即可自动启用原生向量索引，无需修改业务代码
3. **架构一致性**：基于ZeroClaw的BLOB存储经验，扩展到MySQL生态
4. **性能分层**：为不同部署环境提供合适的性能级别

参考ZeroClaw的`src/memory/sqlite.rs`实现（向量化混合搜索）和NanoClaw的`src/db.ts`设计（数据库抽象层），本方案将向量搜索能力与具体数据库解耦，实现真正的跨版本兼容。

**从NanoClaw借鉴：**
- 游标机制避免重复处理
- 状态快照注入（任务、群组信息）

### 8.5 对当前项目的启示

当前项目（touwaka-mate-v2）的提示词架构：

```javascript
// lib/context-manager.js 当前实现
buildContext(message, options) {
    // 1. 系统提示（Base）
    // 2. Soul（人格特质）
    // 3. Inner Voices（反思反馈）
    // 4. Topic Context（主题上下文）
    // 5. Contact Profile（联系人画像）
    // 6. Recent Messages（最近消息）
}
```

**建议改进：**

1. **引入动态组件**：参考PicoClaw，在系统提示中加入当前时间、活跃工具列表
2. **优化Token估算**：当前使用字符/4估算，建议改用更精确的算法或tiktoken
3. **摘要触发机制**：当前基于消息数（20条）触发，建议加入Token阈值（如70%上下文窗口）
4. **异步摘要**：摘要生成阻塞主流程，建议改为异步执行
5. **考虑RAG增强**：对于长期对话，可引入向量检索补偿被截断的历史

---

*报告生成时间：2026-02-16*
*分析版本：v1.1（新增提示词生成与历史压缩专题）*
