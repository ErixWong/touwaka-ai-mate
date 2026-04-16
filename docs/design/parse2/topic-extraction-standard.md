# Topic 提炼标准设计

> 创建时间：2026-03-01
> 分支：feature/topic-extraction
> 目的：中长期记忆优化

## 问题分析

### 当前问题：话题漂移/扩大化

**现象：**
- 持续监测 topic 时，LLM 倾向于认为对话仍在"同一话题"
- 话题内容和范围不断扩大，失去细节
- 最终导致一个过于宽泛的 topic，失去了记忆索引的价值

**根本原因：**
- 从语义学角度，任何对话都可以被高度概括
- LLM 缺乏明确的"何时该拆分"的量化标准
- 没有考虑中长期记忆的实际使用场景

### Topic 的核心目的

1. **上下文压缩**：减少每次对话的 token 消耗
2. **长期记忆召回**：LLM 需要快速定位相关历史

**关键问题：如果 LLM 需要读取最近的几条 topic 来实现长期记忆，怎样的 topic 才符合要求？**

## Topic 设计原则

### 1. 聚焦性原则
- 一个 topic 应该能用 **一句话（15-25字）** 清晰描述
- 描述应该包含核心关键词，便于语义检索

### 2. 可召回性原则
- 当 LLM 查找相关记忆时，能快速判断 topic 是否相关
- 避免过于宽泛（"编程讨论"）或过于狭窄（"第3行代码"）

### 3. 独立性原则
- 每个 topic 应该相对独立，可以单独理解
- 加载 topic 上下文时不需要依赖其他 topic

## 提炼标准方案

### 方案一：关键词阈值法

**核心思路：**
- 从对话中提取关键词
- 当关键词数量超过阈值（建议 5 个）时，拆分为新 topic

**具体算法：**
```
1. 维护当前 topic 的关键词集合 K_current
2. 每轮对话后，提取新关键词 K_new
3. 计算：
   - 重叠度 = |K_current ∩ K_new| / |K_new|
   - 总关键词数 = |K_current ∪ K_new|
4. 判断：
   - 如果 总关键词数 > 5 且 重叠度 < 0.5 → 创建新 topic
```

**优点：**
- 简单直观，易于实现
- 可量化，减少 LLM 主观判断

**缺点：**
- 关键词提取质量依赖 LLM
- 可能过于机械，忽略语义关联

### 方案二：语义漂移检测法

**核心思路：**
- 使用 embedding 计算消息间的语义相似度
- 当相似度持续下降并低于阈值时，创建新 topic

**具体算法：**
```
1. 维护当前 topic 的中心向量 V_center（消息 embedding 平均值）
2. 每轮对话后，计算新消息的 embedding V_new
3. 计算：
   - 相似度 = cosine_similarity(V_center, V_new)
   - 漂移趋势 = 最近 N 条消息的相似度变化斜率
4. 判断：
   - 如果 相似度 < 0.6 且 漂移趋势 < 0 → 创建新 topic
```

**优点：**
- 基于语义，更准确
- 能捕捉隐含的话题变化

**缺点：**
- 需要额外的 embedding 计算（成本）
- 实现复杂度较高

### 方案三：混合方案（推荐）

**结合关键词和语义检测：**

```
触发条件（满足任一）：
1. 关键词数量 > 5 且 新关键词占比 > 50%
2. 语义相似度 < 0.6 且 持续下降趋势
3. 消息数量 > 30 条（硬上限，强制评估）
4. 时间跨度 > 24 小时无对话后重启

提炼标准：
- 标题：8-15 字，包含 2-3 个核心关键词
- 描述：30-50 字，概括核心问题和结论
- 关键词：3-5 个，用于语义检索
```

## Topic 数据结构建议

```json
{
  "id": "topic_xxx",
  "title": "React useMemo 性能优化",
  "description": "讨论 useMemo 的使用场景、性能提升效果及与 useCallback 的区别",
  "keywords": ["React", "useMemo", "性能优化", "缓存"],
  "category": "技术讨论",
  "message_count": 15,
  "time_span": {
    "start": "2026-03-01T08:00:00Z",
    "end": "2026-03-01T09:30:00Z"
  },
  "summary_embedding": [0.1, 0.2, ...]  // 可选：用于语义检索
}
```

## 记忆召回场景模拟

**场景：用户问"上次我们讨论的 React 优化方案是什么？"**

**理想的 Topic 列表：**
```
1. [React useMemo 性能优化] - 讨论 useMemo 使用场景... (15条)
2. [Vue3 组合式 API 实践] - setup 函数最佳实践... (12条)
3. [Node.js 内存泄漏排查] - heapdump 使用方法... (8条)
```

**LLM 处理流程：**
1. 从用户问题中提取关键词："React"、"优化"
2. 匹配到 Topic 1
3. 加载 Topic 1 的 summary 到上下文
4. 如果需要更多细节，加载 Topic 1 的消息历史

**关键：每个 Topic 都应该是独立可理解的，不需要加载其他 Topic 就能回答相关问题。**

## 关键词获取方案

### 方案对比

