# 消息重发逻辑流程图

> **状态：已修复** | 相关 Issue 已关闭
>
> 本文档记录了消息重发问题的分析和修复过程。

## 1. 原代码的问题流程

```mermaid
flowchart TD
    A[用户点击重试按钮<br/>助手消息B'失败] --> B{查找对应的<br/>用户消息}
    
    B --> C[使用 chatStore.messages<br/>原始数组]
    C --> D[筛选所有 time < B' 的用户消息]
    D --> E[得到: [用户A, 用户B]]
    E --> F[取最后一条: 用户B]
    
    B --> G[用户看到的是<br/>chatStore.sortedMessages]
    G --> H[按时间排序后:<br/>[用户A, 助手A', 用户B, 助手B']]
    H --> I[用户认为B'前面是B]
    
    F --> J{messages数组<br/>实际顺序}
    J --> K[可能是:<br/>[用户B, 用户A, 助手A', 助手B']]
    K --> L[筛选出 [用户B, 用户A]]
    L --> M[取最后一条 = 用户A]
    
    M --> N[❌ 错误！<br/>重发了用户A的消息]
    I --> O[用户期望重发B]
    
    N --> P[用户困惑:<br/>"为什么重发的不是B?"]
    O --> P
```

## 2. 修复后的正确流程

```mermaid
flowchart TD
    A[用户点击重试按钮<br/>助手消息B'失败] --> B[在messages数组中<br/>找到B'的索引]
    B --> C{找到索引?}
    C -->|否| D[输出警告日志<br/>直接返回]
    C -->|是| E[从索引往前遍历]
    
    E --> F{找到第一条<br/>用户消息?}
    F -->|否| G[输出警告日志<br/>直接返回]
    F -->|是| H[找到用户B]
    
    H --> I[删除失败的助手B']
    I --> J[重发用户B的消息]
    J --> K[✅ 正确！<br/>重发了用户期望的消息]
```

## 3. 核心问题对比

```mermaid
flowchart LR
    subgraph 原代码问题
    A1[依赖时间戳筛选] --> B1[取最后一条]
    B1 --> C1[可能选错消息]
    end
    
    subgraph 修复后
    A2[依赖索引位置] --> B2[往前找第一条]
    B2 --> C2[一定选对消息]
    end
    
    C1 --> D[❌ 错误]
    C2 --> E[✅ 正确]
```

## 4. 状态重复问题示意图

```mermaid
flowchart TD
    subgraph 数据源
    A[chatStore.messages<br/>唯一真实数据源]
    end
    
    subgraph 重复存储
    B[currentAssistantMessage<br/>本地ref]
    C[currentUserMessageId<br/>本地ref]
    D[streamingContent<br/>本地ref]
    E[isSending<br/>本地ref]
    end
    
    subgraph 计算得出
    F[当前助手消息<br/>可从A计算]
    G[当前用户消息ID<br/>可从A计算]
    H[流式内容<br/>可从A计算]
    I[是否发送中<br/>可从A计算]
    end
    
    A -.->|手动同步| B
    A -.->|手动同步| C
    A -.->|手动同步| D
    A -.->|手动同步| E
    
    A -->|computed| F
    A -->|computed| G
    A -->|computed| H
    A -->|computed| I
    
    style A fill:#e3f2fd
    style B fill:#ffebee
    style C fill:#ffebee
    style D fill:#ffebee
    style E fill:#ffebee
    style F fill:#e8f5e9
    style G fill:#e8f5e9
    style H fill:#e8f5e9
    style I fill:#e8f5e9
```

## 5. 完整的消息发送与重试流程

```mermaid
sequenceDiagram
    participant U as 用户
    participant CW as ChatWindow
    participant CV as ChatView
    participant CS as ChatStore
    
    %% 正常发送流程
    U->>CW: 输入消息B并发送
    CW->>CV: @send事件
    CV->>CS: addLocalMessage(用户B)
    CS-->>CV: 返回userMessage
    CV->>CS: addLocalMessage(助手B', streaming)
    CS-->>CV: 返回assistantMessage
    
    %% 发送失败
    Note over CV: SSE返回error事件
    CV->>CS: updateMessageContent(B', error)
    CS-->>CW: 消息状态更新
    CW->>U: 显示错误+重试按钮
    
    %% 点击重试
    U->>CW: 点击重试按钮
    CW->>CV: @retry事件(消息B')
    
    alt 原代码逻辑
        CV->>CS: 读取messages数组
        Note over CV: 筛选time < B'的消息<br/>取最后一条
        CS-->>CV: 可能返回用户A
        CV->>CS: removeMessage(B')
        CV->>CS: addLocalMessage(用户A)
        Note over U: ❌ 用户困惑：为什么重发A？
    else 修复后逻辑
        CV->>CS: 读取messages数组
        Note over CV: 找到B'索引<br/>往前找第一条user
        CS-->>CV: 返回用户B
        CV->>CS: removeMessage(B')
        CV->>CS: addLocalMessage(用户B)
        Note over U: ✅ 正确重发B
    end
```
