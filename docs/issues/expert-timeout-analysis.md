# 专家执行超长任务时的 Request Timeout 问题分析

**创建时间:** 2026-03-11
**作者:** Maria

## 问题描述

当专家执行超长任务（如远程 LLM 调用、复杂文档处理）时，会面临多个层面的 Request timeout 问题。

## 当前系统中的超时配置

### 1. 驻留技能层 (remote-llm)

**前端配置界面：** ❌ 无（后端硬编码）

```javascript
// data/skills/remote-llm/index.js
const CONFIG = {
  defaultTimeout: 120000,  // 120秒/2分钟
};

// HTTP 请求
async function httpRequest(url, options, body) {
  req.on('timeout', () => {
    req.destroy();
    reject(new Error('Request timeout'));
  });
}
```

**问题：** 2分钟超时对于复杂 LLM 任务可能不够。

### 2. 技能执行层 (skill-runner)

**前端配置界面：** ❌ 无（后端硬编码）

```javascript
// lib/skill-runner.js

// Node.js VM 沙箱
vm.runInContext(code, context, {
  timeout: 30000,  // 30秒超时（已调整）
});

// Python 执行
const PYTHON_TIMEOUT = 300000;  // 5分钟超时（已调整）
```

**状态：** ✅ 已调整超时值

### 3. Provider 配置层

**前端配置界面：** ✅ [`frontend/src/views/SettingsView.vue`](../src/views/SettingsView.vue) 第 595-605 行

```vue
<div class="form-item">
  <label class="form-label">{{ $t('settings.timeout') }} (秒)</label>
  <input
    v-model.number="providerForm.timeout"
    type="number"
    ...
  />
</div>
```

**后端处理：** `server/controllers/provider.controller.js`

```javascript
const timeout = (body.timeout ?? 30) * 1000;  // 默认30秒
```

**问题：** Provider 超时默认30秒，前端传入单位为秒，存储时转为毫秒。

### 4. 技能调用层

**前端配置界面：** ❌ 无（后端硬编码）

```javascript
// server/controllers/skill.controller.js
timeout: 60000,  // 60秒超时
request.on('timeout', () => {
  request.destroy();
});
```

**问题：** 60秒超时可能不够某些复杂任务。

## 超时问题层级分析

```
┌─────────────────────────────────────────────────────────────┐
│                      用户请求层                              │
│  浏览器/HTTP Client timeout (通常 5-30 分钟)                │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                      SSE 连接层                              │
│  SSE 保持连接，但可能因网络波动断开                          │
│  需要心跳机制保持活跃                                        │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    ChatService 层                            │
│  调用专家时设置 timeout                                      │
│  当前依赖 Provider 配置                                      │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    Provider 层                               │
│  LLM API 调用 timeout (默认 30-60 秒)                        │
│  可配置，但受限于前端 UI                                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                    驻留技能层                                │
│  remote-llm defaultTimeout: 120 秒                          │
│  执行远程 LLM 调用                                          │
└─────────────────────────────────────────────────────────────┘
```

## 典型场景分析

### 场景 1: 超长上下文 LLM 调用

```
专家收到任务
    │
    ├─► 构建大量上下文 (可能包含多个文档)
    │
    ├─► 调用远程 LLM (可能需要 3-5 分钟)
    │       │
    │       ├─► Provider timeout (30-60秒) ❌ 可能超时
    │       │
    │       └─► remote-llm timeout (120秒) ❌ 可能超时
    │
    └─► 返回结果给用户
```

### 场景 2: 复杂文档处理

```
专家调用文档处理技能
    │
    ├─► skill-runner VM timeout (10秒) ❌ 严重不足
    │
    └─► Python timeout (30秒) ❌ 可能不足
```

## 解决方案建议

### 方案 1: 分层超时配置

```javascript
// 建议的超时配置结构
const TIMEOUT_CONFIG = {
  // 快速任务
  quick: {
    vm: 10000,      // 10秒
    python: 30000,  // 30秒
    http: 60000,    // 60秒
  },
  
  // 标准任务
  standard: {
    vm: 60000,      // 60秒
    python: 120000, // 2分钟
    http: 180000,   // 3分钟
  },
  
  // 长时间任务
  long: {
    vm: 300000,     // 5分钟
    python: 600000, // 10分钟
    http: 900000,   // 15分钟
  },
};
```

### 方案 2: 动态超时调整

```javascript
// 根据任务类型动态设置超时
function getTimeout(taskType, complexity) {
  const baseTimeout = TIMEOUT_CONFIG[taskType] || TIMEOUT_CONFIG.standard;
  
  // 根据复杂度调整
  const multiplier = complexity === 'high' ? 2 : 1;
  
  return {
    ...baseTimeout,
    http: baseTimeout.http * multiplier,
  };
}
```

### 方案 3: 异步任务 + 轮询/SSE 推送

```
专家发起长时间任务
    │
    ├─► 立即返回 task_id
    │
    ├─► 后台执行任务
    │
    └─► 通过 SSE 推送进度和结果
```

### 方案 4: 心跳保活机制

```javascript
// SSE 心跳
setInterval(() => {
  sseConnection.write(': heartbeat\n\n');
}, 15000);  // 每15秒发送心跳

// 驻留进程心跳
setInterval(() => {
  sendResponse({ type: 'heartbeat', timestamp: Date.now() });
}, 30000);  // 每30秒发送心跳
```

## 具体改进建议

### 1. 增加 Provider 超时上限

```javascript
// server/controllers/provider.controller.js
const timeout = Math.min(
  (body.timeout ?? 30) * 1000,
  1800000  // 最大 30 分钟
);
```

### 2. 驻留技能支持自定义超时

```javascript
// data/skills/remote-llm/index.js
async function callRemoteLLM(params) {
  const timeout = params.timeout || CONFIG.defaultTimeout;
  // 使用传入的超时或默认值
}
```

### 3. 技能执行器支持长时间任务

```javascript
// lib/skill-runner.js
const timeout = process.env.SKILL_TIMEOUT 
  ? parseInt(process.env.SKILL_TIMEOUT)
  : 30000;  // 默认30秒，可通过环境变量覆盖
```

### 4. 添加任务优先级

```sql
ALTER TABLE skill_tools 
ADD COLUMN priority ENUM('quick', 'standard', 'long') DEFAULT 'standard';
```

## 讨论要点

1. **最大超时限制**：应该设置什么上限？5分钟？30分钟？
2. **超时通知**：超时时如何优雅地通知用户？
3. **重试机制**：是否需要自动重试？
4. **任务队列**：是否需要引入任务队列管理长时间任务？
5. **资源限制**：长时间任务如何避免资源耗尽？

---

✌Bazinga！