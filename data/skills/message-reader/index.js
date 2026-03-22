/**
 * Message Reader Skill
 * 提供消息内容检索能力，用于上下文优化中的按需获取
 *
 * 使用场景：
 * - 当工具消息被摘要后，AI 可以通过此技能获取完整消息内容
 * - 通过 message_id 检索特定的 tool 角色消息
 *
 * Issue #325 优化：
 * - 当工具结果超过阈值时，content 存摘要，完整结果存 tool_calls.result
 * - 此技能优先从 tool_calls.result 获取完整结果
 */

const logger = require('../../../lib/logger.js');
const db = require('../../../lib/db.js');

/**
 * 工具定义
 */
const tools = {
  get_message_content: {
    description: '获取指定工具消息的完整内容。当你在上下文中看到类似 "get_message_content("xxx")" 的提示时，可以使用此工具获取完整结果。',
    parameters: {
      type: 'object',
      properties: {
        tool_call_id: {
          type: 'string',
          description: '消息 ID，从上下文摘要中获取（格式如 "msg_xxx"）',
        },
      },
      required: ['tool_call_id'],
    },
  },
};

/**
 * 获取消息内容
 *
 * Issue #325 优化后的获取逻辑：
 * 1. 优先从 tool_calls.result 获取完整结果（新存储方式）
 * 2. 如果 tool_calls.result 不存在，使用 content 字段（旧存储方式或短结果）
 *
 * @param {Object} params - 参数
 * @param {string} params.tool_call_id - 消息 ID（消息主键）
 * @param {Object} context - 上下文
 * @returns {Promise<Object>} 消息内容
 */
async function get_message_content(params, context) {
  const { tool_call_id } = params;

  if (!tool_call_id) {
    return {
      success: false,
      error: '缺少 tool_call_id 参数',
    };
  }

  try {
    // tool_call_id 是消息主键 ID，直接用 ID 查询
    const messages = await db.query(`
      SELECT id, role, content, tool_calls, created_at
      FROM messages
      WHERE id = ?
      LIMIT 1
    `, [tool_call_id]);

    if (!messages || messages.length === 0) {
      return {
        success: false,
        error: `未找到 id="${tool_call_id}" 的消息`,
      };
    }

    const message = messages[0];

    // 验证消息角色
    if (message.role !== 'tool') {
      return {
        success: false,
        error: `消息 id="${tool_call_id}" 不是工具消息 (role=${message.role})`,
      };
    }

    // 解析 tool_calls JSON
    let toolMetaData = {};
    try {
      toolMetaData = typeof message.tool_calls === 'string'
        ? JSON.parse(message.tool_calls)
        : message.tool_calls || {};
    } catch (e) {
      logger.warn('[message-reader] 解析 tool_calls 失败:', e.message);
    }

    // Issue #325: 优先从 tool_calls.result 获取完整结果
    // 如果 result 字段存在，说明使用了新的摘要存储方式
    let fullContent;
    let isFromResult = false;
    
    if (toolMetaData.result !== undefined && toolMetaData.result !== null) {
      // 新存储方式：完整结果在 tool_calls.result 中
      fullContent = typeof toolMetaData.result === 'string'
        ? toolMetaData.result
        : JSON.stringify(toolMetaData.result);
      isFromResult = true;
      logger.info(`[message-reader] 从 tool_calls.result 获取完整内容: id=${message.id}, length=${fullContent.length}`);
    } else {
      // 旧存储方式或短结果：使用 content 字段
      fullContent = message.content || '';
      logger.info(`[message-reader] 从 content 获取内容: id=${message.id}, length=${fullContent.length}`);
    }

    return {
      success: true,
      tool_call_id,
      tool_name: toolMetaData.name || 'unknown',
      content: fullContent,
      content_length: fullContent.length,
      result_length: toolMetaData.result_length || fullContent.length,  // 原始结果长度
      is_from_result: isFromResult,  // 标识内容来源
      created_at: message.created_at,
    };
  } catch (error) {
    logger.error('[message-reader] Error retrieving message:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * 执行工具
 * @param {string} toolName - 工具名称
 * @param {Object} params - 参数
 * @param {Object} context - 上下文
 * @returns {Promise<Object>} 执行结果
 */
async function execute(toolName, params, context = {}) {
  switch (toolName) {
    case 'get_message_content':
      return await get_message_content(params, context);
    default:
      return {
        success: false,
        error: `Unknown tool: ${toolName}`,
      };
  }
}

module.exports = {
  execute,
  get_message_content,
  tools,
};