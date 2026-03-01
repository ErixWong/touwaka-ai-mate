# Skill Runner 多语言支持

> 创建时间：2026-03-01
> 状态：讨论中
> 分支：feature/skill-runner-multi-language

---

## 已确定的决定

| 决定项 | 结论 |
|--------|------|
| **统一沙箱方案** | **OpenSandbox**（阿里巴巴开源） |
| **跨平台支持** | Linux / Windows / macOS（通过 Docker） |
| **文件隔离** | ✅ Docker 容器隔离，保证文件夹隔离 |
| **SDK** | JavaScript/TypeScript SDK 集成到 Node.js 后端 |

### OpenSandbox 优势

- ✅ 跨平台一致（Docker 运行时）
- ✅ 多语言 SDK（JavaScript/TypeScript 原生支持）
- ✅ 内置 Code Interpreter（完美适配技能执行）
- ✅ 生产级方案（阿里巴巴内部使用）
- ✅ Apache 2.0 开源协议
- ✅ 统一维护，无需维护多套沙箱实现

### 新发现：OpenSandbox（阿里巴巴开源）

> GitHub: https://github.com/alibaba/OpenSandbox
> 文档: https://open-sandbox.ai/

**OpenSandbox** 是阿里巴巴开源的通用沙箱平台，专为 AI 应用设计：

| 特性 | 说明 |
|------|------|
| **多语言 SDK** | Python, JavaScript/TypeScript, Java/Kotlin, C#/.NET |
| **统一沙箱 API** | 跨平台一致的沙箱生命周期管理 |
| **运行时** | Docker（本地）+ Kubernetes（云端） |
| **内置功能** | Command 执行、Filesystem 操作、Code Interpreter |
| **网络策略** | Ingress Gateway + Egress 控制 |

**示例代码**：

```python
from opensandbox import Sandbox
from code_interpreter import CodeInterpreter

# 创建沙箱
sandbox = await Sandbox.create(
    "opensandbox/code-interpreter:v1.0.1",
    timeout=timedelta(minutes=10),
)

async with sandbox:
    # 执行命令
    result = await sandbox.commands.run("echo 'Hello!'")
    
    # 文件操作
    await sandbox.files.write_files([
        WriteEntry(path="/tmp/hello.txt", data="Hello World")
    ])
    
    # 执行 Python 代码
    interpreter = await CodeInterpreter.create(sandbox)
    result = await interpreter.codes.run("print(2 + 2)", language="python")
```

**优点**：
- ✅ 跨平台一致（Docker 运行时）
- ✅ 多语言 SDK（可直接集成到 Node.js 后端）
- ✅ 内置 Code Interpreter（完美适配技能执行场景）
- ✅ 生产级方案（阿里巴巴内部使用）
- ✅ Apache 2.0 开源协议

**缺点**：
- 需要 Docker 环境
- 镜像下载开销

---

### 原方案对比

| 方案 | 隔离能力 | 跨平台 | 复杂度 | 适用场景 |
|------|---------|--------|--------|---------|
| **OpenSandbox** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 中 | 推荐：生产+开发 |
| **Firejail** | ⭐⭐⭐⭐ | ⭐（仅 Linux） | 低 | Linux 生产环境 |
| **Sandboxie Plus** | ⭐⭐⭐⭐ | ⭐（仅 Windows） | 低 | Windows 开发环境 |
| **Apple Sandbox** | ⭐⭐⭐⭐ | ⭐（仅 macOS） | 高 | macOS 开发环境 |

---

### 推荐方案：OpenSandbox + 原生沙箱混合

```
┌─────────────────────────────────────────────────────────────┐
│ 生产环境（服务器）                                            │
│ - 首选: OpenSandbox（Docker/K8s 运行时）                      │
│ - 备选: Firejail（Linux 轻量方案）                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 开发环境（本地）                                              │
│ - 有 Docker: OpenSandbox                                     │
│ - 无 Docker:                                                 │
│   - Linux: Firejail                                          │
│   - Windows: Sandboxie Plus                                  │
│   - macOS: 无沙箱（软限制）                                   │
└─────────────────────────────────────────────────────────────┘
```

---

### macOS 方案讨论（备选）

macOS 没有原生的 Firejail 或 Sandboxie，可选方案：

