import _sequelize from "sequelize";
const DataTypes = _sequelize.DataTypes;
import _ai_model from  "./ai_model.js";
import _expert_skill from  "./expert_skill.js";
import _expert from  "./expert.js";
import _message from  "./message.js";
import _permission from  "./permission.js";
import _provider from  "./provider.js";
import _role_permission from  "./role_permission.js";
import _role from  "./role.js";
import _skill_tool from  "./skill_tool.js";
import _skill from  "./skill.js";
import _topic from  "./topic.js";
import _user_profile from  "./user_profile.js";
import _user_role from  "./user_role.js";
import _user from  "./user.js";

export default function initModels(sequelize) {
  const ai_model = _ai_model.init(sequelize, DataTypes);
  const expert_skill = _expert_skill.init(sequelize, DataTypes);
  const expert = _expert.init(sequelize, DataTypes);
  const message = _message.init(sequelize, DataTypes);
  const permission = _permission.init(sequelize, DataTypes);
  const provider = _provider.init(sequelize, DataTypes);
  const role_permission = _role_permission.init(sequelize, DataTypes);
  const role = _role.init(sequelize, DataTypes);
  const skill_tool = _skill_tool.init(sequelize, DataTypes);
  const skill = _skill.init(sequelize, DataTypes);
  const topic = _topic.init(sequelize, DataTypes);
  const user_profile = _user_profile.init(sequelize, DataTypes);
  const user_role = _user_role.init(sequelize, DataTypes);
  const user = _user.init(sequelize, DataTypes);

  permission.belongsToMany(role, { as: 'role_id_roles', through: role_permission, foreignKey: "permission_id", otherKey: "role_id" });
  role.belongsToMany(permission, { as: 'permission_id_permissions', through: role_permission, foreignKey: "role_id", otherKey: "permission_id" });
  role.belongsToMany(user, { as: 'user_id_users', through: user_role, foreignKey: "role_id", otherKey: "user_id" });
  user.belongsToMany(role, { as: 'role_id_roles_user_roles', through: user_role, foreignKey: "user_id", otherKey: "role_id" });
  expert.belongsTo(ai_model, { as: "expressive_model", foreignKey: "expressive_model_id"});
  ai_model.hasMany(expert, { as: "experts", foreignKey: "expressive_model_id"});
  expert.belongsTo(ai_model, { as: "reflective_model", foreignKey: "reflective_model_id"});
  ai_model.hasMany(expert, { as: "reflective_model_experts", foreignKey: "reflective_model_id"});
  expert_skill.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(expert_skill, { as: "expert_skills", foreignKey: "expert_id"});
  message.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(message, { as: "messages", foreignKey: "expert_id"});
  topic.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(topic, { as: "topics", foreignKey: "expert_id"});
  user_profile.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(user_profile, { as: "user_profiles", foreignKey: "expert_id"});
  permission.belongsTo(permission, { as: "parent", foreignKey: "parent_id"});
  permission.hasMany(permission, { as: "permissions", foreignKey: "parent_id"});
  role_permission.belongsTo(permission, { as: "permission", foreignKey: "permission_id"});
  permission.hasMany(role_permission, { as: "role_permissions", foreignKey: "permission_id"});
  ai_model.belongsTo(provider, { as: "provider", foreignKey: "provider_id"});
  provider.hasMany(ai_model, { as: "ai_models", foreignKey: "provider_id"});
  role_permission.belongsTo(role, { as: "role", foreignKey: "role_id"});
  role.hasMany(role_permission, { as: "role_permissions", foreignKey: "role_id"});
  user_role.belongsTo(role, { as: "role", foreignKey: "role_id"});
  role.hasMany(user_role, { as: "user_roles", foreignKey: "role_id"});
  expert_skill.belongsTo(skill, { as: "skill", foreignKey: "skill_id"});
  skill.hasMany(expert_skill, { as: "expert_skills", foreignKey: "skill_id"});
  skill_tool.belongsTo(skill, { as: "skill", foreignKey: "skill_id"});
  skill.hasMany(skill_tool, { as: "skill_tools", foreignKey: "skill_id"});
  message.belongsTo(topic, { as: "topic", foreignKey: "topic_id"});
  topic.hasMany(message, { as: "messages", foreignKey: "topic_id"});
  message.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(message, { as: "messages", foreignKey: "user_id"});
  topic.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(topic, { as: "topics", foreignKey: "user_id"});
  user_profile.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(user_profile, { as: "user_profiles", foreignKey: "user_id"});
  user_role.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(user_role, { as: "user_roles", foreignKey: "user_id"});

  return {
    ai_model,
    expert_skill,
    expert,
    message,
    permission,
    provider,
    role_permission,
    role,
    skill_tool,
    skill,
    topic,
    user_profile,
    user_role,
    user,
  };
}
