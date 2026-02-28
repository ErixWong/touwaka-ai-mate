/**
 * SkillMeta - 技能元数据定义
 * 
 * 定义技能的风险等级、所需角色等元数据
 * 用于权限控制和技能过滤
 */

/**
 * 技能元数据定义
 * 
 * @property {boolean} builtin - 是否为内置技能
 * @property {string} risk_level - 风险等级: low/medium/high/critical
 * @property {string} required_role - 最低所需角色: user/power_user/admin
 * @property {string} description - 技能描述
 */
export const SKILL_META = {
  // ==================== 内置技能 ====================
  exec: {
    builtin: true,
    risk_level: 'high',
    required_role: 'user',
    description: '在沙箱中执行命令',
  },
  list_skills: {
    builtin: true,
    risk_level: 'low',
    required_role: 'user',
    description: '列出可用技能',
  },
  
  // ==================== 文件操作（内置） ====================
  read_lines: {
    builtin: true,
    risk_level: 'low',
    required_role: 'user',
    description: '读取文件内容',
  },
  read_bytes: {
    builtin: true,
    risk_level: 'low',
    required_role: 'user',
    description: '按字节读取文件',
  },
  write_file: {
    builtin: true,
    risk_level: 'medium',
    required_role: 'user',
    description: '写入文件',
  },
  list_files: {
    builtin: true,
    risk_level: 'low',
    required_role: 'user',
    description: '列出目录内容',
  },
  
  // ==================== 管理技能（普通技能） ====================
  'skill-edit': {
    builtin: false,
    risk_level: 'high',
    required_role: 'power_user',
    description: '编辑技能',
  },
  'skill-create': {
    builtin: false,
    risk_level: 'high',
    required_role: 'power_user',
    description: '创建新技能',
  },
  'skill-delete': {
    builtin: false,
    risk_level: 'critical',
    required_role: 'admin',
    description: '删除技能',
  },
  
  // ==================== 系统管理技能 ====================
  'database-access': {
    builtin: false,
    risk_level: 'critical',
    required_role: 'admin',
    description: '访问数据库',
  },
  'system-config': {
    builtin: false,
    risk_level: 'critical',
    required_role: 'admin',
    description: '系统配置管理',
  },
  'user-management': {
    builtin: false,
    risk_level: 'critical',
    required_role: 'admin',
    description: '用户管理',
  },
};

/**
 * 角色等级定义
 * 数值越大权限越高
 */
export const ROLE_LEVEL = {
  user: 1,
  power_user: 2,
  admin: 3,
};

/**
 * 风险等级权重
 * 数值越大风险越高
 */
export const RISK_LEVEL = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * 检查用户是否有权限访问指定技能
 * 
 * @param {string} role - 用户角色
 * @param {string} skillName - 技能名称
 * @returns {boolean} 是否有权限
 */
export function hasSkillAccess(role, skillName) {
  const skill = SKILL_META[skillName];
  
  // 未知技能默认拒绝
  if (!skill) {
    return false;
  }
  
  const userLevel = ROLE_LEVEL[role];
  const requiredLevel = ROLE_LEVEL[skill.required_role];
  
  return userLevel >= requiredLevel;
}

/**
 * 根据角色过滤可用技能列表
 * 
 * @param {string} role - 用户角色
 * @param {Array} skills - 技能列表
 * @returns {Array} 过滤后的技能列表
 */
export function filterSkillsByRole(role, skills) {
  return skills.filter(skill => {
    const skillName = skill.name || skill.id;
    return hasSkillAccess(role, skillName);
  });
}

/**
 * 获取角色可用的所有技能名称
 * 
 * @param {string} role - 用户角色
 * @returns {Array<string>} 技能名称列表
 */
export function getAvailableSkills(role) {
  return Object.entries(SKILL_META)
    .filter(([name, meta]) => hasSkillAccess(role, name))
    .map(([name, meta]) => ({
      name,
      ...meta,
    }));
}

/**
 * 获取技能元数据
 * 
 * @param {string} skillName - 技能名称
 * @returns {object|null} 技能元数据
 */
export function getSkillMeta(skillName) {
  return SKILL_META[skillName] || null;
}

/**
 * 检查技能是否为内置技能
 * 
 * @param {string} skillName - 技能名称
 * @returns {boolean}
 */
export function isBuiltinSkill(skillName) {
  const meta = SKILL_META[skillName];
  return meta?.builtin === true;
}

/**
 * 验证技能访问并返回错误信息
 * 
 * @param {string} role - 用户角色
 * @param {string} skillName - 技能名称
 * @returns {{allowed: boolean, error?: string}}
 */
export function validateSkillAccess(role, skillName) {
  const skill = SKILL_META[skillName];
  
  if (!skill) {
    return {
      allowed: false,
      error: `Unknown skill: ${skillName}`,
    };
  }
  
  if (!hasSkillAccess(role, skillName)) {
    return {
      allowed: false,
      error: `Skill "${skillName}" requires role "${skill.required_role}" or higher. Current role: "${role}"`,
    };
  }
  
  return { allowed: true };
}

export default {
  SKILL_META,
  ROLE_LEVEL,
  RISK_LEVEL,
  hasSkillAccess,
  filterSkillsByRole,
  getAvailableSkills,
  getSkillMeta,
  isBuiltinSkill,
  validateSkillAccess,
};