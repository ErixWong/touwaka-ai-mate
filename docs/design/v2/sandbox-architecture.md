# 沙箱架构设计

> 创建时间：2026-03-01
> 状态：设计中

---

## 1. 核心概念

### 1.1 两层角色模型

权限由两层角色叠加决定：

```
┌─────────────────────────────────────────────────────────────┐
│ 第一层：用户角色 (User Role)                                  │
│                                                              │
│ 决定：全局权限上限                                            │
│ ├── 目录上限: /work/{user_id}/                              │
│ ├── 技能上限: max_skill_level                               │
│ └── 敏感文件: 始终不可见 (.env, *.key)                       │
│                                                              │
│ 取值: guest(1), user(2), power_user(3), admin(4)            │
└─────────────────────────────────────────────────────────────┘
                            ↓ 继承并收窄
┌─────────────────────────────────────────────────────────────┐
│ 第二层：专家角色 (Expert Role)                                │
│                                                              │
│ 决定：在用户权限内的细分                                      │
│ ├── 目录细分: 只能访问特定 Task 的特定 Phase 目录             │
│ ├── 读写控制: 指定哪些只读、哪些读写                          │
│ └── 技能选择: 从用户可用池中选择                              │
│                                                              │
│ 取值: dialog, analyst, worker, reviewer, orchestrator       │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 专家分类

| 类型 | 可见性 | 触发方式 | 沙箱类型 | 示例 |
|------|--------|----------|----------|------|
| **用户可见专家** | 用户可选择 | 用户发送消息 | dialog 沙箱 | 开发助手、翻译专家 |
| **内部专家** | 用户不可见 | 主循环调度 | task-phase 沙箱 | Analyst, Worker, Reviewer |
| **系统专家** | 仅管理员 | 系统管理 | admin 沙箱 | Skills Studio |

### 1.3 沙箱隔离原则

1. **同级隔离**：每个沙箱独立，不嵌套
2. **权限收窄**：内部专家沙箱权限 ⊆ 用户权限
3. **按需创建**：首次需要时创建，不预分配
4. **闲置回收**：超过阈值自动销毁

---

## 2. 架构总览

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Core Service                            │
│  ├── API Gateway                                             │
│  ├── TaskOrchestrator (主循环调度器)                         │
│  └── SandboxPool (沙箱池管理器)                              │
└─────────────────────────────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ 用户对话沙箱     │    │ Task Worker 沙箱 │    │ Task Reviewer   │
│ user_1_dialog   │    │ user_1_T001_wrk  │    │ user_1_T001_rev │
│                 │    │                 │    │                 │
│ /work/user_1/   │    │ /work/user_1/   │    │ /work/user_1/   │
│   读写          │    │   T001/02-proc/ │    │   T001/03-rev/  │
│ /skills 只读    │    │     读写        │    │     读写        │
│ .env 不可见     │    │   T001/01-ana/  │    │   T001/ 只读    │
│                 │    │     只读        │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                    │                    │
         │                    │                    │
    用户直接对话          主循环调度启动         主循环调度启动
```

### 2.2 沙箱类型

| 沙箱类型 | 命名规则 | 生命周期 | 用途 |
|----------|----------|----------|------|
| **dialog** | `{user_id}_dialog` | 用户会话期间 | 用户与专家对话 |
| **task-phase** | `{user_id}_{task_id}_{phase}` | Task 阶段执行期间 | 内部专家执行任务 |
| **admin** | `admin_{purpose}` | 管理操作期间 | 系统管理 |

---

## 3. SandboxPool 设计

### 3.1 沙箱状态机

```
     ┌──────────┐
     │  IDLE    │ (不存在)
     └────┬─────┘
          │ acquire()
          ▼
     ┌──────────┐
     │ CREATING │
     └────┬─────┘
          │ created
          ▼
     ┌──────────┐     release()     ┌──────────┐
     │  ACTIVE  │──────────────────▶│  IDLE    │
     └────┬─────┘                    └────┬─────┘
          │                               │
          │ acquire()                     │ timeout
          │ (复用)                        │
          └──────────────┐                ▼
                         │          ┌──────────┐
                         ▼          │DESTROYED │
                    ┌──────────┐    └──────────┘
                    │  ACTIVE  │
                    └──────────┘
```

### 3.2 核心接口

