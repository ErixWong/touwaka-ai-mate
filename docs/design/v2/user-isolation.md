# 用户隔离架构设计 (V2)

> 创建时间：2026-02-27
> 最后更新：2026-02-28
> 状态：设计完善中

---

## 1. 背景与目标

### 当前问题

所有用户在同一进程中运行，存在安全风险：
- 普通用户可能通过 `execute` 工具读取 `.env` 文件
- 用户 A 理论上可以访问用户 B 的文件
- 敏感配置（数据库连接、API Key）对所有用户可见

### 目标

实现用户级别的隔离，确保：
1. 普通用户无法访问敏感配置（`.env`、数据库连接）
2. 用户之间互相隔离，无法访问对方文件
3. 技能工具在受限环境中执行
4. 技能权限根据角色动态分配

---

## 2. 权限模型

### 2.1 四层权限架构

```
技能(Skill) → 专家(Expert) → 角色(Role) → 用户(User)
    ↓              ↓            ↓           ↓
  能做什么      能做什么组合    能看什么     是谁
```

### 2.2 角色权限矩阵

| 角色 | 技能范围 | 目录范围 |
|------|----------|----------|
| **admin** | 全部技能（含管理技能） | `/`（完整访问） |
| **power_user** | 业务技能 + 技能编辑 | `/skills`（读写）+ `/work/{userId}`（读写） |
| **user** | 业务技能 | `/skills`（只读）+ `/work/{userId}`（读写） |

### 2.3 技能元数据扩展

```javascript
// skills/meta.js
{
  "exec": {
    "builtin": true,
    "risk_level": "high",
    "required_role": "user", // 最低角色要求
  },
  "list_skill": {
    "builtin": true,
    "risk_level": "low",
    "required_role": "user",
  },
  "skill-edit": {
    "builtin": false,
    "risk_level": "high",
    "required_role": "power_user",
  },
  "database-access": {
    "builtin": false,
    "risk_level": "critical",
    "required_role": "admin",
  }
}
```

### 2.4 用户 Scope 维度

用户的实际权限由两个维度决定：

1. **技能维度**：能使用哪些技能（由角色 → 专家 → 技能链决定）
2. **目录维度**：能访问哪些文件（由角色的目录权限决定）

---

## 3. 跨平台沙箱方案

### 3.1 方案选型

| 平台 | 沙箱方案 | 适用场景 |
|------|----------|----------|
| Windows | Sandboxie Plus | 开发 + 生产 |
| Linux | Firejail | 开发 + 生产 |
| 通用（高安全） | Docker | 生产环境 |

### 3.2 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Core Service                              │
│  - 管理 LLM 配置、专家、技能                                  │
│  - 提供 API Gateway                                          │
│  - 持有敏感配置（.env）                                       │
│  - 用户认证与授权                                            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              SandboxExecutor (统一接口)                 │ │
│  │                                                          │ │
│  │   ┌─────────────────┐      ┌─────────────────┐         │ │
│  │   │ SandboxieExecutor│      │ FirejailExecutor │         │ │
│  │   │   (Windows)     │      │   (Linux)       │         │ │
│  │   └─────────────────┘      └─────────────────┘         │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                   Core API (HTTP/SSE)
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
    ┌───────────┐     ┌───────────┐     ┌───────────┐
    │User Runtime│    │User Runtime│    │User Runtime│
    │  (user_1) │     │  (user_2) │     │  (user_3) │
    │           │     │           │     │           │
    │ - 无敏感配置│    │ - 无敏感配置│    │ - 无敏感配置│
    │ - 受限目录  │    │ - 受限目录  │    │ - 受限目录  │
    │ - 沙箱隔离  │    │ - 沙箱隔离  │    │ - 沙箱隔离  │
    └───────────┘     └───────────┘     └───────────┘
```

---

## 4. Windows 方案：Sandboxie Plus

### 4.1 架构图

```
┌─────────────────────────────────────────┐
│           Windows 宿主机                 │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │    Sandboxie Sandbox             │    │
│  │                                  │    │
│  │   ┌─────────────────────────┐   │    │
│  │   │  Node.js Worker Process  │   │    │
│  │   │                          │   │    │
│  │   │  可访问：                 │   │    │
│  │   │  ✅ C:\work\user_123     │   │    │
│  │   │  ✅ C:\skills (只读)     │   │    │
│  │   │                          │   │    │
│  │   │  不可访问：               │   │    │
│  │   │  ❌ .env                 │   │    │
│  │   │  ❌ C:\work\user_456     │   │    │
│  │   │  ❌ 注册表敏感键         │   │    │
│  │   └─────────────────────────┘   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### 4.2 Sandboxie 配置模板

