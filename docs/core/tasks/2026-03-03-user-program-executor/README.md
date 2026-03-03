# 用户程序执行器

> 创建日期：2026-03-03
> 状态：⏳ 待开始
> 优先级：中

---

## 背景与动机

当前系统已有完善的技能执行系统（skill-runner），支持 Node.js 和 Python 两种运行时，并具备沙箱隔离能力。Eric 提出了一个想法：

**利用现有的执行能力，让专家可以运行用户目录中的程序。**

这将为系统带来极大的扩展性，让用户能够：
- 快速运行一次性脚本
- 复用已有的工具和自动化脚本
- 在对话中直接获得脚本执行结果

---

## ⚠️ 重要约束

**这不是技能系统的一部分**，而是一个独立的执行能力，具有严格的限制：

| 约束 | 说明 |
|------|------|
| **超时限制** | 最大执行时间 5 分钟，超时强制终止 |
| **禁止监听端口** | 不允许执行网络服务类程序（如 HTTP Server） |
| **作用域限制** | 只能在当前 Task 上下文中执行，程序只能访问 Task 工作空间 |
| **一次性执行** | 程序必须是一次性任务，执行完毕后退出 |

---

## 可行性分析

### 现有系统能力（skill-runner.js）

| 能力 | 现状 | 说明 |
|------|------|------|
| Node.js 执行 | ✅ 已有 | vm 沙箱，10秒超时 |
| Python 执行 | ✅ 已有 | subprocess 隔离，30秒超时 |
| 模块白名单 | ✅ 已有 | 限制可 require 的模块 |
| 路径遍历防护 | ✅ 已有 | 禁止 `..` 和绝对路径 |
| Python 危险函数黑名单 | ✅ 已有 | 禁止 os.system, exec, fork 等 |
| 超时控制 | ✅ 已有 | Node 10s / Python 30s |

### 需求对照

| 需求 | 可行性 | 说明 |
|------|--------|------|
| **5 分钟超时** | ✅ **简单** | 修改 `PYTHON_TIMEOUT` 常量即可 |
| **禁止监听端口** | ⚠️ **需要新增** | 需要实现检测机制 |
| **Task 作用域** | ⚠️ **有依赖** | 依赖 Task 工作空间管理任务 |
| **独立于技能系统** | ✅ **简单** | 创建独立的 program-executor 模块 |

### 技术挑战

#### 1. 端口监听检测 🔴 需要新增

**方案 A：静态代码分析**
```javascript
// 检测 Python 代码中的危险模式
const PYTHON_DANGEROUS_PATTERNS = [
  /socket\.socket\s*\(/,
  /\.bind\s*\(/,
  /\.listen\s*\(/,
  /http\.server/i,
  /flask/i,
  /fastapi/i,
  /uvicorn/i,
];

// 检测 Node.js 代码中的危险模式
const NODE_DANGEROUS_PATTERNS = [
  /net\.createServer/,
  /http\.createServer/,
  /express\(\)/,
  /koa\(\)/,
  /\.listen\s*\(/,
];
```

**方案 B：运行时监控**
```javascript
// 执行前记录开放端口
const beforePorts = getOpenPorts();

// 执行程序（带超时）
await executeProgram();

// 执行后检查新开放的端口
const afterPorts = getOpenPorts();
const newPorts = difference(afterPorts, beforePorts);

if (newPorts.length > 0) {
  throw new Error(`程序尝试监听端口: ${newPorts.join(', ')}`);
}
```

**推荐**：方案 A（静态分析）+ 方案 B（运行时监控）双重保障

#### 2. Task 作用域隔离 🟡 有依赖

**依赖**：Task 工作空间管理任务（进行中 30%）

**实现方式**：
```javascript
// 执行时将 cwd 设置为 Task 工作空间
const taskWorkspace = `/app/workspaces/task_${taskId}`;

const result = await executeProgram({
  cwd: taskWorkspace,           // 工作目录
  env: {
    TASK_ID: taskId,
    TASK_WORKSPACE: taskWorkspace,
  },
  // 限制文件系统访问
  allowedPaths: [taskWorkspace],
});
```

#### 3. 5 分钟超时 ✅ 简单

```javascript
// 现有代码
const PYTHON_TIMEOUT = 30000; // 30秒

// 修改为
const PROGRAM_TIMEOUT = 5 * 60 * 1000; // 5 分钟
```

