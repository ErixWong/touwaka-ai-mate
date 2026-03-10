/**
 * Department Controller - 部门控制器
 */

import Utils from '../../lib/utils.js';
import logger from '../../lib/logger.js';

class DepartmentController {
  constructor(db) {
    this.db = db;
    this.Department = db.getModel('department');
    this.Position = db.getModel('position');
    this.User = db.getModel('user');
  }

  /**
   * 获取部门树
   */
  async getDepartmentTree(ctx) {
    try {
      const departments = await this.Department.findAll({
        where: { status: 'active' },
        order: [['name', 'ASC']],
        raw: true,
      });

      // 构建树形结构
      const buildTree = (items, parentId = null) => {
        return items
          .filter(item => item.parent_id === parentId)
          .map(item => ({
            ...item,
            children: buildTree(items, item.id),
          }));
      };

      const tree = buildTree(departments);
      ctx.success(tree);
    } catch (error) {
      logger.error('Get department tree error:', error);
      ctx.error('获取部门树失败', 500);
    }
  }

  /**
   * 创建部门
   */
  async createDepartment(ctx) {
    try {
      // 检查管理员权限
      if (!ctx.state.session.isAdmin) {
        ctx.error('无权限访问', 403);
        return;
      }

      const { name, parent_id, description } = ctx.request.body;

      if (!name) {
        ctx.error('部门名称不能为空');
        return;
      }

      // 检查名称长度
      if (name.length > 100) {
        ctx.error('部门名称不能超过100字符');
        return;
      }

      // 检查描述长度
      if (description && description.length > 500) {
        ctx.error('部门描述不能超过500字符');
        return;
      }

      // 检查同级是否已有同名部门
      const existingDept = await this.Department.findOne({
        where: {
          name,
          parent_id: parent_id || null,
          status: 'active',
        },
        raw: true,
      });
      if (existingDept) {
        ctx.error('同级部门已存在同名部门', 409);
        return;
      }

      // 检查层级深度
      let level = 1;
      let path = `/${Utils.newID()}`;
      let parentId = parent_id || null;

      if (parentId) {
        const parent = await this.Department.findOne({
          where: { id: parentId },
          raw: true,
        });

        if (!parent) {
          ctx.error('父部门不存在', 404);
          return;
        }

        if (parent.level >= 4) {
          ctx.error('部门层级不能超过4级', 400);
          return;
        }

        level = parent.level + 1;
        path = `${parent.path}${path}`;
      }

      const id = Utils.newID();
      await this.Department.create({
        id,
        name,
        parent_id: parentId,
        path,
        level,
        description,
        status: 'active',
      });

      ctx.success({
        id,
        name,
        parent_id: parentId,
        path,
        level,
        description,
      });
    } catch (error) {
      logger.error('Create department error:', error);
      ctx.error('创建部门失败', 500);
    }
  }

  /**
   * 获取部门详情
   */
  async getDepartment(ctx) {
    try {
      const { id } = ctx.params;

      const department = await this.Department.findOne({
        where: { id },
        raw: true,
      });

      if (!department) {
        ctx.error('部门不存在', 404);
        return;
      }

      ctx.success(department);
    } catch (error) {
      logger.error('Get department error:', error);
      ctx.error('获取部门失败', 500);
    }
  }

  /**
   * 更新部门
   */
  async updateDepartment(ctx) {
    try {
      // 检查管理员权限
      if (!ctx.state.session.isAdmin) {
        ctx.error('无权限访问', 403);
        return;
      }

      const { id } = ctx.params;
      const { name, description } = ctx.request.body;

      const department = await this.Department.findOne({
        where: { id },
        raw: true,
      });

      if (!department) {
        ctx.error('部门不存在', 404);
        return;
      }

      // 构建更新对象，只更新传入的字段
      const updates = {};
      if (name !== undefined) {
        // 检查名称长度
        if (name.length > 100) {
          ctx.error('部门名称不能超过100字符');
          return;
        }
        // 检查同级是否已有同名部门（排除自己）
        const existingDept = await this.Department.findOne({
          where: {
            name,
            parent_id: department.parent_id,
            status: 'active',
          },
          raw: true,
        });
        if (existingDept && existingDept.id !== id) {
          ctx.error('同级部门已存在同名部门', 409);
          return;
        }
        updates.name = name;
      }
      if (description !== undefined) {
        if (description.length > 500) {
          ctx.error('部门描述不能超过500字符');
          return;
        }
        updates.description = description;
      }

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      await this.Department.update(updates, { where: { id } });

      ctx.success({ id, ...updates });
    } catch (error) {
      logger.error('Update department error:', error);
      ctx.error('更新部门失败', 500);
    }
  }

  /**
   * 删除部门
   */
  async deleteDepartment(ctx) {
    try {
      // 检查管理员权限
      if (!ctx.state.session.isAdmin) {
        ctx.error('无权限访问', 403);
        return;
      }

      const { id } = ctx.params;

      // 检查是否有子部门
      const children = await this.Department.count({
        where: { parent_id: id },
      });

      if (children > 0) {
        ctx.error('请先删除子部门', 400);
        return;
      }

      // 检查是否有职位
      const positions = await this.Position.count({
        where: { department_id: id },
      });

      if (positions > 0) {
        ctx.error('请先删除职位', 400);
        return;
      }

      // 检查是否有成员
      const members = await this.User.count({
        where: { department_id: id },
      });

      if (members > 0) {
        ctx.error('请先移除部门成员', 400);
        return;
      }

      await this.Department.destroy({ where: { id } });

      ctx.success({ id });
    } catch (error) {
      logger.error('Delete department error:', error);
      ctx.error('删除部门失败', 500);
    }
  }

  /**
   * 获取部门职位列表（含成员）
   */
  async getDepartmentPositions(ctx) {
    try {
      const { id } = ctx.params;

      const positions = await this.Position.findAll({
        where: { department_id: id, status: 'active' },
        order: [
          ['is_manager', 'DESC'],
          ['name', 'ASC'],
        ],
        include: [{
          model: this.User,
          as: 'members',
          attributes: ['id', 'username', 'nickname', 'avatar'],
          where: { status: 'active' },
          required: false, // LEFT JOIN
        }],
      });

      ctx.success(positions);
    } catch (error) {
      logger.error('Get department positions error:', error);
      ctx.error('获取部门职位失败', 500);
    }
  }

  /**
   * 获取部门负责人
   */
  async getDepartmentManagers(ctx) {
    try {
      const { id } = ctx.params;

      const managerPositions = await this.Position.findAll({
        where: { department_id: id, is_manager: true, status: 'active' },
        include: [{
          model: this.User,
          as: 'members',
          attributes: ['id', 'username', 'nickname', 'avatar'],
          where: { status: 'active' },
          required: false, // LEFT JOIN
        }],
      });

      // 提取所有负责人
      const managers = [];
      for (const pos of managerPositions) {
        if (pos.members && pos.members.length > 0) {
          managers.push(...pos.members.map(m => m.get({ plain: true })));
        }
      }

      ctx.success(managers);
    } catch (error) {
      logger.error('Get department managers error:', error);
      ctx.error('获取部门负责人失败', 500);
    }
  }
}

export default DepartmentController;