| 方案 | 优点 | 缺点 | 额外成本 |
|------|------|------|----------|
| A. 每轮对话返回关键词 | 实时、增量累积 | 修改 LLM 返回格式 | 无 |
| B. 定期批量提取 | 不影响对话流程 | 额外 LLM 调用 | +1 次 LLM/检测 |
| C. 复用 Reflective Mind | 无额外调用 | 需要扩展反思模板 | 无 |

### 推荐方案：C. 复用 Reflective Mind

**现有架构：**
- Reflective Mind 每轮对话后异步执行
- 已有 `topicAnalysis` 输出（isOnTopic, relevanceScore 等）

**扩展设计：**
```json
// Reflective Mind 返回结构
{
  "monologue": "内心独白...",
  "topicAnalysis": {
    "isOnTopic": true,
    "relevanceScore": 8,
    "topicShiftConfidence": 0.3
  },
  "keywords": ["React", "useMemo", "性能优化"],
  "topicSuggestion": {
    "shouldCreateNew": false,
    "reason": "继续讨论 useMemo 使用场景",
    "suggestedTitle": null
  }
}
```

**实现要点：**
1. 扩展 [`lib/reflective-mind.js`](lib/reflective-mind.js) 的提示模板
2. 在 [`lib/chat-service.js`](lib/chat-service.js:959) `performReflection` 中处理新字段
3. 维护 `currentTopicKeywords` 集合，累积关键词
4. 当关键词数量或漂移度触发阈值时，创建新 Topic

### 流程图

```
用户消息 → Expressive Mind 生成回复
                ↓
         Reflective Mind 异步反思
                ↓
         提取关键词 + 话题分析
                ↓
         更新当前 Topic 关键词累积
                ↓
         判断是否需要创建新 Topic
                ↓
         [是] → 创建新 Topic，重置关键词集合
         [否] → 继续累积
```

### 替代方案：A. Expressive Mind 返回 JSON

如果希望 Expressive Mind 直接返回结构化数据：

```json
{
  "content": "这是我的回复内容...",
  "metadata": {
    "keywords": ["React", "useMemo"],
    "intent": "技术问答"
  }
}
```

**缺点：**
- 需要 Expressive Mind 输出 JSON 格式，可能影响回复的自然性
- 或者需要后处理解析（增加复杂度）

## 下一步

1. 确认关键词获取方案（推荐复用 Reflective Mind）
2. 是否需要在 topics 表添加 `keywords` 字段？（需要 Eric 批准）
3. 实现关键词累积和阈值判断逻辑
4. 测试和调优

## 提示词设计

### 现有 Reflective Mind 提示词结构（摘要）

```json
{
  "selfEvaluation": { "score": 1-10, "breakdown": {...} },
  "nextRoundAdvice": "下一轮建议",
  "monologue": "内心独白",
  "topicAnalysis": {
    "isOnTopic": true/false,
    "topicShiftConfidence": 0.0-1.0,
    "relevanceScore": 1-10,
    "reason": "话题分析理由"
  }
}
```

### 新增字段设计

```json
{
  "selfEvaluation": { ... },
  "nextRoundAdvice": "下一轮建议",
  "monologue": "内心独白",
  "topicAnalysis": { ... },
  
  "keywords": ["React", "useMemo", "性能优化"],
  
  "topicSuggestion": {
    "shouldCreateNew": false,
    "reason": "继续讨论 useMemo 的具体用法",
    "suggestedTitle": null
  }
}
```

### 新增提示词段落

```
## 关键词提取任务
从本轮对话中提取 3-5 个核心关键词：
- 关键词应能概括本轮讨论的核心主题
- 优先选择技术术语、专有名词、核心概念
- 避免过于宽泛的词（如"问题"、"方法"、"讨论"）
- 格式：字符串数组，如 ["React", "useMemo", "性能优化"]

## 话题分裂检测任务
判断是否需要创建新话题：
- **shouldCreateNew**: 当前累积的关键词是否已经过多或偏离，需要拆分新话题
- **reason**: 判断理由
- **suggestedTitle**: 如果建议创建新话题，给出新话题标题（8-15字）

判断标准：
- 如果当前话题的关键词数量超过 5 个，且新关键词与现有话题关联度低，建议拆分
- 如果用户提出了完全不同领域的问题，建议拆分
- 如果是对同一主题的深入追问，不建议拆分
```

### 完整 JSON 输出格式

```json
{
  "selfEvaluation": {
    "score": 1-10,
    "breakdown": {
      "valueAlignment": 1-10,
      "behaviorAdherence": 1-10,
      "tabooCheck": 1-10,
      "emotionalTone": 1-10
    },
    "reason": "评分理由"
  },
  "nextRoundAdvice": "下一轮的具体建议",
  "monologue": "内心独白（第一人称）",
  "topicAnalysis": {
    "isOnTopic": true/false,
    "topicShiftConfidence": 0.0-1.0,
    "relevanceScore": 1-10,
    "reason": "话题分析理由"
  },
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "topicSuggestion": {
    "shouldCreateNew": true/false,
    "reason": "判断理由",
    "suggestedTitle": "新话题标题（如果 shouldCreateNew 为 true）"
  }
}
```

---

*待 Eric 确认提示词设计后开始实现...*