---

## 设计方案

### 方案对比：独立模块 vs 技能

| 维度 | 方案 A：独立模块 | 方案 B：创建技能 |
|------|------------------|------------------|
| **实现复杂度** | 🟡 中等（需要新建模块） | 🟢 简单（复用现有框架） |
| **安全控制** | 🟢 灵活（可定制所有限制） | 🟡 受限（受技能框架约束） |
| **作用域限制** | 🟢 天然支持 Task 作用域 | 🔴 需要额外处理（技能是全局的） |
| **超时配置** | 🟢 可独立配置 5 分钟 | 🟡 需要修改 skill-runner |
| **权限管理** | 🟢 可精细控制 | 🟡 继承技能权限模型 |
| **维护成本** | 🔴 两套执行框架 | 🟢 统一维护 |

### 推荐：方案 B - 创建技能 ✅

**理由**：
1. **复用现有框架**：skill-runner 已有完善的沙箱、超时、黑名单机制
2. **统一管理**：所有执行能力都在技能框架内，便于维护
3. **权限继承**：可以复用现有的专家-技能分配机制
4. **快速实现**：只需创建一个特殊技能，无需修改核心框架

**关键设计**：创建 `task-executor` 技能，专门用于执行 Task 工作空间内的程序。

### 架构（方案 B）

```
Task 工作空间
    ├── process-data.py
    ├── calculate.js
    └── ...
        ↓
    task-executor 技能（data/skills/task-executor/）
        ├── index.js（技能入口）
        ├── 安全检查（端口检测、路径验证）
        └── 调用 skill-runner 执行
        ↓
    返回结果给对话
```

### 技能定义

**技能目录**：`data/skills/task-executor/`

**SKILL.md**：
```markdown
# Task 程序执行器

在当前 Task 工作空间中执行用户程序。

## 约束
- 超时：5 分钟
- 禁止监听端口
- 只能访问 Task 工作空间
```

**工具定义**：
```json
{
  "name": "execute_program",
  "description": "在当前 Task 工作空间中执行用户程序。程序必须是一次性任务（5分钟内完成），不允许监听端口。",
  "parameters": {
    "type": "object",
    "properties": {
      "program": {
        "type": "string",
        "description": "程序文件名（在 Task 工作空间内）"
      },
      "args": {
        "type": "array",
        "items": { "type": "string" },
        "description": "命令行参数"
      }
    },
    "required": ["program"]
  }
}
```

### 技能实现要点

```javascript
// data/skills/task-executor/index.js

module.exports = {
  name: 'task-executor',
  description: '在 Task 工作空间中执行用户程序',
  
  getTools() {
    return [{
      type: 'function',
      function: {
        name: 'execute_program',
        description: '执行 Task 工作空间中的程序...',
        parameters: { ... }
      }
    }];
  },
  
  async execute(toolName, params, context) {
    const { program, args = [] } = params;
    const { taskId, taskWorkspace } = context;
    
    // 1. 安全检查
    validateProgramPath(program, taskWorkspace);
    await checkDangerousPatterns(program, taskWorkspace);
    
    // 2. 执行程序
    const result = await runProgram({
      program: path.join(taskWorkspace, program),
      args,
      cwd: taskWorkspace,
      timeout: 5 * 60 * 1000,  // 5 分钟
    });
    
    // 3. 返回结果
    return {
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }
};
```

### 需要修改 skill-runner 的地方

1. **超时配置**：为 task-executor 技能使用更长的超时
   ```javascript
   // skill-runner.js
   const TIMEOUT_CONFIG = {
     default: 30000,        // 默认 30 秒
     'task-executor': 300000,  // task-executor 5 分钟
   };
   ```

2. **传递 Task 上下文**：在 skill-loader 中传递 taskId 和 taskWorkspace
   ```javascript
   // skill-loader.js
   const context = {
     ...existingContext,
     taskId: task.id,
     taskWorkspace: getTaskWorkspace(task.id),
   };
   ```

### API 设计

```http
POST /api/tasks/:taskId/programs/execute
```

请求体：
```json
{
  "program": "process-data.py",
  "args": ["--input", "data.csv", "--output", "result.json"]
}
```

