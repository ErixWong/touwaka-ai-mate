/**
 * Autonomous Task Executor - 自主任务执行器
 *
 * 作为 BackgroundTaskScheduler 的任务处理器
 * 定期扫描 status='autonomous_wait' 的任务，自动触发 AI 执行
 *
 * 工作流程：
 * 1. 查找所有 status='autonomous_wait' 或 'autonomous_working' 的任务
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
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import InternalLLMService from './internal-llm-service.js';

/**
 * 创建自主任务执行器
 * @param {Object} options 配置选项
 * @param {Object} options.chatService ChatService 实例
 * @param {number} options.batchSize 每批处理的任务数量（默认 5）
 * @param {number} options.minIntervalMinutes 最小执行间隔（分钟，默认 1）
 * @param {number} options.rateLimitCooldownMs 速率限制冷却时间（毫秒，默认 60000）
 * @param {number} options.contextCharLimit PM上下文总字符预算（默认 12000）
 * @returns {Function} 任务处理函数
 */
// autonomous_working 状态超时时间（毫秒）
// 如果任务在此状态超过此时间，自动恢复为 autonomous_wait
// 默认 10 分钟，防止因异常导致 EOF 未触发而造成的死锁
const WORKING_TIMEOUT_MS = 10 * 60 * 1000;

const TASK_STATUS = {
  ACTIVE: 'active',
  AUTONOMOUS_WAIT: 'autonomous_wait',
  AUTONOMOUS_WORKING: 'autonomous_working',
  ERROR: 'error',
  ARCHIVED: 'archived',
  DELETED: 'deleted',
};

