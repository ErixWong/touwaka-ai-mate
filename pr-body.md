## 变更概述

为内置工具 `execute_javascript` 添加权限控制，仅 `admin` 和 `creator` 角色可执行脚本。

## 变更详情

### 1. 内置工具权限控制

**`lib/tool-manager.js`**:
- 为 `execute_javascript` 添加 `allowedRoles: ['admin', 'creator']` 配置
- 在 `executeBuiltinTool()` 方法中添加权限检查逻辑
- 新增 `getUserRole()` 方法用于提取用户角色

### 2. 技能清理与重构

- **删除 `data/skills/http-client/`**: 功能已合并到 `net-operations`
- **删除 `lib/skill-meta.js`**: 权限控制逻辑移至 `tool-manager.js`
- **重构 `net-operations` 工具命名**:
  - `dns_lookup` → `net_dns`
  - `ping` → `net_ping`
  - `port_check` → `net_port`
  - `http_request` → `net_request`

### 3. 沙箱模块白名单

**`lib/skill-runner.js`**:
- 添加 `dns`、`net` 内置模块到 `BUILTIN_MODULES` 白名单

## 权限设计

| 角色 | execute_javascript 权限 |
|------|------------------------|
| `admin` | ✅ 可执行 |
| `creator` | ✅ 可执行 |
| `user` | ❌ 权限拒绝 |

## 测试验证

- [x] `npm run lint` 通过
- [x] ES 模块导入验证通过
- [x] 代码审计通过

Closes #358