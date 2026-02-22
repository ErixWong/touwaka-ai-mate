/**
 * User Controller - 用户控制器
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import logger from '../../lib/logger.js';

class UserController {
  constructor(db) {
    this.db = db;
    this.User = db.getModel('user');
  }

  /**
   * 获取用户信息
   */
  async getUser(ctx) {
    try {
      const { id } = ctx.params;

      // 只能查看自己或管理员查看任何人
      if (id !== ctx.state.userId && ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const user = await this.User.findOne({
        where: { id },
        attributes: ['id', 'email', 'nickname', 'role', 'avatar', 'preferences', 'created_at'],
        raw: true,
      });

      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      ctx.success({
        ...user,
        preferences: user.preferences ? JSON.parse(user.preferences) : {},
      });
    } catch (error) {
      logger.error('Get user error:', error);
      ctx.error('获取用户失败', 500);
    }
  }

  /**
   * 更新用户信息
   */
  async updateUser(ctx) {
    try {
      const { id } = ctx.params;

      if (id !== ctx.state.userId && ctx.state.userRole !== 'admin') {
        ctx.error('无权限修改', 403);
        return;
      }

      const { nickname, avatar } = ctx.request.body;
      const updates = {};

      if (nickname !== undefined) updates.nickname = nickname;
      if (avatar !== undefined) updates.avatar = avatar;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      await this.User.update(updates, { where: { id } });

      ctx.success(null, '更新成功');
    } catch (error) {
      logger.error('Update user error:', error);
      ctx.error('更新失败', 500);
    }
  }

  /**
   * 更新用户偏好设置（通过 URL 参数指定用户 ID）
   * @deprecated 请使用 updateMyPreferences，直接从认证信息获取用户 ID
   */
  async updatePreferences(ctx) {
    try {
      const { id } = ctx.params;

      if (id !== ctx.state.userId) {
        ctx.error('无权限修改', 403);
        return;
      }

      const preferences = JSON.stringify(ctx.request.body);
      await this.User.update(
        { preferences },
        { where: { id } }
      );

      ctx.success(null, '偏好设置更新成功');
    } catch (error) {
      logger.error('Update preferences error:', error);
      ctx.error('更新偏好设置失败', 500);
    }
  }

  /**
   * 获取当前用户的偏好设置
   * 直接从认证信息获取用户 ID，无需前端传递
   */
  async getMyPreferences(ctx) {
    try {
      const user = await this.User.findOne({
        where: { id: ctx.state.userId },
        attributes: ['preferences'],
        raw: true,
      });

      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      ctx.success(user.preferences ? JSON.parse(user.preferences) : {});
    } catch (error) {
      logger.error('Get my preferences error:', error);
      ctx.error('获取偏好设置失败', 500);
    }
  }

  /**
   * 更新当前用户的偏好设置
   * 直接从认证信息获取用户 ID，无需前端传递
   */
  async updateMyPreferences(ctx) {
    try {
      const preferences = JSON.stringify(ctx.request.body);
      await this.User.update(
        { preferences },
        { where: { id: ctx.state.userId } }
      );

      // 返回更新后的偏好设置
      const user = await this.User.findOne({
        where: { id: ctx.state.userId },
        attributes: ['preferences'],
        raw: true,
      });

      const updatedPreferences = user && user.preferences
        ? JSON.parse(user.preferences)
        : ctx.request.body;

      ctx.success(updatedPreferences, '偏好设置更新成功');
    } catch (error) {
      logger.error('Update my preferences error:', error);
      ctx.error('更新偏好设置失败', 500);
    }
  }
}

export default UserController;
