## 📋 变更概述

扫描项目代码，识别所有静态变量和硬编码配置，分析是否需要将其移至设置界面进行管理。

> ✅ **Eric 已确认**：设计方案已获批准，可按计划实施

## 🔍 分析结果

### 高优先级（安全相关）
- **JWT Secret 硬编码**: [`server/middlewares/auth.js`](server/middlewares/auth.js:7) 中存在不安全的默认值
- **建议**: 添加启动时环境变量检查，不放入设置界面

### 中优先级（建议设置界面）
| 配置项 | 当前位置 | 建议处理 |
|--------|----------|----------|
| LLM 参数默认值 | `expert.controller.js` | ✅ 系统设置 |
| SSE 连接限制 | `stream.controller.js` | ✅ 管理员设置 |
| Token 过期时间 | `auth.js` | ✅ 管理员设置 |
| SSE 超时/重连 | `useSSE.ts` | ❌ 保持硬编码 |

### 低优先级
| 配置项 | 建议处理 |
|--------|----------|
| 分页默认值 | 统一配置，不需要设置界面 |
| 工作空间路径 | 环境变量，不需要设置界面 |
| 图片压缩参数 | 保持硬编码 |

## 💡 建议方案

### 系统设置界面（管理员）

在现有设置页面添加「系统配置」标签页：

```typescript
interface SystemDefaults {
  llm: {
    contextThreshold: number    // 上下文压缩阈值
    temperature: number         // 表达温度
    reflectiveTemperature: number // 反思温度
    topP: number               // Top-p 采样
    frequencyPenalty: number   // 频率惩罚
    presencePenalty: number    // 存在惩罚
    maxTokens: number          // 最大 token
  }
  connection: {
    maxConnectionsPerUser: number     // 每用户最大连接数
    maxConnectionsPerExpert: number   // 每 Expert 最大连接数
  }
  token: {
    accessExpiry: string    // Access Token 过期时间
    refreshExpiry: string   // Refresh Token 过期时间
  }
}
```

### 数据库变更

需要新增 `system_settings` 表（需 Eric 确认）：

```sql
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT NOT NULL,
  description VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## ✅ 行动项

### 紧急
- [ ] 修复 JWT Secret 硬编码问题

### 后续任务
- [ ] 创建 `system_settings` 数据库表
- [ ] 创建后端 API：`GET/PUT /api/system-settings`
- [ ] 前端添加系统配置标签页
- [ ] 迁移 LLM 默认参数到系统配置
- [ ] 迁移连接限制到系统配置

## 📁 相关文件

详细报告见: [`docs/core/tasks/2026-03-08-static-variables-audit/report.md`](docs/core/tasks/2026-03-08-static-variables-audit/report.md)

---

**实施任务**: #46
**本 PR 为分析报告和设计方案，具体实现将在 Issue #46 中跟踪**