```javascript
class SandboxPool {
  constructor(options = {}) {
    this.maxIdleTime = options.maxIdleTime || 5 * 60 * 1000;  // 5分钟
    this.maxPerUser = options.maxPerUser || 10;
    this.sandboxes = new Map();  // sandboxId -> SandboxInfo
    this.userPools = new Map();  // userId -> Set<sandboxId>
  }

  /**
   * 获取沙箱（不存在则创建，闲置则复用）
   */
  async acquire(userId, expertRole, taskId = null, options = {}) {
    const sandboxId = this.generateId(userId, expertRole, taskId);
    
    // 检查是否已存在
    const existing = this.sandboxes.get(sandboxId);
    if (existing && existing.status !== 'destroyed') {
      if (existing.status === 'idle') {
        // 复用闲置沙箱
        existing.status = 'active';
        existing.lastUsedAt = Date.now();
        existing.idleSince = null;
        return existing;
      }
      if (existing.status === 'active') {
        // 已活跃，直接返回
        return existing;
      }
    }
    
    // 检查用户沙箱数量限制
    const userPool = this.userPools.get(userId) || new Set();
    const activeCount = [...userPool].filter(id => 
      this.sandboxes.get(id)?.status === 'active'
    ).length;
    
    if (activeCount >= this.maxPerUser) {
      // 尝试回收闲置沙箱
      await this.reclaimIdleForUser(userId);
      
      // 再次检查
      if (userPool.size >= this.maxPerUser) {
        throw new Error(`User ${userId} reached max sandbox limit: ${this.maxPerUser}`);
      }
    }
    
    // 创建新沙箱
    return this.createSandbox(userId, expertRole, taskId, options);
  }

  /**
   * 释放沙箱（标记为闲置，等待回收或复用）
   */
  async release(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    
    sandbox.status = 'idle';
    sandbox.idleSince = Date.now();
  }

  /**
   * 销毁沙箱
   */
  async destroy(sandboxId) {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) return;
    
    sandbox.status = 'destroying';
    
    // 调用平台执行器销毁
    await this.executor.destroy(sandbox.sandboxName);
    
    // 从注册表移除
    this.sandboxes.delete(sandboxId);
    
    const userPool = this.userPools.get(sandbox.userId);
    if (userPool) {
      userPool.delete(sandboxId);
    }
  }

  /**
   * 定期回收闲置沙箱
   */
  async reclaimIdle() {
    const now = Date.now();
    
    for (const [sandboxId, sandbox] of this.sandboxes) {
      if (sandbox.status === 'idle' && 
          sandbox.idleSince && 
          now - sandbox.idleSince > this.maxIdleTime) {
        await this.destroy(sandboxId);
      }
    }
  }

  /**
   * 生成沙箱ID
   */
  generateId(userId, expertRole, taskId) {
    if (taskId) {
      return `${userId}_${taskId}_${expertRole}`;
    }
    return `${userId}_${expertRole}`;
  }

  /**
   * 创建新沙箱
   */
  async createSandbox(userId, expertRole, taskId, options) {
    const sandboxId = this.generateId(userId, expertRole, taskId);
    const sandboxName = `sb_${sandboxId}`;
    
    // 获取用户角色
    const userRole = await this.getUserRole(userId);
    
    // 计算沙箱权限配置
    const config = this.buildSandboxConfig(userId, userRole, expertRole, taskId);
    
    // 创建沙箱
    sandbox.status = 'creating';
    await this.executor.create(sandboxName, config);
    
    const sandbox = {
      id: sandboxId,
      sandboxName,
      userId,
      taskId,
      expertRole,
      status: 'active',
      config,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      idleSince: null,
    };
    
    this.sandboxes.set(sandboxId, sandbox);
    
    const userPool = this.userPools.get(userId) || new Set();
    userPool.add(sandboxId);
    this.userPools.set(userId, userPool);
    
    return sandbox;
  }

  /**
   * 构建沙箱配置（用户权限 ∩ 专家权限）
   */
  buildSandboxConfig(userId, userRole, expertRole, taskId) {
    // 1. 获取用户角色基础配置
    const userConfig = this.getUserRoleConfig(userRole);
    
    // 2. 获取专家角色配置
    const expertConfig = this.getExpertRoleConfig(expertRole);
    
    // 3. 计算交集
    return {
      readonlyDirs: this.resolvePatterns(expertConfig.readonlyPatterns, userId, taskId),
      readwriteDirs: this.resolvePatterns(expertConfig.readwritePatterns, userId, taskId),
      blacklist: userConfig.blacklist,  // 继承用户级别的黑名单
      maxMemory: Math.min(expertConfig.maxMemory, userConfig.maxMemory),
      maxProcesses: Math.min(expertConfig.maxProcesses, userConfig.maxProcesses),
      timeout: expertConfig.timeout,
    };
  }
}
```

