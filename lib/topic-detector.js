/**
 * Topic Detector - 话题检测器
 * 使用 LLM 实时检测对话中的话题切换
 */

import logger from './logger.js';

class TopicDetector {
  /**
   * @param {LLMClient} llmClient - LLM客户端
   * @param {object} options - 配置选项
   * @param {number} options.confidenceThreshold - 话题切换置信度阈值（默认0.7）
   * @param {number} options.minMessagesForDetection - 触发检测的最小消息数（默认3轮）
   */
  constructor(llmClient, options = {}) {
    this.llmClient = llmClient;
    this.confidenceThreshold = options.confidenceThreshold || 0.7;
    this.minMessagesForDetection = options.minMessagesForDetection || 6; // 3轮对话
  }

  /**
   * 检测是否应该切换话题
   * @param {object} params - 检测参数
   * @param {string} params.currentTopicTitle - 当前话题标题
   * @param {string} params.currentTopicDescription - 当前话题描述
   * @param {Array} params.recentMessages - 最近的消息列表
   * @param {string} params.newMessage - 用户新消息
   * @returns {Promise<object>} 检测结果 { shouldSwitch: boolean, confidence: number, reason: string, suggestedTitle: string }
   */
  async detectTopicShift(params) {
    const { currentTopicTitle, currentTopicDescription, recentMessages, newMessage } = params;

    // 消息数不足，不检测
    if (!recentMessages || recentMessages.length < this.minMessagesForDetection) {
      logger.debug('[TopicDetector] 消息数不足，跳过话题检测');
      return { shouldSwitch: false, confidence: 0, reason: '消息数不足', suggestedTitle: null };
    }

    try {
      const prompt = this.buildDetectionPrompt({
        currentTopicTitle,
        currentTopicDescription,
        recentMessages,
        newMessage,
      });

      const response = await this.llmClient.callExpressive([
        {
          role: 'system',
          content: '你是一个话题分析专家，负责判断对话是否发生了话题切换。请仔细分析对话上下文和用户的新消息，判断用户是在继续当前话题，还是开启了全新的话题。'
        },
        { role: 'user', content: prompt },
      ], { temperature: 0.3, max_tokens: 500 });

      const result = this.parseDetectionResponse(response.content);
      
      logger.info('[TopicDetector] 话题检测结果:', {
        shouldSwitch: result.shouldSwitch,
        confidence: result.confidence,
        reason: result.reason,
        suggestedTitle: result.suggestedTitle,
      });

      return result;
    } catch (error) {
      logger.error('[TopicDetector] 话题检测失败:', error.message);
      // 检测失败时，默认不切换话题，避免误操作
      return { shouldSwitch: false, confidence: 0, reason: '检测失败', suggestedTitle: null };
    }
  }

  /**
   * 构建检测提示词
   */
  buildDetectionPrompt(params) {
    const { currentTopicTitle, currentTopicDescription, recentMessages, newMessage } = params;

    // 格式化最近的消息（最多取10条）
    const messagesToAnalyze = recentMessages.slice(-10);
    const conversationHistory = messagesToAnalyze.map(m => {
      const role = m.role === 'user' ? '用户' : '助手';
      const content = m.content?.substring(0, 200) || ''; // 限制长度
      return `${role}: ${content}${m.content?.length > 200 ? '...' : ''}`;
    }).join('\n');

    return `请分析以下对话，判断用户的新消息是否开启了全新的话题。

## 当前话题信息
- 话题标题：${currentTopicTitle || '未命名话题'}
- 话题描述：${currentTopicDescription || '暂无描述'}

## 最近对话历史
${conversationHistory}

## 用户新消息
${newMessage}

## 分析任务
请判断用户的新消息是：
1. **继续当前话题** - 与之前的讨论内容直接相关，是同一话题的延续
2. **开启新话题** - 与之前讨论的内容明显不同，是一个全新的问题或主题

## 输出要求（JSON格式）
{
  "isNewTopic": true/false,  // 是否为新话题
  "confidence": 0.0-1.0,     // 判断的置信度（0-1之间）
  "reason": "判断理由",      // 简要说明判断依据
  "suggestedTitle": "建议标题" // 如果是新话题，建议一个简短的话题标题（8-15字）
}

## 判断标准
- **继续当前话题**：用户追问、补充细节、深入讨论、表达相关观点
- **开启新话题**：提出全新问题、转向完全不同领域、讨论内容无关联

请只返回JSON格式的结果，不要包含其他内容。`;
  }

  /**
   * 解析检测响应
   */
  parseDetectionResponse(content) {
    try {
      // 尝试提取JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('未找到JSON格式的响应');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      const confidence = Math.max(0, Math.min(1, parseFloat(parsed.confidence) || 0));
      const shouldSwitch = parsed.isNewTopic === true && confidence >= this.confidenceThreshold;

      return {
        shouldSwitch,
        confidence,
        reason: parsed.reason || '未提供理由',
        suggestedTitle: parsed.suggestedTitle || null,
        isNewTopic: parsed.isNewTopic === true,
      };
    } catch (error) {
      logger.warn('[TopicDetector] 解析检测结果失败:', error.message, '原始内容:', content.substring(0, 200));
      return { shouldSwitch: false, confidence: 0, reason: '解析失败', suggestedTitle: null };
    }
  }

  /**
   * 批量检测历史消息中的话题边界（用于初始化或重建话题）
   * @param {Array} messages - 消息列表
   * @returns {Promise<Array>} 话题边界索引列表
   */
  async detectTopicBoundaries(messages) {
    if (!messages || messages.length < this.minMessagesForDetection) {
      return [];
    }

    const boundaries = [];
    const windowSize = 6; // 每次检测的窗口大小

    for (let i = windowSize; i < messages.length; i += windowSize / 2) {
      const window = messages.slice(Math.max(0, i - windowSize), i);
      const newMessage = messages[i];

      const recentMessages = window.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const result = await this.detectTopicShift({
        currentTopicTitle: '历史对话',
        currentTopicDescription: '',
        recentMessages,
        newMessage: newMessage.content,
      });

      if (result.shouldSwitch) {
        boundaries.push(i);
      }
    }

    return boundaries;
  }
}

export default TopicDetector;
