/**
 * Message Reader Skill
 * 提供消息内容检索能力，用于上下文优化中的按需获取
 * 
 * 使用场景：
 * - 当工具消息被摘要后，AI 可以通过此技能获取完整消息内容
 * - 通过 tool_call_id 检索特定的 tool 角色消息
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
          description: '工具调用 ID，从上下文摘要中获取',
        },
      },
      required: ['tool_call_id'],
    },
  },
};

/**
 * 获取消息内容
 * @param {Object} params - 参数
 * @param {string} params.tool_call_id - 工具调用 ID
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
    // tool_call_id 现在是消息主键 ID，直接用 ID 查询
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

    logger.info(`[message-reader] 检索到消息: id=${message.id}, content_length=${message.content?.length || 0}`);

    return {
      success: true,
      tool_call_id,
      tool_name: JSON.parse(message.tool_calls || '{}').name || 'unknown',
      content: message.content,
      content_length: message.content?.length || 0,
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