/**
 * User Controller - 用户控制器
 * 
 * 使用 Sequelize ORM 进行数据库操作
 */

import bcrypt from 'bcryptjs';
import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

class UserController {
  constructor(db) {
    this.db = db;
    this.User = db.getModel('user');
    this.UserRole = db.getModel('user_role');
    this.Role = db.getModel('role');
  }

  /**
   * 获取用户列表（支持分页、搜索）
   * 管理员专用
   */
  async getUsers(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const { page = 1, pageSize = 10, search = '' } = ctx.query;
      const offset = (parseInt(page) - 1) * parseInt(pageSize);
      const limit = parseInt(pageSize);

      // 构建搜索条件
      const { Op } = this.db;
      const whereClause = search ? {
        [Op.or]: [
          { username: { [Op.like]: `%${search}%` } },
          { email: { [Op.like]: `%${search}%` } },
          { nickname: { [Op.like]: `%${search}%` } },
        ],
      } : {};

      // 查询用户列表
      const { count, rows } = await this.User.findAndCountAll({
        where: whereClause,
        attributes: [
          'id', 'username', 'email', 'nickname', 'avatar',
          'gender', 'birthday', 'occupation', 'location', 'status',
          'last_login', 'created_at', 'updated_at'
        ],
        offset,
        limit,
        order: [['created_at', 'DESC']],
        raw: true,
      });

      // 获取每个用户的角色
      const usersWithRoles = await Promise.all(
        rows.map(async (user) => {
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
          return {
            ...user,
            roles: roles.map(r => r.role?.name).filter(Boolean),
          };
        })
      );

      ctx.success({
        items: usersWithRoles,
        pagination: {
          page: parseInt(page),
          size: limit,
          total: count,
          pages: Math.ceil(count / limit),
        },
      });
    } catch (error) {
      logger.error('Get users error:', error);
      ctx.error('获取用户列表失败', 500);
    }
  }

  /**
   * 创建新用户
   * 管理员专用
   */
  async createUser(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const {
        username, email, password, nickname,
        gender, birthday, occupation, location, status,
      } = ctx.request.body;

      // 验证必填字段
      if (!username || !email || !password) {
        ctx.error('用户名、邮箱和密码为必填项');
        return;
      }

      // 检查用户名是否已存在
      const existingUsername = await this.User.findOne({
        where: { username },
        raw: true,
      });
      if (existingUsername) {
        ctx.error('用户名已存在', 409);
        return;
      }

      // 检查邮箱是否已存在
      const existingEmail = await this.User.findOne({
        where: { email },
        raw: true,
      });
      if (existingEmail) {
        ctx.error('邮箱已存在', 409);
        return;
      }

      // 生成用户 ID（使用 Utils.newID 遵循项目规范）
      const userId = Utils.newID();

      // 哈希密码
      const passwordHash = await bcrypt.hash(password, 10);

      // 创建用户
      await this.User.create({
        id: userId,
        username,
        email,
        password_hash: passwordHash,
        nickname: nickname || username,
        gender: gender || null,
        birthday: birthday || null,
        occupation: occupation || null,
        location: location || null,
        status: status || 'active',
      });

      // 返回创建的用户（不包含密码）
      ctx.success({
        id: userId,
        username,
        email,
        nickname: nickname || username,
        gender,
        birthday,
        occupation,
        location,
        status: status || 'active',
      }, '用户创建成功');
    } catch (error) {
      logger.error('Create user error:', error);
      ctx.error('创建用户失败', 500);
    }
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
        attributes: ['id', 'email', 'nickname', 'avatar', 'preferences', 'created_at'],
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
   * 更新用户信息（管理员可编辑所有字段）
   */
  async updateUser(ctx) {
    try {
      const { id } = ctx.params;
      const isAdmin = ctx.state.userRole === 'admin';
      const isSelf = id === ctx.state.userId;

      if (!isSelf && !isAdmin) {
        ctx.error('无权限修改', 403);
        return;
      }

      const {
        username, email, nickname, avatar,
        gender, birthday, occupation, location, status,
      } = ctx.request.body;

      const updates = {};

      // 管理员可修改所有字段
      if (isAdmin) {
        if (username !== undefined) updates.username = username;
        if (email !== undefined) updates.email = email;
        if (status !== undefined) updates.status = status;
      }

      // 所有登录用户可修改的字段
      if (nickname !== undefined) updates.nickname = nickname;
      if (avatar !== undefined) updates.avatar = avatar;
      if (gender !== undefined) updates.gender = gender;
      if (birthday !== undefined) updates.birthday = birthday;
      if (occupation !== undefined) updates.occupation = occupation;
      if (location !== undefined) updates.location = location;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      // 检查用户名和邮箱唯一性
      if (updates.username || updates.email) {
        const { Op } = this.db;
        const existing = await this.User.findOne({
          where: {
            [Op.or]: [
              updates.username ? { username: updates.username } : null,
              updates.email ? { email: updates.email } : null,
            ].filter(Boolean),
            id: { [Op.ne]: id },
          },
          raw: true,
        });
        if (existing) {
          if (existing.username === updates.username) {
            ctx.error('用户名已存在', 409);
            return;
          }
          if (existing.email === updates.email) {
            ctx.error('邮箱已存在', 409);
            return;
          }
        }
      }

      await this.User.update(updates, { where: { id } });

      ctx.success(null, '更新成功');
    } catch (error) {
      logger.error('Update user error:', error);
      ctx.error('更新失败', 500);
    }
  }

  /**
   * 删除用户
   * 管理员专用
   */
  async deleteUser(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const { id } = ctx.params;

      // 不能删除自己
      if (id === ctx.state.userId) {
        ctx.error('不能删除自己的账户');
        return;
      }

      const user = await this.User.findOne({ where: { id }, raw: true });
      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      // 删除用户角色关联
      await this.UserRole.destroy({ where: { user_id: id } });

      // 删除用户
      await this.User.destroy({ where: { id } });

      ctx.success(null, '用户已删除');
    } catch (error) {
      logger.error('Delete user error:', error);
      ctx.error('删除用户失败', 500);
    }
  }

  /**
   * 重置用户密码
   * 管理员专用
   */
  async resetPassword(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const { id } = ctx.params;
      const { password } = ctx.request.body;

      if (!password || password.length < 6) {
        ctx.error('密码长度至少为 6 位');
        return;
      }

      const user = await this.User.findOne({ where: { id }, raw: true });
      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      // 哈希新密码
      const passwordHash = await bcrypt.hash(password, 10);

      await this.User.update(
        { password_hash: passwordHash },
        { where: { id } }
      );

      ctx.success(null, '密码重置成功');
    } catch (error) {
      logger.error('Reset password error:', error);
      ctx.error('重置密码失败', 500);
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

  /**
   * 获取所有角色列表
   * 管理员专用
   */
  async getRoles(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const roles = await this.Role.findAll({
        attributes: ['id', 'name', 'label', 'description', 'is_system'],
        order: [['name', 'ASC']],
        raw: true,
      });

      ctx.success(roles);
    } catch (error) {
      logger.error('Get roles error:', error);
      ctx.error('获取角色列表失败', 500);
    }
  }

  /**
   * 更新用户角色
   * 管理员专用
   */
  async updateUserRoles(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const { id } = ctx.params;
      const { roleIds } = ctx.request.body;

      if (!Array.isArray(roleIds)) {
        ctx.error('roleIds 必须是数组');
        return;
      }

      // 检查用户是否存在
      const user = await this.User.findOne({ where: { id }, raw: true });
      if (!user) {
        ctx.error('用户不存在', 404);
        return;
      }

      // 删除现有角色
      await this.UserRole.destroy({ where: { user_id: id } });

      // 添加新角色
      if (roleIds.length > 0) {
        const roleRecords = roleIds.map(roleId => ({
          user_id: id,
          role_id: roleId,
        }));
        await this.UserRole.bulkCreate(roleRecords);
      }

      ctx.success(null, '角色更新成功');
    } catch (error) {
      logger.error('Update user roles error:', error);
      ctx.error('更新角色失败', 500);
    }
  }
}

export default UserController;
