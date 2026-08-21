/**
 * Auth Middleware - JWT 认证中间件
 */

import jwt from 'jsonwebtoken';

const getUserPermissionCodes = async (ctx, userId) => {
  if (!ctx.db) return [];

  const UserRole = ctx.db.getModel('user_role');
  const RolePermission = ctx.db.getModel('role_permission');
  const Permission = ctx.db.getModel('permission');

  const userRoles = await UserRole.findAll({
    where: { user_id: userId },
    attributes: ['role_id'],
    raw: true,
  });

  const roleIds = [...new Set(userRoles.map(item => item.role_id).filter(Boolean))];
  if (roleIds.length === 0) {
    return [];
  }

  const rolePermissions = await RolePermission.findAll({
    where: { role_id: roleIds },
    include: [{
      model: Permission,
      as: 'permission',
      attributes: ['code'],
    }],
    raw: true,
    nest: true,
  });

  return [...new Set(rolePermissions.map(item => item.permission?.code).filter(Boolean))];
};

// 延迟读取环境变量（因为 ES Modules 的 import 会在 dotenv.config() 之前执行）
// 启动/首次使用前必须配置 JWT_SECRET/JWT_REFRESH_SECRET，绝不允许使用硬编码兜底密钥
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET 环境变量未配置，请在 .env 文件中设置强随机密钥');
  }
  return secret;
};
const getJwtRefreshSecret = () => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET 环境变量未配置，请在 .env 文件中设置强随机密钥');
  }
  return secret;
};

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
 * 权限校验中间件
 * - 管理员默认放行
 * - 非管理员需命中指定权限之一
 */
const requirePermission = (...permissionCodes) => {
  return async (ctx, next) => {
    const session = ctx.state.session;
    if (!session) {
      ctx.error('未登录', 401);
      return;
    }

    if (session.isAdmin) {
      await next();
      return;
    }

    const requiredCodes = permissionCodes.flat().filter(Boolean);
    if (requiredCodes.length === 0) {
      await next();
      return;
    }

    try {
      const permissionCodesForUser = await getUserPermissionCodes(ctx, session.id);
      const hasPermission = requiredCodes.some(code => permissionCodesForUser.includes(code));
      if (!hasPermission) {
        ctx.error('权限不足', 403);
        return;
      }

      session.permission_codes = permissionCodesForUser;
      await next();
    } catch (error) {
      console.error('[RequirePermission] Error checking permissions:', error.message);
      ctx.error('权限校验失败', 500);
    }
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
  requirePermission,
  generateTokens,
  verifyRefreshToken,
};
