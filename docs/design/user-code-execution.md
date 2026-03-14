# 用户代码执行设计文档

## 背景

目前系统已有完善的技能执行架构，支持在 VM 沙箱中安全执行技能代码。本设计探讨如何复用该架构，支持执行用户目录下的自定义代码。

## 现有架构分析

### 核心组件

1. **[`skill-loader.js`](../../lib/skill-loader.js)** - 主进程中的技能加载器
   - 从数据库加载技能配置和工具定义
   - 构建最小化环境变量
   - 通过子进程隔离执行

2. **[`skill-runner.js`](../../lib/skill-runner.js)** - 子进程执行器
   - VM 沙箱执行 JavaScript
   - Python 子进程执行（带黑名单）
   - 模块白名单控制
   - 路径访问限制

### 安全机制

```
┌─────────────────────────────────────────────────────────────┐
│                      主进程 (Main Process)                    │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │  SkillLoader    │───▶│  spawn('node', skill-runner) │   │
│  │  - 加载配置      │    │  - 环境变量隔离               │   │
│  │  - 构建环境变量  │    │  - 超时控制                   │   │
│  └─────────────────┘    └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ stdin/stdout JSON
┌─────────────────────────────────────────────────────────────┐
│                    子进程 (Child Process)                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  VM 沙箱 (vm.runInContext)            │    │
│  │  ┌─────────────────────────────────────────────┐    │    │
│  │  │  技能代码                                     │    │    │
│  │  │  - 白名单模块访问                             │    │    │
│  │  │  - 受限的 fs（路径检查）                       │    │    │
│  │  │  - 无 global/__dirname/__filename            │    │    │
│  │  └─────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 路径访问控制

```javascript
// skill-runner.js 中的路径限制逻辑
const allowedPaths = isAdmin
  ? [projectRoot, dataBasePath]    // 管理员：项目根 + 数据目录
  : [dataBasePath];                 // 普通用户：仅数据目录
```

## 设计方案

### 方案一：创建"用户代码执行"虚拟技能

**思路**：将用户代码视为一种特殊的技能，复用现有执行管道。

**优点**：
- 完全复用现有安全机制
- 代码改动最小
- 天然支持资源限制

**实现步骤**：

1. 创建内置技能 `user-code-executor`：
```
data/skills/user-code-executor/
├── SKILL.md
└── index.js    # 执行器代码
```

2. 在 `skill-runner.js` 中扩展路径白名单：
```javascript
// 用户工作目录
const userWorkDir = process.env.WORKING_DIRECTORY 
  ? path.join(dataBasePath, process.env.WORKING_DIRECTORY)
  : null;

const allowedPaths = [
  ...existingPaths,
  userWorkDir,  // 添加用户工作目录
].filter(Boolean);
```

3. 执行器代码示例：
```javascript
// data/skills/user-code-executor/index.js
import vm from 'vm';

export function getTools() {
  return [{
    name: 'execute_javascript',
    description: '在沙箱中执行用户提供的 JavaScript 代码',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: '要执行的 JavaScript 代码' },
        script_path: { type: 'string', description: '用户脚本路径（相对于工作目录）' }
      }
    }
  }];
}

export async function execute(toolName, params, context) {
  if (toolName === 'execute_javascript') {
    // 选项1：执行内联代码
    if (params.code) {
      return await executeCode(params.code, context);
    }
    // 选项2：加载用户脚本文件
    if (params.script_path) {
      const fs = require('fs');
      const path = require('path');
      const scriptPath = path.join(process.cwd(), params.script_path);
      const code = fs.readFileSync(scriptPath, 'utf-8');
      return await executeCode(code, context);
    }
  }
}
```

### 方案二：扩展 SkillLoader 支持临时代码执行

**思路**：在 `SkillLoader` 中添加临时代码执行方法，不依赖数据库记录。

```javascript
// skill-loader.js 新增方法
async executeUserCode(code, context, options = {}) {
  const {
    language = 'javascript',  // javascript | python
    workingDirectory,
    timeout = 30000,
  } = options;

  // 构建临时环境
  const env = {
    ...this.buildBaseEnvironment(context),
    WORKING_DIRECTORY: workingDirectory,
    ALLOWED_PATHS: JSON.stringify([workingDirectory]),
  };

  // 复用子进程执行
  return this.executeInSubprocess('__user_code__', 'execute', { code }, context, env);
}
```

### 方案三：独立的 UserCodeExecutor 服务

**思路**：创建专门的用户代码执行服务，独立于技能系统。

```javascript
// lib/user-code-executor.js
import SkillRunner from './skill-runner.js';

