/**
 * Topic Detector - 话题检测器
 * 使用 InternalLLMService 进行话题切换检测
 * 
 * 重构说明：
 * - 使用 InternalLLMService 替代直接使用 LLMClient
 * - 不再依赖专家人设，使用独立的判断逻辑
 * - 移除了废弃的 LLMClient 兼容代码
 */

import logger from './logger.js';

class TopicDetector {
  /**
   * @param {InternalLLMService} llmClient - InternalLLMService 实例
   * @param {object} options - 配置选项
   * @param {string} options.expertId - 专家ID（使用 InternalLLMService 时必需）
   * @param {number} options.confidenceThreshold - 话题切换置信度阈值（默认0.7）
   * @param {number} options.minMessagesForDetection - 触发检测的最小消息数（默认3轮）
   */
  constructor(llmClient, options = {}) {
    this.llmClient = llmClient;
    this.expertId = options.expertId || null;
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
      return await this.detectWithInternalLLM(params);
    } catch (error) {
      logger.error('[TopicDetector] 话题检测失败:', error.message);
      // 检测失败时，默认不切换话题，避免误操作
      return { shouldSwitch: false, confidence: 0, reason: '检测失败', suggestedTitle: null };
    }
  }

  /**
   * 使用 InternalLLMService 进行检测
   */
  async detectWithInternalLLM(params) {
    const { currentTopicTitle, currentTopicDescription, recentMessages, newMessage } = params;

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt({
      currentTopicTitle,
      currentTopicDescription,
      recentMessages,
      newMessage,
    });

    const result = await this.llmClient.judge(systemPrompt, userPrompt, {
      expertId: this.expertId,
      temperature: 0.3,
      defaultValue: { isNewTopic: false, confidence: 0, reason: 'LLM 调用失败', suggestedTitle: null },
    });

    if (!result) {
      return { shouldSwitch: false, confidence: 0, reason: '解析失败', suggestedTitle: null };
    }

    const confidence = Math.max(0, Math.min(1, parseFloat(result.confidence) || 0));
    const shouldSwitch = result.isNewTopic === true && confidence >= this.confidenceThreshold;

    logger.info('[TopicDetector] 话题检测结果:', {
      shouldSwitch,
      confidence,
      reason: result.reason,
      suggestedTitle: result.suggestedTitle,
    });

    return {
      shouldSwitch,
      confidence,
      reason: result.reason || '未提供理由',
      suggestedTitle: result.suggestedTitle || null,
      isNewTopic: result.isNewTopic === true,
    };
  }

  /**
   * 构建系统提示词
   */
  buildSystemPrompt() {
    return `你是一个话题分析专家，负责判断对话是否发生了话题切换。

## 分析任务
分析对话上下文和用户的新消息，判断用户是在继续当前话题，还是开启了全新的话题。

## 判断标准
- **继续当前话题**：用户追问、补充细节、深入讨论、表达相关观点
- **开启新话题**：提出全新问题、转向完全不同领域、讨论内容无关联

## 输出要求
返回 JSON 格式的结果，包含以下字段：
- isNewTopic (boolean): 是否为新话题
- confidence (number): 判断的置信度，0-1 之间
- reason (string): 判断理由，简要说明
- suggestedTitle (string|null): 如果是新话题，建议一个简短的话题标题（8-15字）；否则为 null`;
  }

  /**
   * 构建用户提示词
   */
  buildUserPrompt(params) {
    const { currentTopicTitle, currentTopicDescription, recentMessages, newMessage } = params;

    // 格式化最近的消息（最多取10条）
    const messagesToAnalyze = recentMessages.slice(-10);
    const conversationHistory = messagesToAnalyze.map(m => {
      const role = m.role === 'user' ? '用户' : '助手';
      const content = m.content?.substring(0, 200) || '';
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

请返回 JSON 格式的判断结果。`;
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