### 3.3 权限配置计算

```javascript
// 用户角色配置
const USER_ROLE_CONFIGS = {
  guest: {
    maxSkillLevel: 1,
    maxMemory: 256,
    maxProcesses: 20,
    blacklist: ['.env', '*.key', '*.pem'],
    maxSandboxes: 3,
  },
  user: {
    maxSkillLevel: 2,
    maxMemory: 512,
    maxProcesses: 50,
    blacklist: ['.env', '*.key', '*.pem'],
    maxSandboxes: 5,
  },
  power_user: {
    maxSkillLevel: 3,
    maxMemory: 1024,
    maxProcesses: 100,
    blacklist: ['.env'],
    maxSandboxes: 10,
  },
  admin: {
    maxSkillLevel: 4,
    maxMemory: 2048,
    maxProcesses: 200,
    blacklist: [],
    maxSandboxes: 20,
  },
};

// 专家角色配置
const EXPERT_ROLE_CONFIGS = {
  dialog: {
    visibility: 'user',
    readonlyPatterns: ['/skills'],
    readwritePatterns: ['/work/{userId}/'],
    maxMemory: 512,
    maxProcesses: 50,
    timeout: 60,
  },
  analyst: {
    visibility: 'internal',
    readonlyPatterns: [
      '/skills',
      '/work/{userId}/{taskId}/00-requirements/',
    ],
    readwritePatterns: [
      '/work/{userId}/{taskId}/01-analysis/',
    ],
    maxMemory: 256,
    maxProcesses: 30,
    timeout: 30,
  },
  worker: {
    visibility: 'internal',
    readonlyPatterns: [
      '/skills',
      '/work/{userId}/{taskId}/00-requirements/',
      '/work/{userId}/{taskId}/01-analysis/',
    ],
    readwritePatterns: [
      '/work/{userId}/{taskId}/02-process/',
    ],
    maxMemory: 512,
    maxProcesses: 50,
    timeout: 60,
  },
  reviewer: {
    visibility: 'internal',
    readonlyPatterns: [
      '/skills',
      '/work/{userId}/{taskId}/',
    ],
    readwritePatterns: [
      '/work/{userId}/{taskId}/03-review/',
    ],
    maxMemory: 256,
    maxProcesses: 20,
    timeout: 30,
  },
};
```

---

## 4. 平台实现

### 4.0 本地开发环境（轻量级沙箱）

本地开发环境使用轻量级沙箱方案，生产环境使用 OpenSandbox 提供更强大的隔离支持。两套方案并行，默认使用本地方案。

| 环境 | Node.js 沙箱 | Python 沙箱 |
|------|-------------|-------------|
| 本地开发 | vm 模块 | subprocess + chdir + 危险函数黑名单 |
| 服务端部署 | OpenSandbox | OpenSandbox |

#### 4.0.1 Node.js 本地沙箱

使用 Node.js 内置的 `vm` 模块实现隔离：

```javascript
// 使用 vm.createContext 创建隔离上下文
vm.createContext(context);

// 使用 vm.runInContext 执行代码，设置超时
vm.runInContext(code, context, {
  timeout: 10000, // 10秒超时
  displayErrors: true,
});
```

**安全措施**：
- 模块白名单：只允许加载特定模块
- 禁止相对路径引用
- 提供受限的 process 对象（只暴露 env 和 cwd）
- 禁止访问 global, __dirname, __filename

#### 4.0.2 Python 本地沙箱

使用 subprocess 隔离进程，通过 Python 包装器禁止危险函数：

```javascript
// 使用 spawn 执行 Python
const pythonProcess = spawn('python', ['-c', sandboxWrapper], {
  cwd: skillPath,  // chdir 到技能目录
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

**Python 危险函数黑名单**：
- `os.system`, `os.spawn*`, `os.exec*`, `os.popen`
- `subprocess.*`（禁止导入）
- `eval()`, `exec()`

**实现方式**：
```python
# 通过限制 __builtins__ 来禁止危险函数
_BLACKLIST = {
    'system', 'spawn', 'spawnl', 'spawnle', 'spawnlp', 'spawnlpe', 
    'spawnv', 'spawnve', 'spawnvp', 'spawnvpe',
    'exec', 'execl', 'execle', 'execlp', 'execlpe',
    'execv', 'execve', 'execvp', 'execvpe',
    'popen', 'fdopen',
}