| 方案 | 隔离能力 | 复杂度 | 适用场景 |
|------|---------|--------|---------|
| **Apple Sandbox (Seatbelt)** | ⭐⭐⭐⭐ | 高 | 生产环境 |
| **软限制（无沙箱）** | ⭐ | 低 | 开发环境 |
| **Docker Desktop** | ⭐⭐⭐⭐⭐ | 中 | 可选（用户自行安装） |

**原推荐方案：分层策略**

```
┌─────────────────────────────────────────────────────────────┐
│ 生产环境（服务器）                                            │
│ - Linux: Firejail（轻量、原生）                               │
│ - 无 macOS 服务器场景                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 开发环境（本地）                                              │
│ - Linux: Firejail 或无沙箱（开发者选择）                       │
│ - Windows: Sandboxie Plus 或无沙箱                            │
│ - macOS: 无沙箱，仅软限制                                     │
└─────────────────────────────────────────────────────────────┘
```

**macOS 开发环境方案**：

```javascript
// sandbox-executor.js 检测平台和能力
async execute(userId, role, command, options) {
  if (process.platform === 'darwin') {
    // macOS: 检查是否有 sandbox-exec
    if (await this.hasAppleSandbox()) {
      return this.executeWithAppleSandbox(userId, role, command, options);
    }
    // 降级到无沙箱执行（仅开发环境）
    logger.warn('[SandboxExecutor] macOS running without sandbox (dev mode)');
    return this.executeWithoutSandbox(userId, role, command, options);
  }
  // Linux/Windows: 使用对应沙箱
  ...
}
```

**Apple Sandbox (Seatbelt) 示例**：

```
(version 1)
(deny default)
(allow process-exec (literal "/usr/bin/python3"))
(allow file-read* (subpath "/skills"))
(allow file-read* (subpath "/work/user_123"))
(allow file-write* (subpath "/work/user_123"))
(deny file-read* (subpath "/.env"))
```

执行：`sandbox-exec -f profile.sb python skill/index.py`

**优点**：
- macOS 原生，无需安装
- 轻量，无额外开销
- 生产级隔离能力

**缺点**：
- 配置语法复杂
- Apple 文档较少

---

## 背景

当前 [`lib/skill-runner.js`](../../../lib/skill-runner.js) 只支持 Node.js 技能：
- 使用 `vm` 模块执行 JavaScript 代码
- 通过 stdin/stdout JSON 协议通信
- 只能运行 `index.js` 入口文件

**需求**：扩展支持 Python 等其他脚本语言

---

## 当前架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Core Service                             │
│  调用 skill-runner 子进程                                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              skill-runner.js (Node.js)                       │
│  - 从技能目录加载 index.js                                    │
│  - 使用 vm 模块执行 JS 代码                                   │
│  - stdin 接收参数，stdout 返回结果                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 方案讨论

### 方案 A：多 Runner 架构

为每种语言创建独立的 runner：

```
lib/
├── skill-runner.js        # Node.js 技能
├── skill-runner-py.py     # Python 技能
├── skill-runner-sh.sh     # Shell 技能
└── skill-runner.d/        # 或统一目录
```

**优点**：
- 各语言独立，互不影响
- 可以针对每种语言优化

**缺点**：
- 维护成本高
- 需要统一通信协议

### 方案 B：统一 Runner + 语言检测

在现有 `skill-runner.js` 中检测入口文件类型：

```javascript
// 伪代码
function detectRunner(skillPath) {
  if (fs.existsSync(path.join(skillPath, 'index.js'))) {
    return { type: 'node', entry: 'index.js' };
  }
  if (fs.existsSync(path.join(skillPath, 'index.py'))) {
    return { type: 'python', entry: 'index.py' };
  }
  if (fs.existsSync(path.join(skillPath, 'main.sh'))) {
    return { type: 'bash', entry: 'main.sh' };
  }
  throw new Error('No entry file found');
}
```

**优点**：
- 统一入口，调用方无需感知语言差异
- stdin/stdout JSON 协议保持一致

**缺点**：
- 需要在 runner 中处理多语言执行逻辑

### 方案 C：外部沙箱执行器

利用现有的 `sandbox-executor` 直接执行任意命令：

```javascript
// 调用方
const result = await sandboxExecutor.execute(userId, role, 
  `python ${skillPath}/index.py`, 
  { input: JSON.stringify(params) }
);
```

**优点**：
- 复用现有沙箱基础设施
- 支持任意可执行文件

