/**
 * ToolIntegration - 助理工具集成模块
 * 
 * 负责：
 * - 提供助理工具定义（供 Expert 使用）
 * - 获取继承的工具定义
 * - 执行继承的工具调用
 */

import logger from '../../../lib/logger.js';

// 动态导入缓存
let ToolManagerClass = null;

async function getToolManagerClass() {
  if (!ToolManagerClass) {
    ToolManagerClass = (await import('../../../lib/tool-manager.js')).default;
  }
  return ToolManagerClass;
}

/**
 * 获取助理系统提供的工具定义（供 Expert 使用）
 * @param {Map} assistantsCache - 助理缓存
 * @returns {Array}
 */
export function getAssistantTools(assistantsCache) {
  // 动态获取可用助理列表
  const assistants = Array.from(assistantsCache?.values() || []);
  
  // 构建助理列表描述（用于工具描述）
  const assistantListDesc = assistants.length > 0
    ? assistants.map(a => `${a.id}（${a.name}）`).join('、')
    : '（当前无可用助理）';

  return [
    {
      type: 'function',
      function: {
        name: 'assistant_summon',
        description: `召唤助理来处理特定任务。助理是异步执行的，会立即返回委托ID。【重要规则】1.召唤成功后必须立即回复用户：任务已提交，请稍后查看结果。2.不要轮询等待结果，结果会自动返回到对话中。3.收到助理返回的结果后，根据用户需求处理结果。可用助理：${assistantListDesc}`,
        parameters: {
          type: 'object',
          properties: {
            assistant_id: {
              type: 'string',
              description: `助理ID。可用助理：${assistantListDesc}`,
            },
            task: {
              type: 'string',
              description: '任务描述（一句话说明要做什么）',
            },
            background: {
              type: 'string',
              description: '任务背景（为什么需要这个任务）',
            },
            input: {
              type: 'object',
              description: '输入参数。支持图片路径(image_path/image_paths)、Base64数据(image_data/image_data_urls)及其他自定义参数。',
            },
            expected_output: {
              type: 'object',
              properties: {
                format: { type: 'string', description: '输出格式：markdown/json/text' },
                focus: { type: 'array', items: { type: 'string' }, description: '关注点列表' },
                max_length: { type: 'number', description: '最大输出长度' },
              },
              description: '期望的输出格式',
            },
            inherited_tools: {
              type: 'array',
              items: { type: 'string' },
              description: '要继承的工具ID列表，助理可以调用这些工具',
            },
          },
          required: ['assistant_id', 'input'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'assistant_roster',
        description: '列出所有可用的助理，返回助理ID、名称、图标和简介。在召唤助理前，可先调用此工具了解有哪些助理可用。',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    },
  ];
}

/**
 * 根据工具ID列表获取工具定义
 * @param {Database} db - 数据库实例
 * @param {string[]} toolIds - 工具ID列表
 * @param {string} expertId - 专家ID（用于加载专家的工具配置）
 * @returns {Promise<Array>} 工具定义数组
 */
export async function getInheritedToolDefinitions(db, toolIds, expertId) {
  if (!toolIds || toolIds.length === 0) {
    return [];
  }

  logger.info(`[ToolIntegration] 获取继承工具定义:`, toolIds);

  try {
    const ToolManager = await getToolManagerClass();
    const toolManager = new ToolManager(db, expertId || 'system');
    await toolManager.initialize();

    // 获取所有工具定义
    const allTools = toolManager.getToolDefinitions();

    // 过滤出需要的工具
    const inheritedTools = allTools.filter(tool => {
      const toolName = tool.function?.name || tool.name;
      return toolIds.includes(toolName);
    });

    logger.info(`[ToolIntegration] 找到 ${inheritedTools.length}/${toolIds.length} 个继承工具`);

    return inheritedTools;
  } catch (error) {
    logger.error('[ToolIntegration] 获取继承工具定义失败:', error.message);
    return [];
  }
}

/**
 * 执行继承的工具调用
 * @param {Database} db - 数据库实例
 * @param {string} toolId - 工具ID
 * @param {object} params - 工具参数
 * @param {object} context - 执行上下文
 * @returns {Promise<object>} 工具执行结果
 */
export async function executeInheritedTool(db, toolId, params, context) {
  logger.info(`[ToolIntegration] 执行继承工具: ${toolId}`, params);

  try {
    const ToolManager = await getToolManagerClass();
    const toolManager = new ToolManager(db, context.expertId || 'system');
    await toolManager.initialize();

    const result = await toolManager.executeTool(toolId, params, {
      userId: context.userId,
      expertId: context.expertId,
      is_admin: true, // 助理执行继承工具具有较高权限
      requestId: context.requestId,
    });

    return result;
  } catch (error) {
    logger.error(`[ToolIntegration] 执行继承工具失败: ${toolId}`, error.message);
    return { error: error.message };
  }
}

export default {
  getAssistantTools,
  getInheritedToolDefinitions,
  executeInheritedTool,
};