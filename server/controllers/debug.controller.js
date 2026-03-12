/**
 * Debug Controller - 调试信息控制器
 * 
 * 提供 LLM Payload 等调试信息的 API
 */

import logger from '../../lib/logger.js';

class DebugController {
  constructor(db, chatService) {
    this.db = db;
    this.chatService = chatService;
  }

  /**
   * 获取最近一次 LLM Payload
   * GET /api/debug/llm-payload?expert_id=xxx
   */
  async getLLMPayload(ctx) {
    try {
      const { expert_id } = ctx.query;
      const user_id = ctx.state.session.id;

      if (!expert_id) {
        ctx.error('缺少必要参数：expert_id');
        return;
      }

      const payload = this.chatService.getLLMPayload(user_id, expert_id);

      if (!payload) {
        ctx.success({
          payload: null,
          message: '暂无该专家的 LLM Payload 缓存',
        });
        return;
      }

      ctx.success({
        payload,
        cached_at: payload.cached_at,
      });

    } catch (error) {
      logger.error('[DebugController] 获取 LLM Payload 失败:', error);
      ctx.error(error.message || '获取 LLM Payload 失败');
    }
  }

  /**
   * 获取驻留进程状态
   * GET /api/debug/resident-status
   */
  async getResidentStatus(ctx) {
    try {
      // 从全局获取 ResidentSkillManager
      const residentSkillManager = global.residentSkillManager;
      
      if (!residentSkillManager) {
        ctx.success({
          initialized: false,
          message: 'ResidentSkillManager 未初始化',
          processes: [],
        });
        return;
      }

      const status = residentSkillManager.getStatus();
      
      ctx.success({
        initialized: true,
        process_count: status.length,
        processes: status,
      });
    } catch (error) {
      logger.error('[DebugController] 获取驻留进程状态失败:', error);
      ctx.error(error.message || '获取驻留进程状态失败');
    }
  }

  /**
   * 设置 ResidentSkillManager 引用
   */
  setResidentSkillManager(manager) {
    global.residentSkillManager = manager;
  }
}

export default DebugController;
