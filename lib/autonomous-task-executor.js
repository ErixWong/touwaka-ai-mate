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
   * 获取任务的历史上下文消息
   * @param {string} topicId - 话题ID
   * @param {number} limit - 消息数量限制
   * @returns {Promise<Array>} 历史消息数组
   */
  async function getContextMessages(topicId, limit = contextMessagesCount) {
    if (!topicId) return [];
    
    try {
      const messages = await models.Message.findAll({
        where: { topic_id: topicId },
        attributes: ['id', 'role', 'content', 'created_at'],
        order: [['created_at', 'DESC']],
        limit,
        raw: true,
      });
      
      // 反转顺序，使最新消息在最后
      return messages.reverse();
    } catch (error) {
      logger.error(`[AutonomousExecutor] 获取历史上下文失败: ${error.message}`);
      return [];
    }
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

      // 获取历史上下文消息（仅当话题已存在时）
      const contextMessages = isNewTopic ? [] : await getContextMessages(topicId);
      logger.info(`[AutonomousExecutor] 获取到 ${contextMessages.length} 条历史上下文消息`);

      // 构建自主执行的提示消息（包含历史上下文）
      const autonomousPrompt = buildAutonomousPrompt(task, contextMessages);

// 使用 ChatService 生成回复（流式调用，支持多轮工具调用）
      // 虽然是后台任务，但使用 streamChat 可以获得更完善的工具调用处理
      let result = { success: false };
      
      await new Promise((resolve) => {
        chatService.streamChat(
          {
            topic_id: topicId,
            user_id: task.created_by,
            expert_id: task.expert_id,
            content: autonomousPrompt,
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
   * @param {Object} task 任务对象
   * @param {Array} contextMessages 历史上下文消息
   * @returns {string} 提示消息
   */
  function buildAutonomousPrompt(task, contextMessages = []) {
    const parts = [
      `【自主任务执行】`,
      ``,
      `任务标题: ${task.title}`,
    ];

    if (task.description) {
      parts.push(`任务描述: ${task.description}`);
    }

    // 添加历史上下文（如果有）
    if (contextMessages.length > 0) {
      parts.push(``);
      parts.push(`【最近执行历史】`);
      parts.push(`(以下是你之前的执行记录，请参考以判断当前进度)`);
      parts.push(``);
      
      for (const msg of contextMessages) {
        const roleLabel = msg.role === 'user' ? '📥 系统提示' : 
                          msg.role === 'assistant' ? '🤖 你的回复' :
                          msg.role === 'tool' ? '🔧 工具结果' : msg.role;
        
        // 截断过长的内容
        const content = msg.content || '(无内容)';
        const truncatedContent = content.length > 500 
          ? content.substring(0, 500) + '...(已截断)' 
          : content;
        
        parts.push(`${roleLabel}:`);
        parts.push(`${truncatedContent}`);
        parts.push(``);
      }
    }

    // 添加执行指导
    parts.push(`【执行指导】`);
    parts.push(``);
    parts.push(`1. 请完整执行任务，不要跳过必要步骤，不要敷衍了事`);
    parts.push(`2. 如果遇到困难，请尝试不同的解决方案，不要轻易放弃`);
    parts.push(`3. 根据历史上下文判断当前进度，继续未完成的工作`);
    parts.push(`4. 如果需要使用工具，请直接调用`);
    parts.push(`5. 任务完成后，请汇报最终结果`);
    
    // 检测历史中是否有未回答的问题
    const lastAssistantMessages = contextMessages
      .filter(m => m.role === 'assistant')
      .slice(-2);  // 检查最近 2 条助手消息
    
    const hasUnansweredQuestion = lastAssistantMessages.some(msg => {
      const content = msg.content || '';
      // 检测是否包含问题标记（中文或英文问号）
      const hasQuestion = content.includes('?') || content.includes('？');
      // 检测是否包含询问性语句
      const isAsking = content.includes('我应该') || 
                       content.includes('我该') ||
                       content.includes('请问') ||
                       content.includes('如何') ||
                       content.includes('怎么');
      return hasQuestion && isAsking;
    });
    
    if (hasUnansweredQuestion) {
      parts.push(``);
      parts.push(`【注意】`);
      parts.push(`检测到你上次提出了问题。请根据任务描述自行决策并继续执行，不要等待外部输入。`);
      parts.push(`如果问题不影响任务执行，可以先搁置并继续其他工作。`);
    }

    parts.push(``);
    parts.push(`请开始执行任务。`);

    return parts.join('\n');
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