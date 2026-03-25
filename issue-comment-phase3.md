## Phase 3 分析：`assistant-manager.js` 模块拆分方案

### 📊 当前状态

文件：[`server/services/assistant-manager.js`](server/services/assistant-manager.js)
- **总行数**：2398 行
- **方法数**：35+ 个
- **职责**：配置管理、请求处理、执行引擎、视觉处理、专家通知、工具集成

---

### 📦 功能模块分析

| 模块 | 方法 | 行数 | 职责 |
|------|------|------|------|
| **配置管理** | `initialize`, `refreshAssistantsCache`, `restoreRunningRequests`, `getAssistant`, `refreshCache`, `roster`, `getAssistantDetail`, `createAssistant`, `updateAssistant`, `deleteAssistant` | ~200 | 助理配置 CRUD、缓存管理 |
| **请求管理** | `summon`, `status`, `list`, `archive`, `unarchive`, `delete`, `getMessages` | ~300 | 委托请求生命周期管理 |
| **执行引擎** | `executeRequest`, `executeAssistant`, `executeDirect`, `executeLLM`, `executeLLMWithTools`, `executeHybrid` | ~500 | 多模式执行逻辑 |
| **视觉处理** | `executeHybridVision`, `executeVisionWithInput`, `readImageFile`, `extractImageInput`, `getAllowedImagePaths`, `validateImagePath` | ~300 | 图片读取、多模态消息构建 |
| **专家通知** | `notifyExpertResult`, `pushSSENotification`, `triggerExpertResponse` | ~450 | SSE 推送、专家响应触发 |
| **工具集成** | `getAssistantTools`, `getInheritedToolDefinitions`, `executeInheritedTool`, `executeTool` | ~150 | 工具定义、继承工具执行 |

---

### 🎯 推荐拆分方案

```
server/services/assistant/
├── index.js                    # 主入口，导出 AssistantManager
├── manager.js                  # 核心管理器（~300行）
│   - 构造函数、初始化
│   - 外部服务引用（chatService, expertConnections）
│   - 协调各子模块
│
├── config-repository.js        # 配置管理（~200行）
│   - refreshAssistantsCache()
│   - getAssistant(), roster()
│   - getAssistantDetail()
│   - createAssistant(), updateAssistant(), deleteAssistant()
│
├── request-repository.js       # 请求管理（~300行）
│   - summon(), status(), list()
│   - archive(), unarchive(), delete()
│   - getMessages()
│
├── executor.js                 # 执行引擎（~500行）
│   - executeRequest()
│   - executeAssistant()
│   - executeDirect(), executeLLM()
│   - executeLLMWithTools()
│   - executeHybrid()
│
├── vision-processor.js         # 视觉处理（~300行）
│   - executeHybridVision()
│   - executeVisionWithInput()
│   - readImageFile()
│   - extractImageInput()
│   - getAllowedImagePaths(), validateImagePath()
│
├── expert-notifier.js          # 专家通知（~450行）
│   - notifyExpertResult()
│   - pushSSENotification()
│   - triggerExpertResponse()
│
└── tool-integration.js         # 工具集成（~150行）
    - getAssistantTools()
    - getInheritedToolDefinitions()
    - executeInheritedTool()
    - executeTool()
```

---

### 📐 模块依赖关系

```
                    ┌─────────────────┐
                    │   manager.js    │
                    │   (协调器)       │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ config-       │   │ request-      │   │ executor.js   │
│ repository.js │   │ repository.js │   │               │
└───────────────┘   └───────────────┘   └───────┬───────┘
                                                │
                        ┌───────────────────────┼───────────────────────┐
                        │                       │                       │
                        ▼                       ▼                       ▼
                ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
                │ vision-       │       │ expert-       │       │ tool-         │
                │ processor.js  │       │ notifier.js   │       │ integration.js│
                └───────────────┘       └───────────────┘       └───────────────┘
```

---

### ⚠️ 拆分注意事项

1. **共享依赖注入**
   - `db` 数据库实例
   - `chatService` 聊天服务
   - `expertConnections` SSE 连接池
   - `messageService` 消息服务

2. **循环依赖风险**
   - `executor.js` 需要 `tool-integration.js`
   - `expert-notifier.js` 需要 `chatService`（外部服务）
   - 解决方案：通过 `manager.js` 协调，避免直接依赖

3. **状态管理**
   - `assistantsCache` - 配置缓存
   - `requests` - 请求队列
   - `notifiedRequests` - 通知去重集合
   - 建议：保留在 `manager.js` 中，通过方法访问

---

### 📋 实施步骤

1. **创建目录结构**
   ```bash
   mkdir -p server/services/assistant
   ```

2. **按顺序拆分模块**（从低依赖到高依赖）
   - [ ] `tool-integration.js` - 无内部依赖
   - [ ] `vision-processor.js` - 仅依赖 `simple-llm-client`
   - [ ] `config-repository.js` - 仅依赖数据库
   - [ ] `request-repository.js` - 依赖 `config-repository`
   - [ ] `executor.js` - 依赖上述模块
   - [ ] `expert-notifier.js` - 依赖 `tool-calling-executor`
   - [ ] `manager.js` - 协调所有模块

3. **更新导入路径**
   - 更新 `server/controllers/assistant.controller.js`
   - 更新其他引用 `assistant-manager.js` 的文件

4. **测试验证**
   - 运行现有测试
   - 手动测试关键功能

---

### 🤔 是否需要立即执行？

**建议**：Phase 3 是一个较大的重构，建议：
1. 如果当前代码可维护，可以暂缓执行
2. 如果需要添加新功能，先完成拆分再添加
3. 优先级低于 Phase 1 和 Phase 2（已完成）

请确认是否继续执行 Phase 3 拆分？