# 限制 os 模块的危险函数
class _RestrictedOS:
    def __getattr__(self, name):
        if name in _BLACKLIST:
            raise PermissionError(f"Function os.{name} is not allowed in sandbox")
        return getattr(_original_os, name)

# 禁止导入 subprocess 模块
def _restricted_import(name, *args, **kwargs):
    if name == 'subprocess' or name.startswith('subprocess.'):
        raise PermissionError("Import subprocess is not allowed in sandbox")
    return _original_import(name, *args, **kwargs)
```

**超时控制**：默认 30 秒超时

#### 4.0.3 入口文件检测

skill-runner 自动检测技能入口文件类型：

| 入口文件 | 执行器 | 语言 |
|----------|--------|------|
| `index.js` | Node.js vm | JavaScript |
| `index.py` | Python subprocess | Python |

检测优先级：`index.js` > `index.py`

### 4.1 Firejail 实现

```javascript
class FirejailExecutor {
  async create(sandboxName, config) {
    // Firejail 不需要显式创建沙箱
    // 只需要记录配置，执行时使用
    return { sandboxName, created: true };
  }

  async execute(sandboxName, command, options = {}) {
    const args = [
      `--name=${sandboxName}`,
      '--quiet',
    ];

    // 添加只读目录
    for (const dir of config.readonlyDirs) {
      args.push(`--read-only=${dir}`);
    }

    // 添加读写目录
    for (const dir of config.readwriteDirs) {
      args.push(`--whitelist=${dir}`);
    }

    // 添加黑名单
    for (const item of config.blacklist) {
      args.push(`--blacklist=${item}`);
    }

    // 资源限制
    args.push(`--rlimit-as=${config.maxMemory}M`);
    args.push(`--rlimit-nproc=${config.maxProcesses}`);

    args.push('--', 'sh', '-c', command);

    return this.spawn(args, options);
  }

  async join(sandboxName, command, options = {}) {
    // 加入已存在的沙箱执行命令
    const args = [
      `--join=${sandboxName}`,
      '--quiet',
      '--', 'sh', '-c', command,
    ];
    return this.spawn(args, options);
  }

  async destroy(sandboxName) {
    // 终止沙箱内所有进程
    await exec(`firejail --shutdown=${sandboxName}`);
  }
}
```

### 4.2 Sandboxie 实现

```javascript
class SandboxieExecutor {
  async create(sandboxName, config) {
    // 创建 Sandboxie 配置节
    const iniContent = this.buildIniContent(sandboxName, config);
    await this.applyConfig(sandboxName, iniContent);
    return { sandboxName, created: true };
  }

  buildIniContent(sandboxName, config) {
    let content = `[${sandboxName}]\n`;
    
    // 读写目录
    for (const dir of config.readwriteDirs) {
      content += `OpenFilePath=${dir}\n`;
    }
    
    // 只读目录
    for (const dir of config.readonlyDirs) {
      content += `ReadFilePath=${dir}\n`;
    }
    
    // 黑名单
    for (const item of config.blacklist) {
      content += `ClosedFilePath=${item}\n`;
    }
    
    content += 'Enabled=y\n';
    
    return content;
  }

  async execute(sandboxName, command, options = {}) {
    const args = [
      `/box:${sandboxName}`,
      '/nosbiectrl',
      'cmd.exe', '/c', command,
    ];
    
    return this.spawn(this.startExe, args, options);
  }

  async destroy(sandboxName) {
    await exec(`"${this.sbieCtrl}" /delete_sandbox:${sandboxName}`);
  }
}
```

---

## 5. 与 ChatService 集成

### 5.1 用户对话流程

```javascript
class ChatService {
  async handleMessage(userId, expertId, message) {
    // 1. 获取或创建用户对话沙箱
    const sandbox = await sandboxPool.acquire(userId, 'dialog');
    
    // 2. 执行对话（LLM 调用不需要沙箱，只有工具调用需要）
    const response = await this.callLLM(expertId, message, {
      toolExecutor: async (toolName, params) => {
        // 在沙箱中执行工具
        return sandboxPool.executeInSandbox(sandbox.id, async () => {
          return this.executeTool(toolName, params, { userId, sandbox });
        });
      }
    });
    
    // 3. 对话结束后释放沙箱（标记闲置）
    // 注意：不立即销毁，等待复用或超时回收
    await sandboxPool.release(sandbox.id);
    
    return response;
  }
}
```

### 5.2 Task 执行流程

```javascript
class TaskOrchestrator {
  async runTaskPhase(taskId, phase) {
    const task = await this.getTask(taskId);
    const userId = task.created_by;
    
    // 根据阶段确定专家角色
    const expertRole = this.getExpertRoleForPhase(phase);
    
    // 获取沙箱
    const sandbox = await sandboxPool.acquire(userId, expertRole, taskId);
    
    // 创建执行记录
    const execution = await this.createExecution(sandbox.id, taskId, expertRole, phase);
    
    // 启动专家
    await this.startExpert(sandbox, execution);
    
    return execution;
  }

