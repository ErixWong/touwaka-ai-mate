/**
 * ExpertNotifier - 专家通知模块
 * 
 * 负责：
 * - SSE 推送通知
 * - 触发专家响应
 * - 构建结果消息
 */

import logger from '../../../lib/logger.js';
import Utils from '../../../lib/utils.js';
import { executeStreamWithToolLoop } from '../../../lib/tool-calling-executor.js';

// 记录已发送的通知，避免重复
const notifiedRequests = new Set();

/**
 * 检查并标记请求已通知
 * @param {string} requestId - 请求ID
 * @param {string} status - 请求状态
 * @returns {boolean} 是否应该继续通知
 */
function shouldNotify(requestId, status) {
  const notifyKey = `${requestId}_${status}`;
  if (notifiedRequests.has(notifyKey)) {
    logger.info(`[ExpertNotifier] 跳过重复通知: ${notifyKey}`);
    return false;
  }
  notifiedRequests.add(notifyKey);
  // 5分钟后清理
  setTimeout(() => notifiedRequests.delete(notifyKey), 5 * 60 * 1000);
  return true;
}

/**
 * 通过 SSE 推送通知
 * @param {Map} expertConnections - SSE 连接池
 * @param {string} expertId - 专家ID
 * @param {string} userId - 用户ID
 * @param {object} notification - 通知内容
 * @returns {boolean} 是否成功推送
 */
export function pushSSENotification(expertConnections, expertId, userId, notification) {
  if (!expertConnections) {
    logger.debug(`[ExpertNotifier] 无 SSE 连接池`);
    return false;
  }

  const connections = expertConnections.get(expertId);

  if (!connections || connections.size === 0) {
    logger.debug(`[ExpertNotifier] 无 SSE 连接: expert=${expertId}`);
    return false;
  }

  // 找到该用户的连接
  for (const conn of connections) {
    if (conn.user_id === userId && !conn.res.writableEnded) {
      try {
        conn.res.write(`event: ${notification.event}\n`);
        conn.res.write(`data: ${JSON.stringify(notification.data)}\n\n`);
        logger.info(`[ExpertNotifier] SSE 通知已发送: ${notification.event} to user=${userId}`);
        return true;
      } catch (err) {
        logger.error('[ExpertNotifier] SSE 发送失败:', err);
      }
    }
  }

  return false;
}

/**
 * 内存中的通知状态记录（用于重发功能）
 * key: requestId, value: { status, error, sentAt, retryCount }
 */
const notificationStatusMap = new Map();

/**
 * 更新通知状态到内存
 * @param {string} requestId - 请求ID
 * @param {string} status - 通知状态: pending, sent, failed, skipped
 * @param {string} error - 错误信息（可选）
 * @returns {object} 当前状态记录
 */
function updateNotificationStatus(requestId, status, error = null) {
  const record = {
    status,
    error: error || null,
    sentAt: status === 'sent' ? new Date() : null,
    retryCount: (notificationStatusMap.get(requestId)?.retryCount || 0) + (status === 'sent' ? 0 : 1),
  };
  notificationStatusMap.set(requestId, record);
  
  // 控制台输出通知状态
  console.log(`\n[通知状态] request_id: ${requestId}`);
  console.log(`  状态: ${status}`);
  if (error) {
    console.log(`  失败原因: ${error}`);
  }
  if (record.sentAt) {
    console.log(`  发送时间: ${record.sentAt.toISOString()}`);
  }
  console.log(`  重试次数: ${record.retryCount}`);
  console.log('');
  
  logger.info(`[ExpertNotifier] 通知状态更新: request=${requestId}, status=${status}`);
  return record;
}

/**
 * 获取通知状态
 * @param {string} requestId - 请求ID
 * @returns {object|null} 状态记录
 */
export function getNotificationStatus(requestId) {
  return notificationStatusMap.get(requestId) || null;
}

/**
 * 清除通知状态（用于重发）
 * @param {string} requestId - 请求ID
 */
function clearNotificationStatus(requestId) {
  notificationStatusMap.delete(requestId);
  logger.info(`[ExpertNotifier] 清除通知状态: request=${requestId}`);
}

/**
 * 重发通知给专家
 * @param {Database} db - 数据库实例
 * @param {string} requestId - 请求ID
 * @param {object} services - 服务引用
 * @returns {Promise<object>} 重发结果
 */
