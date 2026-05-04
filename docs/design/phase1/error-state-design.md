# V1 阶段错误状态详细设计

## 一、设计原则确认

基于用户明确的决策：
- ✅ **无限滚动** - 历史消息加载策略
- ✅ **SSE 需要后端支持，前端发起连接** - SSE 管理策略
- ❌ **文件上传** - V1 阶段不需要，后续再讨论
- ❌ **消息撤回/修改/删除/引用回复** - V1 阶段用户不允许这些操作

## 二、错误分类与处理

### 2.1 网络层错误

| 错误类型 | 触发场景 | UI 表现 | 用户操作 | 自动恢复 |
|---------|---------|---------|---------|---------|
| **网络断开** | WiFi/网络连接中断 | 顶部红色横幅提示"网络连接已断开" | 点击"重试"按钮 | 监听 online 事件，网络恢复后自动重连 |
| **连接超时** | SSE 连接建立超过 10s | 消息气泡内显示"连接超时" + 重试按钮 | 点击重试 | 无 |
| **DNS 解析失败** | 域名无法解析 | 全局错误提示"无法连接到服务器" | 检查网络设置 | 无 |

**代码示例**:
```typescript
// 网络状态监听
window.addEventListener('offline', () => {
  showNetworkError('网络连接已断开');
});

window.addEventListener('online', () => {
  hideNetworkError();
  // 自动恢复待发送的消息
  retryPendingMessages();
});
```

### 2.2 API 错误

| 错误码 | 场景 | UI 表现 | 处理策略 |
|-------|------|---------|---------|
| **401 Unauthorized** | Access Token 过期 | 静默刷新，失败则跳转登录 | 自动刷新 Token，用户无感知 |
| **403 Forbidden** | 权限不足 | 全局提示"您没有权限执行此操作" | 记录日志，提示管理员 |
| **429 Too Many Requests** | 触发限流 | 消息气泡内显示"请求过于频繁，请稍后再试" | 指数退避重试 |
| **500 Internal Error** | 服务器内部错误 | 消息气泡内显示"服务器暂时不可用" + 重试 | 用户可手动重试 |
| **503 Service Unavailable** | 服务维护/过载 | 全局提示"服务暂时不可用，请稍后再试" | 显示预计恢复时间（如有） |
| **AI Provider Error** | AI 服务提供商错误 | 消息气泡内显示"AI 服务暂时不可用" + 重试 | 可切换备用模型 |

**Token 刷新机制**:
```typescript
// Axios 拦截器处理 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const newToken = await refreshAccessToken();
        originalRequest.headers['Authorization'] = `Bearer ${newToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // 刷新失败，跳转登录
        redirectToLogin();
        return Promise.reject(refreshError);
      }
    }
    
    return Promise.reject(error);
  }
);
```

### 2.3 业务逻辑错误

| 错误类型 | 触发场景 | UI 表现 | 处理策略 |
|---------|---------|---------|---------|
| **话题不存在** | 访问已删除的话题 | 全局提示"话题不存在或已被删除" | 跳转回话题列表 |
| **模型不可用** | 配置的模型已下线 | 输入框上方提示"当前模型不可用，请切换模型" | 自动切换到默认模型 |
| **上下文过长** | 消息超过模型上下文限制 | 消息气泡内显示"消息过长，请缩短后重试" | 提示用户精简内容 |
| **内容审核失败** | 触发敏感词过滤 | 消息气泡内显示"内容不符合规范，请修改后重试" | 提示具体违规原因 |

## 三、消息发送错误处理

### 3.1 错误状态展示

```vue
<!-- 消息错误状态组件 -->
<template>
  <div class="message-error" v-if="message.status === 'error'">
    <div class="error-icon">
      <Icon name="error-circle" />
    </div>
    <div class="error-content">
      <div class="error-title">{{ getErrorTitle(message.errorCode) }}</div>
      <div class="error-desc">{{ getErrorDesc(message.errorCode) }}</div>
    </div>
    <div class="error-actions">
      <button @click="retryMessage(message.id)" class="retry-btn">
        <Icon name="refresh" /> 重试
      </button>
    </div>
  </div>