```ini
; config/sandboxie/user-sandbox.ini
[Template_UserRuntime]
# 普通用户沙箱配置

# 用户工作目录（读写）
OpenFilePath=C:\touwaka-mate\data\work\%USER_ID%\

# 技能目录（只读）
ReadFilePath=C:\touwaka-mate\skills\

# 禁止访问敏感文件
ClosedFilePath=C:\touwaka-mate\.env
ClosedFilePath=C:\touwaka-mate\*.key
ClosedFilePath=C:\touwaka-mate\*.pem

# 禁止访问其他用户目录
ClosedFilePath=C:\touwaka-mate\data\work\*

# 网络访问
AllowNetworkAccess=y

# 注册表隔离
OpenKeyPath=HKCU\Software\TouwakaMate\%USER_ID%
```

```ini
; config/sandboxie/power-user-sandbox.ini
[Template_PowerUserRuntime]
# Power User 沙箱配置

# 技能目录（读写）
OpenFilePath=C:\touwaka-mate\skills\

# 用户工作目录（读写）
OpenFilePath=C:\touwaka-mate\data\work\%USER_ID%\

# 禁止访问敏感文件
ClosedFilePath=C:\touwaka-mate\.env
ClosedFilePath=C:\touwaka-mate\*.key

# 网络访问
AllowNetworkAccess=y
```

```ini
; config/sandboxie/admin-sandbox.ini
[Template_AdminRuntime]
# 管理员沙箱配置（权限最宽）

# 完整访问项目目录
OpenFilePath=C:\touwaka-mate\

# 注册表访问
OpenKeyPath=HKLM\Software\TouwakaMate\

# 网络访问
AllowNetworkAccess=y
```

### 4.3 Sandboxie 执行器实现

```javascript
// lib/sandboxie-executor.js
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

class SandboxieExecutor {
  constructor() {
    // Sandboxie Plus 安装路径
    this.startExe = 'C:\\Program Files\\Sandboxie-Plus\\Start.exe';
    this.sbieCtrl = 'C:\\Program Files\\Sandboxie-Plus\\SbieCtrl.exe';
    this.configDir = path.join(process.cwd(), 'config', 'sandboxie');
  }

  /**
   * 获取角色对应的配置模板名称
   */
  getTemplateName(role) {
    const templates = {
      'admin': 'AdminRuntime',
      'power_user': 'PowerUserRuntime',
      'user': 'UserRuntime',
    };
    return templates[role] || 'UserRuntime';
  }

  /**
   * 在沙箱中执行命令
   */
  async execute(userId, role, command, options = {}) {
    const sandboxName = `user_${userId}`;
    const template = this.getTemplateName(role);
    
    // 确保 Sandboxie 配置已加载
    await this.ensureSandboxConfig(sandboxName, template, userId);

    // 构建 Sandboxie 命令
    const args = [
      `/box:${sandboxName}`,
      `/nosbiectrl`,  // 不显示 UI
      `cmd.exe`, '/c', command
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(this.startExe, args, {
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          USER_ID: userId,
          WORK_DIR: path.resolve('data', 'work', userId),
        },
        timeout: options.timeout || 30000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => stdout += data);
      child.stderr.on('data', (data) => stderr += data);

      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      child.on('error', reject);
    });
  }

  /**
   * 确保沙箱配置存在
   */
  async ensureSandboxConfig(sandboxName, template, userId) {
    const configPath = path.join(this.configDir, `${template.toLowerCase()}.ini`);
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`Sandboxie config not found: ${configPath}`);
    }

    // 使用 Sandboxie IniEdit 命令加载配置
    // 实际实现中需要调用 Sandboxie API 或修改全局配置
  }

  /**
   * 创建用户沙箱
   */
  async createSandbox(userId, role) {
    const sandboxName = `user_${userId}`;
    const template = this.getTemplateName(role);
    
    // Sandboxie 会自动创建沙箱，这里主要是确保配置正确
    console.log(`[Sandboxie] Creating sandbox: ${sandboxName} with template: ${template}`);
    
    return { sandboxName, template };
  }

  /**
   * 删除用户沙箱及其内容
   */
  async deleteSandbox(userId) {
    const sandboxName = `user_${userId}`;
    
    return new Promise((resolve, reject) => {
      exec(`"${this.sbieCtrl}" /delete_sandbox:${sandboxName}`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ sandboxName, deleted: true });
        }
      });
    });
  }

  /**
   * 检查沙箱是否存在且运行中
   */
  async isSandboxRunning(userId) {
    const sandboxName = `user_${userId}`;
    
    return new Promise((resolve) => {
      exec(`"${this.startExe}" /box:${sandboxName} echo check`, (error, stdout, stderr) => {
        resolve(!error && stdout.includes('check'));
      });
    });
  }
}

export default SandboxieExecutor;
```

