# V1 Mind Core 基础层要求

**定位**: V1 是 V2 的基石，V2 通过 API 调用 V1，不会修改 V1 代码  
**原则**: V1 必须在部署前达到生产级质量

---

## 必须修复的问题（阻塞 V2 开发）

### 🔴 P0: 安全漏洞 - 技能执行沙箱逃逸

**问题**: `vm` 模块不能提供真正的隔离

**后果**: 
- V2 启动 Task 容器时，恶意技能可能逃逸到宿主机
- 容器隔离被破坏，影响整个系统安全

**必须修复**: 使用子进程隔离

```javascript
// lib/skill-loader.js
async executeSkill(skillId, toolName, params) {
  // 使用子进程，配合 Docker 的安全策略
  const proc = spawn('node', ['skill-runner.js', skillId, toolName], {
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30000,
    // Docker 中可添加更多限制
    // - 只读文件系统
    // - 网络隔离
    // - 资源限制
  });
  
  proc.send(params);
  
  return new Promise((resolve, reject) => {
    proc.on('message', (result) => {
      resolve(result);
      proc.kill();
    });
    
    proc.on('error', reject);
    
    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Skill execution timeout'));
    }, 30000);
  });
}
```

---

### 🔴 P0: 稳定性 - LLM Client 重试机制

**问题**: 网络抖动导致请求失败，没有重试

**后果**:
- V2 Task 执行过程中 LLM 调用失败会导致整个 Task 失败
- 无法区分是暂时网络问题还是真实错误

**必须修复**: 添加指数退避重试

```javascript
// lib/llm-client.js
async callWithRetry(model, messages, options = {}, maxRetries = 3) {
  const errors = [];
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await this.call(model, messages, options);
    } catch (error) {
      errors.push(error);
      
      // 判断是否应该重试
      if (!this.isRetryableError(error) || attempt === maxRetries) {
        throw new AggregateError(errors, `Failed after ${attempt} attempts`);
      }
      
      // 指数退避
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

isRetryableError(error) {
  // 网络错误、超时、429 限流、503 服务不可用
  return error.code === 'ECONNRESET' ||
         error.code === 'ETIMEDOUT' ||
         error.message.includes('429') ||
         error.message.includes('503');
}
```

---

### 🔴 P0: 资源控制 - 工具调用结果截断

**问题**: 工具返回大量数据会撑爆上下文

**后果**:
- V2 Task 执行时搜索工具返回大量结果会导致后续 LLM 调用失败
- 无法完成多步骤任务

**必须修复**: 限制工具结果长度

```javascript
// lib/tool-manager.js
formatToolResultsForLLM(results, maxLength = 4000) {
  return results.map(result => {
    let content = JSON.stringify({
      success: result.success,
      data: result.data,
      error: result.error,
    });
    
    // 截断并添加标记
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + 
        `\n...[truncated, original ${content.length} chars]`;
    }
    
    return {
      role: 'tool',
      tool_call_id: result.toolCallId,
      name: result.toolName,
      content,
    };
  });
}
```

---

## 强烈建议修复（影响 V2 体验）

### 🟠 P1: 配置验证

**问题**: 配置加载后没有验证，无效配置会导致运行时错误

**后果**: V2 启动 Task 时发现配置错误，难以排查

```javascript
// lib/config-loader.js
validateExpertConfig(config) {
  const required = ['id', 'name', 'expressive_model'];
  for (const field of required) {
    if (!config.expert[field]) {
      throw new Error(`Expert config missing required field: ${field}`);
    }
  }
  
  // 验证模型配置完整性
  if (!config.expressiveModel?.base_url || !config.expressiveModel?.api_key) {
    throw new Error('Expressive model configuration incomplete');
  }
}
```

---

### 🟠 P1: 内存缓存上限

**问题**: 联系人缓存无限增长

**后果**: V2 长期运行多个 Task 会导致内存泄漏

```javascript
// lib/memory-system.js
constructor() {
  this.messageCache = new Map();
  this.cacheMaxSize = 100;
  this.maxCachedContacts = 50; // 新增
  this.lruList = []; // 新增 LRU 追踪
}
```

---

## 可以延后（V2 可以 workaround）

### 🟡 P2: Topic 智能匹配

V2 可以在调用 V1 API 时自行携带相关 Topic 上下文作为 workaround

### 🟡 P2: Reflective Mind 触发条件

V2 可以在 Task 级别控制何时调用 V1 进行反思

---

## 修复优先级矩阵

| 问题 | V1 修复成本 | V2 影响程度 | 修复优先级 |
|------|------------|------------|-----------|
| 技能沙箱逃逸 | 高 | 致命 | **P0 - 必须** |
| LLM 重试机制 | 中 | 高 | **P0 - 必须** |
| 工具结果截断 | 低 | 高 | **P0 - 必须** |
| 配置验证 | 低 | 中 | **P1 - 建议** |
| 内存缓存上限 | 中 | 中 | **P1 - 建议** |
| Topic 智能匹配 | 高 | 低 | P2 - 延后 |
| Reflective 触发条件 | 中 | 低 | P2 - 延后 |

---

## 结论

**V1 必须在生产部署前修复 P0 和 P1 问题**，因为：

1. **V2 依赖 V1 的稳定性** - LLM 调用失败会导致 Task 失败
2. **安全是底线** - 技能沙箱逃逸会危及整个系统
3. **无法后期修复** - V2 不修改 V1 代码，问题会永久遗留
4. **资源控制是契约** - V2 假设 V1 能处理大流量，必须有资源限制

**建议**: V1 应该有一个 "生产就绪" 的里程碑，包含上述修复并通过压力测试，然后再开始 V2 开发。
