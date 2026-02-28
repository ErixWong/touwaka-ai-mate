# 沙箱执行器使用指南

> 创建时间：2026-02-28
> 最后更新：2026-02-28
> 版本：1.0.0

---

## 概述

沙箱执行器是用户隔离架构的核心组件，提供跨平台的命令隔离执行能力。

### 支持的平台

| 平台 | 沙箱方案 | 安装要求 |
|------|----------|----------|
| Windows | Sandboxie Plus | [下载地址](https://github.com/sandboxie-plus/Sandboxie) |
| Linux | Firejail | `sudo apt install firejail` |

---

## 快速开始

### 基本用法

```javascript
import SandboxExecutor from './lib/sandbox-executor.js';

// 创建执行器实例
const sandbox = new SandboxExecutor();

// 在沙箱中执行命令
const result = await sandbox.execute(userId, userRole, 'npm test', {
  timeout: 30000,
  cwd: './project',
});

console.log(result);
// {
//   success: true,
//   code: 0,
//   stdout: '...',
//   stderr: '',
//   timedOut: false,
// }
```

### 用户角色

| 角色 | 权限范围 |
|------|----------|
| `user` | 只能访问自己的工作目录 |
| `power_user` | 可以编辑技能，访问技能目录 |
| `admin` | 完整访问权限 |

---

## API 参考

### SandboxExecutor

#### `new SandboxExecutor()`

创建沙箱执行器实例。自动检测当前平台并初始化对应的执行器。

**错误**：如果平台不支持，抛出 `UNSUPPORTED_PLATFORM` 错误。

#### `execute(userId, role, command, options)`

在沙箱中执行命令。

**参数**：
- `userId` (string): 用户ID
- `role` (string): 用户角色 (`user` | `power_user` | `admin`)
- `command` (string): 要执行的命令
- `options` (object):
  - `timeout` (number): 超时时间（毫秒），默认 30000
  - `cwd` (string): 工作目录

**返回值**：
```javascript
{
  success: boolean,   // 是否成功
  code: number,       // 退出码
  stdout: string,     // 标准输出
  stderr: string,     // 标准错误
  timedOut: boolean,  // 是否超时
}
```

#### `isAvailable()`

检查沙箱是否可用。

**返回值**：`Promise<boolean>`

#### `createSandbox(userId, role)`

创建用户沙箱。

#### `deleteSandbox(userId)`

删除用户沙箱。

---

## 权限控制

### 技能元数据

```javascript
import { SKILL_META, hasSkillAccess, validateSkillAccess } from './lib/skill-meta.js';

// 检查权限
const validation = validateSkillAccess('user', 'exec');
if (!validation.allowed) {
  console.error(validation.error);
}

// 获取可用技能
import { getAvailableSkills } from './lib/skill-meta.js';
const skills = getAvailableSkills('power_user');
```

### 内置技能权限

| 技能 | 风险等级 | 最低角色 |
|------|----------|----------|
| `exec` | high | user |
| `list_skills` | low | user |
| `read_lines` | low | user |
| `write_file` | medium | user |
| `skill-edit` | high | power_user |
| `skill-delete` | critical | admin |
| `database-access` | critical | admin |

---

## 错误处理

### 错误码

| 错误码 | 说明 |
|--------|------|
| `E001` | 平台不支持 |
| `E002` | 沙箱未安装 |
| `E003` | 沙箱配置缺失 |
| `E101` | 权限不足 |
| `E102` | 技能不可用 |
| `E103` | 角色权限不足 |
| `E201` | 命令执行超时 |
| `E202` | 命令执行失败 |
| `E203` | 危险命令被阻止 |

### 错误处理示例

```javascript
import { createSandboxError, ErrorCodes, formatErrorResponse } from './lib/sandbox-errors.js';

try {
  const result = await sandbox.execute(userId, role, command);
} catch (error) {
  const response = formatErrorResponse(error, true);
  console.error(response);
  // {
  //   success: false,
  //   error: '...',
  //   code: 'E002',
  //   title: '沙箱未安装',
  //   solution: '请安装 Sandboxie Plus...',
  // }
}
```

---

## 监控

### 获取执行统计

```javascript
import { getSandboxMonitor } from './lib/sandbox-monitor.js';

const monitor = getSandboxMonitor();

// 获取统计摘要
const stats = monitor.getStatsSummary();
console.log(stats);
// {
//   total: 100,
//   success: 95,
//   failure: 5,
//   successRate: '95.00%',
//   ...
// }

// 获取最近执行记录
const history = monitor.getRecentHistory(50);
```

### 日志位置

- 执行历史：`logs/sandbox/execution-history.jsonl`
- 统计数据：`logs/sandbox/stats.json`

---

## 配置

### Sandboxie (Windows)

配置文件位置：`C:\Users\<用户名>\AppData\Local\Sandboxie\Sandboxie.ini`

参考模板：`config/sandboxie/templates.ini`

### Firejail (Linux)

配置文件位置：`config/firejail/*.profile`

角色配置文件：
- `user.profile` - 普通用户
- `power-user.profile` - Power User
- `admin.profile` - 管理员

---

## 数据库迁移

执行角色等级迁移：

```bash
mysql -u root -p touwaka_mate < scripts/migrations/20260228-add-role-level.sql
```

回滚：

```bash
mysql -u root -p touwaka_mate < scripts/migrations/20260228-add-role-level.rollback.sql
```

---

## 故障排除

### 问题：沙箱不可用

**症状**：执行命令返回 `Sandbox not available` 错误

**解决方案**：
1. Windows: 确认 Sandboxie Plus 已安装并正在运行
2. Linux: 确认 Firejail 已安装 (`which firejail`)

### 问题：权限被拒绝

**症状**：执行命令返回 `Permission denied` 错误

**解决方案**：
1. 检查用户角色是否正确
2. 确认沙箱配置已正确设置
3. 查看日志了解具体原因

### 问题：命令超时

**症状**：命令执行被终止，返回 `timedOut: true`

**解决方案**：
1. 增加 `timeout` 参数值
2. 优化命令执行效率
3. 检查是否有死循环

---

## 安全最佳实践

1. **始终使用沙箱**：不要绕过沙箱直接执行命令
2. **最小权限原则**：给用户分配最小必要的角色
3. **定期审计**：检查执行日志和统计数据
4. **更新黑名单**：发现新的危险命令模式时及时更新

---

## 相关文档

- [用户隔离架构设计](./user-isolation.md)
- [技能元数据定义](../../lib/skill-meta.js)
- [安全审计报告](./code-review-2026-02-28.md)