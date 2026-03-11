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
   */
  async call(ctx) {
    try {
      const { assistant_type, input } = ctx.request.body;

      if (!assistant_type) {
        ctx.error('缺少 assistant_type 参数', 400);
        return;
      }

      if (!input) {
        ctx.error('缺少 input 参数', 400);
        return;
      }

      // 从 session 获取上下文
      const userId = ctx.state.session?.userId;
      const expertId = ctx.state.session?.expertId;
      const contactId = ctx.state.session?.contactId;
      const topicId = ctx.state.topicId;

      const result = await this.assistantManager.summon(assistant_type, input, {
        expertId,
        contactId,
        userId,
        topicId,
      });

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
}

export default AssistantController;
