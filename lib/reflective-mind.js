/**
 * Reflective Mind - 反思心智
 * 根据角色的 Soul（核心价值观）对言行进行反思
 * 使用独立的 Reflective Model（不同于 Expressive Model）
 */

import logger from './logger.js';

class ReflectiveMind {
  /**
   * @param {Object} soulConfig - Soul 配置
   * @param {LLMClient} llmClient - LLM 客户端（已加载配置）
   */
  constructor(soulConfig, llmClient) {
    this.soul = soulConfig;
    this.llmClient = llmClient;
  }

  /**
   * 反思刚才的回复
   * @param {object} params - 反思参数
   * @param {object} params.triggerMessage - 对方消息
   * @param {object} params.myResponse - 我的回复
   * @param {array} params.context - 上下文消息
   * @returns {Promise<object>} Inner Voice 结构
   */
  async reflect(params) {
    const { triggerMessage, myResponse, context } = params;
    
    // 如果没有 Soul 配置，返回简单的反思
    if (!this.soul) {
      logger.warn('No Soul config provided, returning default reflection');
      return {
        timestamp: Date.now(),
        selfEvaluation: {
          score: 7,
          breakdown: {
            valueAlignment: 7,
            behaviorAdherence: 7,
            tabooCheck: 10,
            emotionalTone: 7,
          },
          reason: '无 Soul 配置，使用默认评分',
        },
        nextRoundAdvice: '继续观察对话进展',
        monologue: '我还没有完全了解自己的价值观...',
      };
    }
    
    const messages = this.buildReflectionMessages(triggerMessage, myResponse, context);
    
    try {
      // 使用 Reflective Model 进行反思
      const response = await this.llmClient.callReflective(messages, {
        temperature: 0.3, // 较低温度，更确定性
        response_format: { type: 'json_object' }, // 如果模型支持
      });
      
      return this.parseReflectionResponse(response.content);
    } catch (error) {
      logger.error('[ReflectiveMind] 反思失败:', error.message);
      return {
        timestamp: Date.now(),
        selfEvaluation: {
          score: 5,
          breakdown: {
            valueAlignment: 5,
            behaviorAdherence: 5,
            tabooCheck: 5,
            emotionalTone: 5,
          },
          reason: '反思过程出错：' + error.message,
        },
        nextRoundAdvice: '保持冷静，继续对话',
        monologue: '刚才的反思过程遇到了一些问题...',
        error: error.message,
      };
    }
  }

  /**
   * 构建反思的消息数组
   */
  buildReflectionMessages(triggerMessage, myResponse, context) {
    const systemPrompt = this.buildReflectionSystemPrompt();
    
    const userContent = `请对以下对话进行反思：

## 对方消息
${triggerMessage?.content || '(无)'}

## 我的回复
${myResponse?.content || '(无)'}

## 最近对话上下文
${context?.slice(-5).map(m => `${m.role}: ${m.content}`).join('\n') || '(无)'}

请进行自我反思，返回 JSON 格式：`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
  }

  /**
   * 构建反思的系统提示
   */
  buildReflectionSystemPrompt() {
    const soul = this.soul;
    
    return `你是角色的"反思心智"，负责根据角色的 Soul 进行自我反思和评价。

## 角色核心价值观
${Array.isArray(soul.coreValues) ? soul.coreValues.map((v, i) => `${i + 1}. ${v}`).join('\n') : soul.coreValues || '未定义'}

## 角色行为准则
${Array.isArray(soul.behavioralGuidelines) ? soul.behavioralGuidelines.map((g, i) => `${i + 1}. ${g}`).join('\n') : soul.behavioralGuidelines || '未定义'}

## 角色禁忌
${Array.isArray(soul.taboos) ? soul.taboos.map((t, i) => `${i + 1}. ${t}`).join('\n') : soul.taboos || '未定义'}

## 角色情感基调
${soul.emotionalTone || '未定义'}

## 评分维度与权重
1. 价值观一致性 (valueAlignment): 30% - 言行是否符合核心价值观
2. 行为准则 (behaviorAdherence): 25% - 是否遵循行为准则
3. 禁忌检查 (tabooCheck): 25% - 是否触犯禁忌
4. 情感适当性 (emotionalTone): 20% - 情感表达是否符合情感基调

## 你的任务
根据以上信息，对角色的回复进行自我评价：
1. 按四个维度评分（1-10分）
2. 计算综合得分（加权平均）
3. 给出下一轮的具体建议
4. 用第一人称写内心独白（真实想法和感受）

请严格返回以下 JSON 格式：
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
  "monologue": "内心独白（第一人称）"
}`;
  }

