/**
 * Role Controller - 角色管理控制器
 * 使用 ctx.db.getModel() 获取模型，避免独立的数据库连接
 */

import Utils from '../../lib/utils.js';

/**
 * 获取角色列表
 */
async function list(ctx) {
  try {
    const role = ctx.db.getModel('role');
    const roles = await role.findAll({
      order: [['created_at', 'ASC']],
    });

    ctx.success(roles);
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
    const role = ctx.db.getModel('role');
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    ctx.success(roleData);
  } catch (error) {
    console.error('[RoleController] get error:', error);
    ctx.error('获取角色详情失败', 500);
  }
}

/**
 * 更新角色基本信息
 * 注意：mark（角色标识）不可修改，只能修改 name（显示名称）和 description
 */
async function update(ctx) {
  const { id } = ctx.params;
  const { name, description } = ctx.request.body;  // name 是显示名称，mark 不可修改

  try {
    const role = ctx.db.getModel('role');
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 只允许修改 name（显示名称）和 description，mark（角色标识）不可修改
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;

    await roleData.update(updates);

    ctx.success(roleData, '角色更新成功');
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
    const role = ctx.db.getModel('role');
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 管理员角色拥有所有权限
    if (roleData.mark === 'admin') {
      const permission = ctx.db.getModel('permission');
      const allPermissions = await permission.findAll({
        attributes: ['id', 'code', 'name', 'type', 'parent_id'],
      });
      ctx.success({
        permission_ids: allPermissions.map(p => p.id),
        is_admin: true,
      });
      return;
    }

    const permissions = await roleData.getPermission_id_permissions({
      attributes: ['id', 'code', 'name', 'type', 'parent_id'],
    });

    ctx.success({
      permission_ids: permissions.map(p => p.id),
      is_admin: false,
    });
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
    const role = ctx.db.getModel('role');
    const permission = ctx.db.getModel('permission');
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 管理员角色拥有所有权限，不允许修改（通过 mark 字段判断）
    if (roleData.mark === 'admin') {
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

    ctx.success(null, '角色权限更新成功');
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
    const role = ctx.db.getModel('role');
    const expert = ctx.db.getModel('expert');
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 管理员角色可以访问所有专家（通过 mark 字段判断）
    if (roleData.mark === 'admin') {
      const allExperts = await expert.findAll({
        attributes: ['id', 'name'],
        where: { is_active: true },
      });
      ctx.success({
        expert_ids: allExperts.map(e => e.id),
        is_admin: true,
      });
      return;
    }

    const experts = await roleData.getExpert_id_experts_role_experts({
      attributes: ['id', 'name'],
    });

    ctx.success({
      expert_ids: experts.map(e => e.id),
      is_admin: false,
    });
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
    const role = ctx.db.getModel('role');
    const expert = ctx.db.getModel('expert');
    const roleData = await role.findByPk(id);
    if (!roleData) {
      ctx.error('角色不存在', 404);
      return;
    }

    // 管理员角色可以访问所有专家，不允许修改（通过 mark 字段判断）
    if (roleData.mark === 'admin') {
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
    await roleData.setExpert_id_experts_role_experts(expert_ids);

    ctx.success(null, '角色专家访问权限更新成功');
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
    const permission = ctx.db.getModel('permission');
    const permissions = await permission.findAll({
      attributes: ['id', 'code', 'name', 'type', 'parent_id', 'route_path', 'sort_order'],
      order: [['sort_order', 'ASC'], ['created_at', 'ASC']],
    });

    ctx.success(permissions);
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
    const expert = ctx.db.getModel('expert');
    const experts = await expert.findAll({
      attributes: ['id', 'name', 'introduction'],
      where: { is_active: true },
      order: [['name', 'ASC']],
    });

    ctx.success(experts);
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