/**
 * Permission Service - 通用权限校验服务
 */

import logger from './logger.js';

/**
 * 检查用户是否是系统管理员
 * @param {Object} db - 数据库实例
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>}
 */
export async function isSystemAdmin(db, userId) {
  try {
    const UserRole = db.getModel('user_role');
    const Role = db.getModel('role');
    
    const roles = await UserRole.findAll({
      where: { user_id: userId },
      include: [{
        model: Role,
        as: 'role',
        attributes: ['mark'],
      }],
      raw: true,
      nest: true,
    });
    
    return roles.some(r => r.role?.mark === 'admin');
  } catch (error) {
    logger.error('[Permission] isSystemAdmin error:', error);
    return false;
  }
}