</template>
```

### 3.2 错误文案规范

| 错误码 | 标题 | 描述 | 操作建议 |
|-------|------|------|---------|
| NETWORK_ERROR | 网络错误 | 无法连接到服务器，请检查网络设置 | 重试 |
| TIMEOUT_ERROR | 请求超时 | 服务器响应时间过长，请稍后重试 | 重试 |
| RATE_LIMIT_ERROR | 请求过于频繁 | 已达到请求限制，请稍后再试 | 等待后重试 |
| TOKEN_EXPIRED | 登录已过期 | 您的登录状态已过期，请重新登录 | 重新登录 |
| MODEL_UNAVAILABLE | 模型不可用 | 当前选择的模型暂时不可用 | 切换模型 |
| CONTENT_TOO_LONG | 内容过长 | 消息内容超过模型处理限制 | 精简内容 |
| CONTENT_VIOLATION | 内容不合规 | 消息内容违反使用规范 | 修改内容 |
| SERVER_ERROR | 服务器错误 | 服务器遇到意外错误 | 重试或联系管理员 |
| AI_PROVIDER_ERROR | AI 服务错误 | AI 服务提供商返回错误 | 重试或切换模型 |

### 3.3 重试策略

```typescript
// 重试策略配置
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

// 指数退避重试
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  attempt: number = 1
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (attempt >= RETRY_CONFIG.maxRetries) {
      throw error;
    }
    
    const delay = Math.min(
      RETRY_CONFIG.initialDelay * Math.pow(RETRY_CONFIG.backoffMultiplier, attempt - 1),
      RETRY_CONFIG.maxDelay
    );
    
    await sleep(delay);
    return retryWithBackoff(operation, attempt + 1);
  }
}
```

## 四、SSE 连接错误处理

### 4.1 连接生命周期

```
[用户发送消息] → [建立 SSE 连接] → [接收流式数据] → [完成/错误]
                     ↓
              [连接失败/中断]
                     ↓
              [自动重连，最多 3 次]
                     ↓
              [重连成功] → [继续接收]
                     ↓
              [重连失败] → [显示错误 + 重试按钮]
```

### 4.2 SSE 错误处理代码

```typescript
class SSEManager {
  private eventSource: EventSource | null = null;
  private retryCount = 0;
  private maxRetries = 3;
  private messageId: string;

  constructor(messageId: string) {
    this.messageId = messageId;
  }

  connect(url: string): void {
    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleStreamData(data);
      this.retryCount = 0; // 重置重试计数
    };

    this.eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      this.handleSSEError();
    };

    this.eventSource.addEventListener('complete', () => {
      this.handleStreamComplete();
    });
  }

  private handleSSEError(): void {
    if (this.retryCount < this.maxRetries) {
      this.retryCount++;
      const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), 5000);
      
      showReconnectingToast(`连接中断，${delay / 1000}秒后重试...`);
      
      setTimeout(() => {
        this.reconnect();
      }, delay);
    } else {
      this.handleStreamError('STREAM_INTERRUPTED');
    }
  }

  private reconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }
    // 使用 last_event_id 恢复断点
    const url = `${this.baseUrl}?last_event_id=${this.lastEventId}`;
    this.connect(url);
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
```

### 4.3 断点续传支持

```typescript
// 后端需要支持 last_event_id 参数
interface SSEReconnectParams {
  last_event_id?: string;  // 上次接收到的消息 ID
  conversation_id: string;
  model: string;
}

// 前端存储 last_event_id
const lastEventId = localStorage.getItem(`sse_last_event_${conversationId}`);
const sseUrl = `/api/chat/stream?conversation_id=${conversationId}&last_event_id=${lastEventId || ''}`;
```

## 五、全局错误处理组件

### 5.1 错误边界设计

```vue
<!-- GlobalErrorBoundary.vue -->
<template>
  <div v-if="hasError" class="global-error-overlay">
    <div class="error-modal">
      <div class="error-icon">
        <Icon name="warning" size="48" />
      </div>
      <h2>{{ errorTitle }}</h2>
      <p>{{ errorMessage }}</p>
      <div class="error-actions">
        <button @click="reloadPage" class="primary-btn">
          刷新页面
        </button>
        <button @click="goHome" class="secondary-btn">
          返回首页
        </button>
      </div>
    </div>
  </div>
  <slot v-else />
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue';

const hasError = ref(false);
const errorTitle = ref('');
const errorMessage = ref('');