响应：
```json
{
  "success": true,
  "stdout": "...",
  "stderr": "",
  "exitCode": 0,
  "duration": 1234
}
```

### 专家工具定义

```json
{
  "name": "execute_program",
  "description": "在当前 Task 工作空间中执行用户程序。程序必须是一次性任务（5分钟内完成），不允许监听端口。",
  "parameters": {
    "type": "object",
    "properties": {
      "program": {
        "type": "string",
        "description": "程序文件名（在 Task 工作空间内）"
      },
      "args": {
        "type": "array",
        "items": { "type": "string" },
        "description": "命令行参数"
      }
    },
    "required": ["program"]
  }
}
```

---

## 实现计划

> **选定方案**：方案 B - 创建 `task-executor` 技能

### Phase 1：技能基础框架
- [ ] 创建 `data/skills/task-executor/` 目录
- [ ] 编写 SKILL.md（技能描述）
- [ ] 编写 index.js（技能入口 + execute_program 工具）
- [ ] 通过 skill-manager 注册技能

### Phase 2：安全增强
- [ ] 实现路径验证（防止路径遍历）
- [ ] 实现静态代码分析（端口检测）
- [ ] 实现运行时端口监控（可选）
- [ ] 环境变量过滤（只传递安全变量）

### Phase 3：skill-runner 适配
- [ ] 为 task-executor 配置 5 分钟超时
- [ ] 在 skill-loader 中传递 Task 上下文（taskId, taskWorkspace）
- [ ] 测试与文档

### 依赖
- Task 工作空间管理任务（进行中 30%）

---

## 风险分析

### 安全风险矩阵

| 风险 | 严重程度 | 可能性 | 缓解措施 | 残余风险 |
|------|----------|--------|----------|----------|
| **恶意代码执行** | 🔴 高 | 中 | 沙箱隔离 + 危险函数黑名单 | ⚠️ 中 |
| **资源耗尽攻击** | 🟡 中 | 高 | 超时终止 + 内存限制 | ⚠️ 中 |
| **文件系统越权** | 🔴 高 | 中 | Task 作用域限制 | ⚠️ 中 |
| **端口监听/网络服务** | 🟡 中 | 低 | 静态分析 + 运行时监控 | ✅ 低 |
| **敏感信息泄露** | 🔴 高 | 中 | 环境变量过滤 + 日志脱敏 | ⚠️ 中 |
| **权限提升** | 🔴 高 | 低 | 最小权限原则 + 非 root 运行 | ✅ 低 |

### 技术风险

| 风险 | 严重程度 | 可能性 | 缓解措施 |
|------|----------|--------|----------|
| **静态分析绕过** | 🟡 中 | 中 | 运行时监控作为兜底 |
| **Python 动态代码执行** | 🔴 高 | 中 | 禁止 eval/exec/dynamic import |
| **Node.js 原生模块** | 🟡 中 | 低 | 模块白名单限制 |
| **符号链接攻击** | 🟡 中 | 低 | 禁止符号链接跟随 |
| **竞态条件** | 🟢 低 | 低 | 文件锁 + 原子操作 |

### 运维风险

| 风险 | 严重程度 | 可能性 | 缓解措施 |
|------|----------|--------|----------|
| **磁盘空间耗尽** | 🟡 中 | 中 | Task 工作空间配额 |
| **进程僵尸** | 🟡 中 | 低 | 超时强制 kill + 进程回收 |
| **日志膨胀** | 🟢 低 | 中 | 日志轮转 + 大小限制 |
| **依赖冲突** | 🟢 低 | 高 | 用户自行管理依赖 |

---

### 详细风险分析

#### 1. 恶意代码执行 🔴

**场景**：用户创建恶意脚本，尝试：
- 访问系统敏感文件（/etc/passwd, ~/.ssh/）
- 执行系统命令
- 网络攻击其他服务

**现有防护**：
- Python 危险函数黑名单（os.system, exec, fork 等）
- Node.js 模块白名单
- vm 沙箱隔离

**残余风险**：
- Python 黑名单可能不完整
- 通过合法模块间接执行危险操作
- 绕过 vm 沙箱的攻击（虽然困难但存在）

