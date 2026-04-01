/**
 * Reflection Service - 反思服务
 * 调用 LLM 生成新的 Psyche，实现自动反思更新
 */

import logger from '../logger.js';

/**
 * 反思服务类
 * 负责调用 LLM 分析对话并生成 Psyche 更新
 */
export class ReflectionService {
  constructor(llmClient, config = {}) {
    this.llmClient = llmClient;
    this.config = {
      model: config.model || 'gpt-4o-mini',
      temperature: config.temperature || 0.3,
      maxTokens: config.maxTokens || 2000,
      lookbackRounds: config.lookbackRounds || 4,
      ...config
    };
  }

  /**
   * 执行反思，生成 Psyche 更新
   * @param {Object} currentPsyche - 当前 Psyche 数据
   * @param {Array} recentMessages - 最近对话消息
   * @param {Object} options - 额外选项
   * @returns {Object} 反思结果，用于更新 Psyche
   */
  async reflect(currentPsyche, recentMessages, options = {}) {
    const prompt = this._buildReflectionPrompt(currentPsyche, recentMessages, options);
    
    try {
      logger.debug('[ReflectionService] 开始反思...');
      const response = await this.llmClient.complete({
        model: this.config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM 返回空内容');
      }

      const reflection = JSON.parse(content);
      logger.debug('[ReflectionService] 反思完成');
      return reflection;
    } catch (error) {
      logger.error('[ReflectionService] 反思失败:', error.message);
      // 返回最小化的更新，避免中断流程
      return this._createFallbackReflection(currentPsyche, recentMessages);
    }
  }

  /**
   * 构建反思 Prompt
   */
  _buildReflectionPrompt(currentPsyche, recentMessages, options) {
    const messagesText = recentMessages.map((msg, idx) => {
      const role = msg.role === 'user' ? '用户' : 'AI';
      return `[${idx + 1}] ${role}: ${msg.content?.substring(0, 500) || ''}`;
    }).join('\n\n');

    const currentPsycheText = JSON.stringify(currentPsyche, null, 2);

    return `你是一位专业的对话分析师。请分析以下对话，更新"心神"(Psyche)状态。

## 当前心神状态
\`\`\`json
${currentPsycheText}
\`\`\`

## 最近 ${recentMessages.length} 轮对话
${messagesText}

## 任务
请分析对话内容，生成心神更新。输出必须是有效的 JSON 格式：

\`\`\`json
{
  "session_meta": {
    "current_topic": "当前讨论的主题",
    "user_intent": "用户意图",
    "conversation_round": 对话轮次数字
  },
  "methodology": {
    "approach": "采用的方法论",
    "current_phase": "当前阶段 (init/clarification/execution/review/complete)",
    "next_action": "下一步行动"
  },
  "key_exchange": {
    "round": 当前轮次,
    "summary": "本轮对话的关键内容摘要"
  },
  "key_decisions": ["关键决策1", "关键决策2"],
  "pending_questions": ["待确认问题1", "待确认问题2"],
  "notes_refs": [
    {"id": "笔记标识", "summary": "笔记摘要", "relevance": 0.9}
  ],
  "topics_context": [
    {"topic_id": 123, "title": "主题标题", "relevance": 0.95}
  ],
  "working_memory": {
    "calculated_values": {"key": "value"},
    "temp_notes": "临时笔记内容"
  }
}
\`\`\`

注意：
1. 只输出 JSON，不要其他内容
2. 如果某部分没有变化，可以省略该字段
3. 保持简洁，不要包含过多细节
4. 确保 JSON 格式正确`;
  }

  /**
   * 创建回退反思结果（当 LLM 调用失败时）
   */
  _createFallbackReflection(currentPsyche, recentMessages) {
    const lastMessage = recentMessages[recentMessages.length - 1];
    const round = (currentPsyche.session_meta?.conversation_round || 0) + 1;

    return {
      session_meta: {
        conversation_round: round,
        last_updated: new Date().toISOString()
      },
      key_exchange: {
        round: round,
        summary: lastMessage?.content?.substring(0, 100) || '继续对话'
      }
    };
  }

  /**
   * 批量反思（用于历史消息重建 Psyche）
   */
  async reflectBatch(messages, batchSize = 4) {
    const reflections = [];
    
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const reflection = await this.reflect(
        i === 0 ? {} : reflections[reflections.length - 1],
        batch
      );
      reflections.push(reflection);
    }

    return reflections;
  }
}

export default ReflectionService;  
