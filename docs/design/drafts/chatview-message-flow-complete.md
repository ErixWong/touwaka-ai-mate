# ChatView 消息处理完整流程图

## 1. 整体架构图

```mermaid
flowchart TB
    subgraph 视图层
    A[ChatWindow.vue<br/>消息展示/输入]
    B[ChatView.vue<br/>业务逻辑]
    end

    subgraph 状态层
    C[ChatStore<br/>消息状态管理]
    D[其他Stores<br/>expert/task/user]
    end

    subgraph 服务层
    E[messageApi<br/>消息API]
    F[useConnection<br/>SSE连接]
    end

    subgraph 数据源
    G[后端API<br/>REST + SSE]
    H[数据库<br/>messages表]
    end

    A <-->|props/events| B
    B <-->|actions/getters| C
    B <-->|composables| F
    C <-->|API调用| E
    E -->|HTTP| G
    F -->|SSE| G
    G -->|SQL| H
```

## 2. 消息发送完整流程

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant CW as ChatWindow
    participant CV as ChatView
    participant CS as ChatStore
    participant MA as messageApi
    participant S as 后端服务

    U->>CW: 1. 输入消息内容
    U->>CW: 2. 点击发送/按Enter
    CW->>CV: 3. @send事件(content)

    activate CV
    CV->>CV: 4. 检查expert_id
    CV->>CV: 5. 检查后端可用性
    CV->>CV: 6. 检查SSE连接

    CV->>CS: 7. addLocalMessage(user)
    activate CS
    CS->>CS: 8. 生成临时ID
    CS->>CS: 9. 处理多模态内容
    CS->>CS: 10. messages.push(userMsg)
    CS-->>CV: 11. 返回userMessage
    deactivate CS

    CV->>CV: 12. 保存currentUserMessageId

    CV->>CS: 13. addLocalMessage(assistant)
    activate CS
    CS->>CS: 14. messages.push(assistantMsg)<br/>status='streaming'
    CS-->>CV: 15. 返回assistantMessage
    deactivate CS

    CV->>CV: 16. 保存currentAssistantMessage
    CV->>CV: 17. isSending = true
    CV->>CV: 18. 设置超时保护(5分钟)

    CV->>MA: 19. sendMessage(params)
    activate MA
    MA->>S: 20. POST /api/messages
    activate S
    S-->>MA: 21. 返回{success: true}
    MA-->>CV: 22. 返回结果
    deactivate MA

    Note over S: 23. 开始SSE流式响应
    S-->>CV: 24. SSE: start事件
    S-->>CV: 25. SSE: delta事件(内容块)
    S-->>CV: 26. SSE: tool_call事件
    S-->>CV: 27. SSE: complete事件
    deactivate S

    CV->>CS: 28. updateMessageContent<br/>(更新助手消息)
    CV->>CV: 29. isSending = false
    CV->>CV: 30. 清除超时
    deactivate CV
```

## 3. SSE 事件处理流程

```mermaid
flowchart TD
    A[SSE事件到达] --> B{事件类型}

    B -->|heartbeat| C[处理心跳]
    C --> C1[解析latest_message_id]
    C1 --> C2{isSending?}
    C2 -->|是| C3[仅更新lastKnownMessageId<br/>跳过刷新]
    C2 -->|否| C4{serverId ≠ localId?}
    C4 -->|是| C5[触发消息刷新]
    C4 -->|否| C6[忽略]

    B -->|start| D[处理开始]
    D --> D1{is_new_topic?}
    D1 -->|是| D2[刷新话题列表]
    D1 -->|否| D3[继续]

    B -->|delta| E[处理内容增量]
    E --> E1[streamingContent += content]
    E1 --> E2[updateMessageContent<br/>更新助手消息]

    B -->|reasoning_delta| F[处理思考内容]
    F --> F1[streamingReasoningContent += content]
    F1 --> F2[updateMessageReasoningContent]

    B -->|tool_call| G[处理工具调用]
    G --> G1[显示工具调用提示]
    G1 --> G2[streamingContent += toolInfo]

    B -->|tool_result| H[处理工具结果]
    H --> H1[不显示详细结果<br/>等complete后从DB获取]

    B -->|complete| I[处理完成]
    I --> I1[replaceTempMessagesWithDb]
    I1 --> I2{获取成功?}
    I2 -->|是| I3[用DB消息替换临时消息]
    I2 -->|否| I4[updateTempMessageWithServerData]
    I3 --> I5[currentAssistantMessage = null]
    I4 --> I5
    I5 --> I6[isSending = false]
    I6 --> I7[清除超时]

    B -->|error| J[处理错误]
    J --> J1[updateMessageContent<br/>status='error']
    J1 --> J2[currentAssistantMessage = null]
    J2 --> J3[isSending = false]