**建议增强**：
```python
# 更完整的 Python 黑名单
_OS_BLACKLIST = {
    'system', 'spawn*', 'exec*', 'popen', 'fork', 'kill',
    'chroot', 'chdir', 'fchdir',  # 目录操作
    'setuid', 'setgid', 'seteuid', 'setegid',  # 权限操作
}
_SUBPROCESS_BLACKLIST = True  # 完全禁止 subprocess 模块
_SOCKET_BLACKLIST = True  # 完全禁止 socket 模块（或仅允许客户端）
```

#### 2. 资源耗尽攻击 🟡

**场景**：
- CPU 密集型计算（死循环、加密挖矿）
- 内存耗尽（大数组、无限递归）
- 文件系统填满（创建大量文件）

**现有防护**：
- 超时控制（5 分钟）
- Node.js vm 超时（10 秒）

**残余风险**：
- 5 分钟内可以消耗大量资源
- 没有内存限制
- 没有磁盘配额

**建议增强**：
```javascript
// 添加资源限制
const execOptions = {
  timeout: 5 * 60 * 1000,  // 5 分钟
  maxBuffer: 10 * 1024 * 1024,  // 10MB stdout
  memoryLimit: 512 * 1024 * 1024,  // 512MB（需要 cgroups）
  diskQuota: 100 * 1024 * 1024,  // 100MB（需要配额管理）
};
```

#### 3. 敏感信息泄露 🔴

**场景**：
- 程序读取环境变量中的数据库密码
- 读取配置文件中的 API Key
- 通过 stdout 输出敏感信息

**现有防护**：
- vm 沙箱中 process.env 是副本（但包含所有环境变量）

**残余风险**：
- 技能可以访问所有环境变量
- 可能读取工作空间外的配置文件

**建议增强**：
```javascript
// 过滤环境变量，只传递安全的变量
const safeEnv = {
  TASK_ID: process.env.TASK_ID,
  TASK_WORKSPACE: process.env.TASK_WORKSPACE,
  // 不传递数据库密码、API Key 等
};
```

#### 4. 端口监听绕过 🟡

**场景**：
- 使用混淆代码绕过静态分析
- 运行时动态加载监听代码
- 使用非标准方式监听端口

**防护策略**：

**静态分析**（第一道防线）：
```javascript
// 检测常见框架和模式
const DANGEROUS_PATTERNS = [
  // 显式监听
  /socket\.socket/, /\.bind\s*\(/, /\.listen\s*\(/,
  // Web 框架
  /flask/i, /fastapi/i, /django/i, /express/i, /koa/i, /hapi/i,
  /http\.server/i, /simplehttpserver/i,
  // ASGI/WGI 服务器
  /uvicorn/i, /gunicorn/i, /waitress/i,
  // 混淆尝试
  /__import__\s*\(/,  // 动态导入
  /eval\s*\(/, /exec\s*\(/,  // 动态执行
];
```

**运行时监控**（第二道防线）：
```javascript
// 执行前后检查端口
function getListeningPorts(pid) {
  // Linux: 读取 /proc/net/tcp
  // Windows: netstat -ano
  // 返回该 PID 监听的端口列表
}

// 执行前
const beforePorts = getListeningPorts(process.pid);

// 执行程序
await executeProgram();

// 执行后
const afterPorts = getListeningPorts(process.pid);
if (afterPorts.length > beforePorts.length) {
  // 终止程序并报错
}
```

**残余风险**：
- 极短时间内完成监听并关闭
- 使用原始 socket 绕过高层检测

---

### 风险接受准则

| 等级 | 准则 |
|------|------|
| ✅ 可接受 | 残余风险为低，可直接实施 |
| ⚠️ 需控制措施 | 残余风险为中，需实施缓解措施后接受 |
| 🔴 不可接受 | 残余风险为高，需重新设计或放弃 |

**当前评估**：大部分风险在实施缓解措施后为 ⚠️ 中等

**建议**：
1. 先在受限环境（如 Docker 容器）中实施
2. 逐步放开功能，初期只允许白名单程序
3. 完善监控和审计日志

---

## 相关文档

- [Task 工作空间管理](../2026-03-02-task-workspace/README.md) - 进行中（依赖）
- [skill-runner.js](../../../lib/skill-runner.js) - 现有执行框架
- [沙箱架构实现](../../../archive/todo-archive-2026-03.md) - 已完成的沙箱基础
