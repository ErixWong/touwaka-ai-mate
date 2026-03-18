/**
 * Autonomous Task Executor - 自主任务执行器
 *
 * 作为 BackgroundTaskScheduler 的任务处理器
 * 定期扫描 status='autonomous' 的任务，自动触发 AI 执行
 *
 * 工作流程：
 * 1. 查找所有 status='autonomous' 的任务
 * 2. 检查任务是否需要执行（根据 last_executed_at 和执行间隔）
 * 3. 获取任务的历史上下文（最近 N 条消息）
 * 4. 调用 ChatService 生成 AI 回复
 * 5. 更新任务的 last_executed_at 时间戳
 *
 * 上下文感知提示词：
 * - 获取最近 N 条历史消息作为上下文
 * - 防止 LLM 走捷径，鼓励完整执行任务
 * - 检测 LLM 提出的问题并提供指导
 *
 * 速率限制处理：
 * - 遇到 429 错误时，暂停执行一段时间（默认 60 秒）
 * - 在暂停期间，跳过所有任务执行
 * - 暂停结束后恢复正常执行
 */

import { Op } from 'sequelize';
import logger from './logger.js';
import InternalLLMService from './internal-llm-service.js';

/**
 * 创建自主任务执行器
 * @param {Object} options 配置选项
 * @param {Object} options.chatService ChatService 实例
 * @param {number} options.batchSize 每批处理的任务数量（默认 5）
 * @param {number} options.minIntervalMinutes 最小执行间隔（分钟，默认 1）
 * @param {number} options.rateLimitCooldownMs 速率限制冷却时间（毫秒，默认 60000）
 * @param {number} options.contextMessagesCount 历史上下文消息数量（默认 6）
 * @returns {Function} 任务处理函数
 */
