/**
 * Permission Service - 权限服务
 *
 * 提供统一的专家访问权限校验方法
 */

import logger from '../../lib/logger.js';
import { Op } from 'sequelize';

let permissionServiceInstance = null;

class PermissionService {
  constructor(db) {
    this.db = db;
    this.User = db.getModel('user');
    this.Role = db.getModel('role');
    this.UserRole = db.getModel('user_role');
    this.RoleExpert = db.getModel('role_expert');
    this.Expert = db.getModel('expert');
  }

  /**
   * 检查用户是否为管理员
   * @param {string} userId - 用户ID
   * @returns {Promise<boolean>}
   */
  async isAdmin(userId) {
    try {
      const roles = await this.getUserRoles(userId);
      return roles.includes('admin');
    } catch (error) {
      logger.error('[PermissionService] isAdmin error:', error.message);
      return false;
    }
  }

  /**
   * 获取用户的所有角色标识
   * @param {string} userId - 用户ID
   * @returns {Promise<string[]>}
   */
  async getUserRoles(userId) {
    try {
      const userRoles = await this.UserRole.findAll({
        where: { user_id: userId },
        include: [{
          model: this.Role,
          as: 'role',
          attributes: ['mark'],
        }],
        raw: true,
        nest: true,
      });
      return userRoles.map(r => r.role?.mark).filter(Boolean);
    } catch (error) {
      logger.error('[PermissionService] getUserRoles error:', error.message);
      return [];
    }
  }

  /**
   * 获取用户可访问的专家ID列表
   * - 管理员可访问所有激活专家
   * - 普通用户只能访问其角色绑定的专家
   * @param {string} userId - 用户ID
   * @returns {Promise<string[]>}
   */
  async getAccessibleExpertIds(userId) {
    try {
      const isAdmin = await this.isAdmin(userId);
      
      if (isAdmin) {
        const experts = await this.Expert.findAll({
          where: { is_active: true },
          attributes: ['id'],
          raw: true,
        });
        return experts.map(e => e.id);
      }

      const userRoles = await this.UserRole.findAll({
        where: { user_id: userId },
        attributes: ['role_id'],
        raw: true,
      });
      const roleIds = userRoles.map(r => r.role_id).filter(Boolean);

      if (roleIds.length === 0) {
        return [];
      }

      const roleExperts = await this.RoleExpert.findAll({
        where: { role_id: { [Op.in]: roleIds } },
        attributes: ['expert_id'],
        raw: true,
      });
      const expertIds = [...new Set(roleExperts.map(r => r.expert_id).filter(Boolean))];

      const activeExperts = await this.Expert.findAll({
        where: { id: { [Op.in]: expertIds }, is_active: true },
        attributes: ['id'],
        raw: true,
      });

      return activeExperts.map(e => e.id);
    } catch (error) {
      logger.error('[PermissionService] getAccessibleExpertIds error:', error.message);
      return [];
    }
  }

  /**
   * 检查用户是否可以访问指定专家
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @returns {Promise<boolean>}
   */
  async canAccessExpert(userId, expertId) {
    try {
      const accessibleIds = await this.getAccessibleExpertIds(userId);
      return accessibleIds.includes(expertId);
    } catch (error) {
      logger.error('[PermissionService] canAccessExpert error:', error.message);
      return false;
    }
  }

  /**
   * 获取用户可访问的专家列表（安全版本，仅返回必要字段）
   * @param {string} userId - 用户ID
   * @returns {Promise<object[]>}
   */
  async getAccessibleExperts(userId) {
    try {
      const isAdmin = await this.isAdmin(userId);
      
      const where = { is_active: true };
      
      if (!isAdmin) {
        const expertIds = await this.getAccessibleExpertIds(userId);
        if (expertIds.length === 0) {
          return [];
        }
        where.id = { [Op.in]: expertIds };
      }

      const experts = await this.Expert.findAll({
        where,
        attributes: [
          'id',
          'name',
          'introduction',
          'is_active',
          'avatar_base64',
          'avatar_large_base64',
        ],
        order: [['created_at', 'DESC']],
        raw: true,
      });

      return experts.map(e => ({
        ...e,
        is_active: !!e.is_active,
      }));
    } catch (error) {
      logger.error('[PermissionService] getAccessibleExperts error:', error.message);
      return [];
    }
  }
}

/**
 * 获取权限服务实例（单例）
 * @param {object} db - 数据库实例
 * @returns {PermissionService}
 */
export function getPermissionService(db) {
  if (!permissionServiceInstance) {
    permissionServiceInstance = new PermissionService(db);
  }
  return permissionServiceInstance;
}

export default PermissionService;