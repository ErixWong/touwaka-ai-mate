import _sequelize from "sequelize";
const DataTypes = _sequelize.DataTypes;
import _ai_model from  "./ai_model.js";
import _app_action_log from  "./app_action_log.js";
import _app_clock_registry from  "./app_clock_registry.js";
import _app_contract_mgr_compare from  "./app_contract_mgr_compare.js";
import _app_contract_mgr_content from  "./app_contract_mgr_content.js";
import _app_contract_mgr_record from  "./app_contract_mgr_record.js";
import _app_contract_mgr_row from  "./app_contract_mgr_row.js";
import _app_contract_mgr_v2_content from  "./app_contract_mgr_v2_content.js";
import _app_contract_mgr_v2_row from  "./app_contract_mgr_v2_row.js";
import _app_current_feature_rule_set from  "./app_current_feature_rule_set.js";
import _app_current_feature_rule_stage from  "./app_current_feature_rule_stage.js";
import _app_doc_binding from  "./app_doc_binding.js";
import _app_invoice_mgr_item from  "./app_invoice_mgr_item.js";
import _app_invoice_mgr_record from  "./app_invoice_mgr_record.js";
import _app_invoice_mgr_row from  "./app_invoice_mgr_row.js";
import _app_tick_log from  "./app_tick_log.js";
import _app_tick_run from  "./app_tick_run.js";
import _attachment_token from  "./attachment_token.js";
import _attachment from  "./attachment.js";
import _chat_request from  "./chat_request.js";
import _contract_v2_main_record from  "./contract_v2_main_record.js";
import _contract_v2_org_node from  "./contract_v2_org_node.js";
import _contract_v2_version from  "./contract_v2_version.js";
import _department from  "./department.js";
import _doc_compare_item from  "./doc_compare_item.js";
import _doc_compare_run from  "./doc_compare_run.js";
import _doc_content_unit from  "./doc_content_unit.js";
import _doc_document_tag from  "./doc_document_tag.js";
import _doc_ocr_image from  "./doc_ocr_image.js";
import _doc_ocr_result from  "./doc_ocr_result.js";
import _doc_process_run from  "./doc_process_run.js";
import _doc_tag from  "./doc_tag.js";
import _document_chunk from  "./document_chunk.js";
import _document_collection from  "./document_collection.js";
import _document_outline from  "./document_outline.js";
import _document_revision from  "./document_revision.js";
import _document from  "./document.js";
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
import _mcp_credential from  "./mcp_credential.js";
import _mcp_server from  "./mcp_server.js";
import _mcp_tools_cache from  "./mcp_tools_cache.js";
import _mcp_user_credential from  "./mcp_user_credential.js";
import _message from  "./message.js";
import _mini_app_file from  "./mini_app_file.js";
import _mini_app_role_access from  "./mini_app_role_access.js";
import _mini_app_row from  "./mini_app_row.js";
import _mini_app from  "./mini_app.js";
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
import _app_els_library from  "./app_els_library.js";
import _app_els_material from  "./app_els_material.js";
import _app_els_notebook from  "./app_els_notebook.js";
import _app_els_user_preference from  "./app_els_user_preference.js";
import _app_els_user_review from  "./app_els_user_review.js";
import _app_els_user_study_day from  "./app_els_user_study_day.js";
import _app_els_user_word from  "./app_els_user_word.js";