export function createAutonomousTaskExecutor(options = {}) {
  const { 
    chatService, 
    batchSize = 5, 
    minIntervalMinutes = 1, 
    rateLimitCooldownMs = 60000,
    contextMessagesCount = 6,  // 默认获取最近 6 条消息（约 3 轮对话）
  } = options;

  // 速率限制状态
  let rateLimitedUntil = 0;  // 速率限制解除的时间戳（毫秒）

  // 缓存模型引用
  let models = null;

  /**
   * 确保模型已初始化
   */
  function ensureModels(db) {
    if (!models) {
      models = {
        Task: db.getModel('task'),
        Expert: db.getModel('expert'),
        Message: db.getModel('message'),
        Topic: db.getModel('topic'),
      };
    }
    return models;
  }

  /**
   * 检查任务是否需要执行
   * @param {Object} task 任务对象
   * @returns {boolean} 是否需要执行
   */
  function shouldExecute(task) {
    // 如果没有最后执行时间，需要执行
    if (!task.last_executed_at) {
      return true;
    }

    // 检查距离上次执行是否超过最小间隔
    const lastExecuted = new Date(task.last_executed_at);
    const now = new Date();
    const diffMinutes = (now - lastExecuted) / (1000 * 60);

    return diffMinutes >= minIntervalMinutes;
  }

  /**
   * 检查是否处于速率限制暂停期
   * @returns {boolean} 是否处于暂停期
   */
  function isRateLimited() {
    return Date.now() < rateLimitedUntil;
  }

  /**
   * 设置速率限制暂停
   * @param {number} durationMs 暂停时长（毫秒），默认使用配置的 rateLimitCooldownMs
   */
  function setRateLimit(durationMs = rateLimitCooldownMs) {
    rateLimitedUntil = Date.now() + durationMs;
    logger.warn(`[AutonomousExecutor] 🚫 检测到速率限制，暂停执行 ${durationMs / 1000} 秒`);
  }

  /**
   * 检查错误是否为速率限制错误（429）
   * @param {Error|string} error 错误对象
   * @returns {boolean} 是否为速率限制错误
   */
  function isRateLimitError(error) {
    const errorMsg = error?.message || error?.toString() || '';
    // 检查 HTTP 429 状态码或速率限制相关消息
    return errorMsg.includes('429') || 
           errorMsg.includes('rate limit') || 
           errorMsg.includes('速率限制') ||
           errorMsg.includes('Rate limit');
  }

  /**
   * 获取任务的历史上下文消息（包含工具调用）
   *
   * 逻辑：
   * 1. 找到最近的 2 个 user 和 2 个 assistant 消息
   * 2. 获取第一条对话的时间作为开始时间
   * 3. 获取大于这个时间的所有对话（包括 tool 消息）
   * 4. 工具调用只显示工具名称和返回结果（适当截断）
   *
   * @param {string} expertId - 专家ID
   * @param {string} userId - 用户ID
   * @returns {Promise<Array>} 历史消息数组
   */
  async function getContextMessages(expertId, userId) {
    if (!expertId || !userId) return [];
    
    try {
      // 1. 先获取最近的 2 个 user 和 2 个 assistant 消息
      const userMessages = await models.Message.findAll({
        where: {
          expert_id: expertId,
          user_id: userId,
          role: 'user',
        },
        attributes: ['id', 'role', 'content', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 2,
        raw: true,
      });
      
      const assistantMessages = await models.Message.findAll({
        where: {
          expert_id: expertId,
          user_id: userId,
          role: 'assistant',
        },
        attributes: ['id', 'role', 'content', 'created_at'],
        order: [['created_at', 'DESC']],
        limit: 2,
        raw: true,
      });
      
      // 2. 合并并找到最早的时间
      const coreMessages = [...userMessages, ...assistantMessages];
      if (coreMessages.length === 0) return [];
      
      const earliestTime = coreMessages.reduce((min, msg) => {
        const msgTime = new Date(msg.created_at);
        return msgTime < min ? msgTime : min;
      }, new Date(coreMessages[0].created_at));
      
      // 3. 获取大于这个时间的所有消息（包括 tool 消息）
      const allMessages = await models.Message.findAll({
        where: {
          expert_id: expertId,
          user_id: userId,
          created_at: { [Op.gte]: earliestTime },
        },
        attributes: ['id', 'role', 'content', 'tool_calls', 'created_at'],
        order: [['created_at', 'ASC']],
        raw: true,
      });
      
      // 4. 格式化消息
      return allMessages.map(msg => {
        // 对于 tool 消息，提取工具名称和结果
        if (msg.role === 'tool') {
          return formatToolMessage(msg);
        }
        
        // 对于 user 和 assistant 消息，截断内容
        return {
          role: msg.role,
          content: truncateContent(msg.content || '(无内容)', 800),
        };
      });
    } catch (error) {
      logger.error(`[AutonomousExecutor] 获取历史上下文失败: ${error.message}`);
      return [];
    }
  }

  /**
   * 格式化工具消息
   * @param {Object} msg - 工具消息对象
   * @returns {Object} 格式化后的消息
   */
  function formatToolMessage(msg) {
    let toolName = '未知工具';
    let result = msg.content || '(无结果)';
    
    // 尝试解析 tool_calls 字段
    try {
      const toolCalls = typeof msg.tool_calls === 'string'
        ? JSON.parse(msg.tool_calls)
        : msg.tool_calls;
      
      if (toolCalls?.name) {
        toolName = toolCalls.name;
      }
      
      // 检查工具调用是否成功
      const success = toolCalls?.success !== false;
      result = success
        ? truncateContent(result, 500)  // 成功时截断
        : `❌ 错误: ${truncateContent(result, 300)}`;  // 失败时标注
    } catch (e) {
      // 解析失败，使用原始内容
      result = truncateContent(result, 500);
    }
    
    return {
      role: 'tool',
      name: toolName,
      content: result,
    };
  }

  /**
   * 执行单个自主任务
   * @param {Object} task 任务对象
   * @param {Object} db 数据库实例
   * @returns {Promise<{success: boolean, rateLimited?: boolean}>} 执行结果
   */
  async function executeTask(task, db) {
    try {
      logger.info(`[AutonomousExecutor] 执行自主任务: ${task.id} (${task.title})`);

      // 检查任务是否有关联的专家
      if (!task.expert_id) {
        logger.warn(`[AutonomousExecutor] 任务 ${task.id} 没有关联专家，跳过执行`);
        return { success: false };
      }

      // 获取任务关联的专家信息
      const expert = await models.Expert.findOne({
        where: { id: task.expert_id },
        raw: true,
      });

      if (!expert) {
        logger.warn(`[AutonomousExecutor] 任务 ${task.id} 关联的专家 ${task.expert_id} 不存在`);
        return { success: false };
      }

      // 获取或创建任务关联的话题
      let topicId = task.topic_id;
      let isNewTopic = false;
      if (!topicId) {
        // 创建新话题
        topicId = await chatService.createNewTopic(
          task.created_by,
          task.expert_id,
          `自主任务: ${task.title}`,
          task.id
        );
        isNewTopic = true;

        // 更新任务的 topic_id
        await models.Task.update(
          { topic_id: topicId },
          { where: { id: task.id } }
        );
      }

      // 获取历史上下文消息（按 expert_id + user_id 查询，新消息的 topic_id 为 NULL）
      const contextMessages = await getContextMessages(task.expert_id, task.created_by);
      logger.info(`[AutonomousExecutor] 获取到 ${contextMessages.length} 条历史上下文消息`);

      // 【两步调用流程】
      // 步骤 1: 用 InternalLLMService 生成 PM 指导建议
      const internalLLM = new InternalLLMService(db);
      const pmPrompt = buildPMPrompt(task, contextMessages);
      
      let guidanceMessage;
      try {
        guidanceMessage = await internalLLM.generate(
          '你是一个项目管理助手（PM），负责监督 AI 专家的工作进展。你的任务是给出简洁、具体的指导建议，帮助专家继续推进任务。',
          pmPrompt,
          { expertId: task.expert_id }
        );
        logger.info(`[AutonomousExecutor] PM 生成指导建议: ${guidanceMessage.substring(0, 100)}...`);
      } catch (error) {
        logger.warn(`[AutonomousExecutor] PM 生成失败，使用默认指导: ${error.message}`);
        guidanceMessage = buildDefaultGuidance(task);
      }

      // 步骤 2: 把指导建议发给专家继续工作
      let result = { success: false };
      
      await new Promise((resolve) => {
        chatService.streamChat(
          {
            topic_id: topicId,
            user_id: task.created_by,
            expert_id: task.expert_id,
            content: guidanceMessage,
            task_id: task.id,
          },
          // onDelta - 忽略流式事件（后台任务不需要实时反馈）
          () => {},
          // onComplete - 完成回调
          (completeResult) => {
            result = {
              success: true,
              message_id: completeResult.message_id,
              content: completeResult.content,
            };
            resolve();
          },
          // onError - 错误回调
          (error) => {
            result = {
              success: false,
              error: error.message,
            };
            resolve();
          }
        );
      });

      if (result.success) {
        // 更新任务的最后执行时间
        await models.Task.update(
          { last_executed_at: new Date() },
          { where: { id: task.id } }
        );

        logger.info(`[AutonomousExecutor] 任务 ${task.id} 执行成功, 消息ID: ${result.message_id}`);
        return { success: true };
      } else {
        // 检查是否为速率限制错误
        if (isRateLimitError(result.error)) {
          logger.warn(`[AutonomousExecutor] 任务 ${task.id} 遇到速率限制: ${result.error}`);
          return { success: false, rateLimited: true };
        }
        
        logger.error(`[AutonomousExecutor] 任务 ${task.id} 执行失败: ${result.error}`);
        return { success: false };
      }

    } catch (error) {
      // 检查是否为速率限制错误
      if (isRateLimitError(error)) {
        logger.warn(`[AutonomousExecutor] 任务 ${task.id} 遇到速率限制异常: ${error.message}`);
        return { success: false, rateLimited: true };
      }
      
      logger.error(`[AutonomousExecutor] 执行任务 ${task.id} 时发生错误:`, error.message);
      return { success: false };
    }
  }

  /**
   * 构建自主执行的提示消息
   *
   * 设计思路：
   * - LLM 扮演 PM 角色，监督专家的工作
   * - 提供最近 2 轮对话历史，让 PM 了解项目进展
   * - PM 根据进展指导专家推进项目
   *
   * @param {Object} task 任务对象
   * @param {Array} contextMessages 历史上下文消息
   * @returns {string} 提示消息
   */
  function buildAutonomousPrompt(task, contextMessages = []) {
    // 构建任务描述
    const taskDescription = task.description
      ? `${task.title}\n任务详情: ${task.description}`
      : task.title;

    // 构建历史上下文（最近 2 轮对话）
    let historySection = '';
    if (contextMessages.length > 0) {
      // 格式化为 JSON 结构，便于 LLM 理解
      const formattedHistory = contextMessages.map(msg => ({
        role: msg.role,
        content: truncateContent(msg.content || '(无内容)', 800),
        timestamp: msg.created_at,
      }));
      
      historySection = `
--------
【最近对话记录】
\`\`\`json
${JSON.stringify(formattedHistory, null, 2)}
\`\`\`
`;
    }

    // PM 角色的提示词
    const prompt = `当前项目是「${taskDescription}」，你是当前项目的 PM，负责监督专家的工作。
以下是项目的进展，请根据项目要求和专家的进展，指导专家推进项目。
注意：要求专家不能跳过必要步骤，遇到困难要尝试不同解决方案，不要轻易放弃。
${historySection}
--------
请根据上述项目进展，给出你的指导建议，帮助专家继续推进任务。`;

    return prompt;
  }

  /**
   * 构建 PM 提示词（用于 InternalLLMService）
   *
   * PM 角色说明：
   * - PM 是项目管理助手，监督专家的工作进展
   * - PM 根据历史对话了解项目状态
   * - PM 给出简洁、具体的指导建议
   *
   * @param {Object} task 任务对象
   * @param {Array} contextMessages 历史上下文消息
   * @returns {string} PM 提示词
   */
  function buildPMPrompt(task, contextMessages = []) {
    // 构建任务描述
    const taskDescription = task.description
      ? `${task.title}\n任务详情: ${task.description}`
      : task.title;

    // 构建历史上下文
    let historySection = '';
    if (contextMessages.length > 0) {
      const formattedHistory = contextMessages.map(msg => {
        if (msg.role === 'tool') {
          return `【工具调用】${msg.name}: ${msg.content}`;
        }
        const roleLabel = msg.role === 'user' ? '用户' : '专家';
        return `【${roleLabel}】${msg.content}`;
      }).join('\n\n');
      
      historySection = `
--------
【最近对话记录】
${formattedHistory}
`;
    } else {
      historySection = `
--------
【最近对话记录】
（暂无对话记录，这是任务的第一次执行）
`;
    }

    const prompt = `你是一个项目管理助手（PM），负责监督 AI 专家的工作进展。

当前任务：${taskDescription}
${historySection}
--------
请根据上述任务要求和专家的工作进展，给出简洁、具体的指导建议（不超过 200 字），帮助专家继续推进任务。

注意：
1. 如果专家刚完成某个步骤，指导下一步该做什么
2. 如果专家遇到困难，建议尝试其他方案
3. 如果专家跳过了必要步骤，要求其补充
4. 不要重复专家已经完成的工作`;

    return prompt;
  }

  /**
   * 构建默认指导消息（当 PM 生成失败时的后备方案）
   *
   * @param {Object} task 任务对象
   * @returns {string} 默认指导消息
   */
  function buildDefaultGuidance(task) {
    const taskDescription = task.description
      ? `${task.title}: ${task.description}`
      : task.title;

    return `请继续推进任务「${taskDescription}」。

如果你刚完成某个步骤，请继续下一步。
如果遇到问题，请尝试不同的解决方案。
请确保完成所有必要的工作，不要跳过关键步骤。`;
  }

  /**
   * 截断过长的内容
   * @param {string} content 原始内容
   * @param {number} maxLength 最大长度
   * @returns {string} 截断后的内容
   */
  function truncateContent(content, maxLength = 800) {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength) + '...(内容已截断)';
  }

  return async function autonomousTaskHandler(db) {
    ensureModels(db);

    console.log('[AutonomousExecutor] 🔍 检查需要执行的自主任务...');
    logger.info('[AutonomousExecutor] Checking for autonomous tasks...');

    // 检查是否处于速率限制暂停期
    if (isRateLimited()) {
      const remainingMs = rateLimitedUntil - Date.now();
      console.log(`[AutonomousExecutor] ⏸️ 速率限制暂停中，剩余 ${Math.ceil(remainingMs / 1000)} 秒`);
      logger.info(`[AutonomousExecutor] Rate limited, skipping. ${Math.ceil(remainingMs / 1000)}s remaining`);
      return;
    }

    try {
      // 查找所有 status='autonomous' 的任务
      const autonomousTasks = await models.Task.findAll({
        where: {
          status: 'autonomous',
        },
        attributes: [
          'id', 'task_id', 'title', 'description', 'status',
          'expert_id', 'created_by', 'topic_id', 'last_executed_at',
          'workspace_path',
        ],
        raw: true,
      });

      if (autonomousTasks.length === 0) {
        console.log('[AutonomousExecutor] ✅ 没有自主任务需要执行');
        return;
      }

      console.log(`[AutonomousExecutor] 📝 发现 ${autonomousTasks.length} 个自主任务`);

      // 过滤出需要执行的任务
      const tasksToExecute = autonomousTasks.filter(shouldExecute);

      if (tasksToExecute.length === 0) {
        console.log('[AutonomousExecutor] ⏳ 所有自主任务都在执行间隔内，跳过');
        return;
      }

      console.log(`[AutonomousExecutor] 🚀 准备执行 ${tasksToExecute.length} 个任务`);

      // 执行任务（限制批次大小）
      const batch = tasksToExecute.slice(0, batchSize);
      let successCount = 0;
      let failCount = 0;

      for (const task of batch) {
        // 在执行每个任务前检查速率限制
        if (isRateLimited()) {
          console.log(`[AutonomousExecutor] ⏸️ 批次执行中断：检测到速率限制`);
          break;
        }

        const result = await executeTask(task, db);
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          // 如果遇到速率限制，设置暂停并中断批次执行
          if (result.rateLimited) {
            setRateLimit();
            break;
          }
        }
      }

      console.log(`[AutonomousExecutor] ✅ 执行完成: ${successCount} 成功, ${failCount} 失败`);
      logger.info(`[AutonomousExecutor] Completed: ${successCount} success, ${failCount} failed`);

    } catch (error) {
      console.error('[AutonomousExecutor] ❌ 检查自主任务时发生错误:', error.message);
      logger.error('[AutonomousExecutor] Error checking autonomous tasks:', error);
    }
  };
}

export default createAutonomousTaskExecutor;