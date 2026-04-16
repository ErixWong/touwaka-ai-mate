# V1 vs V2 技能加载设计对比

## V1 Mind Core - 当前设计 (全量加载)

### 代码位置
- `index.js:196-230` - 消息处理流程
- `lib/tool-manager.js:128-137` - 获取工具定义

### 当前实现

```javascript
// index.js 处理流程
async handleMessage(contactId, content) {
  // ...
  
  // 5. 获取工具定义 - 加载专家启用的所有技能
  const tools = this.toolManager.getToolDefinitions();
  // 如果专家启用20个技能，tools 可能包含 5000+ tokens 的定义
  
  // 6. 将所有工具一次性传给 LLM
  const llmResponse = await this.llmClient.callExpressive(context.messages, { tools });
}
```

```javascript
// lib/tool-manager.js:128-137
getToolDefinitions() {
  const definitions = [];
  
  for (const skill of this.skills.values()) {
    const tools = this.skillLoader.getToolDefinitions(skill);
    definitions.push(...tools);  // 所有技能的工具都加入
  }
  
  return definitions;  // 全量返回
}
```

### 问题

| 问题 | 说明 |
|------|------|
| 上下文膨胀 | 专家启用20个技能 → 工具定义占用 5000+ tokens |
| 资源浪费 | 当前对话只需要"天气查询"，但 LLM 能看到所有工具 |
| 成本增加 | 不必要的 token 消耗增加 API 费用 |
| 可能干扰 | 过多工具选项可能降低 LLM 选择正确工具的准确率 |

---

## V2 Task Orchestrator - 设计目标 (RAG + 动态加载)

### 设计文档
`docs/v2/task-layer-design.md` 第 4.2 节 "技能加载策略"

### 核心设计

```javascript
// V2 的设计方案（尚未实现）
class TaskOrchestrator {
  async loadSkillsByVectorQuery(taskDescription) {
    // 1. 将任务描述向量化
    const embedding = await this.getEmbedding(taskDescription);
    
    // 2. 向量检索最相关的技能
    const relevantSkills = await this.db.query(`
      SELECT s.*, 
             1 - (e.embedding <=> ?) AS similarity
      FROM skill_embeddings e
      JOIN skills s ON e.skill_id = s.id
      WHERE s.is_active = TRUE
      ORDER BY similarity DESC
      LIMIT 5  -- 只加载最相关的5个
    `, [embedding]);
    
    // 3. 动态构建 Toolbox
    const toolbox = relevantSkills.map(s => ({
      name: s.id,
      description: s.description,
      parameters: s.parameters,  // 只包含必要参数定义
    }));
    
    // 4. 将 Toolbox 放入 System Prompt
    return toolbox;
  }
}
```

### V2 流程

```
用户消息 → 向量化 → 向量检索Top5技能 → 动态构建Toolbox → 放入System Prompt → LLM调用
```

---

## 方案对比

| 维度 | V1 全量加载 | V2 RAG 动态加载 |
|------|------------|----------------|
| **上下文占用** | 所有工具定义 (5000+ tokens) | 仅相关工具 (1000左右) |
| **Token 消耗** | 高 | 低 |
| **工具选择准确率** | 可能选错 | 更精准匹配 |
| **实现复杂度** | 简单 | 需要向量索引 |
| **响应延迟** | 快 | 多一次向量查询 |
| **适用场景** | 技能少 (<10个) | 技能多 (50+) |

---

## 建议的 V1 过渡方案

在 V1 中可以先实现**轻量级关键词匹配**，不需要完整向量：

```javascript
// lib/tool-manager.js
async getRelevantTools(currentMessage, limit = 5) {
  const allTools = this.getToolDefinitions();
  
  // 关键词匹配
  const keywords = currentMessage.toLowerCase().split(/\s+/);
  const scored = allTools.map(tool => {
    const desc = (tool.function?.description || '').toLowerCase();
    const name = (tool.function?.name || '').toLowerCase();
    const score = keywords.filter(k => 
      desc.includes(k) || name.includes(k)
    ).length;
    return { tool, score };
  });
  
  // 返回得分最高的 N 个
  const relevant = scored
    .filter(t => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(t => t.tool);
  
  // 如果没有匹配，返回最常用的几个
  return relevant.length > 0 ? relevant : allTools.slice(0, limit);
}
```

### V1 调用处修改

```javascript
// index.js:196
// 从全量加载改为智能选择
const tools = await this.toolManager.getRelevantTools(content, 5);
```

### 过渡方案优势

1. **无需向量索引** - 适合 V1 快速部署
2. **减少上下文** - 从 20 个工具减少到 5 个
3. **保持简单** - 不增加架构复杂度
4. **可平滑升级** - 后续可替换为向量检索

---

## 总结

| 版本 | 技能加载策略 | 状态 |
|------|------------|------|
| **V1 当前** | 全量加载所有启用技能 | 已实现，需优化 |
| **V1 改进** | 关键词匹配过滤 | 建议实现 |
| **V2 目标** | 向量检索动态加载 | 设计中 |

V1 的"工具调用结果上下文膨胀"是指：工具执行后的返回结果（如搜索返回的大量数据）直接追加到消息数组，没有长度限制，可能撑爆上下文窗口。这与技能加载是两个不同的问题。