---

## 5. Linux 方案：Firejail

### 5.1 架构图

```
┌─────────────────────────────────────────┐
│           Linux 宿主机                   │
│                                          │
│  ┌─────────────────────────────────┐    │
│  │    Firejail Sandbox              │    │
│  │                                  │    │
│  │   ┌─────────────────────────┐   │    │
│  │   │  Node.js Worker Process  │   │    │
│  │   │                          │   │    │
│  │   │  可访问：                 │   │    │
│  │   │  ✅ /work/user_123       │   │    │
│  │   │  ✅ /skills (只读)       │   │    │
│  │   │                          │   │    │
│  │   │  不可访问：               │   │    │
│  │   │  ❌ .env                 │   │    │
│  │   │  ❌ /work/user_456       │   │    │
│  │   │  ❌ /etc/shadow          │   │    │
│  │   └─────────────────────────┘   │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### 5.2 Firejail 配置模板

```bash
# config/firejail/user.profile
# 普通用户沙箱配置

# 私有模式：隔离文件系统
private /data/work

# 用户工作目录（读写）
whitelist /data/work/${USER_ID}

# 技能目录（只读）
read-only /skills

# 禁止访问敏感文件
blacklist /.env
blacklist /*.key
blacklist /*.pem

# 网络访问
netfilter

# 资源限制
rlimit-as 512M
rlimit-nproc 50
```

```bash
# config/firejail/power-user.profile
# Power User 沙箱配置

# 技能目录（读写）
whitelist /skills

# 用户工作目录（读写）
whitelist /data/work/${USER_ID}

# 禁止访问敏感文件
blacklist /.env
blacklist /*.key

# 网络访问
netfilter

# 资源限制
rlimit-as 1G
rlimit-nproc 100
```

```bash
# config/firejail/admin.profile
# 管理员沙箱配置

# 完整访问
private /

# 网络访问
netfilter
```

### 5.3 Firejail 执行器实现

```javascript
// lib/firejail-executor.js
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

class FirejailExecutor {
  constructor() {
    this.firejailPath = '/usr/bin/firejail';
    this.configDir = path.join(process.cwd(), 'config', 'firejail');
  }

  /**
   * 获取角色对应的配置文件名
   */
  getProfileName(role) {
    const profiles = {
      'admin': 'admin.profile',
      'power_user': 'power-user.profile',
      'user': 'user.profile',
    };
    return profiles[role] || 'user.profile';
  }

  /**
   * 在沙箱中执行命令
   */
  async execute(userId, role, command, options = {}) {
    const profileName = this.getProfileName(role);
    const profilePath = path.join(this.configDir, profileName);
    
    if (!fs.existsSync(profilePath)) {
      throw new Error(`Firejail profile not found: ${profilePath}`);
    }

    // 构建 Firejail 命令
    const args = [
      `--profile=${profilePath}`,
      `--env=USER_ID=${userId}`,
      `--env=WORK_DIR=/data/work/${userId}`,
      '--noprofile', // 不使用用户默认配置
      '--quiet',
      'sh', '-c', command
    ];

    return new Promise((resolve, reject) => {
      const child = spawn(this.firejailPath, args, {
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          USER_ID: userId,
        },
        timeout: options.timeout || 30000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => stdout += data);
      child.stderr.on('data', (data) => stderr += data);

      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      child.on('error', reject);
    });
  }

  /**
   * 检查 Firejail 是否可用
   */
  async isAvailable() {
    return new Promise((resolve) => {
      exec('which firejail', (error) => {
        resolve(!error);
      });
    });
  }
}

export default FirejailExecutor;
```

---

## 6. 统一沙箱执行器

### 6.1 跨平台适配器

```javascript
// lib/sandbox-executor.js
import SandboxieExecutor from './sandboxie-executor.js';
import FirejailExecutor from './firejail-executor.js';

class SandboxExecutor {
  constructor() {
    this.platform = process.platform;
    this.executor = null;
    
    if (this.platform === 'win32') {
      this.executor = new SandboxieExecutor();
    } else if (this.platform === 'linux') {
      this.executor = new FirejailExecutor();
    } else {
      console.warn(`[SandboxExecutor] Unsupported platform: ${this.platform}, using process isolation only`);
    }
  }