onErrorCaptured((error, instance, info) => {
  hasError.value = true;
  errorTitle.value = '发生错误';
  errorMessage.value = error.message || '应用程序遇到意外错误';
  
  // 上报错误
  reportError({
    error: error.message,
    stack: error.stack,
    component: instance?.$options?.name,
    info,
    timestamp: new Date().toISOString(),
  });
  
  return false; // 阻止错误继续传播
});
</script>
```

### 5.2 错误 Toast 通知

```typescript
// 错误通知管理
interface ErrorToast {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  duration: number;
  action?: {
    label: string;
    handler: () => void;
  };
}

const errorToast = useErrorToast();

// 显示网络错误
errorToast.show({
  type: 'error',
  title: '网络连接已断开',
  message: '请检查您的网络设置',
  duration: 0, // 不自动关闭
  action: {
    label: '重试',
    handler: () => retryConnection(),
  },
});

// 显示限流错误
errorToast.show({
  type: 'warning',
  title: '请求过于频繁',
  message: '请稍后再试',
  duration: 5000,
});
```

## 六、用户操作错误预防

### 6.1 发送前验证

```typescript
// 消息发送前验证
function validateBeforeSend(message: string): ValidationResult {
  // 1. 检查网络状态
  if (!navigator.onLine) {
    return { valid: false, error: 'NETWORK_ERROR', message: '网络连接已断开' };
  }

  // 2. 检查消息长度（预估 Token 数）
  const estimatedTokens = estimateTokenCount(message);
  if (estimatedTokens > MAX_CONTEXT_LENGTH) {
    return { valid: false, error: 'CONTENT_TOO_LONG', message: '消息过长，请精简内容' };
  }

  // 3. 检查是否为空
  if (!message.trim()) {
    return { valid: false, error: 'EMPTY_MESSAGE', message: '消息不能为空' };
  }

  return { valid: true };
}
```

### 6.2 防重复提交

```typescript
// 发送状态管理
const isSending = ref(false);

async function sendMessage(message: string): Promise<void> {
  if (isSending.value) {
    return; // 防止重复提交
  }

  const validation = validateBeforeSend(message);
  if (!validation.valid) {
    showError(validation.message);
    return;
  }

  isSending.value = true;
  
  try {
    await chatStore.sendMessage(message);
  } catch (error) {
    handleSendError(error);
  } finally {
    isSending.value = false;
  }
}
```

## 七、错误日志与监控

### 7.1 错误上报

```typescript
interface ErrorReport {
  type: 'api' | 'network' | 'sse' | 'ui' | 'runtime';
  code: string;
  message: string;
  stack?: string;
  context: {
    userId?: string;
    conversationId?: string;
    model?: string;
    timestamp: string;
    userAgent: string;
    url: string;
  };
}

async function reportError(error: ErrorReport): Promise<void> {
  // 本地存储，用于调试
  const errors = JSON.parse(localStorage.getItem('error_logs') || '[]');
  errors.push(error);
  localStorage.setItem('error_logs', JSON.stringify(errors.slice(-100))); // 保留最近100条

  // 发送到服务端
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/logs/error', JSON.stringify(error));
  } else {
    await fetch('/api/logs/error', {
      method: 'POST',
      body: JSON.stringify(error),
      keepalive: true,
    });
  }
}
```

### 7.2 用户反馈入口

```vue
<!-- 错误详情抽屉 -->
<template>
  <Drawer v-model:visible="showErrorDetail">
    <template #title>
      错误详情
    </template>
    <div class="error-detail">
      <div class="error-section">
        <h4>错误信息</h4>
        <pre>{{ formattedError }}</pre>
      </div>
      <div class="error-actions">
        <Button @click="copyError">复制错误信息</Button>
        <Button type="primary" @click="submitFeedback">提交反馈</Button>
      </div>
    </div>
  </Drawer>
</template>
```

## 八、总结

| 错误类型 | 处理方式 | 用户感知 |
|---------|---------|---------|
| 网络断开 | 全局提示 + 自动恢复 | 明显提示 |
| Token 过期 | 静默刷新 | 无感知 |
| 限流 | 消息内提示 + 自动重试 | 轻微提示 |
| 服务器错误 | 消息内提示 + 手动重试 | 明显提示 |
| SSE 中断 | 自动重连（最多3次） | 轻微提示 |
| 业务逻辑错误 | 针对性提示 | 明显提示 |

**核心原则**:
1. **自动恢复优先**: 能自动恢复的错误不让用户操作
2. **明确提示**: 错误信息清晰，提供解决方案
3. **保留上下文**: 错误发生时不丢失用户输入
4. **优雅降级**: 核心功能不可用时提供备选方案