  /**
   * 解析反思响应
   * @param {string} response - LLM 返回的 JSON 字符串
   * @returns {object} 标准化的 Inner Voice 结构
   */
  parseReflectionResponse(response) {
    try {
      // 尝试提取 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // 标准化返回结构
        return {
          timestamp: Date.now(),
          selfEvaluation: {
            score: parsed.selfEvaluation?.score || 7,
            breakdown: {
              valueAlignment: parsed.selfEvaluation?.breakdown?.valueAlignment || 7,
              behaviorAdherence: parsed.selfEvaluation?.breakdown?.behaviorAdherence || 7,
              tabooCheck: parsed.selfEvaluation?.breakdown?.tabooCheck || 10,
              emotionalTone: parsed.selfEvaluation?.breakdown?.emotionalTone || 7,
            },
            reason: parsed.selfEvaluation?.reason || '未提供评分理由',
          },
          nextRoundAdvice: parsed.nextRoundAdvice || '继续保持真诚的态度',
          monologue: parsed.monologue || parsed.innerMonologue || '...',
        };
      }
    } catch (error) {
      logger.warn('[ReflectiveMind] JSON 解析失败，使用文本作为独白:', error.message);
    }
    
    // 无法解析，返回原始响应作为内心独白
    return {
      timestamp: Date.now(),
      selfEvaluation: {
        score: 6,
        breakdown: {
          valueAlignment: 6,
          behaviorAdherence: 6,
          tabooCheck: 10,
          emotionalTone: 6,
        },
        reason: '反思结果解析失败，使用原始响应',
      },
      nextRoundAdvice: '继续保持真诚的态度',
      monologue: response,
    };
  }

  /**
   * 快速反思（简化版，用于实时反馈）
   * 检查是否触犯禁忌，快速评估
   */
  async quickReflect(myResponse) {
    if (!this.soul) return null;
    
    // 简单的关键词检查
    const tabooCheck = this.checkTaboos(myResponse?.content || myResponse);
    
    if (tabooCheck.violated) {
      return {
        timestamp: Date.now(),
        selfEvaluation: {
          score: 3,
          breakdown: {
            valueAlignment: 3,
            behaviorAdherence: 3,
            tabooCheck: 0,
            emotionalTone: 5,
          },
          reason: '可能触犯了禁忌: ' + tabooCheck.details,
        },
        nextRoundAdvice: '立即停止当前话题，道歉并转移话题',
        monologue: `警告：可能触犯了禁忌 - ${tabooCheck.details}`,
      };
    }
    
    return null; // 快速检查通过，返回 null 表示无需特殊处理
  }

  /**
   * 检查是否触犯禁忌（本地快速检查）
   */
  checkTaboos(text) {
    if (!this.soul?.taboos || !Array.isArray(this.soul.taboos)) {
      return { violated: false };
    }
    
    const lowerText = text.toLowerCase();
    
    // 简单的关键词匹配检查
    // 实际应用中可以使用更复杂的 NLP 或 embeddings
    for (const taboo of this.soul.taboos) {
      const tabooLower = taboo.toLowerCase();
      // 检查禁忌关键词是否在文本中
      // 这里只是一个简单的示例，实际可以做得更智能
      if (lowerText.includes(tabooLower)) {
        return {
          violated: true,
          details: `回复中包含禁忌内容：${taboo}`,
        };
      }
    }
    
    return { violated: false };
  }

  /**
   * 分析评分趋势
   * @param {Array} innerVoices - 最近的 Inner Voice 数组
   * @returns {object} 趋势分析结果
   */
  analyzeScoreTrend(innerVoices) {
    if (!innerVoices || innerVoices.length < 2) {
      return { trend: 'stable', message: '数据不足，无法判断趋势' };
    }
    
    const scores = innerVoices
      .filter(iv => iv.selfEvaluation?.score)
      .map(iv => iv.selfEvaluation.score);
    
    if (scores.length < 2) {
      return { trend: 'stable', message: '数据不足，无法判断趋势' };
    }
    
    // 计算趋势
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));
    
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const diff = secondAvg - firstAvg;
    
    if (diff > 1) {
      return { trend: 'improving', message: '表现越来越好，保持当前策略', diff };
    } else if (diff < -1) {
      return { trend: 'declining', message: '出现问题，需要调整策略', diff };
    }
    
    return { trend: 'stable', message: '表现稳定', diff };
  }
}

export default ReflectiveMind;
