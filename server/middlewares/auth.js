/**
 * Auth Middleware - JWT 认证中间件
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';

/**
 * 必须认证中间件
 * 支持从 Authorization header 或 URL query 参数中获取 token
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

    if (!token) {
      ctx.error('未提供访问令牌', 401);
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      ctx.state.userId = decoded.userId;
      ctx.state.userRole = decoded.role;
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
 */
const generateTokens = (userId, role) => {
  const access_token = jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '15m' });
  const refresh_token = jwt.sign({ userId, role }, JWT_REFRESH_SECRET, { expiresIn: '7d' });
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
