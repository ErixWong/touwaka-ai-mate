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
   * @param {object} params.topicInfo - 话题信息 { title, description, currentKeywords }
   * @param {array} params.recentTopics - 最近的话题列表（用于校验总结是否准确）
   * @returns {Promise<object>} Inner Voice 结构
   */
  async reflect(params) {
    const { triggerMessage, myResponse, context, topicInfo, recentTopics } = params;

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
        topicAnalysis: {
          isOnTopic: true,
          topicShiftConfidence: 0.5,
          relevanceScore: 7,
          reason: '无 Soul 配置，无法判断话题相关性',
        },
        keywords: [],
        topicSuggestion: {
          shouldCreateNew: false,
          reason: '无 Soul 配置',
          suggestedTitle: null,
        },
      };
    }

    const messages = this.buildReflectionMessages({ triggerMessage, myResponse, context, topicInfo, recentTopics });

    try {
      // 使用 Reflective Model 进行反思
      // temperature 由 llmClient.callReflective 从专家配置中读取
      const response = await this.llmClient.callReflective(messages, {
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
        topicAnalysis: {
          isOnTopic: true,
          topicShiftConfidence: 0.5,
          relevanceScore: 5,
          reason: '反思过程出错：' + error.message,
        },
        keywords: [],
        topicSuggestion: {
          shouldCreateNew: false,
          reason: '反思过程出错',
          suggestedTitle: null,
        },
        error: error.message,
      };
    }
  }

  /**
   * 构建反思的消息数组
   * @param {object} params - 反思参数
   */
  buildReflectionMessages(params) {
    const { triggerMessage, myResponse, context, topicInfo, recentTopics } = params;
    const systemPrompt = this.buildReflectionSystemPrompt();
    
    // 当前话题已累积的关键词
    const currentKeywords = topicInfo?.currentKeywords || [];
    const keywordsStr = currentKeywords.length > 0
      ? currentKeywords.join('、')
      : '(暂无)';

    // 构建历史话题信息（最近 2-3 个）
    // 包含 topic_id，让 LLM 可以通过 recall_topic 工具获取详情
    let recentTopicsSection = '';
    if (recentTopics && recentTopics.length > 0) {
      const topicsInfo = recentTopics.slice(0, 3).map((t, i) => {
        return `${i + 1}. 【${t.title}】(ID: ${t.id})\n   描述：${t.description || '暂无'}\n   消息数：${t.message_count || 0}`;
      }).join('\n');
      recentTopicsSection = `\n## 最近话题历史（用于校验总结是否准确）\n${topicsInfo}\n`;
    }

    const userContent = `请对以下对话进行反思：

## 当前话题信息
- 话题标题：${topicInfo?.title || '未命名话题'}
- 话题描述：${topicInfo?.description || '暂无描述'}
- 已累积关键词：${keywordsStr}
${recentTopicsSection}
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
   * 注：字段现在按纯字符串存储，不再需要 JSON 解析
   */
  buildReflectionSystemPrompt() {
    const soul = this.soul;

    // 构建各个章节，空值时省略整个章节
    const sections = [];

    // 核心价值观（纯字符串）
    if (soul.coreValues?.trim()) {
      sections.push(`## 角色核心价值观\n${soul.coreValues.trim()}`);
    }

    // 行为准则（纯字符串）
    if (soul.behavioralGuidelines?.trim()) {
      sections.push(`## 角色行为准则\n${soul.behavioralGuidelines.trim()}`);
    }

    // 禁忌（纯字符串）
    if (soul.taboos?.trim()) {
      sections.push(`## 角色禁忌\n${soul.taboos.trim()}`);
    }

    // 情感基调
    if (soul.emotionalTone?.trim()) {
      sections.push(`## 角色情感基调\n${soul.emotionalTone.trim()}`);
    }

    const soulSections = sections.length > 0
      ? sections.join('\n\n') + '\n\n'
      : '';

    return `你是角色的"反思心智"，负责根据角色的 Soul 进行自我反思和评价。

${soulSections}## 评分维度与权重
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
5. 分析话题相关性（见下方话题分析部分）

## 话题分析任务
评估刚才的回复是否与当前话题相关，以及对话是否发生了话题偏移：
- **isOnTopic**: 回复是否切题（true/false）
- **topicShiftConfidence**: 话题偏移置信度（0-1），越高表示越可能发生了话题切换
- **relevanceScore**: 回复与当前话题的相关性评分（1-10）
- **reason**: 判断理由

判断标准：
- 用户消息是否引入了全新主题？
- 我的回复是否恰当回应了用户的新方向？
- 对话是否自然过渡，还是突兀切换？

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

## 历史话题校验任务（可选）
如果提供了"最近话题历史"，请评估这些话题的总结质量：
- 标题是否准确概括了话题内容？
- 描述是否遗漏了重要信息？
- 是否有需要修正的地方？

注意：这是一个辅助功能，如果你发现历史话题总结有明显问题，可以在 topicSuggestion 中提出来。

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
    "suggestedTitle": "新话题标题（如果 shouldCreateNew 为 true，否则 null）",
    "previousTopicCorrection": {
      "needsCorrection": true/false,
      "topicIndex": 0,
      "suggestedTitle": "修正后的标题（如需要）",
      "suggestedDescription": "修正后的描述（如需要）",
      "reason": "修正理由"
    }
  }
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
          topicAnalysis: {
            isOnTopic: parsed.topicAnalysis?.isOnTopic ?? true,
            topicShiftConfidence: Math.max(0, Math.min(1, parsed.topicAnalysis?.topicShiftConfidence || 0.5)),
            relevanceScore: parsed.topicAnalysis?.relevanceScore || 7,
            reason: parsed.topicAnalysis?.reason || '未提供话题分析',
          },
          // 新增：关键词提取
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 5) : [],
          // 新增：话题分裂建议
          topicSuggestion: {
            shouldCreateNew: parsed.topicSuggestion?.shouldCreateNew === true,
            reason: parsed.topicSuggestion?.reason || '未提供判断理由',
            suggestedTitle: parsed.topicSuggestion?.suggestedTitle || null,
            // 新增：历史话题修正建议
            previousTopicCorrection: parsed.topicSuggestion?.previousTopicCorrection?.needsCorrection
              ? {
                  needsCorrection: true,
                  topicIndex: parsed.topicSuggestion.previousTopicCorrection.topicIndex || 0,
                  suggestedTitle: parsed.topicSuggestion.previousTopicCorrection.suggestedTitle || null,
                  suggestedDescription: parsed.topicSuggestion.previousTopicCorrection.suggestedDescription || null,
                  reason: parsed.topicSuggestion.previousTopicCorrection.reason || '未提供修正理由',
                }
              : { needsCorrection: false },
          },
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
      topicAnalysis: {
        isOnTopic: true,
        topicShiftConfidence: 0.5,
        relevanceScore: 6,
        reason: '反思结果解析失败',
      },
      keywords: [],
      topicSuggestion: {
        shouldCreateNew: false,
        reason: '反思结果解析失败',
        suggestedTitle: null,
      },
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
