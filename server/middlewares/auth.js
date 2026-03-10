/**
 * Auth Middleware - JWT 认证中间件
 */

import jwt from 'jsonwebtoken';

// 延迟读取环境变量（因为 ES Modules 的 import 会在 dotenv.config() 之前执行）
const getJwtSecret = () => process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const getJwtRefreshSecret = () => process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';

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
      const userId = isNaN(parsedUserId) ? internalUserId : parsedUserId;
      ctx.state.session = {
        id: userId,
        roles: ['user'],
        isAdmin: false,
        accessToken: null,
      };
      ctx.state.authType = 'internal';
      console.log('[Auth] Internal auth:', { userId });
      await next();
      return;
    }

    if (!token) {
      ctx.error('未提供访问令牌', 401);
      return;
    }

    // JWT 验证的 try-catch 只包裹验证逻辑，不包裹 await next()
    let decoded;
    try {
      decoded = jwt.verify(token, getJwtSecret());
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        ctx.error('令牌已过期', 401, { type: 'TokenExpired' });
      } else {
        ctx.error('无效的令牌', 403);
      }
      return;
    }

    // 验证用户是否存在，并获取角色列表
    let roles = [];
    if (ctx.db) {
      try {
        const User = ctx.db.getModel('user');
        const user = await User.findOne({
          where: { id: decoded.userId },
          attributes: ['id', 'status'],
          raw: true,
        });
        
        if (!user) {
          ctx.error('用户不存在', 401);
          return;
        }
        
        // 可选：检查用户状态（如被封禁）
        if (user.status === 'disabled' || user.status === 'banned') {
          ctx.error('账户已被禁用', 403);
          return;
        }

        // 查询用户角色列表
        const UserRole = ctx.db.getModel('user_role');
        const Role = ctx.db.getModel('role');
        const roleRecords = await UserRole.findAll({
          where: { user_id: decoded.userId },
          include: [{
            model: Role,
            as: 'role',
            attributes: ['mark'],
          }],
          raw: true,
          nest: true,
        });
        roles = roleRecords.map(r => r.role?.mark).filter(Boolean);
      } catch (err) {
        console.error('[Auth] Error verifying user:', err.message);
        // 数据库查询失败不阻止请求，记录警告
      }
    }

    // 计算是否为管理员
    const isAdmin = roles.includes('admin');

    // JWT 验证成功，设置 session 对象
    ctx.state.session = {
      id: decoded.userId,
      roles: roles,
      isAdmin: isAdmin,
      accessToken: token,
    };
    
    console.log('[Auth] Token decoded:', { userId: decoded.userId, roles, isAdmin });
    await next();
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
        const decoded = jwt.verify(token, getJwtSecret());
        // 尝试获取角色列表
        let roles = [];
        if (ctx.db) {
          try {
            const UserRole = ctx.db.getModel('user_role');
            const Role = ctx.db.getModel('role');
            const roleRecords = await UserRole.findAll({
              where: { user_id: decoded.userId },
              include: [{
                model: Role,
                as: 'role',
                attributes: ['mark'],
              }],
              raw: true,
              nest: true,
            });
            roles = roleRecords.map(r => r.role?.mark).filter(Boolean);
          } catch (err) {
            // 查询失败，使用 JWT 中的角色
          }
        }
        const isAdmin = roles.includes('admin');
        ctx.state.session = {
          id: decoded.userId,
          roles: roles.length > 0 ? roles : [decoded.role || 'user'],
          isAdmin: isAdmin,
          accessToken: token,
        };
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
    const session = ctx.state.session;
    console.log('[RequireAdmin] Checking session:', session?.id, 'isAdmin:', session?.isAdmin);
    if (!session || !session.isAdmin) {
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
  const access_token = jwt.sign({ userId, role }, getJwtSecret(), { expiresIn: accessExpiry });
  const refresh_token = jwt.sign({ userId, role }, getJwtRefreshSecret(), { expiresIn: refreshExpiry });
  return { access_token, refresh_token };
};

/**
 * 验证刷新令牌
 */
const verifyRefreshToken = (refreshToken) => {
  try {
    return jwt.verify(refreshToken, getJwtRefreshSecret());
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
