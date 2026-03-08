import _sequelize from "sequelize";
const DataTypes = _sequelize.DataTypes;
import _ai_model from  "./ai_model.js";
import _department from  "./department.js";
import _expert_skill from  "./expert_skill.js";
import _expert from  "./expert.js";
import _knowledge_base from  "./knowledge_base.js";
import _knowledge_point from  "./knowledge_point.js";
import _knowledge_relation from  "./knowledge_relation.js";
import _knowledge from  "./knowledge.js";
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
import _task from  "./task.js";
import _topic from  "./topic.js";
import _user_profile from  "./user_profile.js";
import _user_role from  "./user_role.js";
import _user from  "./user.js";
import _kb_article from  "./kb_article.js";
import _kb_section from  "./kb_section.js";
import _kb_paragraph from  "./kb_paragraph.js";
import _kb_tag from  "./kb_tag.js";
import _kb_article_tag from  "./kb_article_tag.js";

export default function initModels(sequelize) {
  const ai_model = _ai_model.init(sequelize, DataTypes);
  const department = _department.init(sequelize, DataTypes);
  const expert_skill = _expert_skill.init(sequelize, DataTypes);
  const expert = _expert.init(sequelize, DataTypes);
  const knowledge_base = _knowledge_base.init(sequelize, DataTypes);
  const knowledge_point = _knowledge_point.init(sequelize, DataTypes);
  const knowledge_relation = _knowledge_relation.init(sequelize, DataTypes);
  const knowledge = _knowledge.init(sequelize, DataTypes);
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
  const task = _task.init(sequelize, DataTypes);
  const topic = _topic.init(sequelize, DataTypes);
  const user_profile = _user_profile.init(sequelize, DataTypes);
  const user_role = _user_role.init(sequelize, DataTypes);
  const user = _user.init(sequelize, DataTypes);
  const kb_article = _kb_article.init(sequelize, DataTypes);
  const kb_section = _kb_section.init(sequelize, DataTypes);
  const kb_paragraph = _kb_paragraph.init(sequelize, DataTypes);
  const kb_tag = _kb_tag.init(sequelize, DataTypes);
  const kb_article_tag = _kb_article_tag.init(sequelize, DataTypes);

  expert.belongsToMany(role, { as: 'role_id_roles', through: role_expert, foreignKey: "expert_id", otherKey: "role_id" });
  permission.belongsToMany(role, { as: 'role_id_roles_role_permissions', through: role_permission, foreignKey: "permission_id", otherKey: "role_id" });
  role.belongsToMany(expert, { as: 'expert_id_experts', through: role_expert, foreignKey: "role_id", otherKey: "expert_id" });
  role.belongsToMany(permission, { as: 'permission_id_permissions', through: role_permission, foreignKey: "role_id", otherKey: "permission_id" });
  role.belongsToMany(user, { as: 'user_id_users', through: user_role, foreignKey: "role_id", otherKey: "user_id" });
  user.belongsToMany(role, { as: 'role_id_roles_user_roles', through: user_role, foreignKey: "user_id", otherKey: "role_id" });
  expert.belongsTo(ai_model, { as: "expressive_model", foreignKey: "expressive_model_id"});
  ai_model.hasMany(expert, { as: "experts", foreignKey: "expressive_model_id"});
  expert.belongsTo(ai_model, { as: "reflective_model", foreignKey: "reflective_model_id"});
  ai_model.hasMany(expert, { as: "reflective_model_experts", foreignKey: "reflective_model_id"});
  position.belongsTo(department, { as: "department", foreignKey: "department_id"});
  department.hasMany(position, { as: "positions", foreignKey: "department_id"});
  user.belongsTo(department, { as: "department", foreignKey: "department_id"});
  department.hasMany(user, { as: "users", foreignKey: "department_id"});
  expert_skill.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(expert_skill, { as: "expert_skills", foreignKey: "expert_id"});
  message.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(message, { as: "messages", foreignKey: "expert_id"});
  role_expert.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(role_expert, { as: "role_experts", foreignKey: "expert_id"});
  topic.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(topic, { as: "topics", foreignKey: "expert_id"});
  user_profile.belongsTo(expert, { as: "expert", foreignKey: "expert_id"});
  expert.hasMany(user_profile, { as: "user_profiles", foreignKey: "expert_id"});
  knowledge.belongsTo(knowledge_base, { as: "kb", foreignKey: "kb_id"});
  knowledge_base.hasMany(knowledge, { as: "knowledges", foreignKey: "kb_id"});
  knowledge_relation.belongsTo(knowledge_point, { as: "source", foreignKey: "source_id"});
  knowledge_point.hasMany(knowledge_relation, { as: "knowledge_relations", foreignKey: "source_id"});
  knowledge_relation.belongsTo(knowledge_point, { as: "target", foreignKey: "target_id"});
  knowledge_point.hasMany(knowledge_relation, { as: "target_knowledge_relations", foreignKey: "target_id"});
  knowledge_point.belongsTo(knowledge, { as: "knowledge", foreignKey: "knowledge_id"});
  knowledge.hasMany(knowledge_point, { as: "knowledge_points", foreignKey: "knowledge_id"});
  knowledge.belongsTo(knowledge, { as: "parent", foreignKey: "parent_id"});
  knowledge.hasMany(knowledge, { as: "knowledges", foreignKey: "parent_id"});
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
  skill_tool.belongsTo(skill, { as: "skill", foreignKey: "skill_id"});
  skill.hasMany(skill_tool, { as: "skill_tools", foreignKey: "skill_id"});
  topic.belongsTo(task, { as: "task", foreignKey: "task_id"});
  task.hasMany(topic, { as: "topics", foreignKey: "task_id"});
  message.belongsTo(topic, { as: "topic", foreignKey: "topic_id"});
  topic.hasMany(message, { as: "messages", foreignKey: "topic_id"});
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

  // KB associations
  // kb_article -> knowledge_base
  kb_article.belongsTo(knowledge_base, { as: "kb", foreignKey: "kb_id"});
  knowledge_base.hasMany(kb_article, { as: "articles", foreignKey: "kb_id"});
  
  // kb_section -> kb_article
  kb_section.belongsTo(kb_article, { as: "article", foreignKey: "article_id"});
  kb_article.hasMany(kb_section, { as: "sections", foreignKey: "article_id"});
  
  // kb_section -> kb_section (self-referencing for hierarchy)
  kb_section.belongsTo(kb_section, { as: "parent", foreignKey: "parent_id"});
  kb_section.hasMany(kb_section, { as: "children", foreignKey: "parent_id"});
  
  // kb_paragraph -> kb_section
  kb_paragraph.belongsTo(kb_section, { as: "section", foreignKey: "section_id"});
  kb_section.hasMany(kb_paragraph, { as: "paragraphs", foreignKey: "section_id"});
  
  // kb_tag -> knowledge_base
  kb_tag.belongsTo(knowledge_base, { as: "kb", foreignKey: "kb_id"});
  knowledge_base.hasMany(kb_tag, { as: "tags", foreignKey: "kb_id"});
  
  // kb_article_tag associations (many-to-many between kb_article and kb_tag)
  kb_article.belongsToMany(kb_tag, { as: "tags", through: kb_article_tag, foreignKey: "article_id", otherKey: "tag_id" });
  kb_tag.belongsToMany(kb_article, { as: "articles", through: kb_article_tag, foreignKey: "tag_id", otherKey: "article_id" });
  kb_article_tag.belongsTo(kb_article, { as: "article", foreignKey: "article_id"});
  kb_article.hasMany(kb_article_tag, { as: "article_tags", foreignKey: "article_id"});
  kb_article_tag.belongsTo(kb_tag, { as: "tag", foreignKey: "tag_id"});
  kb_tag.hasMany(kb_article_tag, { as: "article_tags", foreignKey: "tag_id"});

  return {
    ai_model,
    department,
    expert_skill,
    expert,
    knowledge_base,
    knowledge_point,
    knowledge_relation,
    knowledge,
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
    task,
    topic,
    user_profile,
    user_role,
    user,
    kb_article,
    kb_section,
    kb_paragraph,
    kb_tag,
    kb_article_tag,
  };
}
