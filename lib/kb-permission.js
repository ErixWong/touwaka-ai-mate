/**
 * KB Permission Service - 知识库权限校验服务
 * 
 * 实现三级可见性权限控制：
 * - owner: 仅知识库管理员可见
 * - department: 知识库管理员所在部门可见
 * - all: 全员可见
 * 
 * 核心字段：
 * - creator_id: 创建者，用于私人知识库数量限制
 * - owner_id: 知识库管理员，拥有管理权限
 * - visibility: 公开级别
 */

import logger from './logger.js';
import { Op } from 'sequelize';

/**
 * 检查用户是否是系统管理员
 * @param {Object} db - 数据库实例
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
async function isSystemAdmin(db, userId) {
  try {
    const UserRole = db.getModel('user_role');
    const Role = db.getModel('role');
    
    const roles = await UserRole.findAll({
      where: { user_id: userId },
      include: [{
        model: Role,
        as: 'role',
        attributes: ['level'],
      }],
      raw: true,
      nest: true,
    });
    
    return roles.some(r => r.role?.level === 'admin');
  } catch (error) {
    logger.error('[KB-Permission] isSystemAdmin error:', error);
    return false;
  }
}

/**
 * 检查用户是否是部门负责人
 * @param {Object} db - 数据库实例
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
async function isDepartmentManager(db, userId) {
  try {
    const User = db.getModel('user');
    const Position = db.getModel('position');
    
    const user = await User.findOne({
      where: { id: userId },
      include: [{
        model: Position,
        as: 'position',
        attributes: ['is_manager'],
      }],
      raw: true,
      nest: true,
    });
    
    return user?.position?.is_manager === true;
  } catch (error) {
    logger.error('[KB-Permission] isDepartmentManager error:', error);
    return false;
  }
}

/**
 * 获取用户的部门ID
 * @param {Object} db - 数据库实例
 * @param {string} userId - 用户ID
 * @returns {Promise<string|null>}
 */
async function getUserDepartmentId(db, userId) {
  try {
    const User = db.getModel('user');
    const user = await User.findOne({
      where: { id: userId },
      attributes: ['department_id'],
      raw: true,
    });
    
    return user?.department_id || null;
  } catch (error) {
    logger.error('[KB-Permission] getUserDepartmentId error:', error);
    return null;
  }
}

/**
 * 获取知识库管理员所在部门ID
 * @param {Object} db - 数据库实例
 * @param {string} ownerId - 知识库管理员ID
 * @returns {Promise<string|null>}
 */
async function getOwnerDepartmentId(db, ownerId) {
  return getUserDepartmentId(db, ownerId);
}

/**
 * 校验创建知识库权限
 * @param {Object} db - 数据库实例
 * @param {Object} params - 创建参数
 * @param {Object} user - 当前用户
 * @returns {Promise<Object>} - { valid: boolean, owner_id, creator_id, visibility, error? }
 */
async function validateKbCreation(db, params, user) {
  try {
    const { owner_id, visibility } = params;
    const userId = user.id;
    
    // 1. 检查是否是 admin 角色
    const isAdmin = await isSystemAdmin(db, userId);
    
    // admin 角色可以创建任意知识库，数量不限
    if (isAdmin) {
      return {
        valid: true,
        owner_id: owner_id || userId,  // 可指定任意用户
        creator_id: userId,
        visibility: visibility || 'owner',
      };
    }
    
    // 2. 检查是否是部门负责人
    const isManager = await isDepartmentManager(db, userId);
    
    // 部门负责人创建部门知识库（不受私人知识库数量限制）
    if (isManager) {
      const finalOwnerId = owner_id || userId;
      
      // 如果指定了 owner_id，必须是同部门成员
      if (owner_id && owner_id !== userId) {
        const ownerDeptId = await getUserDepartmentId(db, owner_id);
        const userDeptId = await getUserDepartmentId(db, userId);
        
        if (ownerDeptId !== userDeptId) {
          return { valid: false, error: '知识库管理员必须是同部门成员' };
        }
      }
      
      return {
        valid: true,
        owner_id: finalOwnerId,
        creator_id: userId,
        visibility: visibility || 'department',
      };
    }
    
    // 3. 普通用户创建私人知识库
    // 检查是否已有私人知识库（owner_id = creator_id = user_id）
    const KnowledgeBase = db.getModel('knowledge_basis');
    
    const existing = await KnowledgeBase.count({
      where: { creator_id: userId, owner_id: userId },
    });
    
    if (existing > 0) {
      return { valid: false, error: '每个用户只能创建1个私人知识库' };
    }
    
    // owner_id 必须是创建者自己
    if (owner_id && owner_id !== userId) {
      return { valid: false, error: '私人知识库的 owner 必须是创建者自己' };
    }
    
    return {
      valid: true,
      owner_id: userId,
      creator_id: userId,
      visibility: 'owner',  // 私人知识库默认仅自己可见
    };
  } catch (error) {
    logger.error('[KB-Permission] validateKbCreation error:', error);
    return { valid: false, error: '权限校验失败' };
  }
}