export function createAutonomousTaskExecutor(options = {}) {
  const {
    chatService,
    batchSize = 5,
    minIntervalMinutes = 15,  // 默认 15 分钟检查一次
    rateLimitCooldownMs = 60000,
    contextCharLimit = 12000,  // PM上下文总字符预算（按对话轮次倒推纳入）
    maxNoResponseCount = 2,    // 连续无响应最大次数
    maxPMFailureCount = 3,     // PM 连续失败最大次数
  } = options;

  // 速率限制状态
  let rateLimitedUntil = 0;  // 速率限制解除的时间戳（毫秒）

  // 缓存模型引用
  let models = null;

  // 跟踪每个任务的连续无响应次数（内存缓存）
  const noResponseCountMap = new Map();  // taskId -> count

  // 跟踪每个任务的 PM 连续失败次数（内存缓存）
  const pmFailureCountMap = new Map();  // taskId -> count

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
   * 恢复超时任务到 autonomous_wait 状态
   * @param {Object} task 任务对象
   * @returns {Promise<boolean>} 是否进行了恢复
   */
  async function recoverTimeoutTask(task) {
    if (task.status !== TASK_STATUS.AUTONOMOUS_WORKING) {
      return false;
    }

    const workingDuration = Date.now() - new Date(task.last_executed_at).getTime();
    if (workingDuration <= WORKING_TIMEOUT_MS) {
      return false;
    }

    console.log(`[AutonomousExecutor] ⚠️ 任务 ${task.id} 在 autonomous_working 状态超时 (${Math.round(workingDuration / 1000)}s)，自动恢复为 autonomous_wait`);
    logger.warn(`[AutonomousExecutor] 任务 ${task.id} 在 autonomous_working 状态超时 (${Math.round(workingDuration / 1000)}s)，自动恢复为 autonomous_wait`);
    await models.Task.update(
      { status: TASK_STATUS.AUTONOMOUS_WAIT },
      { where: { id: task.id } }
    );
    return true;
  }

  /**
   * 检查任务是否需要执行
   *
   * 状态机设计：
   * ┌─────────────────────────────────────────────────────────────┐
   * │  autonomous_wait  ──(轮询触发)──▶  autonomous_working       │
   * │        ▲                               │                    │
   * │        │                               │ (执行完成/EOF)      │
   * │        │                               │ (或超时自动恢复)    │
   * │        └───────────────────────────────┘                    │
   * └─────────────────────────────────────────────────────────────┘
   *
   * 状态说明：
   * - autonomous_wait: LLM 处理完毕，等待下次轮询
   * - autonomous_working: LLM 正在处理中，跳过轮询
   *
   * 执行条件：
   * 1. 状态必须是 autonomous_wait（不能是 autonomous_working）
   * 2. 连续无响应次数 < maxNoResponseCount
   *
   * 注意：自动运行模式下用户不能输入消息，所以不需要检查"新消息"
   * 执行频率由轮询间隔和速率限制控制
   *
   * @param {Object} task 任务对象
   * @returns {Promise<boolean>} 是否需要执行
   */
  async function shouldExecute(task) {
    // 状态必须是 autonomous_wait 才能执行
    if (task.status !== TASK_STATUS.AUTONOMOUS_WAIT) {
      console.log(`[AutonomousExecutor] ⏭️ 跳过任务 ${task.id}: 状态不是 autonomous_wait (当前: ${task.status})`);
      return false;
    }

    // autonomous_wait 状态下直接执行
    // 注意：自动运行模式下用户不能输入，所以不需要检查"新消息"
    // 执行频率由轮询间隔和速率限制控制
    console.log(`[AutonomousExecutor] ▶️ 任务 ${task.id}: 状态为 autonomous_wait，准备执行`);
    return true;
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
   * 1. 找到最近的 10 个 user 和 10 个 assistant 消息（扩大查询范围）
   * 2. 获取时间窗口内所有消息（含 tool），按时间正序
   * 3. 按对话轮次分组（user → assistant+tools → 下一轮 user）
   * 4. 从最新轮倒推累积，每轮添加前检查上下文预算
   * 5. tool 消息只保留：工具名(参数摘要) ✅/❌（不传完整结果）
   *
   * @param {string} expertId - 专家ID
   * @param {string} userId - 用户ID
   * @param {number} contextCharLimit - 上下文总字符预算（默认 12000）
   * @returns {Promise<{lines: string[], stats: {conversationRounds: number, toolSuccess: number, toolFail: number}}>}
   */
  async function getContextMessages(expertId, userId, contextCharLimit = 12000) {
    const empty = { lines: [], stats: { conversationRounds: 0, toolSuccess: 0, toolFail: 0 } };
    if (!expertId || !userId) return empty;
    
    try {
      // 1. 获取最近的 user 和 assistant 消息的时间戳（扩大范围，倒推时会自动受预算限制）
      const recentUserMsg = await models.Message.findAll({
        where: { expert_id: expertId, user_id: userId, role: 'user' },
        attributes: ['created_at'],
        order: [['created_at', 'DESC']],
        limit: 10,
        raw: true,
      });
      const recentAssistantMsg = await models.Message.findAll({
        where: { expert_id: expertId, user_id: userId, role: 'assistant' },
        attributes: ['created_at'],
        order: [['created_at', 'DESC']],
        limit: 10,
        raw: true,
      });
      
      const coreMsgList = [...recentUserMsg, ...recentAssistantMsg];
      if (coreMsgList.length === 0) return empty;
      
      const earliestTime = coreMsgList.reduce((min, msg) => {
        const t = new Date(msg.created_at);
        return t < min ? t : min;
      }, new Date(coreMsgList[0].created_at));
      
      // 2. 获取时间窗口内的所有消息
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
      if (allMessages.length === 0) return empty;
      
      // 3. 按对话轮次分组（每轮以 user 消息为界）
      const rounds = [];
      let currentRound = null;
      for (const msg of allMessages) {
        if (msg.role === 'user') {
          if (currentRound) rounds.push(currentRound);
          currentRound = { msgs: [msg] };
        } else if (currentRound) {
          currentRound.msgs.push(msg);
        } else {
          // 第一条不是 user，作为独立的前置轮（孤立的 assistant/tool）
          currentRound = { msgs: [msg] };
        }
      }
      if (currentRound) rounds.push(currentRound);
      
      // 4. 格式化每轮为紧凑文本行 + 统计元数据
      const formattedRounds = rounds.map((round, index) => {
        const { lines, toolStats, hasUser } = formatRoundLines(round);
        return { index, lines, toolStats, hasUser };
      });
      
      // 5. 从最新轮向前累积，每轮添加前检查预算
      // - 若最新一轮单轮就超预算，则强制纳入最新轮（截断 user 消息），保证 PM 始终有输入
      // - 后续更老的轮次超预算则 break
      const selectedRounds = [];
      let usedChars = 0;
      for (let i = formattedRounds.length - 1; i >= 0; i--) {
        const round = formattedRounds[i];
        const roundChars = round.lines.reduce((sum, l) => sum + l.length, 0) + round.lines.length * 2;
        if (usedChars + roundChars > contextCharLimit) {
          if (i === formattedRounds.length - 1 && selectedRounds.length === 0) {
            // 最新轮单轮超预算，按行均匀分配预算强制纳入
            const lineCount = round.lines.length;
            const perLineBudget = Math.floor(contextCharLimit / lineCount);
            round.lines = round.lines.map(line => {
              if (line.startsWith('【用户】') || line.startsWith('【专家】')) {
                const label = line.slice(0, line.indexOf('】') + 1);
                const body = line.slice(label.length);
                return `${label}${truncateContent(body, perLineBudget)}`;
              }
              return line;
            });
            selectedRounds.unshift(round);
            usedChars += round.lines.reduce((sum, l) => sum + l.length, 0) + round.lines.length * 2;
          }
          break;
        }
        selectedRounds.unshift(round);
        usedChars += roundChars;
      }
      
      // 6. 合并 lines + 累计结构化统计（全部从结构化字段读取，不依赖字符串前缀）
      const allLines = selectedRounds.flatMap(r => r.lines);
      let conversationRounds = 0;
      let toolSuccess = 0;
      let toolFail = 0;
      for (const round of selectedRounds) {
        if (round.hasUser) conversationRounds++;
        toolSuccess += round.toolStats.success;
        toolFail += round.toolStats.fail;
      }
      
      logger.info(
        `[AutonomousExecutor] PM上下文: 共 ${rounds.length} 轮对话，纳入最近 ${selectedRounds.length} 轮，` +
        `使用约 ${usedChars}/${contextCharLimit} 字符`
      );
      return { lines: allLines, stats: { conversationRounds, toolSuccess, toolFail } };
    } catch (error) {
      logger.error(`[AutonomousExecutor] 获取历史上下文失败: ${error.message}`);
      return empty;
    }
  }

  /**
   * 格式化一轮对话为紧凑文本行
   * @param {Object} round - { msgs: [...] }
   * @returns {{lines: string[], toolStats: {success: number, fail: number}, hasUser: boolean}}
   */
  function formatRoundLines(round) {
    const lines = [];
    const toolStats = { success: 0, fail: 0 };
    let hasUser = false;
    for (const msg of round.msgs) {
      if (msg.role === 'user') {
        lines.push(`【用户】${truncateContent(msg.content || '(无内容)', 800)}`);
        hasUser = true;
      } else if (msg.role === 'assistant') {
        lines.push(`【专家】${truncateContent(msg.content || '(无内容)', 800)}`);
      } else if (msg.role === 'tool') {
        const { summary, success } = buildToolCallSummary(msg);
        lines.push(`【工具调用】${summary}`);
        if (success) toolStats.success++;
        else toolStats.fail++;
      }
    }
    return { lines, toolStats, hasUser };
  }

  /**
   * 构建工具调用摘要（工具名 + 参数摘要 + 成功状态）
   * @param {Object} msg - 工具消息对象
   * @returns {{summary: string, success: boolean}}
   */
  function buildToolCallSummary(msg) {
    let toolName = '未知工具';
    let success = true;
    let argSummary = '';
    
    try {
      const tc = typeof msg.tool_calls === 'string'
        ? JSON.parse(msg.tool_calls)
        : (msg.tool_calls || {});
      
      toolName = tc.name || toolName;
      success = tc.success !== false;
      
      // 构建参数摘要（取最关键的 key-value）
      const rawArgs = tc.arguments;
      if (rawArgs) {
        let argsObj;
        try {
          argsObj = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
        } catch {
          argsObj = null;
        }
        if (argsObj && typeof argsObj === 'object') {
          const keys = Object.keys(argsObj);
          const summaryKeys = keys
            .slice(0, 3)
            .map(k => `${k}=${truncateContent(String(argsObj[k]), 50)}`)
            .join(', ');
          argSummary = `(${summaryKeys})`;
        }
      } else if (tc.context) {
        argSummary = `(${tc.context})`;
      }
    } catch {
      // 解析失败，只用参数摘要
    }
    
    return { summary: `${toolName}${argSummary} ${success ? '✅' : '❌'}`, success };
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

      // 开始执行时立即更新状态为 autonomous_working 和 last_executed_at
      // 状态说明：
      // - autonomous_working: LLM 正在处理中，轮询时跳过
      // - 完成后由 ChatService 在 EOF 时设回 autonomous_wait
      console.log(`[AutonomousExecutor] ⚡ 准备更新任务 ${task.id.substr(0,8)} 状态为 autonomous_working`);
      await models.Task.update(
        {
          status: TASK_STATUS.AUTONOMOUS_WORKING,
          last_executed_at: new Date()
        },
        { where: { id: task.id } }
      );
      console.log(`[AutonomousExecutor] ✅ 任务 ${task.id.substr(0,8)} 状态已设为 autonomous_working`);

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
      if (!topicId) {
        // 创建新话题
        topicId = await chatService.createNewTopic(
          task.created_by,
          task.expert_id,
          `自主任务: ${task.title}`,
          task.id
        );

        // 更新任务的 topic_id
        await models.Task.update(
          { topic_id: topicId },
          { where: { id: task.id } }
        );
      }

      // 获取历史上下文消息（按 expert_id + user_id 查询，按对话轮次倒推累积，受上下文预算限制）
      const { lines: contextLines, stats: contextStats } = await getContextMessages(task.expert_id, task.created_by, contextCharLimit);

      // 读取任务工作区的 README.md
      const readmeContent = readTaskReadme(task.workspace_path);
      if (readmeContent) {
        logger.info(`[AutonomousExecutor] 读取到 README.md (${readmeContent.length} 字符)`);
      }

      // 【两步调用流程】
      // 步骤 1: 用 InternalLLMService 的 extractJson 方法让 PM 判断任务状态并生成指导建议
      const internalLLM = new InternalLLMService(db);
      const pmPrompt = buildPMPrompt(task, contextLines, readmeContent, contextStats);
      
      let pmResult;
      let guidanceMessage;
      let isTaskCompleted = false;
      
      try {
        pmResult = await internalLLM.extractJson(
          '你是一个项目管理助手（PM），负责监督 AI 专家的工作进展。你需要判断任务是否完成，并给出指导建议。',
          pmPrompt,
          {
            expertId: task.expert_id,
            defaultValue: {
              is_completed: false,
              guidance: buildDefaultGuidance(task),
              completion_reason: null
            }
          }
        );

        // 防御：PM 返回 null 时使用默认值
        if (!pmResult) {
          pmResult = {
            is_completed: false,
            guidance: buildDefaultGuidance(task),
            completion_reason: null
          };
        }

        isTaskCompleted = pmResult.is_completed === true;
        guidanceMessage = pmResult.guidance || buildDefaultGuidance(task);
        
        // PM 成功，重置失败计数
        pmFailureCountMap.set(task.id, 0);
        
        if (isTaskCompleted) {
          console.log(`[AutonomousExecutor] ✅ PM 判断任务 ${task.id} 已完成: ${pmResult.completion_reason || '未提供原因'}`);
          logger.info(`[AutonomousExecutor] PM 判断任务 ${task.id} 已完成: ${pmResult.completion_reason}`);
        } else {
          logger.info(`[AutonomousExecutor] PM 生成指导建议: ${guidanceMessage.substring(0, 100)}...`);
        }
      } catch (error) {
        logger.warn(`[AutonomousExecutor] PM 判断失败，使用默认指导: ${error.message}`);
        guidanceMessage = buildDefaultGuidance(task);
        
        // 增加 PM 失败计数
        const pmFailureCount = (pmFailureCountMap.get(task.id) || 0) + 1;
        pmFailureCountMap.set(task.id, pmFailureCount);
        console.log(`[AutonomousExecutor] ⚠️ 任务 ${task.id} PM 失败计数: ${pmFailureCount}/${maxPMFailureCount}`);
        
        // 如果 PM 连续失败次数达到上限，将任务标记为 error
        if (pmFailureCount >= maxPMFailureCount) {
          await models.Task.update(
            { status: TASK_STATUS.ERROR },
            { where: { id: task.id } }
          );
          // 任务进入 error 终态，释放内存计数器
          noResponseCountMap.delete(task.id);
          pmFailureCountMap.delete(task.id);
          console.log(`[AutonomousExecutor] ❌ 任务 ${task.id} PM 连续失败 ${pmFailureCount} 次，标记为 error 状态`);
          logger.error(`[AutonomousExecutor] Task ${task.id} marked as error: ${pmFailureCount} consecutive PM failures`);
          return { success: false, pmFailed: true };
        }
      }

      // 如果 PM 判断任务已完成，更新状态为 active 并跳过专家调用
      if (isTaskCompleted) {
        await models.Task.update(
          { status: TASK_STATUS.ACTIVE },
          { where: { id: task.id } }
        );
        // 任务进入 active 终态，释放内存计数器
        noResponseCountMap.delete(task.id);
        pmFailureCountMap.delete(task.id);
        console.log(`[AutonomousExecutor] 🏁 任务 ${task.id} 已标记为完成，状态更新为 active`);
        logger.info(`[AutonomousExecutor] Task ${task.id} marked as completed, status changed to active`);
        return { success: true, completed: true };
      }

      // 步骤 2: 把指导建议发给专家继续工作
      let result = { success: false };
      
      // 添加超时保护（默认 5 分钟）
      const streamTimeout = 5 * 60 * 1000;
      await new Promise((resolve) => {
        let resolved = false;
        
        // 超时定时器
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            result = {
              success: false,
              error: `streamChat timeout after ${streamTimeout}ms`,
            };
            logger.error(`[AutonomousExecutor] 任务 ${task.id} streamChat 超时`);
            resolve();
          }
        }, streamTimeout);
        
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
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              result = {
                success: true,
                message_id: completeResult.message_id,
                content: completeResult.content,
              };
              resolve();
            }
          },
          // onError - 错误回调
          (error) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeoutId);
              result = {
                success: false,
                error: error.message,
              };
              resolve();
            }
          }
        );
      });

      if (result.success) {
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
   * 构建 PM 提示词（用于 InternalLLMService）
   *
   * PM 角色说明：
   * - PM 是项目管理助手，监督专家的工作进展
   * - PM 根据历史对话了解项目状态
   * - PM 判断任务是否完成，并给出指导建议
   *
   * @param {Object} task 任务对象
   * @param {string[]} contextLines 历史上下文文本行数组
   * @param {string|null} readmeContent README.md 内容
   * @param {{conversationRounds: number, toolSuccess: number, toolFail: number}} stats 执行统计
   * @returns {string} PM 提示词
   */
  function buildPMPrompt(task, contextLines = [], readmeContent = null, stats = {}) {
    const { conversationRounds = 0, toolSuccess = 0, toolFail = 0 } = stats;

    // 构建任务描述
    const taskDescription = task.description
      ? `${task.title}\n任务详情: ${task.description}`
      : task.title;

    // 构建执行统计区域
    const toolTotal = toolSuccess + toolFail;
    const statsMessages = `
--------
【执行统计】
- 对话轮数（可见范围）: ${conversationRounds} 轮
- 工具调用: ${toolTotal} 次（成功 ${toolSuccess}，失败 ${toolFail}）
`;

    // 构建 README 区域
    let readmeSection = '';
    if (readmeContent) {
      readmeSection = `
--------
【任务说明文档 (README.md)】
${readmeContent}
`;
    }

    // 构建历史上下文（contextLines 为 string[]，已按时间正序排列）
    let historySection = '';
    if (contextLines.length > 0) {
      const formattedHistory = contextLines.join('\n');
      
      historySection = `
--------
【最近对话记录】
（按对话轮次从近到远回溯纳入，工具仅显示调用名、参数和成功状态）
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
${readmeSection}${statsMessages}${historySection}

--------
请分析上述任务要求和专家的工作进展，返回 JSON 格式的判断结果。

**任务完成判断标准**：
1. 任务目标已明确达成（如：文件已生成、报告已完成、代码已实现）
2. 专家明确表示任务已完成或无法继续
3. 任务目标已无法实现（如：资源不可用、需求冲突）

**重点关注以下情况（guidance 中必须体现）**：
- **陷入循环**：如果对话历史中专家反复执行相同操作却无进展，请在 guidance 中明确指出如何跳出循环或调整策略
- **工具调用达到上限**：如果对话中出现了「已达工具调用上限」相关标记，说明专家本次执行的资源已耗尽，此时 guidance 应包含：当前进展总结、下一步优先做什么、是否应拆分任务
- **长时间无进展**：如果对话轮数较多但无实质性突破，请建议是否需要暂停、人工介入或调整方向

**注意**：如果专家正在积极工作、遇到问题正在解决、或任务目标尚未达成，请返回 is_completed: false

请返回以下 JSON 格式：
{
  "is_completed": boolean,  // 任务是否已完成
  "guidance": string,       // 给专家的指导建议（不超过 500 字），需针对上述重点情况给出详细、可执行的指导；任务完成时可简短总结
  "completion_reason": string | null  // 如果任务完成，说明完成原因；否则为 null
}`;

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
保持关注任务目标，按你的专业判断推进工作。`;
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
    let truncated = content.substring(0, maxLength);
    // 修复 Unicode 代理字符截断
    const lastChar = truncated.charCodeAt(truncated.length - 1);
    if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
      truncated = truncated.substring(0, truncated.length - 1);
    }
    return truncated + '...(内容已截断)';
  }

  /**
   * 读取任务工作区的 README.md
   * @param {string} workspacePath - 工作区路径
   * @returns {string|null} README 内容，不存在则返回 null
   */
  function readTaskReadme(workspacePath) {
    if (!workspacePath) return null;
    
    try {
      const readmePath = path.join(workspacePath, 'README.md');
      if (fs.existsSync(readmePath)) {
        const content = fs.readFileSync(readmePath, 'utf-8');
        // 限制 README 长度，避免过长
        return truncateContent(content, 2000);
      }
    } catch (error) {
      logger.warn(`[AutonomousExecutor] 读取 README 失败: ${error.message}`);
    }
    return null;
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
      // 查找所有 status='autonomous_wait' 或 'autonomous_working' 的任务
      const autonomousTasks = await models.Task.findAll({
        where: {
          status: { [Op.in]: [TASK_STATUS.AUTONOMOUS_WAIT, TASK_STATUS.AUTONOMOUS_WORKING] },
        },
        attributes: [
          'id', 'task_id', 'title', 'description', 'status',
          'expert_id', 'created_by', 'topic_id', 'last_executed_at',
          'workspace_path',
        ],
        raw: true,
      });

      console.log(`[AutonomousExecutor] 📋 查询到 ${autonomousTasks.length} 个自主任务:`, autonomousTasks.map(t => `${t.id.substr(0,8)}:${t.status}`));

      if (autonomousTasks.length === 0) {
        console.log('[AutonomousExecutor] ✅ 没有自主任务需要执行');
        return;
      }

      console.log(`[AutonomousExecutor] 📝 发现 ${autonomousTasks.length} 个自主任务`);

      // 过滤出需要执行的任务
      const tasksToExecute = [];
      console.log(`[AutonomousExecutor] 🔍 开始过滤 ${autonomousTasks.length} 个任务...`);
      for (const task of autonomousTasks) {
        console.log(`[AutonomousExecutor] 📝 检查任务 ${task.id.substr(0,8)}: status=${task.status}, last_executed_at=${task.last_executed_at}`);
        // 步骤1: 恢复超时任务（先检查 autonomous_working 是否超时）
        const wasRecovered = await recoverTimeoutTask(task);
        if (wasRecovered) {
          // 恢复后更新本地 task 对象的状态，以便后续 shouldExecute 检查通过
          task.status = TASK_STATUS.AUTONOMOUS_WAIT;
        }

        // 检查连续无响应次数
        const noResponseCount = noResponseCountMap.get(task.id) || 0;
        if (noResponseCount >= maxNoResponseCount) {
          console.log(`[AutonomousExecutor] ❌ 任务 ${task.id} 已连续 ${noResponseCount} 次无响应，标记为 error 状态`);
          logger.warn(`[AutonomousExecutor] Task ${task.id} marked as error: ${noResponseCount} consecutive no-response`);
          // 将任务状态设为 error
          await models.Task.update(
            { status: TASK_STATUS.ERROR },
            { where: { id: task.id } }
          );
          // 任务进入 error 终态，释放内存计数器
          noResponseCountMap.delete(task.id);
          pmFailureCountMap.delete(task.id);
          continue;
        }

        // 步骤2: 检查是否需要执行（只看 autonomous_wait 状态）
        const shouldExec = await shouldExecute(task);
        console.log(`[AutonomousExecutor] 🔎 shouldExecute(${task.id.substr(0,8)}) = ${shouldExec}`);
        if (shouldExec) {
          tasksToExecute.push(task);
        }
      }

      console.log(`[AutonomousExecutor] ✅ 过滤后有 ${tasksToExecute.length} 个任务需要执行`);

      if (tasksToExecute.length === 0) {
        console.log('[AutonomousExecutor] ⏳ 没有需要执行的任务');
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

        console.log(`[AutonomousExecutor] 🚀 开始执行任务 ${task.id.substr(0,8)}`);
        const result = await executeTask(task, db);
        console.log(`[AutonomousExecutor] 🏁 任务 ${task.id.substr(0,8)} 执行完成, result=`, result);
        
        if (result.success) {
          successCount++;
          // 成功响应，重置所有失败计数
          noResponseCountMap.set(task.id, 0);
          pmFailureCountMap.set(task.id, 0);
        } else {
          failCount++;
          
          // 检查是否为无响应（不是速率限制错误）
          if (!result.rateLimited) {
            // 增加无响应计数
            const currentCount = noResponseCountMap.get(task.id) || 0;
            noResponseCountMap.set(task.id, currentCount + 1);
            console.log(`[AutonomousExecutor] ⚠️ 任务 ${task.id} 无响应计数: ${currentCount + 1}/${maxNoResponseCount}`);
          }
          
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