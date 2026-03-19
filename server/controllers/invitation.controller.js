/**
 * Invitation Controller - 邀请码控制器
 *
 * 处理邀请码的创建、查询、验证和撤销
 */

import crypto from 'crypto';
import logger from '../../lib/logger.js';
import { getSystemSettingService } from '../services/system-setting.service.js';

class InvitationController {
  constructor(db) {
    this.db = db;
    this.User = db.getModel('user');
    this.Invitation = db.getModel('invitation');
    this.InvitationUsage = db.getModel('invitation_usage');
    this.systemSettingService = getSystemSettingService(db);
  }

  /**
   * 生成随机邀请码
   * @param {number} length - 邀请码长度
   * @returns {string} 邀请码
   */
  _generateCode(length = 16) {
    return crypto.randomBytes(length / 2).toString('hex').toUpperCase();
  }

  /**
   * 获取当前用户的邀请配额信息
   * GET /api/invitations/quota
   */
  async getQuota(ctx) {
    try {
      const userId = ctx.state.session.id;
      
      // 获取用户的邀请配额
      const user = await this.User.findOne({
        where: { id: userId },
        attributes: ['invitation_quota'],
        raw: true,
      });

      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      // 获取已生成的邀请码数量
      const usedCount = await this.Invitation.count({
        where: { creator_id: userId },
      });

      const quota = user.invitation_quota ?? (await this.systemSettingService.getRegistrationConfig()).default_invitation_quota;

      ctx.success({
        quota: quota,
        used: usedCount,
        remaining: Math.max(0, quota - usedCount),
      });
    } catch (error) {
      logger.error('Get invitation quota error:', error);
      ctx.error('获取邀请配额失败: ' + error.message, 500);
    }
  }

  /**
   * 创建邀请码
   * POST /api/invitations
   */
  async create(ctx) {
    try {
      const userId = ctx.state.session.id;
      const { max_uses, expires_in_days } = ctx.request.body || {};

      // 获取注册配置
      const regConfig = await this.systemSettingService.getRegistrationConfig();

      // 获取用户的邀请配额
      const user = await this.User.findOne({
        where: { id: userId },
        attributes: ['invitation_quota'],
        raw: true,
      });

      const quota = user?.invitation_quota ?? regConfig.default_invitation_quota;

      // 检查已生成的邀请码数量
      const existingCount = await this.Invitation.count({
        where: { creator_id: userId },
      });

      if (existingCount >= quota) {
        ctx.error('已达邀请码上限，无法创建更多邀请码', 400);
        return;
      }

      // 生成邀请码
      const code = this._generateCode();

      // 计算过期时间
      const expiryDays = expires_in_days ?? regConfig.invitation_expiry_days;
      let expiresAt = null;
      if (expiryDays > 0) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + expiryDays);
      }

      // 创建邀请码
      const invitation = await this.Invitation.create({
        code,
        creator_id: userId,
        max_uses: max_uses ?? regConfig.default_invitation_max_uses,
        used_count: 0,
        expires_at: expiresAt,
        status: 'active',
      });

      logger.info(`User ${userId} created invitation code: ${code}`);