/**
 * 构建用户可访问的知识库查询条件
 * @param {Object} db - 数据库实例
 * @param {string} userId - 用户ID
 * @returns {Promise<Object>} - Sequelize where 条件
 */
async function buildAccessibleKbWhere(db, userId) {
  try {
    // 1. 检查是否是 admin 角色
    const isAdmin = await isSystemAdmin(db, userId);
    
    // admin 可以访问所有知识库
    if (isAdmin) {
      return {};  // 无过滤条件
    }
    
    // 2. 构建普通用户的访问条件
    const conditions = [];
    
    // 条件1: owner（自己是知识库管理员）
    conditions.push({ owner_id: userId });
    
    // 条件2: department 可见且同部门
    const userDeptId = await getUserDepartmentId(db, userId);
    if (userDeptId) {
      // 子查询：获取 owner 所在部门
      const User = db.getModel('user');
      const ownerDeptUsers = await User.findAll({
        where: { department_id: userDeptId },
        attributes: ['id'],
        raw: true,
      });
      const ownerIds = ownerDeptUsers.map(u => u.id);
      
      if (ownerIds.length > 0) {
        conditions.push({
          visibility: 'department',
          owner_id: { [Op.in]: ownerIds },
        });
      }
    }
    
    // 条件3: all 可见
    conditions.push({ visibility: 'all' });
    
    // 组合条件（OR）
    return { [Op.or]: conditions };
  } catch (error) {
    logger.error('[KB-Permission] buildAccessibleKbWhere error:', error);
    // 出错时只返回自己作为 owner 的知识库
    return { owner_id: userId };
  }
}

/**
 * 检查用户是否有访问知识库的权限
 * @param {Object} db - 数据库实例
 * @param {string} kbId - 知识库ID
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
async function canAccessKb(db, kbId, userId) {
  try {
    const KnowledgeBase = db.getModel('knowledge_basis');
    const kb = await KnowledgeBase.findByPk(kbId);
    
    if (!kb) {
      return false;
    }
    
    // admin 可以访问所有知识库
    const isAdmin = await isSystemAdmin(db, userId);
    if (isAdmin) {
      return true;
    }
    
    // owner 可以访问
    if (kb.owner_id === userId) {
      return true;
    }
    
    // visibility = 'all' 时全员可访问
    if (kb.visibility === 'all') {
      return true;
    }
    
    // visibility = 'department' 时同部门可访问
    if (kb.visibility === 'department') {
      const userDeptId = await getUserDepartmentId(db, userId);
      const ownerDeptId = await getOwnerDepartmentId(db, kb.owner_id);
      
      return userDeptId && ownerDeptId && userDeptId === ownerDeptId;
    }
    
    return false;
  } catch (error) {
    logger.error('[KB-Permission] canAccessKb error:', error);
    return false;
  }
}

/**
 * 检查用户是否有编辑知识库的权限
 * @param {Object} db - 数据库实例
 * @param {string} kbId - 知识库ID
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
async function canEditKb(db, kbId, userId) {
  try {
    const KnowledgeBase = db.getModel('knowledge_basis');
    const kb = await KnowledgeBase.findByPk(kbId);
    
    if (!kb) {
      return false;
    }
    
    // admin 可以编辑所有知识库
    const isAdmin = await isSystemAdmin(db, userId);
    if (isAdmin) {
      return true;
    }
    
    // 只有 owner 可以编辑
    return kb.owner_id === userId;
  } catch (error) {
    logger.error('[KB-Permission] canEditKb error:', error);
    return false;
  }
}

/**
 * 检查用户是否有删除知识库的权限
 * @param {Object} db - 数据库实例
 * @param {string} kbId - 知识库ID
 * @param {string} userId - 用户ID
 * @returns {Promise<Object>} - { canDelete: boolean, reason?: string }
 */
