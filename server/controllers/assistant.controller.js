/**
 * AssistantController - 助理控制器
 *
 * 管理助理的召唤、状态查询和列表
 */

import logger from '../../lib/logger.js';
import { getAssistantManager } from '../services/assistant/index.js';

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
   * 创建助理
   * POST /api/assistants
   * 仅管理员可调用
   */
  async create(ctx) {
    try {
      const data = ctx.request.body;

      // 检查权限
      const session = ctx.state.session;
      if (!session || !session.roles?.includes('admin')) {
        ctx.error('无权限创建助理', 403);
        return;
      }

      // 必填字段校验
      // assistant_type 由系统自动生成，无需前端传入
      if (!data.name) {
        ctx.error('缺少 name 参数', 400);
        return;
      }

      const result = await this.assistantManager.createAssistant(data);
      ctx.success(result, '创建成功');
    } catch (error) {
      logger.error('Create assistant error:', error);
      if (error.message.includes('already exists')) {
        ctx.error(error.message, 409);
      } else if (error.message.includes('required') || error.message.includes('must')) {
        ctx.error(error.message, 400);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 获取单个助理详情
   * GET /api/assistants/:id
   */
  async getDetail(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        ctx.error('缺少 id 参数', 400);
        return;
      }

      const assistant = await this.assistantManager.getAssistantDetail(id);

      if (!assistant) {
        ctx.error(`助理不存在: ${id}`, 404);
        return;
      }

      ctx.success(assistant);
    } catch (error) {
      logger.error('Get assistant detail error:', error);
      ctx.app.emit('error', error, ctx);
    }
  }

  /**
   * 更新助理配置
   * PUT /api/assistants/:id
   * 仅管理员可调用
   */
  async update(ctx) {
    try {
      const { id } = ctx.params;
      const updates = ctx.request.body;

      if (!id) {
        ctx.error('缺少 id 参数', 400);
        return;
      }

      // 检查权限
      const session = ctx.state.session;
      if (!session || !session.roles?.includes('admin')) {
        ctx.error('无权限修改助理配置', 403);
        return;
      }

      const result = await this.assistantManager.updateAssistant(id, updates);
      ctx.success(result, '更新成功');
    } catch (error) {
      logger.error('Update assistant error:', error);
      if (error.message.includes('not found')) {
        ctx.error(error.message, 404);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 删除助理
   * DELETE /api/assistants/:id
   * 仅管理员可调用
   */
  async deleteAssistant(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        ctx.error('缺少 id 参数', 400);
        return;
      }

      // 检查权限
      const session = ctx.state.session;
      if (!session || !session.roles?.includes('admin')) {
        ctx.error('无权限删除助理', 403);
        return;
      }

      const result = await this.assistantManager.deleteAssistant(id);
      ctx.success(result, '删除成功');
    } catch (error) {
      logger.error('Delete assistant error:', error);
      if (error.message.includes('not found')) {
        ctx.error(error.message, 404);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 召唤助理
   * POST /api/assistants/call
   *
   * 新版请求结构 (推荐):
   * {
   *   assistant_id: string,        // 必填
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
   *   assistant_type: string,      // 已废弃，兼容旧版
   *   input: object
   * }
   */
  async call(ctx) {
    try {
      const body = ctx.request.body;

      // 兼容旧版 assistant_type 参数
      const assistantId = body.assistant_id || body.assistant_type;

      // 必填参数校验
      if (!assistantId) {
        ctx.error('缺少 assistant_id 参数', 400);
        return;
      }

      if (!body.input) {
        ctx.error('缺少 input 参数', 400);
        return;
      }

      // 新版参数
      const {
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
        assistant_id: assistantId,
        // 向后兼容：如果没有 task，生成默认描述
        task: task || `执行 ${assistantId} 任务`,
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
      const { status, expert_id, user_id, assistant_id, limit } = ctx.query;

      const filters = {};
      if (status) filters.status = status;
      if (expert_id) filters.expert_id = expert_id;
      if (user_id) filters.user_id = user_id;
      if (assistant_id) filters.assistant_id = assistant_id;
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

  /**
   * 归档委托
   * POST /api/assistants/requests/:request_id/archive
   */
  async archive(ctx) {
    try {
      const { request_id } = ctx.params;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const result = await this.assistantManager.archive(request_id);
      ctx.success(result);
    } catch (error) {
      logger.error('Archive request error:', error);
      if (error.message.includes('not found')) {
        ctx.error(error.message, 404);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 取消归档委托
   * POST /api/assistants/requests/:request_id/unarchive
   */
  async unarchive(ctx) {
    try {
      const { request_id } = ctx.params;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const result = await this.assistantManager.unarchive(request_id);
      ctx.success(result);
    } catch (error) {
      logger.error('Unarchive request error:', error);
      if (error.message.includes('not found')) {
        ctx.error(error.message, 404);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 删除委托
   * DELETE /api/assistants/requests/:request_id
   */
  async delete(ctx) {
    try {
      const { request_id } = ctx.params;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const result = await this.assistantManager.delete(request_id);
      ctx.success(result);
    } catch (error) {
      logger.error('Delete request error:', error);
      if (error.message.includes('not found')) {
        ctx.error(error.message, 404);
      } else if (error.message.includes('Cannot delete')) {
        ctx.error(error.message, 400);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 重发通知给专家
   * POST /api/assistants/requests/:request_id/resend-notification
   */
  async resendNotification(ctx) {
    try {
      const { request_id } = ctx.params;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const result = await this.assistantManager.resendNotification(request_id);
      ctx.success(result, '通知已重发');
    } catch (error) {
      logger.error('Resend notification error:', error);
      if (error.message.includes('不存在')) {
        ctx.error(error.message, 404);
      } else if (error.message.includes('状态不允许')) {
        ctx.error(error.message, 400);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }

  /**
   * 重新执行委托
   * POST /api/assistants/requests/:request_id/retry
   */
  async retry(ctx) {
    try {
      const { request_id } = ctx.params;

      if (!request_id) {
        ctx.error('缺少 request_id 参数', 400);
        return;
      }

      const result = await this.assistantManager.retry(request_id);
      ctx.success(result, '任务已重新提交');
    } catch (error) {
      logger.error('Retry request error:', error);
      if (error.message.includes('not found')) {
        ctx.error(error.message, 404);
      } else {
        ctx.app.emit('error', error, ctx);
      }
    }
  }
}

export default AssistantController;
