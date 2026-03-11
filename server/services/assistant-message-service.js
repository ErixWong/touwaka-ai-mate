/**
 * AssistantMessageService - 助理消息服务
 *
 * 用于记录 Expert 与 Assistant 之间内部协作过程的消息
 *
 * 消息类型：
 * - task: Expert 委托任务包
 * - tool_call: Assistant 发起工具调用
 * - tool_result: 工具返回结果摘要
 * - final: Assistant 最终结果
 * - error: 错误消息
 * - status: 状态变更记录
 */

import logger from '../../lib/logger.js';

class AssistantMessageService {
  /**
   * @param {object} models - Sequelize 模型集合
   */
  constructor(models) {
    this.AssistantMessage = models.assistant_message;
    this.AssistantRequest = models.assistant_request;
  }

  /**
   * 创建消息
   * @param {object} data - 消息数据
   * @returns {Promise<object>}
   */
  async createMessage(data) {
    const {
      requestId,
      role,
      messageType,
      content,
      contentPreview,
      toolName,
      toolCallId,
      status,
      metadata,
      tokensInput,
      tokensOutput,
      latencyMs,
      parentMessageId,
    } = data;

    // 获取当前 sequence_no
    const maxSeq = await this.getMaxSequenceNo(requestId);
    const sequenceNo = (maxSeq || 0) + 1;

    // 生成 content_preview（如果未提供）
    const preview = contentPreview || (content ? content.substring(0, 512) : null);

    try {
      const message = await this.AssistantMessage.create({
        request_id: requestId,
        parent_message_id: parentMessageId || null,
        role,
        message_type: messageType,
        content,
        content_preview: preview,
        tool_name: toolName || null,
        tool_call_id: toolCallId || null,
        status: status || null,
        sequence_no: sequenceNo,
        metadata: metadata || null,
        tokens_input: tokensInput || null,
        tokens_output: tokensOutput || null,
        latency_ms: latencyMs || null,
        created_at: new Date(),
      });

      logger.debug(`[AssistantMessageService] 创建消息: ${requestId} #${sequenceNo} [${role}/${messageType}]`);

      return message;
    } catch (error) {
      logger.error(`[AssistantMessageService] 创建消息失败:`, error.message);
      throw error;
    }
  }

  /**
   * 追加任务消息
   * @param {string} requestId - 请求ID
   * @param {object} taskData - 任务数据
   */
  async appendTaskMessage(requestId, taskData) {
    const { task, background, input, expectedOutput, workspace } = taskData;

    const parts = [];
    if (task) parts.push(`任务: ${task}`);
    if (background) parts.push(`背景: ${background}`);
    if (input) parts.push(`输入: ${this.formatInput(input)}`);
    if (expectedOutput) parts.push(`期望输出: ${JSON.stringify(expectedOutput)}`);
    if (workspace) parts.push(`工作空间: ${JSON.stringify(workspace)}`);

    const content = parts.join('\n');

    return await this.createMessage({
      requestId,
      role: 'expert',
      messageType: 'task',
      content,
    });
  }

  /**
   * 追加状态消息
   * @param {string} requestId - 请求ID
   * @param {string} status - 状态
   * @param {string} content - 内容
   */
  async appendStatusMessage(requestId, status, content) {
    return await this.createMessage({
      requestId,
      role: 'system',
      messageType: 'status',
      status,
      content,
    });
  }

  /**
   * 追加工具调用消息
   * @param {string} requestId - 请求ID
   * @param {string} toolName - 工具名称
   * @param {object|string} argsSummary - 参数摘要
   * @param {string} toolCallId - 工具调用ID
   */
  async appendToolCallMessage(requestId, toolName, argsSummary, toolCallId) {
    const content = typeof argsSummary === 'string'
      ? argsSummary
      : JSON.stringify(argsSummary);

    return await this.createMessage({
      requestId,
      role: 'tool',
      messageType: 'tool_call',
      toolName,
      toolCallId,
      content,
    });
  }

  /**
   * 追加工具结果消息
   * @param {string} requestId - 请求ID
   * @param {string} toolName - 工具名称
   * @param {object|string} resultSummary - 结果摘要
   * @param {string} toolCallId - 工具调用ID
   * @param {object} metadata - 元数据（可选，可存储完整结果）
   */
  async appendToolResultMessage(requestId, toolName, resultSummary, toolCallId, metadata = null) {
    const content = typeof resultSummary === 'string'
      ? resultSummary
      : JSON.stringify(resultSummary);

    return await this.createMessage({
      requestId,
      role: 'tool',
      messageType: 'tool_result',
      toolName,
      toolCallId,
      content,
      metadata,
    });
  }

  /**
   * 追加最终结果消息
   * @param {string} requestId - 请求ID
   * @param {string} content - 结果内容
   * @param {number} tokensInput - 输入token数
   * @param {number} tokensOutput - 输出token数
   * @param {number} latencyMs - 耗时
   */
  async appendFinalMessage(requestId, content, tokensInput = null, tokensOutput = null, latencyMs = null) {
    return await this.createMessage({
      requestId,
      role: 'assistant',
      messageType: 'final',
      content,
      tokensInput,
      tokensOutput,
      latencyMs,
    });
  }

  /**
   * 追加错误消息
   * @param {string} requestId - 请求ID
   * @param {Error|string} error - 错误
   */
  async appendErrorMessage(requestId, error) {
    const content = typeof error === 'string'
      ? error
      : (error.message || String(error));

    return await this.createMessage({
      requestId,
      role: 'system',
      messageType: 'error',
      status: 'failed',
      content,
    });
  }

  /**
   * 获取请求的所有消息
   * @param {string} requestId - 请求ID
   * @param {boolean} debugMode - 是否返回完整内容
   * @returns {Promise<Array>}
   */
  async getMessagesByRequestId(requestId, debugMode = false) {
    const attributes = debugMode
      ? null // 返回所有字段
      : ['id', 'request_id', 'role', 'message_type', 'content_preview', 'tool_name', 'tool_call_id', 'status', 'sequence_no', 'created_at'];

    const messages = await this.AssistantMessage.findAll({
      where: { request_id: requestId },
      attributes,
      order: [['sequence_no', 'ASC']],
      raw: true,
    });

    return messages;
  }

  /**
   * 获取最大序列号
   * @param {string} requestId - 请求ID
   * @returns {Promise<number|null>}
   */
  async getMaxSequenceNo(requestId) {
    const result = await this.AssistantMessage.findOne({
      where: { request_id: requestId },
      attributes: ['sequence_no'],
      order: [['sequence_no', 'DESC']],
      raw: true,
    });

    return result?.sequence_no || 0;
  }

  /**
   * 格式化输入参数（用于摘要）
   * @param {object} input - 输入参数
   * @returns {string}
   */
  formatInput(input) {
    if (!input) return '';

    // 如果有 URL 或路径，只显示摘要
    if (input.image_url) return `image_url: ${input.image_url}`;
    if (input.file_path) return `file_path: ${input.file_path}`;

    // 否则显示 JSON（截断）
    const json = JSON.stringify(input);
    return json.length > 100 ? json.substring(0, 100) + '...' : json;
  }
}

export default AssistantMessageService;