  async tick() {
    // 定期执行
    const activeExecutions = await this.getActiveExecutions();
    
    for (const exec of activeExecutions) {
      // 读取状态文件
      const status = await this.readStatusFile(exec.task_id);
      
      switch (status.state) {
        case 'waiting_input':
          await this.provideInput(exec, status.waiting_for);
          break;
        case 'completed':
          await this.advancePhase(exec.task_id);
          await sandboxPool.release(exec.sandbox_id);
          break;
        case 'blocked':
          await this.handleBlocked(exec, status.block_reason);
          break;
        case 'failed':
          await this.handleFailed(exec, status.error);
          await sandboxPool.release(exec.sandbox_id);
          break;
      }
    }
    
    // 回收闲置沙箱
    await sandboxPool.reclaimIdle();
  }
}
```

---

## 6. 数据库设计

### 6.1 sandboxes 表

```sql
CREATE TABLE sandboxes (
    id VARCHAR(64) PRIMARY KEY COMMENT '沙箱ID',
    user_id VARCHAR(64) NOT NULL COMMENT '所属用户',
    task_id VARCHAR(100) COMMENT '关联的Task',
    expert_role VARCHAR(32) NOT NULL COMMENT '专家角色',
    
    status ENUM('creating', 'active', 'idle', 'destroying', 'destroyed') 
        DEFAULT 'creating',
    
    sandbox_type VARCHAR(20) NOT NULL COMMENT 'firejail/sandboxie/process',
    sandbox_name VARCHAR(100) COMMENT '平台沙箱名称',
    
    config_json TEXT COMMENT '权限配置JSON',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    idle_since TIMESTAMP NULL,
    
    INDEX idx_user (user_id),
    INDEX idx_task (task_id),
    INDEX idx_status (status)
) COMMENT '沙箱注册表';
```

### 6.2 expert_role_defs 表

```sql
CREATE TABLE expert_role_defs (
    id VARCHAR(32) PRIMARY KEY COMMENT 'dialog/analyst/worker/reviewer',
    name VARCHAR(100) NOT NULL,
    description TEXT,
    visibility ENUM('user', 'internal', 'admin') NOT NULL DEFAULT 'user',
    
    readonly_patterns TEXT COMMENT '只读目录模式JSON',
    readwrite_patterns TEXT COMMENT '读写目录模式JSON',
    
    max_memory_mb INT DEFAULT 512,
    max_processes INT DEFAULT 50,
    timeout_minutes INT DEFAULT 30,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) COMMENT '专家角色定义';

-- 初始数据
INSERT INTO expert_role_defs (id, name, visibility, readonly_patterns, readwrite_patterns) VALUES
('dialog', '对话专家', 'user', 
 '["/skills"]',
 '["/work/{userId}/"]'),
('analyst', '分析师', 'internal',
 '["/skills", "/work/{userId}/{taskId}/00-requirements/"]',
 '["/work/{userId}/{taskId}/01-analysis/"]'),
('worker', '执行者', 'internal',
 '["/skills", "/work/{userId}/{taskId}/00-requirements/", "/work/{userId}/{taskId}/01-analysis/"]',
 '["/work/{userId}/{taskId}/02-process/"]'),
('reviewer', '审核员', 'internal',
 '["/skills", "/work/{userId}/{taskId}/"]',
 '["/work/{userId}/{taskId}/03-review/"]');
```

---

## 7. 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-03-02 | 添加本地开发环境轻量级沙箱方案（Node.js vm + Python subprocess） |
| 2026-03-01 | 初始版本：两层角色模型、沙箱池管理、平台实现 |

---

## 8. 相关文档

- [专家编排设计](./expert-orchestration.md)
- [Task Layer 设计](./task-layer-design.md)
- [技能权限设计](./tool-permission-design.md)