  /**
   * 在沙箱中执行命令
   * @param {string} userId - 用户ID
   * @param {string} role - 用户角色 (admin/power_user/user)
   * @param {string} command - 要执行的命令
   * @param {object} options - 执行选项
   */
  async execute(userId, role, command, options = {}) {
    if (this.executor) {
      // 使用平台对应的沙箱
      return this.executor.execute(userId, role, command, options);
    } else {
      // 降级为进程隔离
      return this.executeInProcess(userId, role, command, options);
    }
  }

  /**
   * 进程隔离降级方案
   */
  async executeInProcess(userId, role, command, options = {}) {
    const { spawn } = require('child_process');
    const workDir = path.resolve('data', 'work', userId);

    return new Promise((resolve, reject) => {
      const child = spawn(command, [], {
        shell: true,
        cwd: options.cwd || workDir,
        env: {
          PATH: process.env.PATH,
          USER_ID: userId,
          HOME: workDir,
        },
        timeout: options.timeout || 30000,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => stdout += data);
      child.stderr.on('data', (data) => stderr += data);

      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });

      child.on('error', reject);
    });
  }

  /**
   * 获取当前使用的沙箱类型
   */
  getSandboxType() {
    if (!this.executor) return 'process';
    return this.platform === 'win32' ? 'sandboxie' : 'firejail';
  }

  /**
   * 检查沙箱是否可用
   */
  async isAvailable() {
    if (!this.executor) return false;
    if (this.executor.isAvailable) {
      return this.executor.isAvailable();
    }
    return true;
  }
}

export default SandboxExecutor;
```

### 6.2 与 ChatService 集成

```javascript
// lib/chat-service.js (修改版)
import SandboxExecutor from './sandbox-executor.js';

class ChatService {
  constructor(config) {
    this.sandboxExecutor = new SandboxExecutor();
    // ... 其他初始化
  }

  async executeToolCall(userId, role, toolName, params) {
    // 1. 检查技能权限
    if (!this.hasSkillAccess(role, toolName)) {
      throw new Error(`Skill "${toolName}" not available for role "${role}"`);
    }

    // 2. 如果是 exec 技能，在沙箱中执行
    if (toolName === 'exec') {
      return this.sandboxExecutor.execute(userId, role, params.command, {
        timeout: params.timeout,
        cwd: params.cwd,
      });
    }

    // 3. 其他技能正常执行
    return this.executeSkill(toolName, params);
  }

  hasSkillAccess(role, skillName) {
    const skillMeta = SKILL_META[skillName];
    if (!skillMeta) return false;
    
    const roleLevel = { 'user': 1, 'power_user': 2, 'admin': 3 };
    const requiredLevel = roleLevel[skillMeta.required_role];
    const currentLevel = roleLevel[role];
    
    return currentLevel >= requiredLevel;
  }
}
```

---

## 7. 实施计划

### Phase 1：基础设施（2-3 天）

| 步骤 | 任务 | 预计时间 | 状态 |
|------|------|----------|------|
| 1.1 | 创建 SandboxExecutor 统一接口 | 2h | ⏳ |
| 1.2 | 实现 SandboxieExecutor (Windows) | 4h | ⏳ |
| 1.3 | 实现 FirejailExecutor (Linux) | 4h | ⏳ |
| 1.4 | 创建角色配置模板文件 | 2h | ⏳ |
| 1.5 | 单元测试 | 4h | ⏳ |

### Phase 2：权限集成（2-3 天）

| 步骤 | 任务 | 预计时间 | 状态 |
|------|------|----------|------|
| 2.1 | 扩展技能元数据结构 | 2h | ⏳ |
| 2.2 | 实现 list_skill 角色过滤 | 4h | ⏳ |
| 2.3 | 集成到 ChatService | 4h | ⏳ |
| 2.4 | 集成测试 | 4h | ⏳ |

### Phase 3：完善体验（1-2 天）

| 步骤 | 任务 | 预计时间 | 状态 |
|------|------|----------|------|
| 3.1 | 错误提示优化 | 2h | ⏳ |
| 3.2 | 日志和监控 | 2h | ⏳ |
| 3.3 | 文档完善 | 2h | ⏳ |

---

## 8. 相关文档

- [内置技能精简方案](../core/tasks/builtin-skill-simplify.md)（待创建）
- [技能对话式导入](../core/tasks/skill-import-dialog.md)

---

## 9. 变更记录

| 日期 | 变更内容 |
|------|----------|
| 2026-02-28 | 添加 Sandboxie 方案（Windows）、Firejail 方案（Linux）、角色权限矩阵、统一沙箱执行器 |
| 2026-02-27 | 初始版本：进程隔离 + Docker 方案 |