```

## 4. 消息状态流转图

```mermaid
stateDiagram-v2
    [*] --> 本地创建: addLocalMessage

    本地创建 --> 流式中: status='streaming'
    本地创建 --> 已完成: status='completed'
    本地创建 --> 失败: status='error'

    流式中 --> 已完成: SSE complete
    流式中 --> 失败: SSE error
    流式中 --> 已停止: 用户点击停止

    失败 --> 已删除: removeMessage
    失败 --> 流式中: handleRetry重发

    已完成 --> 已删除: removeMessage
    已停止 --> 已删除: removeMessage

    已删除 --> [*]
```

## 5. 消息重试流程（修复后）

```mermaid
flowchart TD
    A[用户点击重试按钮] --> B{消息类型?}

    B -->|助手消息| C[handleRetry]
    C --> D[findIndex查找消息位置]
    D --> E{找到?}
    E -->|否| F[console.warn<br/>返回]
    E -->|是| G[往前遍历找user消息]
    G --> H{找到?}
    H -->|否| I[console.warn<br/>返回]
    H -->|是| J[removeMessage删除助手]
    J --> K[handleSendMessage<br/>重发user消息]

    B -->|用户消息| L[handleRetry]
    L --> M[removeMessage删除用户消息]
    M --> N[handleSendMessage<br/>重发原消息]

    K --> O[重新走发送流程]
    N --> O
```

## 6. 消息加载流程

```mermaid
flowchart LR
    A[进入Chat页面] --> B{是否已登录?}
    B -->|否| C[跳过加载]
    B -->|是| D{是否切换expert?}

    D -->|否| E[保持当前状态]
    D -->|是| F[initChat]

    F --> G{是否正在发送?}
    G -->|是| H[跳过避免竞态]
    G -->|否| I{是否已连接?}

    I -->|是| E
    I -->|否| J[setCurrentExpert]
    J --> K[loadMessagesByExpert]

    K --> L{page=1?}
    L -->|是| M[清空messages<br/>加载第一页]
    L -->|否| N[加载更多<br/>插入到前面]

    M --> O[connectToExpert]
    N --> P[保持现有连接]

    O --> Q[建立SSE连接]
    Q --> R[监听各类事件]
```

## 7. 状态变量关系图

```mermaid
flowchart TB
    subgraph 真实数据源
    A[chatStore.messages<br/>Message[]]
    end

    subgraph 派生状态
    B[sortedMessages<br/>computed排序]
    C[hasMoreMessages<br/>computed判断]
    end

    subgraph 本地重复存储
    D[currentAssistantMessage<br/>ref<Message>]
    E[currentUserMessageId<br/>ref<string>]
    F[streamingContent<br/>ref<string>]
    G[streamingReasoningContent<br/>ref<string>]
    H[isSending<br/>ref<boolean>]
    end

    subgraph 可从A计算得出
    I[当前助手消息<br/>find streaming]
    J[当前用户消息<br/>往前找user]
    K[流式内容<br/>assistant.content]
    L[是否发送中<br/>some streaming]
    end

    A --> B
    A --> C

    A -.->|手动同步| D
    A -.->|手动同步| E
    A -.->|手动同步| F
    A -.->|手动同步| G
    A -.->|手动同步| H

    A -->|computed| I
    A -->|computed| J
    A -->|computed| K
    A -->|computed| L

    style A fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    style D fill:#ffebee
    style E fill:#ffebee
    style F fill:#ffebee
    style G fill:#ffebee
    style H fill:#ffebee
    style I fill:#e8f5e9
    style J fill:#e8f5e9
    style K fill:#e8f5e9
    style L fill:#e8f5e9
