# 静态变量/硬编码配置审计报告

**项目**: Touwaka Mate V2  
**分析日期**: 2026-03-08  
**分析范围**: 后端 `server/` + 前端 `frontend/src/`  
**基于**: 2026-03-02 报告的更新版本

---

## 📊 概览

| 类别 | 后端数量 | 前端数量 | 风险等级 | 建议处理方式 |
|------|----------|----------|----------|-------------|
| 安全相关（JWT Secret等） | 3 | 0 | ⚠️ **高** | 环境变量强制检查 |
| LLM 参数默认值 | 7 | 0 | 中 | 系统设置界面 |
| 分页默认值 | 4 | 0 | 低 | 统一配置 |
| 超时/连接限制 | 6 | 4 | 中 | 部分可配置 |
| 文件/层级限制 | 3 | 0 | 低 | 可考虑配置 |
| 图片压缩参数 | 0 | 2 | 低 | 可考虑配置 |

---

## 🔴 高优先级问题（安全相关）

### 1. JWT Secret 硬编码默认值

**文件**: [`server/middlewares/auth.js`](server/middlewares/auth.js:7)

```javascript
// 第 7-8 行
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
```

**文件**: [`server/middlewares/auth.js`](server/middlewares/auth.js:32)

```javascript
// 第 32 行
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'internal-api-secret';
```

**风险说明**:
- 如果环境变量未设置，会使用不安全的默认值
- 攻击者可利用此默认值伪造 JWT Token

**建议修复**:
```javascript
// 启动时强制检查
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET environment variables are required');
}
```

**是否需要设置界面**: ❌ 否，这是部署配置，应由运维通过环境变量设置

---

## 🟡 中优先级问题（建议设置界面）

### 2. LLM 参数默认值

**文件**: [`server/controllers/expert.controller.js`](server/controllers/expert.controller.js:143)

| 变量 | 默认值 | 说明 | 是否需要设置界面 |
|------|--------|------|-----------------|
| `context_threshold` | `0.70` | 上下文压缩阈值 | ✅ 是 |
| `temperature` | `0.70` | 表达温度 | ✅ 是（已支持 Expert 级别） |
| `reflective_temperature` | `0.30` | 反思温度 | ✅ 是（已支持 Expert 级别） |
| `top_p` | `1.0` | Top-p 采样 | ✅ 是（已支持 Expert 级别） |
| `frequency_penalty` | `0.0` | 频率惩罚 | ✅ 是（已支持 Expert 级别） |
| `presence_penalty` | `0.0` | 存在惩罚 | ✅ 是（已支持 Expert 级别） |
| `max_tokens` | `4096` | 模型默认最大 token | ✅ 是（已支持 Model 级别） |

**分析**:
- LLM 参数已在 Expert 和 Model 级别支持配置
- 但**全局默认值**仍硬编码在代码中
- 建议：添加**系统级默认值设置**，作为新建 Expert/Model 时的初始值

### 3. SSE 连接配置

**后端** - [`server/controllers/stream.controller.js`](server/controllers/stream.controller.js:238)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| `MAX_CONNECTIONS_PER_USER` | `5` | 每用户最大 SSE 连接数 |
| `MAX_CONNECTIONS_PER_EXPERT` | `100` | 每 Expert 最大 SSE 连接数 |

**前端** - [`frontend/src/composables/useSSE.ts`](frontend/src/composables/useSSE.ts:51)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| `DEFAULT_TIMEOUT` | `10000` | SSE 连接超时（毫秒） |
| `DEFAULT_MAX_RECONNECT` | `10` | 最大重连次数 |
| `DEFAULT_RECONNECT_INTERVAL` | `3000` | 重连间隔（毫秒） |

**前端** - [`frontend/src/composables/useNetworkStatus.ts`](frontend/src/composables/useNetworkStatus.ts:17)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| `CHECK_INTERVAL` | `5000` | 健康检查间隔（毫秒） |
| `SSE_HEARTBEAT_TIMEOUT` | `10000` | SSE 心跳超时（毫秒） |

**是否需要设置界面**: ⚠️ 部分需要
- `MAX_CONNECTIONS_PER_USER` / `MAX_CONNECTIONS_PER_EXPERT`: ✅ 建议管理员可配置
- SSE 超时/重连参数: ❌ 通常不需要用户配置

### 4. Token 过期时间

**文件**: [`server/middlewares/auth.js`](server/middlewares/auth.js:109)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| Access Token 过期时间 | `'15m'` | 15分钟 |
| Refresh Token 过期时间 | `'7d'` | 7天 |

**是否需要设置界面**: ⚠️ 可考虑
- 安全敏感配置，建议管理员可配置
- 但需要有合理的范围限制

---

## 🟢 低优先级问题

### 5. 分页默认值（不统一）