export async function resendNotification(db, requestId, services) {
  const { expertConnections, chatService } = services;
  
  logger.info(`[ExpertNotifier] 开始重发通知: request=${requestId}`);
  
  console.log(`\n========================================`);
  console.log(`[重发通知] request_id: ${requestId}`);
  console.log(`========================================\n`);
  
  try {
    // 从数据库获取请求
    const AssistantRequest = db.getModel('assistant_request');
    const request = await AssistantRequest.findOne({
      where: { request_id: requestId },
      raw: true,
    });
    
    if (!request) {
      const error = `请求不存在: ${requestId}`;
      console.log(`[重发失败] ${error}`);
      throw new Error(error);
    }
    
    // 检查请求状态
    if (request.status !== 'completed' && request.status !== 'failed') {
      const error = `请求状态不允许重发: ${request.status}`;
      console.log(`[重发失败] ${error}`);
      throw new Error(error);
    }
    
    // 解析 input
    let input = request.input;
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch (e) {
        input = {};
      }
    }
    
    // 构建完整的请求对象
    const fullRequest = {
      ...request,
      input,
      result: request.result,
      status: request.status,
      error_message: request.error_message,
      latency_ms: request.latency_ms,
    };
    
    // 清除内存中的通知标记，允许重新通知
    const notifyKey = `${requestId}_${request.status}`;
    notifiedRequests.delete(notifyKey);
    
    // 清除通知状态记录
    clearNotificationStatus(requestId);
    
    console.log(`[重发] 清除历史通知标记，准备重新发送...\n`);
    
    // 重新发送通知
    await notifyExpertResult(db, fullRequest, services);
    
    const result = {
      success: true,
      message: '通知已重发',
      request_id: requestId,
    };
    
    console.log(`[重发成功] request_id: ${requestId}\n`);
    
    return result;
  } catch (error) {
    console.log(`[重发失败] ${error.message}\n`);
    logger.error(`[ExpertNotifier] 重发通知失败: ${error.message}`);
    throw error;
  }
}

/**
 * 通过 Internal API 通知 Expert 会话结果
 * @param {Database} db - 数据库实例
 * @param {object} request - 请求对象
 * @param {object} services - 服务引用
 * @param {Map} services.expertConnections - SSE 连接池
 * @param {ChatService} services.chatService - ChatService 实例
 */
