# 驻留进程实现小程序自定义 API 设计

> Issue: #646
> 状态: 草稿（技术方案储备）

## 背景

在讨论 Issue #645（合同管理 App 元数据结构优化）过程中，发现扩展表架构有两种实现路径：

- **方案 A：原生 SQL** — 简单扩展表，直接在主进程中用原生 SQL 查询
- **方案 B：驻留进程** — 复杂业务逻辑，通过驻留进程实现自定义 API

本文档记录方案 B 的可行性边界和技术设计。

## 当前驻留进程通信机制

### 已有实现：ResidentSkillManager

系统已实现 `ResidentSkillManager`（lib/resident-skill-manager.js），用于管理驻留式技能工具：

| 组件 | 实现方式 |
|------|---------|
| **进程启动** | `spawn('node', [scriptPath])` |
| **通信协议** | **stdio JSON 协议**（stdin/stdout） |
| **消息格式** | `{ command, task_id, params, user } + '\n'` |
| **响应格式** | `{ type, task_id, result, error } + '\n'` |

**无需分配端口**，完全通过 stdin/stdout 通信。

## 驻留进程实现 API 设计

### manifest.json 扩展声明

```json
{
  "id": "contract-mgr",
  "resident_api": {
    "enabled": true,
    "script": "server/index.js",
    "commands": ["list", "detail", "create", "update", "delete", "distinct"],
    "timeout": 60000
  },
  "extension_tables": [...],
  "migrations": {
    "install": "migrations/install.js",
    "upgrade": [...],
    "uninstall": "migrations/uninstall.js"
  }
}
```

### 主进程路由代理

```javascript
// mini-app.routes.js
router.all('/api/mini-apps/:appId/custom/:command', async (ctx) => {
  const { appId, command } = ctx.params;
  
  // 查找驻留进程
  const proc = residentSkillManager.processes.get(`app_${appId}`);
  if (!proc) {
    // 降级处理：无驻留进程时走原生 SQL
    ctx.body = await extensionService.handleDefault(appId, command, ctx);
    return;
  }
  
  // invoke 驻留进程
  const result = await proc.invoke({
    command,
    method: ctx.method,
    params: ctx.query || ctx.request.body
  }, { userId: ctx.state.user.id });
  
  ctx.body = result;
});
```

### 驻留进程脚本示例

```javascript
// apps/contract-mgr/server/index.js

const db = await initDatabaseConnection();

process.stdin.on('data', async (buffer) => {
  const line = buffer.toString().trim();
  if (!line) return;
  
  const { command, task_id, params, user } = JSON.parse(line);
  
  try {
    let result;
    
    switch (command) {
      case 'list':
        result = await handleList(params, user);
        break;
      case 'detail':
        result = await handleDetail(params, user);
        break;
      case 'distinct':
        result = await handleDistinct(params);
        break;
      case 'create':
        result = await handleCreate(params, user);
        break;
      case 'update':
        result = await handleUpdate(params, user);
        break;
      case 'delete':
        result = await handleDelete(params, user);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
    
    respond(task_id, result);
    
  } catch (err) {
    respond(task_id, null, err.message);
  }
});

function respond(task_id, result, error = null) {
  process.stdout.write(JSON.stringify({
    type: 'response',
    task_id,
    result,
    error
  }) + '\n');
}

async function handleDistinct(params) {
  const rows = await db.query(
    `SELECT DISTINCT ${params.field} as value 
     FROM app_contract_rows 
     WHERE ${params.field} IS NOT NULL`
  );
  return { values: rows };
}
```

## 可能性边界

| 边界项 | 约束 | 说明 |
|-------|------|------|
| **命令数量** | 建议 ≤ 10 个核心命令 | 避免过度复杂 |
| **响应大小** | 单次响应 < 1MB | JSON 序列化限制 |
| **并发处理** | 驻留进程自管理并发队列 | 需在脚本内实现 |
| **超时时间** | 默认 60s，可配置 | manifest.timeout |
| **进程崩溃** | 主进程重启机制 | ResidentSkillManager.restart() |
| **数据库连接** | 驻留进程独立连接 | 或共享连接池 |

## 方案判定边界

| 决策因子 | 方案 A（原生 SQL） | 方案 B（驻留进程） |
|---------|------------------|------------------|
| 扩展表数量 | 1-2 表 | >2 表 |
| 业务逻辑复杂度 | 简单 CRUD | 复杂校验/计算 |
| 第三方 API 集成 | 无 | 有 |
| 需要 Cron 任务 | 无 | 有 |
| 需要缓存 | 无 | 有 |
| 开发成本 | 低 | 高 |

**contract-mgr 当前判定：方案 A（原生 SQL）即可，无需驻留进程。**

## 待讨论问题

1. 是否需要为驻留进程 API 实现独立的权限校验？
2. 驻留进程崩溃时的降级策略？
3. 是否允许驻留进程访问第三方 API（白名单域名）？
4. 驻留进程日志如何统一收集？

## 影响范围

| 文件 | 说明 |
|------|------|
| `manifest.json` | resident_api 字段定义 |
| `mini-app.routes.js` | 自定义命令路由代理 |
| `app-market.service.js` | 安装时启动驻留进程 |
| `ResidentSkillManager` | 扩展支持 App 驻留进程 |
| `apps/{appId}/server/` | 小程序驻留进程脚本目录 |

---

*最后更新: 2026-04-26*