**缺点**：
- 需要调用方感知语言类型
- 与现有 skill-runner 调用方式不兼容

---

## 技术要点

### 1. 入口文件检测

| 语言 | 入口文件 | 执行器 |
|------|----------|--------|
| Node.js | `index.js` | `node` |
| Python | `index.py` | `python` / `python3` |
| Bash | `main.sh` | `bash` |
| 可执行文件 | `main.exe` / `main` | 直接执行 |

### 2. 通信协议

保持 stdin/stdout JSON 协议统一：

```json
// 输入 (stdin)
{
  "params": { ... },
  "context": { ... }
}

// 输出 (stdout)
{
  "success": true,
  "data": { ... }
}
// 或
{
  "success": false,
  "error": "错误信息"
}
```

### 3. 沙箱隔离

- **Linux**: 使用 Firejail 限制文件系统和网络访问
- **Windows**: 使用 Sandboxie Plus 隔离执行

### 4. SKILL.md 元数据

在 SKILL.md 中声明语言类型：

```markdown
---
language: python
runtime: python3.11
---
```

---

## 文件夹隔离分析

### 当前架构问题

**关键发现**：当前 [`lib/skill-runner.js`](../../../lib/skill-runner.js) **没有使用沙箱**！

```
当前 Node.js 技能执行流程：
Core Service → spawn('node skill-runner.js') → vm.runInContext()
                                            ↑
                                        仅靠 vm 隔离，无文件系统隔离！
```

`vm` 模块只能隔离 JavaScript 作用域，**无法阻止文件系统访问**。代码中的 `require` 白名单是软限制，可以被绕过。

### 现有沙箱能力

项目已有 [`lib/sandbox-executor.js`](../../../lib/sandbox-executor.js)，支持：

| 平台 | 沙箱 | 文件隔离方式 |
|------|------|-------------|
| Linux | Firejail | `whitelist` + `read-only` + `blacklist` |
| Windows | Sandboxie Plus | `OpenFilePath` + `ReadFilePath` + `ClosedFilePath` |

**Firejail 隔离能力（Linux）**：
```bash
# 普通用户只能访问：
--whitelist=/work/user_123/          # 用户工作目录（读写）
--read-only=/skills/                  # 技能目录（只读）
--blacklist=/work/.env                # 敏感文件（禁止）

# 资源限制：
--rlimit-as=512M                      # 内存限制
--rlimit-nproc=50                     # 进程数限制
--seccomp                             # 系统调用过滤
--caps.drop=all                       # 移除 Linux capabilities
```

**Sandboxie 隔离能力（Windows）**：
```ini
# 普通用户只能访问：
OpenFilePath=C:\work\data\work\user_123\   # 用户工作目录（读写）
ReadFilePath=C:\work\skills\               # 技能目录（只读）
ClosedFilePath=C:\work\.env                # 敏感文件（禁止）
```

### Python 执行隔离方案

**结论：可以保证文件夹隔离，但需要改用 sandbox-executor 执行！**

```
推荐的 Python 技能执行流程：
Core Service → sandbox-executor.execute(userId, role, 'python skill/index.py')
                    ↓
              Firejail/Sandboxie 隔离
                    ↓
              只能访问白名单目录
```

**实现方案**：

```javascript
// 新的 skill-runner.js（统一入口）
async function executeSkill(skillId, toolName, params, context) {
  const skillPath = getSkillPath(skillId);
  const runnerType = detectRunner(skillPath);  // 'node' | 'python' | 'bash'
  
  const command = buildCommand(runnerType, skillPath, toolName);
  // 例如: 'python /skills/compression/index.py'
  
  // 通过沙箱执行，保证文件隔离
  const result = await sandboxExecutor.execute(userId, role, command, {
    input: JSON.stringify({ params, context }),
    timeout: 10000,
  });
  
  return JSON.parse(result.stdout);
}
```

---

## 待讨论问题

### 1. Python 依赖管理（OpenSandbox 方案）

采用 OpenSandbox 后，依赖管理变得简单：

**方案：使用 OpenSandbox 官方镜像或自定义镜像**

```yaml
# 镜像选择策略
- opensandbox/code-interpreter:v1.0.1  # 官方镜像，预装常用库
- 自定义镜像: 根据技能需求构建专用镜像
```