export async function notifyExpertResult(db, request, services) {
  const { expertConnections, chatService } = services;
  const { user_id, expert_id, topic_id, result, status, assistant_id, request_id } = request;

  // 检查是否已经通知过
  if (!shouldNotify(request_id, status)) {
    // 更新状态为已跳过（重复通知）
    updateNotificationStatus(request_id, 'skipped', '重复通知请求被跳过');
    return;
  }

  // 获取模型
  const Topic = db.getModel('topic');
  const Task = db.getModel('task');
  const Message = db.getModel('message');

  // 如果缺少必要信息，尝试补充
  let finalUserId = user_id;
  let finalExpertId = expert_id;
  let finalTopicId = topic_id;

  if ((!finalUserId || !finalExpertId) && finalTopicId) {
    try {
      const topic = await Topic.findByPk(finalTopicId, { raw: true });
      if (topic) {
        if (!finalUserId) {
          finalUserId = topic.user_id;
        }
        if (!finalExpertId) {
          finalExpertId = topic.expert_id;
        }
      }
    } catch (e) {
      logger.warn(`[ExpertNotifier] 从 Topic 获取用户信息失败:`, e.message);
    }
  }

  // P0-A 修复：如果 topic_id 为 null，根据 user_id + expert_id 查询活跃话题
  if (!finalTopicId && finalUserId && finalExpertId) {
    try {
      const activeTopic = await Topic.findOne({
        where: {
          user_id: finalUserId,
          expert_id: finalExpertId,
          status: 'active',
        },
        order: [['created_at', 'DESC']],
        raw: true,
      });
      if (activeTopic) {
        finalTopicId = activeTopic.id;
        logger.info(`[ExpertNotifier] 找到活跃话题: topic_id=${finalTopicId}`);
      } else {
        // 没有活跃话题，创建一个新的
        logger.info(`[ExpertNotifier] 没有活跃话题，为 Assistant 结果创建新话题`);
        const newTopic = await Topic.create({
          id: Utils.newID(20),
          user_id: finalUserId,
          expert_id: finalExpertId,
          status: 'active',
          title: `Assistant 结果 - ${assistant_id}`,
        });
        finalTopicId = newTopic.id;
        logger.info(`[ExpertNotifier] 创建新话题: topic_id=${finalTopicId}`);
      }
    } catch (e) {
      logger.warn(`[ExpertNotifier] 查询/创建话题失败:`, e.message);
    }
  }

  // P0-A 修复：不再因 topic_id 为 null 而跳过通知
  // 只有当 user_id 或 expert_id 缺失时才跳过（这是真正的必填信息）
  if (!finalUserId || !finalExpertId) {
    const errorMsg = `缺少必填信息: user_id=${finalUserId}, expert_id=${finalExpertId}`;
    logger.error(`[ExpertNotifier] 跳过通知：request=${request_id}, 缺少必填信息:`, {
      user_id: finalUserId || 'MISSING',
      expert_id: finalExpertId || 'MISSING',
      topic_id: finalTopicId || '(已处理)',
    });
    // 更新通知状态为失败
    updateNotificationStatus(request_id, 'failed', errorMsg);
    return;
  }

  logger.info(`[ExpertNotifier] 准备通知 Expert: request=${request_id}, expert_id=${finalExpertId}, topic_id=${finalTopicId || '(新创建)'}`);

  // 检查话题状态
  let isTopicActive = false;
  try {
    const topic = await Topic.findByPk(finalTopicId, { raw: true });
    isTopicActive = topic?.status === 'active';
    logger.info(`[ExpertNotifier] 话题状态: topic_id=${finalTopicId}, status=${topic?.status}, isActive=${isTopicActive}`);
  } catch (e) {
    logger.warn(`[ExpertNotifier] 获取话题状态失败:`, e.message);
  }

  // 获取工作目录和对话上下文
  let workspacePath = '';
  let userMessage = '';
  let conversationContext = '';
  let inputObj = null;

  // 首先从 request.input 中获取用户任务描述和保存的上下文
  try {
    if (request.input) {
      inputObj = typeof request.input === 'string' ? JSON.parse(request.input) : request.input;
      if (inputObj.task) {
        userMessage = inputObj.task;
        if (userMessage.length > 300) {
          userMessage = userMessage.substring(0, 300) + '...';
        }
      }
      // 优先使用发起委托时保存的上下文（非空字符串）
      if (inputObj.summon_context && inputObj.summon_context.trim()) {
        conversationContext = inputObj.summon_context;
      }
    }
  } catch (e) {
    logger.warn(`[ExpertNotifier] 解析 input 失败:`, e.message);
  }

  // 如果没有保存的上下文，才从数据库获取
  if (!conversationContext) {
    try {
      // 从 topic 获取信息（task_id 用于获取工作目录）
      const topic = await Topic.findByPk(finalTopicId, { raw: true });

      if (topic?.task_id) {
        // 从 task 获取工作目录
        const task = await Task.findByPk(topic.task_id, { raw: true });
        if (task?.workspace_path) {
          // 确保路径以 work/ 开头
          workspacePath = task.workspace_path.startsWith('work/')
            ? task.workspace_path
            : `work/${task.workspace_path}`;
        }
      }

      // 构建消息查询条件
      let messageWhere = {};
      if (isTopicActive) {
        // 活跃话题：消息的 topic_id 为 NULL，通过 user_id + expert_id 查询
        messageWhere = {
          user_id: finalUserId,
          expert_id: finalExpertId,
        };
      } else {
        // 已归档话题：消息有 topic_id
        messageWhere = {
          topic_id: finalTopicId,
        };
      }

      // 获取最近 N 条对话消息（用户 + 专家）
      const recentMessages = await Message.findAll({
        where: messageWhere,
        order: [['created_at', 'DESC']],
        limit: 10,
        raw: true,
      });

      // 反转顺序，按时间正序排列
      const contextMessages = recentMessages.reverse();

      // 构建对话上下文 - 只显示用户的原始消息
      const contextLines = [];
      for (const msg of contextMessages) {
        // 只显示用户的消息，过滤掉专家和工具消息
        if (msg.role !== 'user') continue;

        let content = msg.content || '';
        // 限制单条消息长度
        if (content.length > 200) {
          content = content.substring(0, 200) + '...';
        }
        // 过滤掉过于简短的消息
        if (content.length > 5) {
          contextLines.push(`**用户**: ${content}`);
        }
      }
      conversationContext = contextLines.join('\n\n');

      // 如果没有从 input 获取到用户消息，使用最近的用户消息
      if (!userMessage && recentMessages.length > 0) {
        // 找最后一条用户消息
        for (const msg of recentMessages.reverse()) {
          if (msg.role === 'user' && msg.content) {
            userMessage = msg.content;
            if (userMessage.length > 300) {
              userMessage = userMessage.substring(0, 300) + '...';
            }
            break;
          }
        }
      }
    } catch (e) {
      logger.warn(`[ExpertNotifier] 获取上下文失败:`, e.message);
    }
  }

  // 构建结果消息内容
  let content;

  // P0-B 增强：构建执行摘要
  const latencyMs = request.latency_ms || request.latencyMs || 0;
  const executionSummary = status === 'failed'
    ? `❌ 状态：执行失败\n⏱ 耗时：${latencyMs}ms`
    : `✅ 状态：执行成功\n⏱ 耗时：${latencyMs}ms`;

  if (status === 'failed') {
    const errorMsg = request.error_message || '未知错误';
    content = `【🎯 委托目标】\n${userMessage || '（无）'}\n\n【📋 上下文摘要】\n${conversationContext || '（无）'}\n\n【当前工作目录】\n${workspacePath || '（无）'}\n\n【📦 执行摘要】\n${executionSummary}\n\n【❌ 错误原因】\n${errorMsg}\n\n---\n**请修改输入参数后重新委托此任务**\n\n【🔗 任务绑定】\n- request_id: ${request_id}\n- assistant_id: ${assistant_id}`;
  } else {
    // 成功时，告诉 Expert 立即处理结果，不要等待用户指令
    let resultObj;
    let rawResult;
    try {
      resultObj = typeof result === 'string' ? JSON.parse(result) : result;
      rawResult = resultObj?.result || JSON.stringify(resultObj);
    } catch (parseErr) {
      logger.warn(`[ExpertNotifier] 解析结果失败，使用原始值:`, parseErr.message);
      rawResult = typeof result === 'string' ? result : JSON.stringify(result);
    }

    content = `【🎯 委托目标】\n${userMessage || '（无）'}\n\n【📋 上下文摘要】\n${conversationContext || '（无）'}\n\n【当前工作目录】\n${workspacePath || '（无）'}\n\n【📦 执行摘要】\n${executionSummary}\n\n【📄 详细结果】\n${rawResult}\n\n---\n【🔗 任务绑定】\n- request_id: ${request_id}\n- assistant_id: ${assistant_id}`;
  }
  // 构造用户消息（不存入数据库，不显示在前端）
  const constructedUserMessage = userMessage
    ? `用户请求：${userMessage}\n\n助理执行结果：\n${content}`
    : content;

  // 在 console 中显示助理返回结果
  console.log('\n========================================');
  console.log(`[助理返回结果] request_id: ${request_id}`);
  console.log(`assistant_id: ${assistant_id}`);
  console.log(`status: ${status}`);
  console.log(`latency: ${latencyMs}ms`);
  console.log('----------------------------------------');
  console.log(content);
  console.log('========================================\n');

  logger.info(`[ExpertNotifier] 通知 Expert 结果: request=${request_id}, topic=${finalTopicId}`, {
    user_id: finalUserId,
    expert_id: finalExpertId,
    topic_id: finalTopicId,
    content_length: content.length,
  });

  try {
    // 1. 通过 SSE 推送通知（如果有连接）
    const sseSent = pushSSENotification(expertConnections, finalExpertId, finalUserId, {
      event: 'new_context',
      data: {
        message_id: `assistant_${request_id}`,
        topic_id: finalTopicId,
        role: 'assistant',
        preview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
      }
    });

    logger.info(`[ExpertNotifier] SSE 通知: ${sseSent ? '已发送' : '无连接'}`);

    // 2. 触发专家响应（如果有 chatService 和 SSE 连接）
    if (chatService) {
      await triggerExpertResponse(db, chatService, expertConnections, {
        userId: finalUserId,
        expertId: finalExpertId,
        content: constructedUserMessage,
        topicId: finalTopicId,
      });
    } else {
      logger.warn(`[ExpertNotifier] 无 chatService，无法触发专家响应`);
    }

    // 更新通知状态为已发送
    updateNotificationStatus(request_id, 'sent');
    logger.info(`[ExpertNotifier] 通知成功: request_id=${request_id}, topic_id=${finalTopicId}`);
  } catch (err) {
    logger.error(`[ExpertNotifier] 通知失败: ${err.message}`);
    // 更新通知状态为失败
    updateNotificationStatus(request_id, 'failed', err.message);
    throw err;
  }
}

