/**
 * AssistantController - 助理控制器
 *
 * 管理助理的召唤、状态查询和列表
 */

import logger from '../../lib/logger.js';
import { getAssistantManager } from '../services/assistant-manager.js';

class AssistantController {
  constructor(db) {
    this.db = db;
    this.assistantManager = getAssistantManager(db);
  }

  /**
   * 列出可用助理
   * GET /api/assistants
   */
  async list(ctx) {
    try {
      const assistants = await this.assistantManager.roster();
      ctx.success(assistants);
    } catch (error) {
      logger.error('List assistants error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 召唤助理
   * POST /api/assistants/call
   *
   * 新版请求结构 (推荐):
   * {
   *   assistant_type: string,      // 必填
   *   task: string,                // 必填：任务描述
   *   background?: string,         // 可选：任务背景
   *   input: object,               // 必填：具体输入数据
   *   expected_output?: object,    // 可选：期望输出格式
   *   workspace?: object,          // 可选：工作空间上下文
   *   inherited_tools?: string[]   // 可选：继承的工具列表
   * }
   *
   * 旧版请求结构 (兼容):
   * {
   *   assistant_type: string,
   *   input: object
   * }
   */
  async call(ctx) {
    try {
      const body = ctx.request.body;

      // 必填参数校验
      if (!body.assistant_type) {
        ctx.error('缺少 assistant_type 参数', 400);
        return;
      }

      if (!body.input) {
        ctx.error('缺少 input 参数', 400);
        return;
      }

      // 新版参数
      const {
        assistant_type,
        task,
        background,
        input,
        expected_output,
        workspace,
        inherited_tools,
      } = body;

      // 从 session 获取上下文（作为默认值）
      const userId = ctx.state.session?.userId;
      const expertId = ctx.state.session?.expertId;
      const contactId = ctx.state.session?.contactId;
      const topicId = ctx.state.topicId;

      // 合并 workspace 参数
      const workspaceContext = {
        topic_id: workspace?.topic_id || topicId,
        expert_id: workspace?.expert_id || expertId,
        workdir: workspace?.workdir,
      };

      // 构建完整的召唤请求
      const summonRequest = {
        assistant_type,
        // 向后兼容：如果没有 task，生成默认描述
        task: task || `执行 ${assistant_type} 任务`,
        background,
        input,
        expected_output,
        workspace: workspaceContext,
        inherited_tools,
        // 额外上下文
        userId,
        contactId,
      };

      const result = await this.assistantManager.summon(summonRequest);

      ctx.success(result);
    } catch (error) {
      logger.error('Call assistant error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 查询委托状态
   * GET /api/assistants/requests/:request_id
   */
  async getRequest(ctx) {
    try {
      const { request_id } = ctx.params;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const result = await this.assistantManager.status(request_id);
      ctx.success(result);
    } catch (error) {
      logger.error('Get request error:', error);
      if (error.message.includes('not found')) {
        ctx.error(error.message, 404);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 查询委托列表
   * GET /api/assistants/requests
   */
  async listRequests(ctx) {
    try {
      const { status, expert_id, user_id, assistant_type, limit } = ctx.query;

      const filters = {};
      if (status) filters.status = status;
      if (expert_id) filters.expert_id = expert_id;
      if (user_id) filters.user_id = user_id;
      if (assistant_type) filters.assistant_type = assistant_type;
      if (limit) filters.limit = parseInt(limit, 10);

      const requests = await this.assistantManager.list(filters);
      ctx.success(requests);
    } catch (error) {
      logger.error('List requests error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 查询委托的消息列表
   * GET /api/assistants/requests/:request_id/messages
   *
   * Query params:
   * - debug: boolean - 是否返回完整内容（默认 false，只返回摘要）
   */
  async getMessages(ctx) {
    try {
      const { request_id } = ctx.params;
      const { debug } = ctx.query;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const debugMode = debug === 'true' || debug === '1';
      const messages = await this.assistantManager.getMessages(request_id, debugMode);

      ctx.success({
        request_id,
        messages,
      });
    } catch (error) {
      logger.error('Get messages error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }
}

export default AssistantController;