**技能目录结构**：
```
skills/
├── compression/
│   ├── SKILL.md
│   ├── index.py
│   └── requirements.txt  # 可选：自定义依赖
```

**执行流程**：
1. 检测技能语言类型
2. 选择对应的基础镜像
3. 如有 requirements.txt，在容器启动时安装
4. 执行技能代码

### 2. Node.js 技能处理

**决定：统一使用 OpenSandbox**

- 当前 `vm` 方案无文件隔离，存在安全风险
- 统一使用 OpenSandbox 保证一致性
- Node.js 技能使用 `opensandbox/code-interpreter` 镜像（支持 Node.js）

### 3. 错误处理

OpenSandbox 提供统一的错误格式：

```typescript
interface ExecutionResult {
  success: boolean;
  result?: any;
  logs: {
    stdout: Array<{ text: string }>;
    stderr: Array<{ text: string }>;
  };
  error?: {
    message: string;
    code?: string;
  };
}
```

### 4. 开发环境

| 环境 | 方案 |
|------|------|
| 有 Docker | OpenSandbox |
| 无 Docker | 降级到无沙箱执行（警告日志） |

---

## OpenSandbox SDK 研究

### 安装

```bash
# 基础沙箱 SDK
npm install @alibaba-group/opensandbox

# Code Interpreter SDK（推荐用于技能执行）
npm install @alibaba-group/opensandbox-code-interpreter
```

### 核心概念

#### 1. Sandbox SDK（底层）

用于创建和管理沙箱生命周期：

```typescript
import { ConnectionConfig, Sandbox } from "@alibaba-group/opensandbox";

const config = new ConnectionConfig({
  domain: "localhost:8080",  // OpenSandbox 服务地址
  apiKey: "your-api-key",    // 可选
});

const sandbox = await Sandbox.create({
  connectionConfig: config,
  image: "ubuntu",
  timeoutSeconds: 10 * 60,
});

// 执行命令
const result = await sandbox.commands.run("echo 'Hello!'");
console.log(result.logs.stdout[0]?.text);

// 文件操作
await sandbox.files.writeFiles([
  { path: "/tmp/hello.txt", data: "Hello World", mode: 644 }
]);
const content = await sandbox.files.readFile("/tmp/hello.txt");

// 清理
await sandbox.kill();
await sandbox.close();
```

#### 2. Code Interpreter SDK（高层）

专为代码执行设计，支持多语言：

```typescript
import { Sandbox } from "@alibaba-group/opensandbox";
import { CodeInterpreter, SupportedLanguages } from "@alibaba-group/opensandbox-code-interpreter";

// 创建沙箱（使用官方 Code Interpreter 镜像）
const sandbox = await Sandbox.create({
  connectionConfig: config,
  image: "opensandbox/code-interpreter:v1.0.1",
  entrypoint: ["/opt/opensandbox/code-interpreter.sh"],
  env: {
    PYTHON_VERSION: "3.11",
    NODE_VERSION: "20",
  },
  timeoutSeconds: 15 * 60,
});

// 创建 Code Interpreter
const ci = await CodeInterpreter.create(sandbox);

// 执行 Python 代码
const result = await ci.codes.run(
  "import sys\nprint(sys.version)\nresult = 2 + 2\nresult",
  { language: SupportedLanguages.PYTHON }
);
console.log(result.result[0]?.text);  // "4"

// 执行 Node.js 代码
const jsResult = await ci.codes.run(
  "const x = 42;\nx + 8;",
  { language: SupportedLanguages.NODEJS }
);

// 清理
await sandbox.kill();
await sandbox.close();
```

### 支持的语言

| 语言 | 环境变量 | 示例值 |
|------|---------|--------|
| Python | `PYTHON_VERSION` | `3.11` |
| Java | `JAVA_VERSION` | `17` |
| Node.js | `NODE_VERSION` | `20` |
| Go | `GO_VERSION` | `1.24` |

### 流式输出

```typescript
const handlers = {
  onStdout: (m) => console.log("STDOUT:", m.text),
  onStderr: (m) => console.error("STDERR:", m.text),
  onResult: (r) => console.log("RESULT:", r.text),
};

await ci.codes.run("for i in range(5):\n    print(i)", {
  language: SupportedLanguages.PYTHON,
  handlers,
});
```

### 上下文管理（状态持久化）