async function canDeleteKb(db, kbId, userId) {
  try {
    const KnowledgeBase = db.getModel('knowledge_basis');
    const KbArticle = db.getModel('kb_article');
    
    const kb = await KnowledgeBase.findByPk(kbId);
    if (!kb) {
      return { canDelete: false, reason: '知识库不存在' };
    }
    
    // admin 可以删除任何知识库
    const isAdmin = await isSystemAdmin(db, userId);
    if (isAdmin) {
      return { canDelete: true };
    }
    
    // 非 admin，检查是否是 owner
    if (kb.owner_id !== userId) {
      return { canDelete: false, reason: '只有知识库管理员可以删除' };
    }
    
    // owner 只能删除空知识库
    const articleCount = await KbArticle.count({
      where: { kb_id: kbId },
    });
    
    if (articleCount > 0) {
      return {
        canDelete: false,
        reason: '知识库非空，需要管理员删除',
      };
    }
    
    return { canDelete: true };
  } catch (error) {
    logger.error('[KB-Permission] canDeleteKb error:', error);
    return { canDelete: false, reason: '权限校验失败' };
  }
}

/**
 * 检查用户是否有转移 owner 的权限
 * @param {Object} db - 数据库实例
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
async function canTransferOwner(db, userId) {
  // 只有系统 admin 可以转移 owner
  return isSystemAdmin(db, userId);
}

/**
 * 获取知识库权限信息（用于 API 返回）
 * @param {Object} db - 数据库实例
 * @param {Object} kb - 知识库对象
 * @param {string} userId - 用户ID
 * @returns {Promise<Object>} - { is_owner, is_creator, can_edit, can_delete, article_count }
 */
async function getKbPermissionInfo(db, kb, userId) {
  try {
    const KbArticle = db.getModel('kb_article');
    
    const isAdmin = await isSystemAdmin(db, userId);
    const isOwner = kb.owner_id === userId;
    const isCreator = kb.creator_id === userId;
    
    // 计算文章数量
    const articleCount = await KbArticle.count({
      where: { kb_id: kb.id },
    });
    
    // 编辑权限：owner 或 admin
    const canEdit = isOwner || isAdmin;
    
    // 删除权限：
    // - admin 可以删除任何知识库
    // - owner 只能删除空知识库
    const canDelete = isAdmin || (isOwner && articleCount === 0);
    
    return {
      is_owner: isOwner,
      is_creator: isCreator,
      can_edit: canEdit,
      can_delete: canDelete,
      article_count: articleCount,
    };
  } catch (error) {
    logger.error('[KB-Permission] getKbPermissionInfo error:', error);
    return {
      is_owner: false,
      is_creator: false,
      can_edit: false,
      can_delete: false,
      article_count: 0,
    };
  }
}

export {
  isSystemAdmin,
  isDepartmentManager,
  getUserDepartmentId,
  getOwnerDepartmentId,
  validateKbCreation,
  buildAccessibleKbWhere,
  canAccessKb,
  canEditKb,
  canDeleteKb,
  canTransferOwner,
  getKbPermissionInfo,
};