      ctx.success({
        id: invitation.id,
        code: invitation.code,
        maxUses: invitation.max_uses,
        usedCount: invitation.used_count,
        remaining: invitation.max_uses - invitation.used_count,
        status: invitation.status,
        expiresAt: invitation.expires_at,
        createdAt: invitation.created_at,
      });
    } catch (error) {
      logger.error('Create invitation error:', error);
      ctx.error('创建邀请码失败: ' + error.message, 500);
    }
  }

  /**
   * 获取当前用户的邀请码列表
   * GET /api/invitations
   */
  async list(ctx) {
    try {
      const userId = ctx.state.session.id;

      const invitations = await this.Invitation.findAll({
        where: { creator_id: userId },
        order: [['created_at', 'DESC']],
        raw: true,
      });

      const items = invitations.map(inv => ({
        id: inv.id,
        code: inv.code,
        maxUses: inv.max_uses,
        usedCount: inv.used_count,
        remaining: inv.max_uses - inv.used_count,
        status: inv.status,
        expiresAt: inv.expires_at,
        createdAt: inv.created_at,
      }));

      ctx.success({
        items,
        total: items.length,
      });
    } catch (error) {
      logger.error('List invitations error:', error);
      ctx.error('获取邀请码列表失败: ' + error.message, 500);
    }
  }

  /**
   * 获取邀请码的使用记录
   * GET /api/invitations/:id/usage
   */
  async getUsage(ctx) {
    try {
      const userId = ctx.state.session.id;
      const invitationId = parseInt(ctx.params.id, 10);

      if (isNaN(invitationId)) {
        ctx.error('无效的邀请码ID', 400);
        return;
      }

      // 验证邀请码属于当前用户
      const invitation = await this.Invitation.findOne({
        where: { id: invitationId },
        raw: true,
      });

      if (!invitation) {
        ctx.error('邀请码不存在', 404);
        return;
      }

      if (invitation.creator_id !== userId) {
        ctx.error('无权查看此邀请码的使用记录', 403);
        return;
      }

      // 获取使用记录
      const usages = await this.InvitationUsage.findAll({
        where: { invitation_id: invitationId },
        include: [{
          model: this.User,
          as: 'user',
          attributes: ['id', 'username', 'nickname'],
        }],
        order: [['used_at', 'DESC']],
        raw: true,
        nest: true,
      });

      const items = usages.map(u => ({
        userId: u.user?.id,
        username: u.user?.username,
        nickname: u.user?.nickname,
        usedAt: u.used_at,
      }));

      ctx.success({
        items,
        total: items.length,
      });
    } catch (error) {
      logger.error('Get invitation usage error:', error);
      ctx.error('获取邀请使用记录失败: ' + error.message, 500);
    }
  }

  /**
   * 撤销邀请码
   * DELETE /api/invitations/:id
   */
  async revoke(ctx) {
    try {
      const userId = ctx.state.session.id;
      const invitationId = parseInt(ctx.params.id, 10);

      if (isNaN(invitationId)) {
        ctx.error('无效的邀请码ID', 400);
        return;
      }

      // 验证邀请码属于当前用户
      const invitation = await this.Invitation.findOne({
        where: { id: invitationId },
      });

      if (!invitation) {
        ctx.error('邀请码不存在', 404);
        return;
      }

      if (invitation.creator_id !== userId) {
        ctx.error('无权撤销此邀请码', 403);
        return;
      }

      if (invitation.status !== 'active') {
        ctx.error('邀请码已失效，无法撤销', 400);
        return;
      }

      // 更新状态为已撤销
      await invitation.update({ status: 'revoked' });

      logger.info(`User ${userId} revoked invitation code: ${invitation.code}`);

      ctx.success(null, '邀请码已撤销');
    } catch (error) {
      logger.error('Revoke invitation error:', error);
      ctx.error('撤销邀请码失败: ' + error.message, 500);
    }
  }

  /**
   * 验证邀请码（公开接口）
   * GET /api/invitations/:code/verify
   */
  async verify(ctx) {
    try {
      const code = ctx.params.code;

      if (!code) {
        ctx.error('请提供邀请码', 400);
        return;
      }

      const invitation = await this.Invitation.findOne({
        where: { code },
        raw: true,
      });

      if (!invitation) {
        ctx.success({
          valid: false,
          message: '邀请码不存在',
        });
        return;
      }

      // 检查状态
      if (invitation.status === 'revoked') {
        ctx.success({
          valid: false,
          message: '邀请码已被撤销',
        });
        return;
      }

      if (invitation.status === 'exhausted') {
        ctx.success({
          valid: false,
          message: '邀请码已用完',
        });
        return;
      }

      // 检查过期
      if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
        ctx.success({
          valid: false,
          message: '邀请码已过期',
        });
        return;
      }

      // 检查使用次数
      if (invitation.used_count >= invitation.max_uses) {
        ctx.success({
          valid: false,
          message: '邀请码已用完',
        });
        return;
      }

      ctx.success({
        valid: true,
        code: invitation.code,
        remaining: invitation.max_uses - invitation.used_count,
        expiresAt: invitation.expires_at,
      });
    } catch (error) {
      logger.error('Verify invitation error:', error);
      ctx.error('验证邀请码失败: ' + error.message, 500);
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

export default InvitationController;