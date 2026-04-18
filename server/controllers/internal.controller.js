/**
 * Internal Controller - 内部 API 控制器
 *
 * 用于驻留进程调用，插入消息并触发专家响应
 *
 * 认证方式：
 * - 用户 JWT Token（通过 Authorization header）
 * - 仅允许本地 IP 调用（作为安全后备）
 */

import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class InternalController {
  /**
   * @param {Object} db - 数据库实例
   * @param {Object} options - 配置选项
   * @param {Map} options.expertConnections - SSE 连接池（来自 StreamController）
   * @param {Object} options.chatService - ChatService 实例（用于触发专家响应）
   */
  constructor(db, options = {}) {
    this.db = db;
    this.Message = db.getModel('message');
    this.Topic = db.getModel('topic');
    this.AiModel = db.getModel('ai_model');
    this.Provider = db.getModel('provider');
    this.expertConnections = options.expertConnections || new Map();
    this.chatService = options.chatService || null;
  }

  /**
   * 插入消息并触发专家响应
   * POST /internal/messages/insert
   * 
   * @param {Object} ctx.request.body - 请求体
   * @param {string} ctx.request.body.user_id - 用户ID
   * @param {string} ctx.request.body.expert_id - 专家ID
   * @param {string} ctx.request.body.content - 消息内容
   * @param {string} ctx.request.body.role - 消息角色（user/assistant/system）
   * @param {string} [ctx.request.body.topic_id] - 话题ID（可选，不传则自动获取/创建）
   * @param {string} [ctx.request.body.task_id] - 任务ID（可选）
   * @param {string} [ctx.request.body.inner_voice] - 内心独白（JSON字符串）
   * @param {string} [ctx.request.body.tool_calls] - 工具调用（JSON字符串）
   */
  async insertMessage(ctx) {
    try {
      // 1. 验证内部调用权限
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.error('无权访问内部 API', 403, { code: 'FORBIDDEN' });
        return;
      }

      // 2. 验证必要参数
      const {
        user_id,
        expert_id,
        content,
        role = 'assistant',
        topic_id,
        task_id,
        inner_voice,
        tool_calls,
        trigger_expert = false,  // 是否触发专家响应
        original_message = '',     // 用户的原始问题（助理场景使用）
      } = ctx.request.body;

      if (!user_id || !expert_id || !content) {
        ctx.error('缺少必要参数：user_id, expert_id, content');
        return;
      }

      // 3. 获取或创建 Topic
      let finalTopicId = topic_id;
      if (!finalTopicId) {
        finalTopicId = await this.getOrCreateActiveTopic(user_id, expert_id, task_id);
      }

      // 4. 如果是助理场景，不保存用户消息，直接触发 Expert
      let messageId;
      let constructedUserMessage = null;

      if (trigger_expert && original_message) {
        // 构造用户消息（不存入数据库，不显示在前端）
        constructedUserMessage = `用户请求：${original_message}\n\n助理执行结果：\n${content}`;
        messageId = 'assistant_trigger';
        logger.info(`Internal API: 助理场景不保存用户消息，直接触发 Expert`);
      } else {
        // 普通场景：正常插入消息
        messageId = Utils.newID(20);
        await this.Message.create({
          id: messageId,
          topic_id: null,
          user_id,
          expert_id,
          role,
          content,
          inner_voice: inner_voice ? (typeof inner_voice === 'string' ? inner_voice : JSON.stringify(inner_voice)) : null,
          tool_calls: tool_calls ? (typeof tool_calls === 'string' ? tool_calls : JSON.stringify(tool_calls)) : null,
        });
        logger.info(`Internal API: 消息已插入 ${messageId}, expert=${expert_id}, user=${user_id}, trigger_expert=${trigger_expert}`);
      }

      // 5. 通过 SSE 推送通知
      const sseSent = this.pushSSENotification(expert_id, user_id, {
        event: 'new_context',
        data: {
          message_id: messageId,
          topic_id: finalTopicId,
          role: role,
          preview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        }
      });

      // 6. 如果需要触发专家响应，异步执行
      if (trigger_expert && this.chatService) {
        // 使用构造的用户消息内容触发 Expert
        const triggerContent = constructedUserMessage || content;
        this.triggerExpertResponse(user_id, expert_id, triggerContent, finalTopicId);
      }

      // 7. 返回成功
      ctx.success({
        message: '消息已插入',
        message_id: messageId,
        topic_id: finalTopicId,
        sse_sent: sseSent,
        trigger_expert,
      });

    } catch (error) {
      logger.error('Internal API insert message error:', error);
      ctx.error(error.message || '插入消息失败', 500);
    }
  }

  /**
   * 触发专家响应（异步执行，不阻塞返回）
   * 支持多轮工具调用循环
   * @param {string} user_id - 用户ID
   * @param {string} expert_id - 专家ID
   * @param {string} content - 触发内容
   * @param {string} topic_id - 话题ID
   */
  async triggerExpertResponse(user_id, expert_id, content, topic_id) {
    try {
      logger.info(`[Internal API] 触发专家响应: expert=${expert_id}, user=${user_id}, topic=${topic_id}`);

      // 调试：检查 expertConnections
      logger.info(`[Internal API] expertConnections 大小: ${this.expertConnections?.size || 0}`);
      logger.info(`[Internal API] chatService 存在: ${!!this.chatService}`);

      // 等待一小段时间确保数据库事务完全提交
      await new Promise(resolve => setTimeout(resolve, 100));

      // 获取 SSE 连接
      const connections = this.expertConnections?.get(expert_id);
      logger.info(`[Internal API] connections: ${connections?.size || 0}`);

      const userConnection = connections
        ? [...connections].find(c => c.user_id === user_id && !c.res.writableEnded)
        : null;

      logger.info(`[Internal API] userConnection: ${!!userConnection}`);

      if (!userConnection) {
        logger.warn(`[Internal API] 没有 SSE 连接，无法触发专家响应: expert=${expert_id}, user=${user_id}`);
        return;
      }

      // 获取专家服务
      const expertService = await this.chatService.getExpertService(expert_id);

      // 构建上下文
      const context = await expertService.buildContext(user_id, content, topic_id);

      logger.info(`[Internal API] 构建上下文: topic=${topic_id}, topicHistoryLength=${context.topicHistory?.length || 0}, messagesCount=${context.messages?.length || 0}`);

      // 获取模型配置
      const modelConfig = expertService.getDefaultModelConfig();

      // 获取工具定义（包含 MCP 工具）
      const toolContext = { user_id, expert_id };
      const tools = await expertService.toolManager.getToolDefinitions(toolContext);

      logger.info(`[Internal API] 开始生成专家回复: model=${modelConfig.model_name}, tools=${tools.length}`);

      // 发送开始事件，让前端准备接收流式内容
      if (!userConnection.res.writableEnded) {
        userConnection.res.write(`event: start\n`);
        userConnection.res.write(`data: ${JSON.stringify({ message_id: `msg_${Utils.newID(10)}`, topic_id })}\n\n`);
      }

      // 多轮工具调用循环
      const maxToolRounds = 5;
      let currentMessages = [...context.messages];
      let fullContent = '';
      const startTime = Date.now();

      for (let round = 0; round < maxToolRounds; round++) {
        let collectedToolCalls = [];
        let roundContent = '';

        logger.info(`[Internal API] 第${round + 1}轮调用 LLM...`);

        // 流式调用 LLM
        await expertService.llmClient.callStream(
          modelConfig,
          currentMessages,
          {
            tools,
            onDelta: (delta) => {
              roundContent += delta;
              fullContent += delta;
              if (!userConnection.res.writableEnded) {
                userConnection.res.write(`event: delta\n`);
                userConnection.res.write(`data: ${JSON.stringify({ content: delta })}\n\n`);
              }
            },
            onToolCall: (toolCalls) => {
              logger.info(`[Internal API] 工具调用:`, toolCalls?.length || 0);
              collectedToolCalls.push(...(Array.isArray(toolCalls) ? toolCalls : [toolCalls]));

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
            onUsage: (usage) => {
              logger.debug(`[Internal API] Token 使用:`, usage);
            },
          }
        );

        // 如果没有工具调用，退出循环
        if (collectedToolCalls.length === 0) {
          logger.info(`[Internal API] 第${round + 1}轮无工具调用，完成`);
          break;
        }

        logger.info(`[Internal API] 第${round + 1}轮开始执行工具调用:`, collectedToolCalls.length);

        // 执行工具调用
        const toolResults = await expertService.handleToolCalls(
          collectedToolCalls,
          user_id,
          null, // access_token
          null, // taskContext
          topic_id
        );

        // 发送工具结果给前端
        for (const toolResult of toolResults) {
          if (!userConnection.res.writableEnded) {
            userConnection.res.write(`event: tool_result\n`);
            userConnection.res.write(`data: ${JSON.stringify({ result: toolResult })}\n\n`);
          }
        }

        // 将工具调用和结果添加到消息历史
        for (let i = 0; i < collectedToolCalls.length; i++) {
          const toolCall = collectedToolCalls[i];
          const toolResult = toolResults[i];

          currentMessages.push({
            role: 'assistant',
            content: null,
            tool_calls: [toolCall],
          });

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function?.name || toolCall.name,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          });
        }
      }

      const latency = Date.now() - startTime;

      // 保存专家回复
      await this.chatService.saveAssistantMessage(
        topic_id,
        user_id,
        fullContent,
        {
          latency_ms: latency,
          model_name: modelConfig.model_name,
          provider_name: modelConfig.provider_name,
          expert_id,
        }
      );

      // 发送完成事件
      if (!userConnection.res.writableEnded) {
        userConnection.res.write(`event: complete\n`);
        userConnection.res.write(`data: ${JSON.stringify({
          content: fullContent,
          latency,
          model: modelConfig.model_name,
        })}\n\n`);
      }

      logger.info(`[Internal API] 专家响应完成: expert=${expert_id}, latency=${latency}ms`);

    } catch (error) {
      logger.error(`[Internal API] 触发专家响应异常: ${error.message}`);

      // 发送错误事件
      const connections = this.expertConnections.get(expert_id);
      if (connections) {
        const userConnection = [...connections].find(c => c.user_id === user_id && !c.res.writableEnded);
        if (userConnection && !userConnection.res.writableEnded) {
          userConnection.res.write(`event: error\n`);
          userConnection.res.write(`data: ${JSON.stringify({ message: error.message })}\n\n`);
        }
      }
    }
  }

  /**
   * 验证内部调用权限
   * 安全策略：
   * 1. 必须有已认证的用户 session（通过 JWT Token）
   * 2. 只允许本地 IP 访问（作为额外安全层）
   */
  validateInternalAccess(ctx) {
    // 1. 检查用户是否已认证（通过 JWT Token）
    const session = ctx.state.session;
    if (!session?.id) {
      logger.warn(`Internal API access denied: no authenticated user`);
      return false;
    }

    // 2. 检查 IP（只允许本地访问）
    const clientIp = ctx.ip || ctx.request.ip;
    const localIps = ['::1', '::ffff:127.0.0.1', '127.0.0.1', 'localhost', '0.0.0.0'];
    const isLocalIp = localIps.includes(clientIp);

    // 检查 X-Forwarded-For（Docker 桥接等场景）
    const remoteAddress = ctx.request?.headers?.['x-forwarded-for'] || '';
    const isForwardedLocal = remoteAddress.includes('127.0.0.1') || remoteAddress.includes('localhost');

    if (!isLocalIp && !isForwardedLocal) {
      logger.warn(`Internal API access denied from IP: ${clientIp} (localhost only)`);
      return false;
    }

    return true;
  }

  /**
   * 获取或创建活跃 Topic
   */
  async getOrCreateActiveTopic(user_id, expert_id, task_id = null) {
    const whereClause = {
      user_id,
      expert_id,
      status: 'active',
    };
    
    if (task_id) {
      whereClause.task_id = task_id;
    }

    // 查找最近活跃的 Topic
    const existingTopic = await this.Topic.findOne({
      where: whereClause,
      order: [['updated_at', 'DESC']],
      raw: true,
    });

    if (existingTopic) {
      return existingTopic.id;
    }

    // 创建新 Topic
    const topic_id = Utils.newID(20);
    await this.Topic.create({
      id: topic_id,
      user_id,
      expert_id,
      title: '新对话',
      status: 'active',
      task_id,
    });

    logger.info(`Internal API: 创建新对话 ${topic_id}`);
    return topic_id;
  }

  /**
   * 通过 SSE 推送通知
   * @returns {boolean} 是否成功推送
   */
  pushSSENotification(expert_id, user_id, notification) {
    const connections = this.expertConnections.get(expert_id);
    
    if (!connections || connections.size === 0) {
      logger.debug(`No SSE connections for expert: ${expert_id}`);
      return false;
    }

    // 找到该用户的连接
    for (const conn of connections) {
      if (conn.user_id === user_id && !conn.res.writableEnded) {
        try {
          conn.res.write(`event: ${notification.event}\n`);
          conn.res.write(`data: ${JSON.stringify(notification.data)}\n\n`);
          logger.info(`SSE notification sent: ${notification.event} to user=${user_id}`);
          return true;
        } catch (err) {
          logger.error('Failed to send SSE notification:', err);
        }
      }
    }

    return false;
  }

  /**
   * 更新 SSE 连接池引用（用于热更新）
   */
  setExpertConnections(connections) {
    this.expertConnections = connections;
  }

  /**
   * 获取模型配置（包含 Provider 信息）
   * GET /internal/models/:model_id
   * 
   * @param {string} ctx.params.model_id - 模型ID
   * @returns {Object} 模型配置（含 base_url, api_key）
   */
  async getModelConfig(ctx) {
    try {
      // 1. 验证内部调用权限
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.error('无权访问内部 API', 403, { code: 'FORBIDDEN' });
        return;
      }

      const { model_id } = ctx.params;

      if (!model_id) {
        ctx.error('缺少 model_id 参数');
        return;
      }

      // 2. 查询模型配置
      const model = await this.AiModel.findOne({
        where: { id: model_id },
        raw: true,
      });

      if (!model) {
        ctx.status = 404;
        ctx.error('模型不存在');
        return;
      }

      // 3. 查询 Provider 配置
      let provider = null;
      if (model.provider_id) {
        provider = await this.Provider.findOne({
          where: { id: model.provider_id },
          raw: true,
        });
      }

      // 4. 返回配置
      ctx.success({
        model: {
          id: model.id,
          name: model.name,
          model_name: model.model_name,
          model_type: model.model_type,
          max_tokens: model.max_tokens,
          max_output_tokens: model.max_output_tokens,
        },
        provider: provider ? {
          id: provider.id,
          name: provider.name,
          base_url: provider.base_url,
          api_key: provider.api_key,
          timeout: provider.timeout,
        } : null,
      });

    } catch (error) {
      logger.error('Internal API get model config error:', error);
      ctx.error(error.message || '获取模型配置失败', 500);
    }
  }

  /**
   * 通过名称解析模型 ID
   * GET /internal/models/resolve?name=xxx
   * 
   * @param {string} ctx.query.name - 模型名称（name 或 model_name）
   * @returns {Object} { model_id, model_name }
   */
  async resolveModelName(ctx) {
    try {
      // 1. 验证内部调用权限
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.error('无权访问内部 API', 403, { code: 'FORBIDDEN' });
        return;
      }

      const { name } = ctx.query;

      if (!name) {
        ctx.error('缺少 name 参数');
        return;
      }

      // 2. 按名称查找（支持 name 或 model_name）
      const model = await this.AiModel.findOne({
        where: {
          is_active: true,
        },
        raw: true,
      });

      // 尝试匹配 name 或 model_name（不区分大小写）
      const allModels = await this.AiModel.findAll({
        where: { is_active: true },
        raw: true,
      });

      const found = allModels.find(m => 
        m.name?.toLowerCase() === name.toLowerCase() ||
        m.model_name?.toLowerCase() === name.toLowerCase()
      );

      if (!found) {
        ctx.status = 404;
        ctx.error(`模型 "${name}" 不存在`);
        return;
      }

      // 3. 返回模型 ID
      ctx.success({
        model_id: found.id,
        model_name: found.model_name,
        name: found.name,
      });

    } catch (error) {
      logger.error('Internal API resolve model name error:', error);
      ctx.error(error.message || '解析模型名称失败', 500);
    }
  }

  /**
   * 调用驻留式技能工具
   * POST /internal/resident/invoke
   * 
   * @param {Object} ctx.request.body - 请求体
   * @param {string} ctx.request.body.skill_id - 技能ID
   * @param {string} ctx.request.body.tool_name - 工具名称
   * @param {Object} ctx.request.body.params - 调用参数
   * @param {number} ctx.request.body.timeout - 超时时间（可选）
   */
  async invokeResidentTool(ctx) {
    try {
      // 1. 验证内部调用权限
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.error('无权访问内部 API', 403, { code: 'FORBIDDEN' });
        return;
      }

      // 2. 获取参数
      const { skill_id, tool_name, params, timeout } = ctx.request.body;

      if (!skill_id || !tool_name) {
        ctx.error('缺少必要参数：skill_id, tool_name');
        return;
      }

      // 3. 获取 ResidentSkillManager
      if (!this.residentSkillManager) {
        ctx.status = 503;
        ctx.error('驻留式技能管理器未初始化');
        return;
      }

      // 4. 调用驻留工具
      const result = await this.residentSkillManager.invokeByName(
        skill_id,
        tool_name,
        params,
        timeout || 60000
      );

      // 5. 返回结果
      ctx.success(result);

    } catch (error) {
      logger.error('Internal API invoke resident tool error:', error);
      ctx.error(error.message || '调用驻留工具失败', 500);
    }
  }

  /**
   * 设置 ResidentSkillManager 引用（在 server 初始化时调用）
   */
  setResidentSkillManager(manager) {
    this.residentSkillManager = manager;
  }

  /**
   * 获取 MCP 配置（供驻留进程调用）
   * POST /internal/mcp/config
   *
   * @param {Object} ctx.request.body - 请求体
   * @param {string} [ctx.request.body.user_id] - 用户ID（可选）
   * @returns {Object} { servers, default_credentials, user_credentials }
   */
  async getMcpConfig(ctx) {
    try {
      // 1. 验证内部调用权限
      if (!this.validateInternalAccess(ctx)) {
        ctx.status = 403;
        ctx.error('无权访问内部 API', 403, { code: 'FORBIDDEN' });
        return;
      }

      const { user_id } = ctx.request.body || {};

      // 2. 获取模型
      const MCPServer = this.db.getModel('mcp_server');
      const MCPCredential = this.db.getModel('mcp_credential');
      const MCPUserCredential = this.db.getModel('mcp_user_credential');

      // 3. 获取 MCP Server 配置
      const servers = await MCPServer.findAll({
        where: { is_enabled: true },
        raw: true,
      });

      // 4. 获取系统默认凭证
      const defaultCredentials = await MCPCredential.findAll({
        where: { is_enabled: true },
        raw: true,
      });

      // 5. 获取用户凭证（如果提供了 user_id）
      let userCredentials = [];
      if (user_id) {
        userCredentials = await MCPUserCredential.findAll({
          where: { user_id, is_enabled: true },
          raw: true,
        });
      }

      // 6. 返回配置
      ctx.success({
        servers: servers.map(s => ({
          id: s.id,
          name: s.name,
          display_name: s.display_name,
          description: s.description,
          transport_type: s.transport_type || 'stdio',  // 新增
          command: s.command,
          args: s.args,
          env_template: s.env_template,
          url: s.url,                                    // 新增
          headers: s.headers,                            // 新增
          is_public: s.is_public,
          is_enabled: s.is_enabled,
          requires_credentials: s.requires_credentials,
          credential_fields: s.credential_fields,
        })),
        default_credentials: defaultCredentials.map(c => ({
          id: c.id,
          mcp_server_id: c.mcp_server_id,
          credentials: c.credentials,
          is_enabled: c.is_enabled,
        })),
        user_credentials: userCredentials.map(c => ({
          id: c.id,
          user_id: c.user_id,
          mcp_server_id: c.mcp_server_id,
          credentials: c.credentials,
          is_enabled: c.is_enabled,
        })),
      });

    } catch (error) {
      logger.error('Internal API get MCP config error:', error);
      ctx.error(error.message || '获取 MCP 配置失败', 500);
    }
  }
}

export default InternalController;