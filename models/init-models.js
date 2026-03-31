import _sequelize from "sequelize";
const DataTypes = _sequelize.DataTypes;
import _ai_model from  "./ai_model.js";
import _assistant_message from  "./assistant_message.js";
import _assistant_request from  "./assistant_request.js";
import _assistant from  "./assistant.js";
import _department from  "./department.js";
import _expert_skill from  "./expert_skill.js";
import _expert from  "./expert.js";
import _invitation_usage from  "./invitation_usage.js";
import _invitation from  "./invitation.js";
import _kb_article_tag from  "./kb_article_tag.js";
import _kb_article from  "./kb_article.js";
import _kb_paragraph from  "./kb_paragraph.js";
import _kb_section from  "./kb_section.js";
import _kb_tag from  "./kb_tag.js";
import _knowledge_basis from  "./knowledge_basis.js";
import _message from  "./message.js";
import _permission from  "./permission.js";
import _position from  "./position.js";
import _provider from  "./provider.js";
import _role_expert from  "./role_expert.js";
import _role_permission from  "./role_permission.js";
import _role from  "./role.js";
import _skill_parameter from  "./skill_parameter.js";
import _skill_tool from  "./skill_tool.js";
import _skill from  "./skill.js";
import _solution from  "./solution.js";
import _system_setting from  "./system_setting.js";
import _task_token from  "./task_token.js";
import _task_token_access_log from  "./task_token_access_log.js";
import _task from  "./task.js";
import _topic from  "./topic.js";
import _user_profile from  "./user_profile.js";
import _user_role from  "./user_role.js";
import _user_skill_parameter from  "./user_skill_parameter.js";
import _user from  "./user.js";

