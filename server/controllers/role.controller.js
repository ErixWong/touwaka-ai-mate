/**
 * Role Controller - 角色管理控制器
 */

import { models } from '../../models/index.js';
import Utils from '../../lib/utils.js';

const { role, permission, role_permission, role_expert, expert } = models;

/**
 * 获取角色列表
 */
async function list(ctx) {
  try {
    const roles = await role.findAll({
      order: [['created_at', 'ASC']],
    });

    ctx.body = {
      success: true,
      data: roles,
    };
  } catch (error) {
    console.error('[RoleController] list error:', error);
    ctx.error('获取角色列表失败', 500);
  }
}

/**
 * 获取单个角色详情
 */
async function get(ctx) {
  const { id } = ctx.params;

  try {
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    ctx.body = {
      success: true,
      data: roleData,
    };
  } catch (error) {
    console.error('[RoleController] get error:', error);
    ctx.error('获取角色详情失败', 500);
  }
}

/**
 * 更新角色基本信息
 */
async function update(ctx) {
  const { id } = ctx.params;
  const { label, description } = ctx.request.body;

  try {
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 系统角色只允许修改 label 和 description
    const updates = {};
    if (label !== undefined) updates.label = label;
    if (description !== undefined) updates.description = description;

    await roleData.update(updates);

    ctx.body = {
      success: true,
      data: roleData,
      message: '角色更新成功',
    };
  } catch (error) {
    console.error('[RoleController] update error:', error);
    ctx.error('更新角色失败', 500);
  }
}

/**
 * 获取角色的权限列表
 */
async function getPermissions(ctx) {
  const { id } = ctx.params;

  try {
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    const permissions = await roleData.getPermission_id_permissions({
      attributes: ['id', 'code', 'name', 'type', 'parent_id'],
    });

    ctx.body = {
      success: true,
      data: {
        permission_ids: permissions.map(p => p.id),
      },
    };
  } catch (error) {
    console.error('[RoleController] getPermissions error:', error);
    ctx.error('获取角色权限失败', 500);
  }
}

/**
 * 更新角色权限
 */
async function updatePermissions(ctx) {
  const { id } = ctx.params;
  const { permission_ids } = ctx.request.body;

  if (!Array.isArray(permission_ids)) {
    ctx.error('permission_ids 必须是数组', 400);
    return;
  }

  try {
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 管理员角色拥有所有权限，不允许修改
    if (roleData.name === 'admin') {
      ctx.error('管理员角色权限不可修改', 403);
      return;
    }

    // 验证所有权限是否存在
    const permissions = await permission.findAll({
      where: { id: permission_ids },
    });

    if (permissions.length !== permission_ids.length) {
      ctx.error('部分权限不存在', 400);
      return;
    }

    // 设置角色权限
    await roleData.setPermission_id_permissions(permission_ids);

    ctx.body = {
      success: true,
      message: '角色权限更新成功',
    };
  } catch (error) {
    console.error('[RoleController] updatePermissions error:', error);
    ctx.error('更新角色权限失败', 500);
  }
}

/**
 * 获取角色可访问的专家列表
 */
async function getExperts(ctx) {
  const { id } = ctx.params;

  try {
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 管理员角色可以访问所有专家
    if (roleData.name === 'admin') {
      const allExperts = await expert.findAll({
        attributes: ['id', 'name'],
        where: { is_active: true },
      });
      ctx.body = {
        success: true,
        data: {
          expert_ids: allExperts.map(e => e.id),
          is_admin: true,
        },
      };
      return;
    }

    const experts = await roleData.getExpert_id_experts({
      attributes: ['id', 'name'],
    });

    ctx.body = {
      success: true,
      data: {
        expert_ids: experts.map(e => e.id),
        is_admin: false,
      },
    };
  } catch (error) {
    console.error('[RoleController] getExperts error:', error);
    ctx.error('获取角色专家失败', 500);
  }
}

/**
 * 更新角色专家访问权限
 */
async function updateExperts(ctx) {
  const { id } = ctx.params;
  const { expert_ids } = ctx.request.body;

  if (!Array.isArray(expert_ids)) {
    ctx.error('expert_ids 必须是数组', 400);
    return;
  }

  try {
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 管理员角色可以访问所有专家，不允许修改
    if (roleData.name === 'admin') {
      ctx.error('管理员角色专家访问权限不可修改', 403);
      return;
    }

    // 验证所有专家是否存在
    const experts = await expert.findAll({
      where: { id: expert_ids },
    });

    if (experts.length !== expert_ids.length) {
      ctx.error('部分专家不存在', 400);
      return;
    }

    // 设置角色专家
    await roleData.setExpert_id_experts(expert_ids);

    ctx.body = {
      success: true,
      message: '角色专家访问权限更新成功',
    };
  } catch (error) {
    console.error('[RoleController] updateExperts error:', error);
    ctx.error('更新角色专家访问权限失败', 500);
  }
}

/**
 * 获取所有权限列表（用于角色管理界面）
 */
async function listAllPermissions(ctx) {
  try {
    const permissions = await permission.findAll({
      attributes: ['id', 'code', 'name', 'type', 'parent_id', 'route_path', 'sort_order'],
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
    });

    ctx.body = {
      success: true,
      data: permissions,
    };
  } catch (error) {
    console.error('[RoleController] listAllPermissions error:', error);
    ctx.error('获取权限列表失败', 500);
  }
}

/**
 * 获取所有专家列表（用于角色管理界面）
 */
async function listAllExperts(ctx) {
  try {
    const experts = await expert.findAll({
      attributes: ['id', 'name', 'introduction'],
      where: { is_active: true },
      order: [['name', 'ASC']],
    });

    ctx.body = {
      success: true,
      data: experts,
    };
  } catch (error) {
    console.error('[RoleController] listAllExperts error:', error);
    ctx.error('获取专家列表失败', 500);
  }
}

export default {
  list,
  get,
  update,
  getPermissions,
  updatePermissions,
  getExperts,
  updateExperts,
  listAllPermissions,
  listAllExperts,
};