| 文件 | 变量 | 默认值 | 建议 |
|------|------|--------|------|
| [`message.controller.js`](server/controllers/message.controller.js:29) | `pageSize` | `30` | 统一 |
| [`message.controller.js`](server/controllers/message.controller.js:112) | `pageSize` | `20` | 统一 |
| [`topic.controller.js`](server/controllers/topic.controller.js:71) | `pageSize` | `20` | 统一 |
| [`user.controller.js`](server/controllers/user.controller.js:31) | `pageSize` | `10` | 统一 |
| [`task.controller.js`](server/controllers/task.controller.js:144) | `pageSize` | `20` | 统一 |

**是否需要设置界面**: ❌ 否
- 建议：创建统一的分页配置，默认 `pageSize: 20`
- 用户级别的分页设置通常不需要

### 6. 文件和层级限制

**文件**: [`server/controllers/kb.controller.js`](server/controllers/kb.controller.js:21)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| `MAX_SECTION_DEPTH` | `10` | 知识库章节最大层级 |

**文件**: [`server/controllers/skill.controller.js`](server/controllers/skill.controller.js:520)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| 下载超时 | `60000` | Skill 下载超时（毫秒） |

**文件**: [`server/controllers/provider.controller.js`](server/controllers/provider.controller.js:92)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| Provider 默认超时 | `30` | 秒 |

**是否需要设置界面**: ⚠️ 可考虑
- `MAX_SECTION_DEPTH`: ❌ 通常不需要
- 超时配置: ✅ Provider 超时已支持配置

### 7. 工作空间路径

**文件**: [`server/routes/task.routes.js`](server/routes/task.routes.js:15), [`server/controllers/task.controller.js`](server/controllers/task.controller.js:20)

```javascript
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';
```

**是否需要设置界面**: ❌ 否，这是部署配置

### 8. 图片压缩参数

**文件**: [`frontend/src/utils/imageCompress.ts`](frontend/src/utils/imageCompress.ts:15)

| 变量 | 当前值 | 说明 |
|------|--------|------|
| `DEFAULT_SMALL_OPTIONS.maxWidth` | `128` | 小头像最大宽度 |
| `DEFAULT_LARGE_OPTIONS.maxWidth` | `800` | 大头像最大宽度 |

**是否需要设置界面**: ❌ 否，通常不需要用户配置

---

## 💡 设置界面改进建议

### 方案：系统设置面板

建议在现有的 [`SettingsView.vue`](frontend/src/views/SettingsView.vue) 中添加**系统配置**标签页（仅管理员可见）：

```typescript
// 建议的系统配置结构
interface SystemDefaults {
  // LLM 默认参数（新建 Expert 时的初始值）
  llm: {
    contextThreshold: number    // 默认 0.70
    temperature: number         // 默认 0.70
    reflectiveTemperature: number // 默认 0.30
    topP: number               // 默认 1.0
    frequencyPenalty: number   // 默认 0.0
    presencePenalty: number    // 默认 0.0
    maxTokens: number          // 默认 4096
  }
  
  // 连接限制
  connection: {
    maxConnectionsPerUser: number     // 默认 5
    maxConnectionsPerExpert: number   // 默认 100
  }
  
  // Token 配置
  token: {
    accessExpiry: string    // 默认 '15m'
    refreshExpiry: string   // 默认 '7d'
  }
  
  // 分页配置
  pagination: {
    defaultPageSize: number  // 默认 20
    maxPageSize: number      // 默认 100
  }
}
```

### 数据库设计

需要新增 `system_settings` 表：

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

---

## ✅ 行动项

### 紧急（安全）
- [ ] 修复 JWT Secret 硬编码问题，添加启动检查
- [ ] 更新 `.env.example` 文档说明必须的环境变量

### 建议实施（设置界面）
- [ ] 创建 `system_settings` 数据库表
- [ ] 创建后端 API：`GET/PUT /api/system-settings`
- [ ] 前端添加系统配置标签页
- [ ] 将 LLM 默认参数移至系统配置
- [ ] 将连接限制移至系统配置
- [ ] 将 Token 过期时间移至系统配置

### 低优先级
- [ ] 统一分页默认值
- [ ] 创建 `config/defaults.js` 统一管理后端默认值

---

## 📁 相关文件

### 后端
- [`server/middlewares/auth.js`](server/middlewares/auth.js) - JWT 配置
- [`server/controllers/expert.controller.js`](server/controllers/expert.controller.js) - LLM 参数
- [`server/controllers/stream.controller.js`](server/controllers/stream.controller.js) - SSE 连接限制
- [`server/controllers/model.controller.js`](server/controllers/model.controller.js) - 模型默认值
- [`server/controllers/kb.controller.js`](server/controllers/kb.controller.js) - 章节深度限制

### 前端
- [`frontend/src/composables/useSSE.ts`](frontend/src/composables/useSSE.ts) - SSE 配置
- [`frontend/src/composables/useNetworkStatus.ts`](frontend/src/composables/useNetworkStatus.ts) - 网络检查配置
- [`frontend/src/utils/imageCompress.ts`](frontend/src/utils/imageCompress.ts) - 图片压缩配置
- [`frontend/src/views/SettingsView.vue`](frontend/src/views/SettingsView.vue) - 设置界面

---

**报告生成**: Maria  
**生成时间**: 2026-03-08 14:35 (Asia/Shanghai)
