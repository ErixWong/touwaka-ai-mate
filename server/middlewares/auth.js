/**
 * Auth Middleware - JWT 认证中间件
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';

/**
 * 必须认证中间件
 * 支持从 Authorization header、URL query 参数或 X-User-Id header（内部服务调用）获取认证信息
 */
const authenticate = () => {
  return async (ctx, next) => {
    // 优先从 Authorization header 获取 token
    let token = null;
    const authHeader = ctx.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // 如果 header 中没有，尝试从 query 参数获取（支持 SSE EventSource）
    if (!token && ctx.query.token) {
      token = ctx.query.token;
    }

    // 内部服务调用：支持 X-User-Id header（来自技能执行等内部调用）
    const internalUserId = ctx.headers['x-user-id'];
    const internalSecret = ctx.headers['x-internal-secret'];
    const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'internal-api-secret';

    if (!token && internalUserId && internalSecret === INTERNAL_SECRET) {
      // 内部服务调用认证成功
      // 支持数字和字符串（UUID）类型的 userId
      const parsedUserId = parseInt(internalUserId, 10);
      ctx.state.userId = isNaN(parsedUserId) ? internalUserId : parsedUserId;
      ctx.state.userRole = 'user';
      ctx.state.authType = 'internal';
      console.log('[Auth] Internal auth:', { userId: ctx.state.userId });
      await next();
      return;
    }

    if (!token) {
      ctx.error('未提供访问令牌', 401);
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      ctx.state.userId = decoded.userId;
      ctx.state.userRole = decoded.role;
      ctx.state.accessToken = token;  // 保存原始 token，用于 skill 调用后台 API
      console.log('[Auth] Token decoded:', { userId: decoded.userId, role: decoded.role });
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
 * 可选认证中间件（公开访问）
 */
const optionalAuth = () => {
  return async (ctx, next) => {
    const authHeader = ctx.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        ctx.state.userId = decoded.userId;
        ctx.state.userRole = decoded.role;
        ctx.state.accessToken = token;  // 保存原始 token，用于 skill 调用后台 API
      } catch (error) {
        // Token 无效但不阻止请求
      }
    }
    await next();
  };
};

/**
 * 管理员权限中间件
 */
const requireAdmin = () => {
  return async (ctx, next) => {
    console.log('[RequireAdmin] Checking role:', ctx.state.userRole);
    if (ctx.state.userRole !== 'admin') {
      ctx.error('需要管理员权限', 403);
      return;
    }
    await next();
  };
};

/**
 * 生成 Token
 * 字段名规则：全栈统一使用 snake_case
 * @param {string|number} userId - 用户ID
 * @param {string} role - 用户角色
 * @param {Object} options - 可选配置
 * @param {string} options.accessExpiry - Access Token 过期时间（如 '15m', '1h', '1d'）
 * @param {string} options.refreshExpiry - Refresh Token 过期时间（如 '7d', '30d'）
 */
const generateTokens = (userId, role, options = {}) => {
  const { accessExpiry = '15m', refreshExpiry = '7d' } = options;
  const access_token = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: accessExpiry });
  const refresh_token = jwt.sign({ userId, role }, JWT_REFRESH_SECRET, { expiresIn: refreshExpiry });
  return { access_token, refresh_token };
};

/**
 * 验证刷新令牌
 */
const verifyRefreshToken = (refreshToken) => {
  try {
    return jwt.verify(refreshToken, JWT_REFRESH_SECRET);
  } catch (error) {
    return null;
  }
};

export {
  authenticate,
  optionalAuth,
  requireAdmin,
  generateTokens,
  verifyRefreshToken,
};
