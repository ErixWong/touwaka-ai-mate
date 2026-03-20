/**
 * Auth Controller - 认证控制器
 *
 * 使用 Sequelize ORM 进行数据库操作
 */

import bcrypt from 'bcryptjs';
import { generateTokens, verifyRefreshToken } from '../middlewares/auth.js';
import logger from '../../lib/logger.js';
import { getSystemSettingService } from '../services/system-setting.service.js';
import Utils from '../../lib/utils.js';

class AuthController {
  constructor(db) {
    this.db = db;
    this.User = db.getModel('user');
    this.UserRole = db.getModel('user_role');
    this.Role = db.getModel('role');
    this.Invitation = db.getModel('invitation');
    this.InvitationUsage = db.getModel('invitation_usage');
    this.systemSettingService = getSystemSettingService(db);
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
          attributes: ['mark', 'name'],  // mark: 角色标识，name: 显示名称
        }],
        raw: true,
        nest: true,
      });
      logger.info(`User ${user.username} roles query result:`, JSON.stringify(roles));
      
      // 提取所有角色标识（mark 字段）
      const roleMarks = roles.map(r => r.role?.mark).filter(Boolean);
      // 检查是否有管理员角色（用户可以有多个角色，通过 mark 字段判断）
      const isAdmin = roleMarks.includes('admin');
      // JWT 中的 role 字段：如果有 admin 角色则为 'admin'，否则取第一个角色
      const primaryRole = isAdmin ? 'admin' : (roleMarks[0] || 'user');
      logger.info(`User ${user.username} roles: ${roleMarks.join(',')}, primaryRole: ${primaryRole}`);

      // 获取 Token 配置并生成 Token
      const tokenConfig = await this.systemSettingService.getTokenConfig();
      const tokens = generateTokens(user.id, primaryRole, {
        accessExpiry: tokenConfig.access_expiry,
        refreshExpiry: tokenConfig.refresh_expiry,
      });

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
          attributes: ['mark', 'name'],
        }],
        raw: true,
        nest: true,
      });
      
      // 提取所有角色标识（mark 字段），检查是否包含 admin
      const roleMarks = roles.map(r => r.role?.mark).filter(Boolean);
      const isAdmin = roleMarks.includes('admin');
      const primaryRole = isAdmin ? 'admin' : (roleMarks[0] || decoded.role || 'user');

      // 获取 Token 配置并生成 Token
      const tokenConfig = await this.systemSettingService.getTokenConfig();
      const tokens = generateTokens(decoded.userId, primaryRole, {
        accessExpiry: tokenConfig.access_expiry,
        refreshExpiry: tokenConfig.refresh_expiry,
      });
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
        where: { id: ctx.state.session.id },
        attributes: ['id', 'username', 'email', 'nickname', 'avatar', 'preferences', 'created_at'],
        raw: true,
      });

      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      // 获取用户角色
      const roles = await this.UserRole.findAll({
        where: { user_id: ctx.state.session.id },
        include: [{
          model: this.Role,
          as: 'role',
          attributes: ['mark', 'name'],  // mark: 角色标识，name: 显示名称
        }],
        raw: true,
        nest: true,
      });

      ctx.success({
        ...user,
        roles: roles.map(r => r.role?.mark).filter(Boolean),  // 返回角色标识列表
        roleNames: roles.map(r => ({ mark: r.role?.mark, name: r.role?.name })),  // 返回完整角色信息
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

  /**
   * 用户注册
   * POST /api/auth/register
   */
  async register(ctx) {
    try {
      const { username, email, password, invitation_code } = ctx.request.body;

      // 验证必填字段
      if (!username || !email || !password) {
        ctx.error('用户名、邮箱和密码不能为空', 400);
        return;
      }

      // 验证用户名格式：字母开头，仅允许字母、数字、下划线，3-32位
      const usernameRegex = /^[a-zA-Z][a-zA-Z0-9_]{2,31}$/;
      if (!usernameRegex.test(username)) {
        ctx.error('用户名格式不正确：需以字母开头，仅允许字母、数字、下划线，长度3-32位', 400);
        return;
      }

      // 验证邮箱格式
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        ctx.error('邮箱格式不正确', 400);
        return;
      }

      // 验证密码长度
      if (password.length < 6) {
        ctx.error('密码长度至少6位', 400);
        return;
      }

      // 获取注册配置
      const regConfig = await this.systemSettingService.getRegistrationConfig();

      // 验证邀请码
      let invitation = null;
      if (invitation_code) {
        invitation = await this.Invitation.findOne({
          where: { code: invitation_code },
        });

        if (!invitation) {
          ctx.error('邀请码不存在', 400);
          return;
        }

        // 检查邀请码状态
        if (invitation.status === 'revoked') {
          ctx.error('邀请码已被撤销', 400);
          return;
        }

        if (invitation.status === 'exhausted') {
          ctx.error('邀请码已用完', 400);
          return;
        }

        // 检查过期
        if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
          ctx.error('邀请码已过期', 400);
          return;
        }

        // 检查使用次数
        if (invitation.used_count >= invitation.max_uses) {
          ctx.error('邀请码已用完', 400);
          return;
        }
      } else if (!regConfig.allow_self_registration) {
        // 没有邀请码且不允许自主注册
        ctx.error('需要有效的邀请码才能注册', 400);
        return;
      }

      // 检查用户名是否已存在
      const existingUsername = await this.User.findOne({
        where: { username },
      });
      if (existingUsername) {
        ctx.error('用户名已存在', 400);
        return;
      }

      // 检查邮箱是否已存在
      const existingEmail = await this.User.findOne({
        where: { email },
      });
      if (existingEmail) {
        ctx.error('邮箱已被注册', 400);
        return;
      }

      // 生成用户ID
      const userId = Utils.newID();

      // 加密密码
      const passwordHash = await bcrypt.hash(password, 10);

      // 创建用户
      const user = await this.User.create({
        id: userId,
        username,
        email,
        password_hash: passwordHash,
        nickname: username,
        status: 'active',
        invitation_quota: regConfig.default_invitation_quota,
      });

      // 分配默认角色
      const defaultRole = await this.Role.findOne({
        where: { mark: 'user' },
      });
      if (defaultRole) {
        await this.UserRole.create({
          user_id: userId,
          role_id: defaultRole.id,
        });
      }

      // 处理邀请码使用
      if (invitation) {
        // 更新邀请码使用次数
        const newUsedCount = invitation.used_count + 1;
        const updateData = { used_count: newUsedCount };
        if (newUsedCount >= invitation.max_uses) {
          updateData.status = 'exhausted';
        }
        await invitation.update(updateData);

        // 记录使用
        const usage = await this.InvitationUsage.create({
          invitation_id: invitation.id,
          user_id: userId,
        });

        // 更新用户的 invited_by 字段
        await user.update({ invited_by: usage.id });

        logger.info(`User ${userId} registered with invitation code: ${invitation.code}`);
      }

      logger.info(`User registered: ${username} (${userId})`);

      // 获取 Token 配置并生成 Token
      const tokenConfig = await this.systemSettingService.getTokenConfig();
      const tokens = generateTokens(userId, 'user', {
        accessExpiry: tokenConfig.access_expiry,
        refreshExpiry: tokenConfig.refresh_expiry,
      });

      ctx.success({
        user: {
          id: userId,
          username,
          email,
          nickname: username,
          role: 'user',
        },
        ...tokens,
      }, '注册成功');
    } catch (error) {
      logger.error('Register error:', error);
      ctx.error('注册失败: ' + error.message, 500);
    }
  }

  /**
   * 获取注册配置（公开接口）
   * GET /api/auth/registration-config
   */
  async getRegistrationConfig(ctx) {
    try {
      const config = await this.systemSettingService.getRegistrationConfig();
      ctx.success({
        allowSelfRegistration: config.allow_self_registration,
      });
    } catch (error) {
      logger.error('Get registration config error:', error);
      ctx.error('获取注册配置失败: ' + error.message, 500);
    }
  }
}

export default AuthController;