export class UserCodeExecutor {
  constructor(options = {}) {
    this.maxTimeout = options.maxTimeout || 60000;
    this.memoryLimit = options.memoryLimit || 128; // MB
  }

  async executeJavaScript(code, context) {
    // 复用 skill-runner 的 VM 沙箱
    return SkillRunner.executeInSandbox(code, {
      timeout: this.maxTimeout,
      allowedPaths: [context.workingDirectory],
      allowedModules: ['fs', 'path', 'http', 'https', 'crypto'],
    });
  }

  async executePython(code, context) {
    // 复用 skill-runner 的 Python 执行器
    return SkillRunner.executePython(code, {
      timeout: this.maxTimeout,
      allowedPackages: context.allowedPackages || [],
    });
  }
}
```

## 推荐方案

**推荐方案一**，原因：

1. **最小改动**：复用现有 `skill-loader` 和 `skill-runner`，只需添加一个虚拟技能
2. **安全继承**：自动继承所有安全机制（白名单、路径限制、超时、内存限制）
3. **可观测性**：执行日志、监控与现有技能系统一致
4. **权限控制**：可通过专家-技能分配机制控制谁可以执行用户代码

## 详细实现设计

### 1. 用户代码执行技能结构

```
data/skills/user-code-executor/
├── SKILL.md              # 技能说明文档
├── index.js              # JavaScript 执行器
└── package.json          # 依赖声明
```

### 2. SKILL.md

```markdown
# User Code Executor

执行用户自定义代码的安全沙箱。

## 工具

### execute_javascript

在 VM 沙箱中执行 JavaScript 代码。

参数：
- `code` (string, optional): 要执行的 JavaScript 代码
- `script_path` (string, optional): 脚本文件路径（相对于用户工作目录）

### execute_python

在受限环境中执行 Python 代码。

参数：
- `code` (string, optional): 要执行的 Python 代码
- `script_path` (string, optional): 脚本文件路径（相对于用户工作目录）

## 安全限制

- 执行超时：30秒（JavaScript）/ 5分钟（Python）
- 内存限制：128MB
- 文件访问：仅限用户工作目录
- 模块访问：白名单控制
```

### 3. 环境变量扩展

```javascript
// skill-loader.js buildSkillEnvironment 中添加
const baseEnv = {
  // ...现有变量
  USER_WORK_DIR: userContext.workingDirectory || '',
  USER_CODE_ALLOWED: 'true',  // 标识允许执行用户代码
};
```

### 4. API 端点

```javascript
// 新增路由 POST /api/user-code/execute
router.post('/execute', async (ctx) => {
  const { code, script_path, language } = ctx.request.body;
  const userId = ctx.state.user.userId;
  
  // 获取用户工作目录
  const workingDir = path.join(DATA_BASE_PATH, 'work', userId);
  
  // 调用技能执行器
  const result = await skillLoader.executeSkillTool(
    'user-code-executor',
    `execute_${language}`,
    { code, script_path },
    { userId, workingDirectory: workingDir }
  );
  
  ctx.success(result);
});
```

## 安全考量

### 风险矩阵

| 风险 | 缓解措施 |
|------|----------|
| 恶意代码耗尽资源 | 超时控制 + 内存限制 |
| 访问敏感文件 | 路径白名单 + 受限 fs |
| 网络攻击 | 可选禁用 http/https 模块 |
| 代码注入 | VM 沙箱隔离，无 global 访问 |
| 权限提升 | 子进程以受限用户运行 |

### 额外安全建议

1. **审计日志**：记录所有用户代码执行请求
2. **速率限制**：限制每用户执行频率
3. **代码审查**：可选的代码静态分析
4. **沙箱强化**：考虑使用 Docker 容器隔离（生产环境）

## 后续工作

1. [ ] 实现 `user-code-executor` 技能
2. [ ] 添加 API 端点
3. [ ] 编写测试用例
4. [ ] 更新文档
5. [ ] 考虑 Docker 隔离方案（可选）

## 参考资料

- [`lib/skill-runner.js`](../../lib/skill-runner.js) - VM 沙箱实现
- [`lib/skill-loader.js`](../../lib/skill-loader.js) - 技能加载器
- [`tests/run-skill.js`](../../tests/run-skill.js) - 命令行测试工具
- [Node.js VM 模块文档](https://nodejs.org/api/vm.html)