/**
 * Position Controller - 职位控制器
 */

import Utils from '../../lib/utils.js';
import logger from '../../lib/logger.js';

class PositionController {
  constructor(db) {
    this.db = db;
    this.Department = db.getModel('department');
    this.Position = db.getModel('position');
    this.User = db.getModel('user');
  }

  /**
   * 创建职位
   */
  async createPosition(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const { name, department_id, is_manager, description } = ctx.request.body;

      if (!name || !department_id) {
        ctx.error('职位名称和所属部门不能为空');
        return;
      }

      // 检查名称长度
      if (name.length > 100) {
        ctx.error('职位名称不能超过100字符');
        return;
      }

      // 检查描述长度
      if (description && description.length > 500) {
        ctx.error('职位描述不能超过500字符');
        return;
      }

      // 检查部门是否存在
      const department = await this.Department.findOne({
        where: { id: department_id },
        raw: true,
      });

      if (!department) {
        ctx.error('所属部门不存在', 404);
        return;
      }

      const id = Utils.newID();
      await this.Position.create({
        id,
        name,
        department_id,
        is_manager: is_manager || false,
        description,
        status: 'active',
      });

      ctx.success({
        id,
        name,
        department_id,
        is_manager: is_manager || false,
        description,
      });
    } catch (error) {
      logger.error('Create position error:', error);
      ctx.error('创建职位失败', 500);
    }
  }

  /**
   * 获取职位详情
   */
  async getPosition(ctx) {
    try {
      const { id } = ctx.params;

      const position = await this.Position.findOne({
        where: { id },
        include: [{
          model: this.Department,
          as: 'department',
          attributes: ['id', 'name', 'level'],
        }],
      });

      if (!position) {
        ctx.error('职位不存在', 404);
        return;
      }

      ctx.success(position.get({ plain: true }));
    } catch (error) {
      logger.error('Get position error:', error);
      ctx.error('获取职位失败', 500);
    }
  }

  /**
   * 更新职位
   */
  async updatePosition(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const { id } = ctx.params;
      const { name, is_manager, description } = ctx.request.body;

      const position = await this.Position.findOne({
        where: { id },
        raw: true,
      });

      if (!position) {
        ctx.error('职位不存在', 404);
        return;
      }

      // 构建更新对象，只更新传入的字段
      const updates = {};
      if (name !== undefined) {
        if (name.length > 100) {
          ctx.error('职位名称不能超过100字符');
          return;
        }
        updates.name = name;
      }
      if (is_manager !== undefined) updates.is_manager = is_manager;
      if (description !== undefined) {
        if (description.length > 500) {
          ctx.error('职位描述不能超过500字符');
          return;
        }
        updates.description = description;
      }

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      await this.Position.update(updates, { where: { id } });

      ctx.success({ id, ...updates });
    } catch (error) {
      logger.error('Update position error:', error);
      ctx.error('更新职位失败', 500);
    }
  }

  /**
   * 删除职位
   */
  async deletePosition(ctx) {
    try {
      // 检查管理员权限
      if (ctx.state.userRole !== 'admin') {
        ctx.error('无权限访问', 403);
        return;
      }

      const { id } = ctx.params;

      // 检查是否有成员
      const members = await this.User.count({
        where: { position_id: id },
      });

      if (members > 0) {
        ctx.error('请先移除职位成员', 400);
        return;
      }

      await this.Position.destroy({ where: { id } });

      ctx.success({ id });
    } catch (error) {
      logger.error('Delete position error:', error);
      ctx.error('删除职位失败', 500);
    }
  }

  /**
   * 获取职位成员列表
   */
  async getPositionMembers(ctx) {
    try {
      const { id } = ctx.params;

      const members = await this.User.findAll({
        where: { position_id: id, status: 'active' },
        attributes: ['id', 'username', 'nickname', 'avatar', 'email'],
        raw: true,
      });

      ctx.success(members);
    } catch (error) {
      logger.error('Get position members error:', error);
      ctx.error('获取职位成员失败', 500);
    }
  }

  /**
   * 获取部门下的所有职位
   */
  async getDepartmentPositions(ctx) {
    try {
      const { department_id } = ctx.params;

      const positions = await this.Position.findAll({
        where: { department_id, status: 'active' },
        order: [
          ['is_manager', 'DESC'],
          ['name', 'ASC'],
        ],
        raw: true,
      });

      ctx.success(positions);
    } catch (error) {
      logger.error('Get department positions error:', error);
      ctx.error('获取部门职位失败', 500);
    }
  }
}

export default PositionController;
