/**
 * Message Reader Skill
 * 
 * Retrieve full content of historical messages (especially tool results)
 * Used when context summarization shows a summary instead of full content
 * 
 * @module message-reader-skill
 */

const logger = require('../../../lib/logger.js');
const db = require('../../../lib/db.js');

/**
 * Get message content by tool_call_id
 * @param {Object} params - Tool parameters
 * @param {string} params.tool_call_id - The tool call ID to look up
 * @param {Object} context - Execution context
 * @returns {Promise<Object>} Message content
 */
async function get_message_content(params, context) {
  const { tool_call_id } = params;
  
  if (!tool_call_id) {
    return {
      success: false,
      error: 'tool_call_id is required',
    };
  }
  
  try {
    // Query the message by tool_call_id
    // The tool_call_id is stored in the tool_calls field as JSON
    const messages = await db.query(`
      SELECT id, role, content, tool_calls, created_at
      FROM messages
      WHERE role = 'tool' 
        AND JSON_EXTRACT(tool_calls, '$.tool_call_id') = ?
      ORDER BY created_at DESC
      LIMIT 1
    `, [tool_call_id]);
    
    if (!messages || messages.length === 0) {
      return {
        success: false,
        error: `Message not found for tool_call_id: ${tool_call_id}`,
      };
    }
    
    const message = messages[0];
    
    // Parse tool_calls to get tool name
    let toolName = 'unknown_tool';
    try {
      const toolCalls = typeof message.tool_calls === 'string' 
        ? JSON.parse(message.tool_calls) 
        : message.tool_calls;
      toolName = toolCalls?.name || 'unknown_tool';
    } catch (e) {
      // Ignore parse errors
    }
    
    logger.info(`[message-reader] Retrieved message content for tool_call_id: ${tool_call_id}`);
    
    return {
      success: true,
      content: message.content,
      tool_name: toolName,
      length: message.content?.length || 0,
      message_id: message.id,
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
 * Skill execute function - called by skill-runner
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool parameters
 * @param {object} context - Execution context
 * @returns {Promise<object>} Execution result
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
  // Tool definitions for registration
  tools: {
    get_message_content: {
      description: 'Retrieve the full content of a tool result by its tool_call_id. Use when you see a context summary that references a tool_call_id.',
      parameters: {
        type: 'object',
        properties: {
          tool_call_id: {
            type: 'string',
            description: 'The tool call ID from the context summary (e.g., "call_abc123")',
          },
        },
        required: ['tool_call_id'],
      },
    },
  },
};