```typescript
// 创建上下文（状态在多次执行间保持）
const ctx = await ci.codes.createContext(SupportedLanguages.PYTHON);

// 第一次执行
await ci.codes.run("x = 42", { context: ctx });

// 第二次执行（可以访问之前的变量）
const result = await ci.codes.run("result = x + 8\nresult", { context: ctx });
console.log(result.result[0]?.text);  // "50"

// 清理上下文
await ci.codes.deleteContext(ctx.id!);
```

---

## 技能执行接口设计

### 新的 skill-runner 架构

```typescript
// lib/skill-runner-opensandbox.js

import { Sandbox } from "@alibaba-group/opensandbox";
import { CodeInterpreter, SupportedLanguages } from "@alibaba-group/opensandbox-code-interpreter";

export class OpenSandboxSkillRunner {
  constructor(config) {
    this.config = config;
    this.sandbox = null;
    this.codeInterpreter = null;
  }

  async initialize() {
    // 创建沙箱
    this.sandbox = await Sandbox.create({
      connectionConfig: this.config,
      image: "opensandbox/code-interpreter:v1.0.1",
      entrypoint: ["/opt/opensandbox/code-interpreter.sh"],
      env: {
        PYTHON_VERSION: "3.11",
        NODE_VERSION: "20",
      },
      timeoutSeconds: 15 * 60,
    });

    this.codeInterpreter = await CodeInterpreter.create(this.sandbox);
  }

  async executeSkill(skillId, toolName, params, context) {
    // 1. 加载技能代码
    const skillCode = await this.loadSkillCode(skillId);
    
    // 2. 检测语言
    const language = this.detectLanguage(skillId);
    
    // 3. 在沙箱中执行
    const result = await this.codeInterpreter.codes.run(skillCode, {
      language,
      // 传入参数作为全局变量
    });

    return result;
  }

  detectLanguage(skillId) {
    // 根据 SKILL.md 或入口文件检测语言
    const skillPath = getSkillPath(skillId);
    if (fs.existsSync(path.join(skillPath, 'index.py'))) {
      return SupportedLanguages.PYTHON;
    }
    if (fs.existsSync(path.join(skillPath, 'index.js'))) {
      return SupportedLanguages.NODEJS;
    }
    throw new Error(`Unknown skill language: ${skillId}`);
  }

  async cleanup() {
    if (this.sandbox) {
      await this.sandbox.kill();
      await this.sandbox.close();
    }
  }
}
```

### 与现有 skill-loader.js 集成

```typescript
// lib/skill-loader.js 修改

import { OpenSandboxSkillRunner } from './open-sandbox-runner.js';

class SkillLoader {
  private sandboxRunner: OpenSandboxSkillRunner | null = null;

  private getSandboxRunner(): OpenSandboxSkillRunner {
    if (!this.sandboxRunner) {
      this.sandboxRunner = new OpenSandboxSkillRunner({
        domain: process.env.OPEN_SANDBOX_DOMAIN || 'localhost:8080',
        apiKey: process.env.OPEN_SANDBOX_API_KEY,
        skillBasePath: process.env.DATA_BASE_PATH + '/skills',
      });
    }
    return this.sandboxRunner;
  }

  async executeSkillTool(skillId, toolName, params, context = {}) {
    // 检测是否启用 OpenSandbox
    if (process.env.USE_OPEN_SANDBOX === 'true') {
      const runner = this.getSandboxRunner();
      return await runner.executeSkill(skillId, toolName, params, context);
    }
    
    // 降级到原有的子进程方式
    return this.executeSkillToolLegacy(skillId, toolName, params, context);
  }
}
```

### 环境变量配置

```env
# .env
USE_OPEN_SANDBOX=true
OPEN_SANDBOX_DOMAIN=localhost:8080
OPEN_SANDBOX_API_KEY=your-api-key
```

### 迁移策略

1. **阶段一**：添加 OpenSandbox 支持，通过环境变量切换
2. **阶段二**：测试验证所有技能在 OpenSandbox 中正常工作
3. **阶段三**：默认启用 OpenSandbox，移除旧的 vm 实现

---

## 下一步

- [x] 确定统一使用 OpenSandbox
- [x] 研究 OpenSandbox JavaScript SDK 集成
- [x] 设计技能执行接口
- [ ] 编写 POC 代码
- [ ] 更新现有技能为 OpenSandbox 兼容格式

---

*让我们一起愉快地讨论吧！ 💪✨*
