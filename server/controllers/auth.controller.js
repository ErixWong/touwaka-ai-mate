/**
 * Auth Controller - 认证控制器
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import bcrypt from 'bcryptjs';
import { generateTokens, verifyRefreshToken } from '../middlewares/auth.js';
import logger from '../../lib/logger.js';

class AuthController {
  constructor(db) {
    this.db = db;
    this.User = db.getModel('user');
    this.UserRole = db.getModel('user_role');
    this.Role = db.getModel('role');
  }

  /**
   * 登录 - 支持用户名或邮箱
   */
  async login(ctx) {
    try {
      const { account, password } = ctx.request.body;

      if (!account || !password) {
        ctx.error('用户名/邮箱和密码不能为空');
        return;
      }

      // 查询用户（支持用户名或邮箱登录）
      const { Op } = this.db;
      const user = await this.User.findOne({
        where: {
          [Op.or]: [
            { username: account },
            { email: account },
          ],
          status: 'active',
        },
        raw: true,
      });

      if (!user) {
        ctx.error('用户名/邮箱或密码错误', 401);
        return;
      }

      // 验证密码
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        ctx.error('用户名/邮箱或密码错误', 401);
        return;
      }

      // 获取用户角色（从 user_roles 表）
      const roles = await this.UserRole.findAll({
        where: { user_id: user.id },
        include: [{
          model: this.Role,
          as: 'role',
          attributes: ['name'],
        }],
        raw: true,
        nest: true,
      });
      logger.info(`User ${user.username} roles query result:`, JSON.stringify(roles));
      const primaryRole = roles.length > 0 ? roles[0].role?.name : 'user';
      logger.info(`User ${user.username} primaryRole: ${primaryRole}`);

      // 生成 Token
      const tokens = generateTokens(user.id, primaryRole);

      // 更新最后登录时间
      await this.User.update(
        { last_login: new Date() },
        { where: { id: user.id } }
      );

      ctx.success({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          nickname: user.nickname,
          role: primaryRole,
          avatar: user.avatar,
        },
        ...tokens,
      });
    } catch (error) {
      logger.error('Login error:', error.message, error.stack);
      ctx.error('登录失败: ' + error.message, 500);
    }
  }

  /**
   * 刷新 Token
   */
  async refresh(ctx) {
    try {
      const { refresh_token } = ctx.request.body;

      if (!refresh_token) {
        ctx.error('缺少刷新令牌');
        return;
      }

      const decoded = verifyRefreshToken(refresh_token);
      if (!decoded) {
        ctx.error('刷新令牌已过期，请重新登录', 401);
        return;
      }

      // 从数据库获取最新角色（避免角色变更后 token 仍使用旧角色）
      const roles = await this.UserRole.findAll({
        where: { user_id: decoded.userId },
        include: [{
          model: this.Role,
          as: 'role',
          attributes: ['name'],
        }],
        raw: true,
        nest: true,
      });
      const primaryRole = roles.length > 0 ? roles[0].role?.name : decoded.role || 'user';

      const tokens = generateTokens(decoded.userId, primaryRole);
      ctx.success(tokens);
    } catch (error) {
      logger.error('Refresh token error:', error);
      ctx.error('无效的刷新令牌', 403);
    }
  }

  /**
   * 获取当前用户信息
   */
  async me(ctx) {
    try {
      const user = await this.User.findOne({
        where: { id: ctx.state.userId },
        attributes: ['id', 'username', 'email', 'nickname', 'avatar', 'preferences', 'created_at'],
        raw: true,
      });

      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      // 获取用户角色
      const roles = await this.UserRole.findAll({
        where: { user_id: ctx.state.userId },
        include: [{
          model: this.Role,
          as: 'role',
          attributes: ['name'],
        }],
        raw: true,
        nest: true,
      });

      ctx.success({
        ...user,
        roles: roles.map(r => r.role?.name).filter(Boolean),
        preferences: user.preferences ? JSON.parse(user.preferences) : {},
      });
    } catch (error) {
      logger.error('Get me error:', error);
      ctx.error('获取用户信息失败', 500);
    }
  }

  /**
   * 登出
   */
  async logout(ctx) {
    // 可以在这里处理 Token 黑名单
    ctx.success(null, '登出成功');
  }
}

export default AuthController;