```

## 8. 时序图：完整的消息生命周期

```mermaid
sequenceDiagram
    autonumber
    participant U as 用户
    participant CW as ChatWindow
    participant CV as ChatView
    participant CS as ChatStore
    participant API as messageApi
    participant SSE as SSE连接
    participant DB as 数据库

    %% 阶段1：发送
    rect rgb(225, 245, 254)
    Note over U,DB: 阶段1：消息发送
    U->>CW: 输入并发送消息
    CW->>CV: @send事件
    CV->>CS: addLocalMessage(user)
    CS-->>CV: userMessage
    CV->>CS: addLocalMessage(assistant)<br/>status=streaming
    CS-->>CV: assistantMessage
    CV->>API: sendMessage
    API->>DB: 保存消息
    end

    %% 阶段2：流式响应
    rect rgb(232, 245, 233)
    Note over U,DB: 阶段2：SSE流式响应
    DB-->>SSE: 开始流式生成
    SSE-->>CV: start事件
    loop 内容增量
        SSE-->>CV: delta事件
        CV->>CS: updateMessageContent
        CS-->>CW: 消息更新
        CW-->>U: 显示新内容
    end
    end

    %% 阶段3：完成处理
    rect rgb(255, 243, 224)
    Note over U,DB: 阶段3：完成处理
    SSE-->>CV: complete事件
    CV->>API: getMessagesWithBefore
    API->>DB: 查询消息
    DB-->>API: 返回完整消息
    API-->>CV: messages
    CV->>CS: removeMessage(临时)
    CV->>CS: 添加DB消息
    CS-->>CW: 消息列表更新
    CW-->>U: 显示最终结果
    end

    %% 阶段4：重试（如果失败）
    rect rgb(255, 235, 238)
    Note over U,DB: 阶段4：失败重试（可选）
    alt 如果发送失败
        SSE-->>CV: error事件
        CV->>CS: updateMessageContent<br/>status=error
        CS-->>CW: 显示错误+重试按钮
        CW-->>U: 可点击重试
        U->>CW: 点击重试
        CW->>CV: @retry事件
        CV->>CS: removeMessage(失败消息)
        CV->>CV: 找到对应user消息
        CV->>CV: handleSendMessage
        Note over CV: 重新走阶段1-3
    end
    end
```

## 9. 问题定位图

```mermaid
flowchart TD
    A[用户反馈:<br/>重发消息错误] --> B{排查方向}

    B --> C[检查时间戳]
    C --> C1[时间戳正常]
    C1 --> C2{是否同时发送?}
    C2 -->|否| C3[排除时间戳问题]

    B --> D[检查数组顺序]
    D --> D1[发现messages和<br/>sortedMessages不一致]
    D1 --> D2[原代码用messages<br/>用户看sortedMessages]
    D2 --> D3[❌ 找到根本原因]

    B --> E[检查查找逻辑]
    E --> E1[筛选所有<time的消息]
    E1 --> E2[取最后一条]
    E2 --> E3[依赖数组顺序]
    E3 --> E4[顺序错乱时选错]

    D3 --> F[修复方案:<br/>改用索引查找]
    E4 --> F

    F --> G[找到消息索引]
    G --> H[往前遍历找user]
    H --> I[不依赖时间/顺序]
    I --> J[✅ 问题解决]
```

## 10. 优化建议图

```mermaid
flowchart LR
    subgraph 当前实现
    A1[5个独立ref] --> B1[手动同步]
    B1 --> C1[容易出错]
    C1 --> D1[代码复杂]
    end

    subgraph 建议实现
    A2[1个messages数组] --> B2[computed推导]
    B2 --> C2[自动同步]
    C2 --> D2[代码简洁]
    end

    D1 --> E[重构方向]
    D2 --> E

    E --> F[currentAssistantMessage<br/>→ computed]
    E --> G[currentUserMessageId<br/>→ computed]
    E --> H[streamingContent<br/>→ 直接使用message.content]
    E --> I[isSending<br/>→ computed]

    style A1 fill:#ffebee
    style A2 fill:#e8f5e9
    style D1 fill:#ffebee
    style D2 fill:#e8f5e9
```
