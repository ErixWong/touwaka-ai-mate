# 后端硬编码变量分析报告

**项目**: Touwaka Mate V2  
**分析日期**: 2026-03-02  
**分析范围**: `server/` 目录  
**扫描文件**: index.js + 12 个控制器 + 中间件

---

## 📊 概览

| 类别 | 数量 | 风险等级 |
|------|------|----------|
| JWT Secret 硬编码 | 2 处 | ⚠️ **高** |
| LLM 参数默认值 | 6 个 | 中 |
| 分页默认值 | 多处不统一 | 低 |
| 超时/限制值 | 6 个 | 低 |

---

## 🔴 高优先级问题

### 1. JWT Secret 硬编码默认值（安全隐患）

**文件**: `server/middlewares/auth.js`

```javascript
// 第 7-8 行
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
```

**风险说明**:
- 如果环境变量 `JWT_SECRET` 或 `JWT_REFRESH_SECRET` 未设置，会使用不安全的默认值
- 攻击者可利用此默认值伪造 JWT Token

**建议修复**:
```javascript
// 启动时强制检查
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET environment variables are required');
}
```

---

## 🟡 中优先级问题

### 2. LLM 参数默认值

**文件**: `server/controllers/expert.controller.js`

| 变量 | 默认值 | 行号 | 说明 |
|------|--------|------|------|
| `context_threshold` | `0.70` | ~120 | 上下文压缩阈值 |
| `temperature` | `0.70` | ~123 | 表达温度 |
| `reflective_temperature` | `0.30` | ~124 | 反思温度 |
| `top_p` | `1.0` | ~125 | Top-p 采样 |
| `frequency_penalty` | `0.0` | ~126 | 频率惩罚 |
| `presence_penalty` | `0.0` | ~127 | 存在惩罚 |

**建议**: 提取到统一配置文件

---

## 🟢 低优先级问题

### 3. 分页默认值（不统一）

| 文件 | 变量 | 默认值 | 建议 |
|------|------|--------|------|
| `message.controller.js` | `pageSize` | `50` | 统一 |
| `message.controller.js` | `pageSize` | `20` | 统一 |
| `model.controller.js` | `max_tokens` | `4096` | OK |
| `topic.controller.js` | `defaultSize` | `10` | OK |
| `topic.controller.js` | `maxSize` | `100` | OK |
| `user.controller.js` | `pageSize` | `10` | 统一 |

### 4. 超时和限制值

| 文件 | 变量 | 当前值 | 说明 |
|------|------|--------|------|
| `provider.controller.js` | 默认超时 | `30` 秒 | 转毫秒存储 |
| `stream.controller.js` | `MAX_CONNECTIONS_PER_USER` | `5` | SSE连接限制 |
| `stream.controller.js` | `MAX_CONNECTIONS_PER_EXPERT` | `100` | SSE连接限制 |
| `stream.controller.js` | 心跳间隔 | `5000` ms | SSE保活 |
| `skill.controller.js` | ZIP大小限制 | `50MB` | 文件上传 |
| `skill.controller.js` | 下载超时 | `60000` ms | 60秒 |
| `user.controller.js` | 密码最小长度 | `6` | 验证规则 |

### 5. Token 过期时间

**文件**: `server/middlewares/auth.js`

| 变量 | 当前值 | 说明 |
|------|--------|------|
| Access Token 过期时间 | `'15m'` | 15分钟 |
| Refresh Token 过期时间 | `'7d'` | 7天 |

---

## 💡 优化建议

### 方案一：创建统一配置文件

```javascript
// config/defaults.js
export const DEFAULTS = {
  // LLM 参数
  llm: {
    contextThreshold: 0.70,
    temperature: 0.70,
    reflectiveTemperature: 0.30,
    topP: 1.0,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    maxTokens: 4096,
  },
  
  // 分页
  pagination: {
    defaultSize: 20,
    maxSize: 100,
  },
  
  // SSE
  sse: {
    maxConnectionsPerUser: 5,
    maxConnectionsPerExpert: 100,
    heartbeatInterval: 5000,
  },
  
  // Token
  token: {
    accessExpiry: '15m',
    refreshExpiry: '7d',
  },
  
  // 文件上传
  upload: {
    maxZipSize: 50 * 1024 * 1024, // 50MB
    downloadTimeout: 60000, // 60秒
  },
  
  // 用户
  user: {
    minPasswordLength: 6,
    providerDefaultTimeout: 30, // 秒
  },
};
```

### 方案二：启动时强制检查关键环境变量

```javascript
// server/config/env-check.js
const REQUIRED_ENV_VARS = [
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
];

export function checkRequiredEnvVars() {
  const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
```

---

## ✅ 行动项

- [ ] **紧急**: 修复 JWT Secret 硬编码问题，添加启动检查
- [ ] 创建 `config/defaults.js` 统一管理默认值
- [ ] 统一分页默认值（建议 `pageSize: 20`）
- [ ] 更新 `.env.example` 文档

---

**报告生成**: Maria (OpenClaw Assistant)  
**生成时间**: 2026-03-02 10:13 (Asia/Shanghai)