/**
 * Internal Routes - 内部 API 路由
 *
 * 用于驻留式技能调用，需要用户 JWT 认证
 *
 * API 设计：
 * - POST /internal/messages/insert - 插入消息并触发专家响应
 * - GET /internal/models/:model_id - 获取模型配置（含 Provider 信息）
 * - GET /internal/models/resolve?name=xxx - 通过名称解析模型 ID
 * - POST /internal/resident/invoke - 调用驻留式技能工具
 *
 * 安全策略：
 * - 必须提供有效的用户 JWT Token
 * - 只允许本地 IP 访问
 */

import Router from '@koa/router';
import jwt from 'jsonwebtoken';

const getJwtSecret = () => process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * 内部 API 认证中间件（放宽验证）
 * - 验证 JWT 格式
 * - 只允许本地 IP 访问
 * - 不检查用户是否存在（允许系统内部调用）
 */
const internalAuth = () => {
  return async (ctx, next) => {
    const authHeader = ctx.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ctx.error('未提供访问令牌', 401);
      return;
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, getJwtSecret());
      
      // 检查 IP（只允许本地访问）
      const clientIp = ctx.ip || ctx.request.ip;
      const localIps = ['::1', '::ffff:127.0.0.1', '127.0.0.1', 'localhost', '0.0.0.0'];
      const isLocalIp = localIps.includes(clientIp);
      
      if (!isLocalIp) {
        ctx.error('内部 API 只允许本地访问', 403);
        return;
      }

      // 设置 session（放宽：不检查用户存在）
      ctx.state.session = {
        id: decoded.userId,
        roles: decoded.role ? [decoded.role] : [],
        isAdmin: decoded.isAdmin || decoded.role === 'admin',
      };
      
      await next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        ctx.error('令牌已过期', 401, { type: 'TokenExpired' });
      } else {
        ctx.error('无效的令牌', 403);
      }
    }
  };
};

/**
 * 创建内部路由
 * @param {Object} controller - InternalController 实例
 * @param {Object} authMiddleware - 认证中间件（未使用，保留参数兼容）
 * @returns {Router}
 */
export default function createInternalRoutes(controller, authMiddleware) {
  const router = new Router({
    prefix: '/internal'
  });

  // 所有 internal API 使用内部认证（放宽验证，不检查用户存在）
  const requireInternalAuth = internalAuth();

  // 消息插入 API
  router.post('/messages/insert', requireInternalAuth, controller.insertMessage.bind(controller));

  // 通过名称解析模型 ID（必须在 /:model_id 之前注册）
  router.get('/models/resolve', requireInternalAuth, controller.resolveModelName.bind(controller));

  // 获取模型配置 API
  router.get('/models/:model_id', requireInternalAuth, controller.getModelConfig.bind(controller));

  // 调用驻留式技能工具 API
  router.post('/resident/invoke', requireInternalAuth, controller.invokeResidentTool.bind(controller));

  // 获取 MCP 配置 API（供驻留进程调用）
  router.post('/mcp/config', requireInternalAuth, controller.getMcpConfig.bind(controller));

  return router;
}