export default function initModels(sequelize) {
  const ai_model = _ai_model.init(sequelize, DataTypes);
  const app_action_log = _app_action_log.init(sequelize, DataTypes);
  const app_clock_registry = _app_clock_registry.init(sequelize, DataTypes);
  const app_contract_mgr_compare = _app_contract_mgr_compare.init(sequelize, DataTypes);
  const app_contract_mgr_content = _app_contract_mgr_content.init(sequelize, DataTypes);
  const app_contract_mgr_record = _app_contract_mgr_record.init(sequelize, DataTypes);
  const app_contract_mgr_row = _app_contract_mgr_row.init(sequelize, DataTypes);
  const app_contract_mgr_v2_content = _app_contract_mgr_v2_content.init(sequelize, DataTypes);
  const app_contract_mgr_v2_row = _app_contract_mgr_v2_row.init(sequelize, DataTypes);
  const app_current_feature_rule_set = _app_current_feature_rule_set.init(sequelize, DataTypes);
  const app_current_feature_rule_stage = _app_current_feature_rule_stage.init(sequelize, DataTypes);
  const app_doc_binding = _app_doc_binding.init(sequelize, DataTypes);
  const app_invoice_mgr_item = _app_invoice_mgr_item.init(sequelize, DataTypes);
  const app_invoice_mgr_record = _app_invoice_mgr_record.init(sequelize, DataTypes);
  const app_invoice_mgr_row = _app_invoice_mgr_row.init(sequelize, DataTypes);
  const app_tick_log = _app_tick_log.init(sequelize, DataTypes);
  const app_tick_run = _app_tick_run.init(sequelize, DataTypes);
  const attachment_token = _attachment_token.init(sequelize, DataTypes);
  const attachment = _attachment.init(sequelize, DataTypes);
  const chat_request = _chat_request.init(sequelize, DataTypes);
  const contract_v2_main_record = _contract_v2_main_record.init(sequelize, DataTypes);
  const contract_v2_org_node = _contract_v2_org_node.init(sequelize, DataTypes);
  const contract_v2_version = _contract_v2_version.init(sequelize, DataTypes);
  const department = _department.init(sequelize, DataTypes);
  const doc_compare_item = _doc_compare_item.init(sequelize, DataTypes);
  const doc_compare_run = _doc_compare_run.init(sequelize, DataTypes);
  const doc_content_unit = _doc_content_unit.init(sequelize, DataTypes);
  const doc_document_tag = _doc_document_tag.init(sequelize, DataTypes);
  const doc_ocr_image = _doc_ocr_image.init(sequelize, DataTypes);
  const doc_ocr_result = _doc_ocr_result.init(sequelize, DataTypes);
  const doc_process_run = _doc_process_run.init(sequelize, DataTypes);
  const doc_tag = _doc_tag.init(sequelize, DataTypes);
  const document_chunk = _document_chunk.init(sequelize, DataTypes);
  const document_collection = _document_collection.init(sequelize, DataTypes);
  const document_outline = _document_outline.init(sequelize, DataTypes);
  const document_revision = _document_revision.init(sequelize, DataTypes);
  const document = _document.init(sequelize, DataTypes);
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
  const mcp_credential = _mcp_credential.init(sequelize, DataTypes);
  const mcp_server = _mcp_server.init(sequelize, DataTypes);
  const mcp_tools_cache = _mcp_tools_cache.init(sequelize, DataTypes);
  const mcp_user_credential = _mcp_user_credential.init(sequelize, DataTypes);
  const message = _message.init(sequelize, DataTypes);
  const mini_app_file = _mini_app_file.init(sequelize, DataTypes);
  const mini_app_role_access = _mini_app_role_access.init(sequelize, DataTypes);
  const mini_app_row = _mini_app_row.init(sequelize, DataTypes);
  const mini_app = _mini_app.init(sequelize, DataTypes);
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
  app_tick_log.belongsTo(app_clock_registry, { as: "registry", foreignKey: "registry_id"});
  app_clock_registry.hasMany(app_tick_log, { as: "app_tick_logs", foreignKey: "registry_id"});
  app_contract_mgr_compare.belongsTo(app_contract_mgr_record, { as: "row", foreignKey: "row_id"});
  app_contract_mgr_record.hasOne(app_contract_mgr_compare, { as: "app_contract_mgr_compare", foreignKey: "row_id"});
  app_contract_mgr_content.belongsTo(app_contract_mgr_record, { as: "row", foreignKey: "row_id"});
  app_contract_mgr_record.hasOne(app_contract_mgr_content, { as: "app_contract_mgr_content", foreignKey: "row_id"});
  app_contract_mgr_row.belongsTo(app_contract_mgr_record, { as: "row", foreignKey: "row_id"});
  app_contract_mgr_record.hasOne(app_contract_mgr_row, { as: "app_contract_mgr_row", foreignKey: "row_id"});
  app_invoice_mgr_item.belongsTo(app_invoice_mgr_record, { as: "row", foreignKey: "row_id"});
  app_invoice_mgr_record.hasMany(app_invoice_mgr_item, { as: "app_invoice_mgr_items", foreignKey: "row_id"});
  app_invoice_mgr_row.belongsTo(app_invoice_mgr_record, { as: "row", foreignKey: "row_id"});
  app_invoice_mgr_record.hasOne(app_invoice_mgr_row, { as: "app_invoice_mgr_row", foreignKey: "row_id"});
  doc_ocr_image.belongsTo(attachment, { as: "attachment", foreignKey: "attachment_id"});
  attachment.hasMany(doc_ocr_image, { as: "doc_ocr_images", foreignKey: "attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "main_markdown_attachment", foreignKey: "main_markdown_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "doc_ocr_results", foreignKey: "main_markdown_attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "raw_result_attachment", foreignKey: "raw_result_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "raw_result_attachment_doc_ocr_results", foreignKey: "raw_result_attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "deliverables_manifest_attachment", foreignKey: "deliverables_manifest_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "deliverables_manifest_attachment_doc_ocr_results", foreignKey: "deliverables_manifest_attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "middle_json_attachment", foreignKey: "middle_json_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "middle_json_attachment_doc_ocr_results", foreignKey: "middle_json_attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "content_list_attachment", foreignKey: "content_list_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "content_list_attachment_doc_ocr_results", foreignKey: "content_list_attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "content_list_v2_attachment", foreignKey: "content_list_v2_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "content_list_v2_attachment_doc_ocr_results", foreignKey: "content_list_v2_attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "model_json_attachment", foreignKey: "model_json_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "model_json_attachment_doc_ocr_results", foreignKey: "model_json_attachment_id"});
  doc_ocr_result.belongsTo(attachment, { as: "image_manifest_attachment", foreignKey: "image_manifest_attachment_id"});
  attachment.hasMany(doc_ocr_result, { as: "image_manifest_attachment_doc_ocr_results", foreignKey: "image_manifest_attachment_id"});
  mini_app_file.belongsTo(attachment, { as: "attachment", foreignKey: "attachment_id"});
  attachment.hasMany(mini_app_file, { as: "mini_app_files", foreignKey: "attachment_id"});
  contract_v2_version.belongsTo(contract_v2_main_record, { as: "contract", foreignKey: "contract_id"});
  contract_v2_main_record.hasMany(contract_v2_version, { as: "contract_v2_versions", foreignKey: "contract_id"});
  contract_v2_main_record.belongsTo(contract_v2_org_node, { as: "org_node", foreignKey: "org_node_id"});
  contract_v2_org_node.hasMany(contract_v2_main_record, { as: "contract_v2_main_records", foreignKey: "org_node_id"});
  contract_v2_org_node.belongsTo(contract_v2_org_node, { as: "parent", foreignKey: "parent_id"});
  contract_v2_org_node.hasMany(contract_v2_org_node, { as: "contract_v2_org_nodes", foreignKey: "parent_id"});
  position.belongsTo(department, { as: "department", foreignKey: "department_id"});
  department.hasMany(position, { as: "positions", foreignKey: "department_id"});
  doc_compare_item.belongsTo(doc_compare_run, { as: "run", foreignKey: "run_id"});
  doc_compare_run.hasMany(doc_compare_item, { as: "doc_compare_items", foreignKey: "run_id"});
  doc_content_unit.belongsTo(doc_content_unit, { as: "parent", foreignKey: "parent_id"});
  doc_content_unit.hasMany(doc_content_unit, { as: "doc_content_units", foreignKey: "parent_id"});
  doc_ocr_image.belongsTo(doc_ocr_result, { as: "ocr_result", foreignKey: "ocr_result_id"});
  doc_ocr_result.hasMany(doc_ocr_image, { as: "doc_ocr_images", foreignKey: "ocr_result_id"});
  doc_document_tag.belongsTo(doc_tag, { as: "tag", foreignKey: "tag_id"});
  doc_tag.hasMany(doc_document_tag, { as: "doc_document_tags", foreignKey: "tag_id"});
  doc_compare_item.belongsTo(document_chunk, { as: "base_unit", foreignKey: "base_unit_id"});
  document_chunk.hasMany(doc_compare_item, { as: "doc_compare_items", foreignKey: "base_unit_id"});
  doc_compare_item.belongsTo(document_chunk, { as: "target_unit", foreignKey: "target_unit_id"});
  document_chunk.hasMany(doc_compare_item, { as: "target_unit_doc_compare_items", foreignKey: "target_unit_id"});
  document.belongsTo(document_collection, { as: "collection", foreignKey: "collection_id"});
  document_collection.hasMany(document, { as: "documents", foreignKey: "collection_id"});
  document_chunk.belongsTo(document_outline, { as: "outline", foreignKey: "outline_id"});
  document_outline.hasMany(document_chunk, { as: "document_chunks", foreignKey: "outline_id"});
  app_doc_binding.belongsTo(document_revision, { as: "current_revision", foreignKey: "current_revision_id"});
  document_revision.hasMany(app_doc_binding, { as: "app_doc_bindings", foreignKey: "current_revision_id"});
  doc_compare_run.belongsTo(document_revision, { as: "base_version", foreignKey: "base_version_id"});
  document_revision.hasMany(doc_compare_run, { as: "doc_compare_runs", foreignKey: "base_version_id"});
  doc_compare_run.belongsTo(document_revision, { as: "target_version", foreignKey: "target_version_id"});
  document_revision.hasMany(doc_compare_run, { as: "target_version_doc_compare_runs", foreignKey: "target_version_id"});
  doc_content_unit.belongsTo(document_revision, { as: "version", foreignKey: "version_id"});
  document_revision.hasMany(doc_content_unit, { as: "doc_content_units", foreignKey: "version_id"});
  doc_ocr_result.belongsTo(document_revision, { as: "revision", foreignKey: "revision_id"});
  document_revision.hasMany(doc_ocr_result, { as: "doc_ocr_results", foreignKey: "revision_id"});
  doc_process_run.belongsTo(document_revision, { as: "revision", foreignKey: "revision_id"});
  document_revision.hasMany(doc_process_run, { as: "doc_process_runs", foreignKey: "revision_id"});
  document_chunk.belongsTo(document_revision, { as: "revision", foreignKey: "revision_id"});
  document_revision.hasMany(document_chunk, { as: "document_chunks", foreignKey: "revision_id"});
  document_outline.belongsTo(document_revision, { as: "revision", foreignKey: "revision_id"});
  document_revision.hasMany(document_outline, { as: "document_outlines", foreignKey: "revision_id"});
  document.belongsTo(document_revision, { as: "id_document_revision", foreignKey: "id"});
  document_revision.hasOne(document, { as: "id_document", foreignKey: "id"});
  document.belongsTo(document_revision, { as: "current_revision", foreignKey: "current_revision_id"});
  document_revision.hasMany(document, { as: "current_revision_documents", foreignKey: "current_revision_id"});
  app_doc_binding.belongsTo(document, { as: "document", foreignKey: "document_id"});
  document.hasMany(app_doc_binding, { as: "app_doc_bindings", foreignKey: "document_id"});
  doc_compare_run.belongsTo(document, { as: "document", foreignKey: "document_id"});
  document.hasMany(doc_compare_run, { as: "doc_compare_runs", foreignKey: "document_id"});
  doc_document_tag.belongsTo(document, { as: "document", foreignKey: "document_id"});
  document.hasMany(doc_document_tag, { as: "doc_document_tags", foreignKey: "document_id"});
  doc_ocr_result.belongsTo(document, { as: "document", foreignKey: "document_id"});
  document.hasMany(doc_ocr_result, { as: "doc_ocr_results", foreignKey: "document_id"});
  document_revision.belongsTo(document, { as: "document", foreignKey: "document_id"});
  document.hasMany(document_revision, { as: "document_revisions", foreignKey: "document_id"});
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
  mcp_credential.belongsTo(mcp_server, { as: "mcp_server", foreignKey: "mcp_server_id"});
  mcp_server.hasOne(mcp_credential, { as: "mcp_credential", foreignKey: "mcp_server_id"});
  mcp_tools_cache.belongsTo(mcp_server, { as: "mcp_server", foreignKey: "mcp_server_id"});
  mcp_server.hasMany(mcp_tools_cache, { as: "mcp_tools_caches", foreignKey: "mcp_server_id"});
  mcp_user_credential.belongsTo(mcp_server, { as: "mcp_server", foreignKey: "mcp_server_id"});
  mcp_server.hasMany(mcp_user_credential, { as: "mcp_user_credentials", foreignKey: "mcp_server_id"});
  app_action_log.belongsTo(mini_app_row, { as: "record", foreignKey: "record_id"});
  mini_app_row.hasMany(app_action_log, { as: "app_action_logs", foreignKey: "record_id"});
  app_contract_mgr_v2_row.belongsTo(mini_app_row, { as: "row", foreignKey: "row_id"});
  mini_app_row.hasOne(app_contract_mgr_v2_row, { as: "app_contract_mgr_v2_row", foreignKey: "row_id"});
  contract_v2_version.belongsTo(mini_app_row, { as: "row", foreignKey: "row_id"});
  mini_app_row.hasMany(contract_v2_version, { as: "contract_v2_versions", foreignKey: "row_id"});
  mini_app_file.belongsTo(mini_app_row, { as: "record", foreignKey: "record_id"});
  mini_app_row.hasMany(mini_app_file, { as: "mini_app_files", foreignKey: "record_id"});
  app_action_log.belongsTo(mini_app, { as: "app", foreignKey: "app_id"});
  mini_app.hasMany(app_action_log, { as: "app_action_logs", foreignKey: "app_id"});
  app_clock_registry.belongsTo(mini_app, { as: "app", foreignKey: "app_id"});
  mini_app.hasMany(app_clock_registry, { as: "app_clock_registries", foreignKey: "app_id"});
  mini_app_role_access.belongsTo(mini_app, { as: "app", foreignKey: "app_id"});
  mini_app.hasMany(mini_app_role_access, { as: "mini_app_role_accesses", foreignKey: "app_id"});
  mini_app_row.belongsTo(mini_app, { as: "app", foreignKey: "app_id"});
  mini_app.hasMany(mini_app_row, { as: "mini_app_rows", foreignKey: "app_id"});
  permission.belongsTo(permission, { as: "parent", foreignKey: "parent_id"});
  permission.hasMany(permission, { as: "permissions", foreignKey: "parent_id"});
  role_permission.belongsTo(permission, { as: "permission", foreignKey: "permission_id"});
  permission.hasMany(role_permission, { as: "role_permissions", foreignKey: "permission_id"});
  user.belongsTo(position, { as: "position", foreignKey: "position_id"});
  position.hasMany(user, { as: "users", foreignKey: "position_id"});
  ai_model.belongsTo(provider, { as: "provider", foreignKey: "provider_id"});
  provider.hasMany(ai_model, { as: "ai_models", foreignKey: "provider_id"});
  mini_app_role_access.belongsTo(role, { as: "role", foreignKey: "role_id"});
  role.hasMany(mini_app_role_access, { as: "mini_app_role_accesses", foreignKey: "role_id"});
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
  attachment_token.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(attachment_token, { as: "attachment_tokens", foreignKey: "user_id"});
  attachment.belongsTo(user, { as: "created_by_user", foreignKey: "created_by"});
  user.hasMany(attachment, { as: "attachments", foreignKey: "created_by"});
  invitation_usage.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(invitation_usage, { as: "invitation_usages", foreignKey: "user_id"});
  invitation.belongsTo(user, { as: "creator", foreignKey: "creator_id"});
  user.hasMany(invitation, { as: "invitations", foreignKey: "creator_id"});
  knowledge_basis.belongsTo(user, { as: "owner", foreignKey: "owner_id"});
  user.hasMany(knowledge_basis, { as: "knowledge_bases", foreignKey: "owner_id"});
  knowledge_basis.belongsTo(user, { as: "creator", foreignKey: "creator_id"});
  user.hasMany(knowledge_basis, { as: "creator_knowledge_bases", foreignKey: "creator_id"});
  mcp_user_credential.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(mcp_user_credential, { as: "mcp_user_credentials", foreignKey: "user_id"});
  message.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(message, { as: "messages", foreignKey: "user_id"});
  mini_app_row.belongsTo(user, { as: "user", foreignKey: "user_id"});
  user.hasMany(mini_app_row, { as: "mini_app_rows", foreignKey: "user_id"});
  mini_app.belongsTo(user, { as: "owner", foreignKey: "owner_id"});
  user.hasMany(mini_app, { as: "mini_apps", foreignKey: "owner_id"});
  mini_app.belongsTo(user, { as: "creator", foreignKey: "creator_id"});
  user.hasMany(mini_app, { as: "creator_mini_apps", foreignKey: "creator_id"});
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

  const app_els_library = _app_els_library.init(sequelize, DataTypes);
  const app_els_material = _app_els_material.init(sequelize, DataTypes);
  const app_els_notebook = _app_els_notebook.init(sequelize, DataTypes);
  const app_els_user_preference = _app_els_user_preference.init(sequelize, DataTypes);
  const app_els_user_review = _app_els_user_review.init(sequelize, DataTypes);
  const app_els_user_study_day = _app_els_user_study_day.init(sequelize, DataTypes);
  const app_els_user_word = _app_els_user_word.init(sequelize, DataTypes);
  return {
    ai_model,
    app_action_log,
    app_clock_registry,
    app_contract_mgr_compare,
    app_contract_mgr_content,
    app_contract_mgr_record,
    app_contract_mgr_row,
    app_contract_mgr_v2_content,
    app_contract_mgr_v2_row,
    app_current_feature_rule_set,
    app_current_feature_rule_stage,
    app_doc_binding,
    app_invoice_mgr_item,
    app_invoice_mgr_record,
    app_invoice_mgr_row,
    app_tick_log,
    app_tick_run,
    attachment_token,
    attachment,
    chat_request,
    contract_v2_main_record,
    contract_v2_org_node,
    contract_v2_version,
    department,
    doc_compare_item,
    doc_compare_run,
    doc_content_unit,
    doc_document_tag,
    doc_ocr_image,
    doc_ocr_result,
    doc_process_run,
    doc_tag,
    document_chunk,
    document_collection,
    document_outline,
    document_revision,
    document,
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
    mcp_credential,
    mcp_server,
    mcp_tools_cache,
    mcp_user_credential,
    message,
    mini_app_file,
    mini_app_role_access,
    mini_app_row,
    mini_app,
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
    app_els_library,
    app_els_material,
    app_els_notebook,
    app_els_user_preference,
    app_els_user_review,
    app_els_user_study_day,
    app_els_user_word,
    user,
  };
}
