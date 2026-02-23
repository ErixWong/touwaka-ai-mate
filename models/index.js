/**
 * Sequelize Models - Auto-generated from database
 * 
 * This file is auto-generated. Do not edit manually.
 * To regenerate: node scripts/generate-models.js
 */

'use strict';

import { Sequelize } from 'sequelize';
import initModels from './init-models.js';

// 创建 Sequelize 实例
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' 
      ? (msg) => console.log('[SQL]', msg) 
      : false,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      freezeTableName: true,
    },
  }
);

// 初始化模型
const models = initModels(sequelize);

// ============ 定义关联关系 ============
// 注意：sequelize-auto 不会自动生成关联，需要手动添加

// Provider -> AIModel
if (models.Providers && models.AiModels) {
  models.Providers.hasMany(models.AiModels, { foreignKey: 'provider_id', as: 'models' });
  models.AiModels.belongsTo(models.Providers, { foreignKey: 'provider_id', as: 'provider' });
}

// AIModel -> Expert (expressive)
if (models.AiModels && models.Experts) {
  models.AiModels.hasMany(models.Experts, { foreignKey: 'expressive_model_id', as: 'expressive_experts' });
  models.Experts.belongsTo(models.AiModels, { foreignKey: 'expressive_model_id', as: 'expressive_model' });
  
  models.AiModels.hasMany(models.Experts, { foreignKey: 'reflective_model_id', as: 'reflective_experts' });
  models.Experts.belongsTo(models.AiModels, { foreignKey: 'reflective_model_id', as: 'reflective_model' });
}

// Expert <-> Skill (through ExpertSkill)
if (models.Experts && models.Skills && models.ExpertSkills) {
  models.Experts.belongsToMany(models.Skills, { through: models.ExpertSkills, foreignKey: 'expert_id', otherKey: 'skill_id', as: 'skills' });
  models.Skills.belongsToMany(models.Experts, { through: models.ExpertSkills, foreignKey: 'skill_id', otherKey: 'expert_id', as: 'experts' });
}

// User -> UserProfile
if (models.Users && models.UserProfiles) {
  models.Users.hasMany(models.UserProfiles, { foreignKey: 'user_id', as: 'profiles' });
  models.UserProfiles.belongsTo(models.Users, { foreignKey: 'user_id', as: 'user' });
}

// Expert -> UserProfile
if (models.Experts && models.UserProfiles) {
  models.Experts.hasMany(models.UserProfiles, { foreignKey: 'expert_id', as: 'profiles' });
  models.UserProfiles.belongsTo(models.Experts, { foreignKey: 'expert_id', as: 'expert' });
}

// User -> Topic
if (models.Users && models.Topics) {
  models.Users.hasMany(models.Topics, { foreignKey: 'user_id', as: 'topics' });
  models.Topics.belongsTo(models.Users, { foreignKey: 'user_id', as: 'user' });
}

// Expert -> Topic
if (models.Experts && models.Topics) {
  models.Experts.hasMany(models.Topics, { foreignKey: 'expert_id', as: 'topics' });
  models.Topics.belongsTo(models.Experts, { foreignKey: 'expert_id', as: 'expert' });
}

// Topic -> Message
if (models.Topics && models.Messages) {
  models.Topics.hasMany(models.Messages, { foreignKey: 'topic_id', as: 'messages' });
  models.Messages.belongsTo(models.Topics, { foreignKey: 'topic_id', as: 'topic' });
}

// User -> Message
if (models.Users && models.Messages) {
  models.Users.hasMany(models.Messages, { foreignKey: 'user_id', as: 'messages' });
  models.Messages.belongsTo(models.Users, { foreignKey: 'user_id', as: 'user' });
}

// Expert -> Message
if (models.Experts && models.Messages) {
  models.Experts.hasMany(models.Messages, { foreignKey: 'expert_id', as: 'messages' });
  models.Messages.belongsTo(models.Experts, { foreignKey: 'expert_id', as: 'expert' });
}

// User <-> Role (through UserRole)
if (models.Users && models.Roles && models.UserRoles) {
  models.Users.belongsToMany(models.Roles, { through: models.UserRoles, foreignKey: 'user_id', otherKey: 'role_id', as: 'roles' });
  models.Roles.belongsToMany(models.Users, { through: models.UserRoles, foreignKey: 'role_id', otherKey: 'user_id', as: 'users' });
}

// Role <-> Permission (through RolePermission)
if (models.Roles && models.Permissions && models.RolePermissions) {
  models.Roles.belongsToMany(models.Permissions, { through: models.RolePermissions, foreignKey: 'role_id', otherKey: 'permission_id', as: 'permissions' });
  models.Permissions.belongsToMany(models.Roles, { through: models.RolePermissions, foreignKey: 'permission_id', otherKey: 'role_id', as: 'roles' });
}

// Permission self-reference
if (models.Permissions) {
  models.Permissions.hasMany(models.Permissions, { foreignKey: 'parent_id', as: 'children' });
  models.Permissions.belongsTo(models.Permissions, { foreignKey: 'parent_id', as: 'parent' });
}

// Skill -> SkillParameter
if (models.Skills && models.SkillParameters) {
  models.Skills.hasMany(models.SkillParameters, { foreignKey: 'skill_id', as: 'parameters' });
  models.SkillParameters.belongsTo(models.Skills, { foreignKey: 'skill_id', as: 'skill' });
}

/**
 * 初始化数据库连接
 */
async function initDatabase() {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established');
    return models;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
}

export {
  models,
  sequelize,
  Sequelize,
  initDatabase,
};

export default {
  ...models,
  sequelize,
  Sequelize,
  initDatabase,
};