/**
 * 触发专家响应（异步执行，不阻塞返回）
 * 使用 ToolCallingExecutor 处理多轮工具调用逻辑
 * @param {Database} db - 数据库实例
 * @param {ChatService} chatService - ChatService 实例
 * @param {Map} expertConnections - SSE 连接池
 * @param {object} params - 参数
 */
export async function triggerExpertResponse(db, chatService, expertConnections, params) {
  const { userId, expertId, content, topicId } = params;

  try {
    logger.info(`[ExpertNotifier] 触发专家响应: expert=${expertId}, user=${userId}, topic=${topicId}`);

    // 等待一小段时间确保数据库事务完全提交
    await new Promise(resolve => setTimeout(resolve, 100));

    // 获取 SSE 连接
    const connections = expertConnections?.get(expertId);
    const userConnection = connections
      ? [...connections].find(c => c.user_id === userId && !c.res.writableEnded)
      : null;

    if (!userConnection) {
      logger.warn(`[ExpertNotifier] 没有 SSE 连接，无法触发专家响应: expert=${expertId}, user=${userId}`);
      return;
    }

    // 获取专家服务
    const expertService = await chatService.getExpertService(expertId);

    // 构建上下文
    const context = await expertService.buildContext(userId, content, topicId);

    logger.info(`[ExpertNotifier] 构建上下文: topic=${topicId}, messagesCount=${context.messages?.length || 0}`);

    // 获取模型配置
    const modelConfig = expertService.getDefaultModelConfig();

    // 获取工具定义
    const tools = expertService.toolManager.getToolDefinitions();

    logger.info(`[ExpertNotifier] 开始生成专家回复: model=${modelConfig.model_name}, tools=${tools.length}`);

    // 发送开始事件
    if (!userConnection.res.writableEnded) {
      userConnection.res.write(`event: start\n`);
      userConnection.res.write(`data: ${JSON.stringify({ message_id: `msg_${Utils.newID(10)}`, topic_id: topicId })}\n\n`);
    }

    const startTime = Date.now();

    // 使用 executeStreamWithToolLoop 处理多轮工具调用
    const result = await executeStreamWithToolLoop(
      expertService.llmClient,
      modelConfig,
      [...context.messages],
      tools,
      {
        maxToolRounds: 5,
        // 增量内容回调：发送 SSE delta 事件
        onDelta: (delta) => {
          if (!userConnection.res.writableEnded) {
            userConnection.res.write(`event: delta\n`);
            userConnection.res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
          }
        },
        // 工具调用回调：发送 SSE tool_call 事件
        onToolCall: (toolCalls) => {
          if (!userConnection.res.writableEnded) {
            const toolCallsWithDisplayNames = (Array.isArray(toolCalls) ? toolCalls : [toolCalls]).map(call => {
              const toolId = call.function?.name || call.name;
              return {
                ...call,
                displayName: expertService.toolManager.formatToolDisplay(toolId),
              };
            });
            userConnection.res.write(`event: tool_call\n`);
            userConnection.res.write(`data: ${JSON.stringify({ type: 'tool_call', toolCalls: toolCallsWithDisplayNames })}\n\n`);
          }
        },
        // 工具执行函数：调用 expertService.handleToolCalls
        executeTool: async (collectedToolCalls, toolContext) => {
          logger.info(`[ExpertNotifier] 执行工具调用:`, collectedToolCalls.length);
          return await expertService.handleToolCalls(
            collectedToolCalls,
            userId,
            null, // access_token
            null, // taskContext
            topicId
          );
        },
        // 工具结果回调：发送 SSE tool_result 事件
        onToolResult: (toolResult) => {
          if (!userConnection.res.writableEnded) {
            userConnection.res.write(`event: tool_result\n`);
            userConnection.res.write(`data: ${JSON.stringify({ result: toolResult })}\n\n`);
          }
        },
        // Token 使用回调
        onUsage: (usage) => {
          logger.debug(`[ExpertNotifier] Token 使用:`, usage);
        },
      }
    );

    const latency = Date.now() - startTime;

    // 保存专家回复
    await chatService.saveAssistantMessage(
      topicId,
      userId,
      result.content,
      {
        latency_ms: latency,
        model_name: modelConfig.model_name,
        provider_name: modelConfig.provider_name,
        expert_id: expertId,
      }
    );

    // 发送完成事件
    if (!userConnection.res.writableEnded) {
      userConnection.res.write(`event: complete\n`);
      userConnection.res.write(`data: ${JSON.stringify({
        content: result.content,
        latency,
        model: modelConfig.model_name,
      })}\n\n`);
    }

    logger.info(`[ExpertNotifier] 专家响应完成: expert=${expertId}, latency=${latency}ms`);

  } catch (error) {
    logger.error(`[ExpertNotifier] 触发专家响应异常: ${error.message}`);

    // 发送错误事件
    if (expertConnections) {
      const connections = expertConnections.get(expertId);
      if (connections) {
        const userConnection = [...connections].find(c => c.user_id === userId && !c.res.writableEnded);
        if (userConnection && !userConnection.res.writableEnded) {
          userConnection.res.write(`event: error\n`);
          userConnection.res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
        }
      }
    }
  }
}

export default {
  pushSSENotification,
  notifyExpertResult,
  triggerExpertResponse,
  resendNotification,
};