export default function initModels(sequelize) {
  const ai_model = _ai_model.init(sequelize, DataTypes);
  const assistant_message = _assistant_message.init(sequelize, DataTypes);
  const assistant_request = _assistant_request.init(sequelize, DataTypes);
  const assistant = _assistant.init(sequelize, DataTypes);
  const department = _department.init(sequelize, DataTypes);
  const expert_skill = _expert_skill.init(sequelize, DataTypes);
  const expert = _expert.init(sequelize, DataTypes);
  const invitation_usage = _invitation_usage.init(sequelize, DataTypes);
  const invitation = _invitation.init(sequelize, DataTypes);
  const kb_article_tag = _kb_article_tag.init(sequelize, DataTypes);
  const kb_article = _kb_article.init(sequelize, DataTypes);
  const kb_paragraph = _kb_paragraph.init(sequelize, DataTypes);
  const kb_section = _kb_section.init(sequelize, DataTypes);
  const kb_tag = _kb_tag.init(sequelize, DataTypes);
  const knowledge_basis = _knowledge_basis.init(sequelize, DataTypes);
  const message = _message.init(sequelize, DataTypes);
  const permission = _permission.init(sequelize, DataTypes);
  const position = _position.init(sequelize, DataTypes);
  const provider = _provider.init(sequelize, DataTypes);
  const role_expert = _role_expert.init(sequelize, DataTypes);
  const role_permission = _role_permission.init(sequelize, DataTypes);
  const role = _role.init(sequelize, DataTypes);
  const skill_parameter = _skill_parameter.init(sequelize, DataTypes);
  const skill_tool = _skill_tool.init(sequelize, DataTypes);
  const skill = _skill.init(sequelize, DataTypes);
  const solution = _solution.init(sequelize, DataTypes);
  const system_setting = _system_setting.init(sequelize, DataTypes);
  const task_token = _task_token.init(sequelize, DataTypes);
  const task_token_access_log = _task_token_access_log.init(sequelize, DataTypes);
  const task = _task.init(sequelize, DataTypes);
  const topic = _topic.init(sequelize, DataTypes);
  const user_profile = _user_profile.init(sequelize, DataTypes);
  const user_role = _user_role.init(sequelize, DataTypes);
  const user_skill_parameter = _user_skill_parameter.init(sequelize, DataTypes);
  const user = _user.init(sequelize, DataTypes);

  expert.belongsToMany(role, { as: 'role_id_roles', through: role_expert, foreignKey: "expert_id", otherKey: "role_id" });
  expert.belongsToMany(skill, { as: 'skill_id_skills', through: expert_skill, foreignKey: "expert_id", otherKey: "skill_id" });
  kb_article.belongsToMany(kb_tag, { as: 'tag_id_kb_tags', through: kb_article_tag, foreignKey: "article_id", otherKey: "tag_id" });
  kb_tag.belongsToMany(kb_article, { as: 'article_id_kb_articles', through: kb_article_tag, foreignKey: "tag_id", otherKey: "article_id" });
  permission.belongsToMany(role, { as: 'role_id_roles_role_permissions', through: role_permission, foreignKey: "permission_id", otherKey: "role_id" });
  role.belongsToMany(expert, { as: 'expert_id_experts_role_experts', through: role_expert, foreignKey: "role_id", otherKey: "expert_id" });
  role.belongsToMany(permission, { as: 'permission_id_permissions', through: role_permission, foreignKey: "role_id", otherKey: "permission_id" });
  role.belongsToMany(user, { as: 'user_id_users', through: user_role, foreignKey: "role_id", otherKey: "user_id" });
  skill.belongsToMany(expert, { as: 'expert_id_experts', through: expert_skill, foreignKey: "skill_id", otherKey: "expert_id" });
  user.belongsToMany(role, { as: 'role_id_roles_user_roles', through: user_role, foreignKey: "user_id", otherKey: "role_id" });
  expert.belongsTo(ai_model, { as: "expressive_model", foreignKey: "expressive_model_id"});
  ai_model.hasMany(expert, { as: "experts", foreignKey: "expressive_model_id"});
  expert.belongsTo(ai_model, { as: "reflective_model", foreignKey: "reflective_model_id"});
  ai_model.hasMany(expert, { as: "reflective_model_experts", foreignKey: "reflective_model_id"});
  knowledge_basis.belongsTo(ai_model, { as: "embedding_model", foreignKey: "embedding_model_id"});
  ai_model.hasMany(knowledge_basis, { as: "knowledge_bases", foreignKey: "embedding_model_id"});
  position.belongsTo(department, { as: "department", foreignKey: "department_id"});
  department.hasMany(position, { as: "positions", foreignKey: "department_id"});
  expert_skill.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(expert_skill, { as: "expert_skills", foreignKey: "expert_id"});
  message.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(message, { as: "messages", foreignKey: "expert_id"});
  role_expert.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(role_expert, { as: "role_experts", foreignKey: "expert_id"});
  task.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(task, { as: "tasks", foreignKey: "expert_id"});
  topic.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(topic, { as: "topics", foreignKey: "expert_id"});
  user_profile.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(user_profile, { as: "user_profiles", foreignKey: "expert_id"});
  invitation_usage.belongsTo(invitation, { as: "invitation", foreignKey: "invitation_id"});
  invitation.hasMany(invitation_usage, { as: "invitation_usages", foreignKey: "invitation_id"});
  kb_article_tag.belongsTo(kb_article, { as: "article", foreignKey: "article_id"});
  kb_article.hasMany(kb_article_tag, { as: "kb_article_tags", foreignKey: "article_id"});
  kb_section.belongsTo(kb_article, { as: "article", foreignKey: "article_id"});
  kb_article.hasMany(kb_section, { as: "kb_sections", foreignKey: "article_id"});
  kb_paragraph.belongsTo(kb_section, { as: "section", foreignKey: "section_id"});
  kb_section.hasMany(kb_paragraph, { as: "kb_paragraphs", foreignKey: "section_id"});
  kb_section.belongsTo(kb_section, { as: "parent", foreignKey: "parent_id"});
  kb_section.hasMany(kb_section, { as: "kb_sections", foreignKey: "parent_id"});
  kb_article_tag.belongsTo(kb_tag, { as: "tag", foreignKey: "tag_id"});
  kb_tag.hasMany(kb_article_tag, { as: "kb_article_tags", foreignKey: "tag_id"});
  kb_article.belongsTo(knowledge_basis, { as: "kb", foreignKey: "kb_id"});
  knowledge_basis.hasMany(kb_article, { as: "kb_articles", foreignKey: "kb_id"});
  kb_tag.belongsTo(knowledge_basis, { as: "kb", foreignKey: "kb_id"});
  knowledge_basis.hasMany(kb_tag, { as: "kb_tags", foreignKey: "kb_id"});
  permission.belongsTo(permission, { as: "parent", foreignKey: "parent_id"});
  permission.hasMany(permission, { as: "permissions", foreignKey: "parent_id"});
  role_permission.belongsTo(permission, { as: "permission", foreignKey: "permission_id"});
  permission.hasMany(role_permission, { as: "role_permissions", foreignKey: "permission_id"});
  user.belongsTo(position, { as: "position", foreignKey: "position_id"});
  position.hasMany(user, { as: "users", foreignKey: "position_id"});
  ai_model.belongsTo(provider, { as: "provider", foreignKey: "provider_id"});
  provider.hasMany(ai_model, { as: "ai_models", foreignKey: "provider_id"});
  role_expert.belongsTo(role, { as: "role", foreignKey: "role_id"});
  role.hasMany(role_expert, { as: "role_experts", foreignKey: "role_id"});
  role_permission.belongsTo(role, { as: "role", foreignKey: "role_id"});
  role.hasMany(role_permission, { as: "role_permissions", foreignKey: "role_id"});
  user_role.belongsTo(role, { as: "role", foreignKey: "role_id"});
  role.hasMany(user_role, { as: "user_roles", foreignKey: "role_id"});
  expert_skill.belongsTo(skill, { as: "skill", foreignKey: "skill_id"});
  skill.hasMany(expert_skill, { as: "expert_skills", foreignKey: "skill_id"});
  skill_parameter.belongsTo(skill, { as: "skill", foreignKey: "skill_id"});
  skill.hasMany(skill_parameter, { as: "skill_parameters", foreignKey: "skill_id"});
  user_skill_parameter.belongsTo(skill, { as: "skill", foreignKey: "skill_id"});
  skill.hasMany(user_skill_parameter, { as: "user_skill_parameters", foreignKey: "skill_id"});
  task.belongsTo(solution, { as: "solution", foreignKey: "solution_id"});
  solution.hasMany(task, { as: "tasks", foreignKey: "solution_id"});
  topic.belongsTo(task, { as: "task_task", foreignKey: "task_id"});
  task.hasMany(topic, { as: "task_topics", foreignKey: "task_id"});
  message.belongsTo(topic, { as: "topic", foreignKey: "topic_id"});
  topic.hasMany(message, { as: "messages", foreignKey: "topic_id"});
  task.belongsTo(topic, { as: "topic", foreignKey: "topic_id"});
  topic.hasMany(task, { as: "tasks", foreignKey: "topic_id"});
  invitation_usage.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(invitation_usage, { as: "invitation_usages", foreignKey: "user_id"});
  invitation.belongsTo(user, { as: "creator", foreignKey: "creator_id"});
  user.hasMany(invitation, { as: "invitations", foreignKey: "creator_id"});
  knowledge_basis.belongsTo(user, { as: "owner", foreignKey: "owner_id"});
  user.hasMany(knowledge_basis, { as: "knowledge_bases", foreignKey: "owner_id"});
  knowledge_basis.belongsTo(user, { as: "creator", foreignKey: "creator_id"});
  user.hasMany(knowledge_basis, { as: "creator_knowledge_bases", foreignKey: "creator_id"});
  message.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(message, { as: "messages", foreignKey: "user_id"});
  task.belongsTo(user, { as: "created_by_user", foreignKey: "created_by"});
  user.hasMany(task, { as: "tasks", foreignKey: "created_by"});
  topic.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(topic, { as: "topics", foreignKey: "user_id"});
  user_profile.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(user_profile, { as: "user_profiles", foreignKey: "user_id"});
  user_role.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(user_role, { as: "user_roles", foreignKey: "user_id"});
  user_skill_parameter.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(user_skill_parameter, { as: "user_skill_parameters", foreignKey: "user_id"});

  return {
    ai_model,
    assistant_message,
    assistant_request,
    assistant,
    department,
    expert_skill,
    expert,
    invitation_usage,
    invitation,
    kb_article_tag,
    kb_article,
    kb_paragraph,
    kb_section,
    kb_tag,
    knowledge_basis,
    message,
    permission,
    position,
    provider,
    role_expert,
    role_permission,
    role,
    skill_parameter,
    skill_tool,
    skill,
    solution,
    system_setting,
    task_token,
    task_token_access_log,
    task,
    topic,
    user_profile,
    user_role,
    user_skill_parameter,
    user,
  };
}
