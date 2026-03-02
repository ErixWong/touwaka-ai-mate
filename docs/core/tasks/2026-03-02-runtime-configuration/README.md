# 运行时配置统一管理

**状态：** ⏳ 待开始  
**创建日期：** 2026-03-02  
**优先级：** 高  
**合并来源：** 运行时参数配置界面 + 反思心智模板配置化 + 硬编码变量分析

---

## 背景

系统中有大量硬编码的配置参数分散在多个文件中，包括：
- LLM 调用参数（temperature, top_p 等）
- 反思心智模板
- 工具调用限制
- 分页和超时设置
- JWT Token 配置

这些参数需要统一管理，并提供可视化配置界面。

---

## 需求分析

### 1. 配置分类

| 类别 | 配置项 | 当前位置 | 可运行时修改 |
|------|--------|----------|-------------|
| **LLM 参数** | temperature, top_p, frequency_penalty, presence_penalty | expert.controller.js | ✅ |
| **反思心智** | 反思维度权重、模板内容 | reflective-mind.js | ✅ |
| **工具调用** | 超时、内存限制、最大轮数 | skill-runner.js, chat-service.js | ⚠️ 需重启 |
| **上下文压缩** | 压缩阈值、最小消息数 | chat-service.js | ✅ |
| **分页设置** | 默认页大小、最大页大小 | 多个 controller | ✅ |
| **SSE 连接** | 心跳间隔、连接数限制 | stream.controller.js | ⚠️ 需重启 |
| **Token 配置** | Access/Refresh Token 过期时间 | auth.js | ❌ 需重启 |
| **安全配置** | JWT Secret | auth.js | ❌ 环境变量 |

### 2. 配置作用域

- **全局配置**：适用于所有专家和用户
- **专家级配置**：每个专家可以覆盖全局配置（如 LLM 参数、反思模板）
- **用户级配置**：用户的个人偏好（暂不考虑）

### 3. 高优先级问题

#### JWT Secret 硬编码（安全隐患）

```javascript
// server/middlewares/auth.js:7-8
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
```

**风险**：如果环境变量未设置，会使用不安全的默认值。

**修复方案**：启动时强制检查，缺失则报错退出。

---

## 设计方案

### 数据库设计

#### 方案 A：新建 system_config 表

```sql
CREATE TABLE system_config (
  id INT PRIMARY KEY AUTO_INCREMENT,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_value TEXT,
  config_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
  description VARCHAR(255),
  requires_restart BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

#### 方案 B：扩展现有 experts 表

在 `experts` 表中添加：
- `llm_config` JSON - LLM 参数配置
- `reflection_config` JSON - 反思心智配置

**推荐**：方案 A + 方案 B 结合
- 全局配置用 `system_config` 表
- 专家级配置用 `experts` 表 JSON 字段

### 配置文件结构

```javascript
// config/defaults.js
export const DEFAULTS = {
  // LLM 参数（专家级可覆盖）
  llm: {
    contextThreshold: 0.70,
    temperature: 0.70,
    reflectiveTemperature: 0.30,
    topP: 1.0,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    maxTokens: 4096,
  },
  
  // 反思心智（专家级可覆盖）
  reflection: {
    weights: {
      valueAlignment: 0.30,
      behaviorAdherence: 0.25,
      tabooCheck: 0.25,
      emotionalTone: 0.20,
    },
    template: '...', // 默认模板
  },
  
  // 工具调用（全局）
  tool: {
    maxResultLength: 10000,
    executionTimeout: 30000,
    memoryLimit: 128,
    maxRounds: 20,
  },
  
  // 上下文压缩（全局）
  compression: {
    threshold: 0.7,
    minMessages: 20,
  },
  
  // 分页（全局）
  pagination: {
    defaultSize: 20,
    maxSize: 100,
  },
  
  // SSE（全局，需重启）
  sse: {
    maxConnectionsPerUser: 5,
    maxConnectionsPerExpert: 100,
    heartbeatInterval: 5000,
  },
  
  // Token（全局，需重启）
  token: {
    accessExpiry: '15m',
    refreshExpiry: '7d',
  },
};
```

### 前端界面设计

在设置界面添加「运行时配置」标签页：

```
┌─────────────────────────────────────────────────────────────┐
│  设置 > 运行时配置                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 LLM 参数（全局默认值，专家可覆盖）                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Temperature: [0.70] ████████████░░░░░░░░  [0-2]     │   │
│  │ Top P: [1.00] ████████████████████░░░░░░  [0-1]     │   │
│  │ 频率惩罚: [0.00] ░░░░░░░░░░░░░░░░░░░░░░░░  [0-2]     │   │
│  │ 存在惩罚: [0.00] ░░░░░░░░░░░░░░░░░░░░░░░░  [0-2]     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  🧠 反思心智配置                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 评分权重:                                            │   │
│  │ • 价值观一致性: [30]%                                │   │
│  │ • 行为准则: [25]%                                    │   │
│  │ • 禁忌检查: [25]%                                    │   │
│  │ • 情感适当性: [20]%                                  │   │
│  │                                                      │   │
│  │ [编辑反思模板...]                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ⚙️ 工具调用限制                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 工具结果最大长度: [10000] 字符                        │   │
│  │ 技能执行超时: [30000] 毫秒                           │   │
│  │ 最大调用轮数: [20]                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [保存] [恢复默认]                                           │
│  ⚠️ 部分配置修改后需要重启服务才能生效                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 实现步骤

### Phase 1: 基础设施（必须）

- [ ] **紧急**：修复 JWT Secret 硬编码问题
- [ ] 创建 `config/defaults.js` 统一管理默认值
- [ ] 创建 `system_config` 数据库表
- [ ] 创建配置读写 API

### Phase 2: LLM 参数配置

- [ ] 修改 `expert.controller.js` 使用配置
- [ ] 前端专家编辑界面添加 LLM 参数配置
- [ ] 支持专家级覆盖全局默认值

### Phase 3: 反思心智配置

- [ ] 数据库添加 `reflection_template` 和 `reflection_weights` 字段
- [ ] 修改 `ReflectiveMind` 支持模板配置
- [ ] 前端添加反思模板编辑器

### Phase 4: 全局配置界面

- [ ] 创建设置界面的「运行时配置」标签页
- [ ] 实现配置热更新（无需重启）
- [ ] 添加配置修改日志

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `server/middlewares/auth.js` | JWT Secret 硬编码 |
| `server/controllers/expert.controller.js` | LLM 参数默认值 |
| `lib/reflective-mind.js` | 反思心智模板 |
| `lib/chat-service.js` | 工具调用、压缩参数 |
| `lib/skill-runner.js` | 技能执行参数 |
| `server/controllers/stream.controller.js` | SSE 参数 |

---

## 参考文档

- [后端硬编码变量分析报告](../2026-03-02-nightly-analysis/reports/2026-03-02-hardcoded-variables.md)
- [运行时参数配置界面（原）](../../../archive/tasks/2026-02/2026-02-24-runtime-config/README.md)
- [反思心智模板配置化（原）](../../../archive/tasks/2026-02/2026-02-24-reflective-mind-template/README.md)
