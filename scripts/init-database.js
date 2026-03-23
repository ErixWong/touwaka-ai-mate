/**
 * Database Initialization Script
 * 使用 newID() 生成随机 ID 初始化数据库
 * 
 * 注意：此脚本用于全新数据库初始化
 * 增量迁移请使用 upgrade-database.js
 */

// 首先加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';
import Utils from '../lib/utils.js';
import bcrypt from 'bcryptjs';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

// 表结构定义
const TABLES = [
  // ==================== 基础表 ====================
  
  // 1. Providers 表
  // timeout 字段单位为毫秒，默认 60 秒 = 60000 毫秒
  `CREATE TABLE IF NOT EXISTS providers (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    base_url VARCHAR(512) NOT NULL,
    api_key VARCHAR(512),
    timeout INT DEFAULT 60000 COMMENT '请求超时时间（毫秒）',
    user_agent VARCHAR(256) COMMENT 'HTTP 请求 User-Agent 头（NULL 则使用默认值）',
    is_active BIT(1) DEFAULT b'1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // 2. AI Models 表（用于前端模型管理）
  `CREATE TABLE IF NOT EXISTS ai_models (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    model_name VARCHAR(128) NOT NULL COMMENT 'API调用使用的模型标识符',
    model_type ENUM('text', 'multimodal', 'embedding') DEFAULT 'text' COMMENT '模型类型: text=文本, multimodal=多模态, embedding=向量化',
    provider_id VARCHAR(32),
    max_tokens INT DEFAULT 4096,
    max_output_tokens INT DEFAULT 4096 COMMENT '每次请求最多生成的 token 数',
    embedding_dim INT NULL COMMENT '向量化模型的嵌入维度（仅 embedding 类型模型使用）',
    supports_reasoning BIT(1) DEFAULT b'0' COMMENT '是否支持思考/推理模式（DeepSeek、OpenAI o1/o3、Qwen 等）',
    thinking_format ENUM('openai', 'deepseek', 'qwen', 'none') DEFAULT 'none' COMMENT '思考模式格式',
    cost_per_1k_input DECIMAL(10, 6) DEFAULT 0,
    cost_per_1k_output DECIMAL(10, 6) DEFAULT 0,
    description TEXT,
    is_active BIT(1) DEFAULT b'1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL,
    INDEX idx_provider (provider_id),
    INDEX idx_active (is_active),
    INDEX idx_model_type (model_type)
  )`,

  // 3. Experts 表
  `CREATE TABLE IF NOT EXISTS experts (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    introduction TEXT,
    speaking_style TEXT,
    core_values TEXT,
    behavioral_guidelines TEXT,
    taboos TEXT,
    emotional_tone VARCHAR(256),
    expressive_model_id VARCHAR(32),
    reflective_model_id VARCHAR(32),
    prompt_template TEXT,
    is_active BIT(1) DEFAULT b'1',
    avatar_base64 TEXT COMMENT '小头像Base64（日常使用，约2-5KB）',
    avatar_large_base64 MEDIUMTEXT COMMENT '大头像Base64（对话框背景，约20-50KB）',
    context_threshold DECIMAL(3,2) DEFAULT 0.70 COMMENT '上下文压缩阈值，Token >= 阈值 × context_size 时触发压缩',
    context_strategy ENUM('full', 'simple') DEFAULT 'full' COMMENT '上下文组织策略：full=完整上下文，simple=简单上下文（近期10条消息+5个Topic）',
    temperature DECIMAL(3,2) DEFAULT 0.7 COMMENT 'Expressive模型温度',
    reflective_temperature DECIMAL(3,2) DEFAULT 0.3 COMMENT 'Reflective模型温度',
    top_p DECIMAL(3,2) DEFAULT 1.0 COMMENT 'Top-p采样',
    frequency_penalty DECIMAL(3,2) DEFAULT 0.0 COMMENT '频率惩罚',
    presence_penalty DECIMAL(3,2) DEFAULT 0.0 COMMENT '存在惩罚',
    knowledge_config TEXT COMMENT '知识库配置（JSON格式）：{enabled, kb_id, top_k, threshold, max_tokens, style}',
    max_tool_rounds INT DEFAULT NULL COMMENT '最大工具调用轮数（NULL表示使用系统默认，范围 1-50）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (expressive_model_id) REFERENCES ai_models(id) ON DELETE SET NULL,
    FOREIGN KEY (reflective_model_id) REFERENCES ai_models(id) ON DELETE SET NULL,
    INDEX idx_active (is_active)
  )`,

  // 4. Skills 表
  // 注：index_js 和 config 字段已移除
  // - 代码通过 source_path 从文件系统加载
  // - 配置通过 skill_parameters 表管理
  `CREATE TABLE IF NOT EXISTS skills (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    description TEXT,
    version VARCHAR(32),
    author VARCHAR(128),
    tags LONGTEXT COMMENT '标签数组（JSON格式）',
    source_type ENUM('database', 'filesystem', 'url', 'zip', 'local') DEFAULT 'filesystem',
    source_path VARCHAR(256),
    source_url VARCHAR(512),
    skill_md TEXT,
    security_score INT DEFAULT 100,
    security_warnings LONGTEXT COMMENT '安全警告（JSON格式）',
    license TEXT COMMENT '许可证信息',
    argument_hint VARCHAR(128) DEFAULT '' COMMENT '参数提示',
    disable_model_invocation BIT(1) DEFAULT b'0' COMMENT '禁用模型调用',
    user_invocable BIT(1) DEFAULT b'1' COMMENT '用户可调用',
    allowed_tools TEXT COMMENT '允许的工具列表（JSON数组）',
    is_active BIT(1) DEFAULT b'1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // 4.1 Skill_Tools 表（技能工具清单）
  // is_resident: 0=普通工具（执行后返回），1=驻留工具（持续运行，stdio通信）
  `CREATE TABLE IF NOT EXISTS skill_tools (
    id VARCHAR(32) PRIMARY KEY,
    skill_id VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL,
    description TEXT,
    \`parameters\` TEXT COMMENT 'JSON Schema 格式的参数定义',
    script_path VARCHAR(255) DEFAULT 'index.js' COMMENT '工具入口脚本路径（相对于技能目录）',
    is_resident BIT(1) DEFAULT b'0' COMMENT '是否驻留进程：0=普通工具，1=驻留工具',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_skill_name (skill_id, name),
    INDEX idx_skill_id (skill_id)
  )`,

  // 4.2 Skill_Parameters 表（技能参数配置）
  `CREATE TABLE IF NOT EXISTS skill_parameters (
    id VARCHAR(32) PRIMARY KEY,
    skill_id VARCHAR(32) NOT NULL COMMENT '技能ID',
    param_name VARCHAR(64) NOT NULL COMMENT '参数名（如 api_key, base_url）',
    param_value TEXT COMMENT '参数值',
    is_secret BIT(1) DEFAULT b'0' COMMENT '是否敏感参数（前端显示/隐藏）',
    allow_user_override BIT(1) DEFAULT b'1' COMMENT '是否允许用户覆盖',
    description VARCHAR(500) COMMENT '参数描述',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_skill_param (skill_id, param_name),
    INDEX idx_skill_id (skill_id),
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  ) COMMENT='技能参数表'`,

  // 5. Expert_Skills 表（复合主键，无独立 id）
  `CREATE TABLE IF NOT EXISTS expert_skills (
    expert_id VARCHAR(32) NOT NULL COMMENT '专家ID',
    skill_id VARCHAR(32) NOT NULL COMMENT '技能ID',
    is_enabled BIT(1) DEFAULT b'1' COMMENT '是否启用',
    config TEXT COMMENT '配置JSON',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (expert_id, skill_id),
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
    INDEX idx_expert (expert_id),
    INDEX idx_skill (skill_id)
  ) COMMENT='专家技能关联表'`,

  // 6. Users 表（用户固有属性，全局一致）
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(32) PRIMARY KEY,
    username VARCHAR(32) UNIQUE,
    email VARCHAR(256) UNIQUE,
    password_hash VARCHAR(256),
    nickname VARCHAR(128),
    avatar TEXT COMMENT '用户头像Base64（约5-15KB）',
    gender VARCHAR(16) COMMENT '性别：male/female/other',
    birthday DATE COMMENT '生日',
    occupation VARCHAR(128) COMMENT '职业',
    location VARCHAR(128) COMMENT '所在地',
    status ENUM('active', 'inactive', 'banned') DEFAULT 'active',
    department_id VARCHAR(20) NULL COMMENT '所属部门',
    position_id VARCHAR(20) NULL COMMENT '职位ID',
    invitation_quota INT DEFAULT 1 COMMENT '可生成的邀请码数量上限',
    invited_by INT DEFAULT NULL COMMENT '邀请记录ID（关联 invitation_usage.id）',
    preferences JSON,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_status (status),
    INDEX idx_department (department_id),
    INDEX idx_position (position_id)
  )`,

  // 7. User_Profiles 表（用户画像：专家对用户的认知）
  `CREATE TABLE IF NOT EXISTS user_profiles (
    id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL,
    expert_id VARCHAR(32) NOT NULL,
    preferred_name VARCHAR(128) COMMENT '用户希望被称呼的名字',
    introduction TEXT COMMENT '用户自我介绍',
    background TEXT COMMENT '背景画像（LLM总结生成）',
    notes TEXT COMMENT '专家对用户的笔记',
    first_met DATETIME,
    last_active DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE,
    UNIQUE KEY uk_user_expert (user_id, expert_id),
    INDEX idx_expert (expert_id),
    INDEX idx_last_active (last_active)
  )`,

  // 8. Tasks 表（任务工作空间）
  `CREATE TABLE IF NOT EXISTS tasks (
    id VARCHAR(32) PRIMARY KEY,
    task_id VARCHAR(50) UNIQUE NOT NULL COMMENT '任务ID (12位随机字符)',
    title VARCHAR(200) NOT NULL COMMENT '任务标题',
    description TEXT COMMENT '任务描述',
    workspace_path VARCHAR(500) NOT NULL COMMENT '工作目录路径（相对路径）',
    expert_id VARCHAR(32) NULL COMMENT '关联的专家ID（自主任务执行时使用）',
    topic_id VARCHAR(32) NULL COMMENT '关联的话题ID（自主任务执行时的对话）',
    last_executed_at DATETIME NULL COMMENT '最后执行时间（自主任务执行器更新）',
    solution_id VARCHAR(32) NULL COMMENT '关联的解决方案ID',
    status ENUM('active', 'autonomous', 'archived', 'deleted') DEFAULT 'active',
    created_by VARCHAR(32) NOT NULL COMMENT '创建者 user_id',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE SET NULL,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE SET NULL,
    FOREIGN KEY (solution_id) REFERENCES solutions(id) ON DELETE SET NULL,
    INDEX idx_task_id (task_id),
    INDEX idx_user (created_by),
    INDEX idx_status (status),
    INDEX idx_expert (expert_id),
    INDEX idx_topic (topic_id),
    INDEX idx_solution (solution_id)
  ) COMMENT='任务工作空间表'`,

  // 9. Topics 表
  `CREATE TABLE IF NOT EXISTS topics (
    id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL,
    expert_id VARCHAR(32),
    task_id VARCHAR(32) COMMENT '关联任务ID',
    provider_name VARCHAR(128),
    model_name VARCHAR(128),
    title VARCHAR(256) NOT NULL,
    description TEXT,
    category VARCHAR(128),
    keywords JSON DEFAULT NULL COMMENT '话题关键词数组，用于中长期记忆召回',
    status ENUM('active', 'archived', 'deleted') DEFAULT 'active',
    message_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE SET NULL,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
    INDEX idx_user_status (user_id, status),
    INDEX idx_expert (expert_id),
    INDEX idx_task (task_id),
    INDEX idx_updated (updated_at)
  )`,

  // 10. Messages 表
  `CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(32) PRIMARY KEY,
    topic_id VARCHAR(32) DEFAULT NULL,
    user_id VARCHAR(32) NOT NULL COMMENT '消息所属用户ID，便于直接查询',
    expert_id VARCHAR(32) COMMENT '专家ID，便于直接查询',
    role ENUM('system', 'user', 'assistant', 'tool') NOT NULL,
    content LONGTEXT NOT NULL COMMENT '消息内容，支持长文本',
    reasoning_content LONGTEXT NULL COMMENT '思考过程内容（DeepSeek reasoning_content 输出）',
    content_type ENUM('text', 'image', 'file') DEFAULT 'text',
    prompt_tokens INT DEFAULT 0 COMMENT '输入 token 数量',
    completion_tokens INT DEFAULT 0 COMMENT '输出 token 数量',
    cost DECIMAL(10, 6) DEFAULT 0,
    latency_ms INT DEFAULT 0,
    provider_name VARCHAR(128),
    model_name VARCHAR(128),
    inner_voice LONGTEXT COMMENT '内心独白（JSON格式）',
    tool_calls LONGTEXT COMMENT '工具调用（JSON格式）',
    error_info LONGTEXT COMMENT '错误信息（JSON格式）',
    is_deleted BIT(1) DEFAULT b'0',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE SET NULL,
    INDEX idx_topic (topic_id),
    INDEX idx_user (user_id),
    INDEX idx_expert (expert_id),
    INDEX idx_role (role),
    INDEX idx_created (created_at)
  )`,

  // 11. Roles 表（RBAC权限系统）
  // 注：字段已重命名 name -> mark, label -> name
  `CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(32) PRIMARY KEY,
    mark VARCHAR(50) UNIQUE NOT NULL COMMENT '角色标识（不可编辑）：admin/creator/user',
    name VARCHAR(100) NOT NULL COMMENT '角色显示名称',
    description TEXT COMMENT '角色描述',
    level ENUM('user', 'power_user', 'admin') DEFAULT 'user' COMMENT '角色权限等级',
    is_system BIT(1) DEFAULT b'0' COMMENT '系统角色，不可删除',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX mark (mark),
    INDEX idx_level (level)
  )`,

  // 12. Permissions 表（权限定义，含菜单路由配置）
  `CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(32) PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL COMMENT '权限码：user:create, expert:edit等',
    name VARCHAR(100) NOT NULL COMMENT '权限名称',
    type ENUM('menu', 'button', 'api') DEFAULT 'api' COMMENT '权限类型',
    parent_id VARCHAR(32) DEFAULT NULL COMMENT '父权限ID，用于菜单层级',
    route_path VARCHAR(255) COMMENT 'Vue路由路径，菜单权限用',
    route_component VARCHAR(255) COMMENT 'Vue组件路径',
    route_icon VARCHAR(100) COMMENT '菜单图标',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES permissions(id) ON DELETE SET NULL,
    INDEX idx_code (code),
    INDEX idx_type (type)
  )`,

  // 13. Role_Permissions 表（角色-权限关联）
  `CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(32) NOT NULL,
    permission_id VARCHAR(32) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
  )`,

  // 14. User_Roles 表（用户-角色关联，支持多角色）
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id VARCHAR(32) NOT NULL,
    role_id VARCHAR(32) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  )`,

  // 15. Role_Experts 表（角色-专家访问权限）
  `CREATE TABLE IF NOT EXISTS role_experts (
    role_id VARCHAR(32) NOT NULL,
    expert_id VARCHAR(32) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, expert_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE
  )`,

  // ==================== 知识库表（旧版） ====================
  
  // 16. Knowledge_Bases 表（知识库）
  `CREATE TABLE IF NOT EXISTS knowledge_bases (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id VARCHAR(32) NOT NULL COMMENT '创建者 user_id',
    embedding_model_id VARCHAR(50) COMMENT '关联 ai_models 表',
    embedding_dim INT DEFAULT 1536,
    is_public BIT(1) DEFAULT b'0' COMMENT '预留，暂不使用',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (embedding_model_id) REFERENCES ai_models(id) ON DELETE SET NULL,
    INDEX idx_kb_owner (owner_id),
    INDEX idx_kb_public (is_public)
  )`,

  // 17. Knowledges 表（文章，树状结构）
  `CREATE TABLE IF NOT EXISTS knowledges (
    id VARCHAR(20) PRIMARY KEY,
    kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
    parent_id VARCHAR(20) DEFAULT NULL COMMENT '父文章 ID（树状结构）',
    title VARCHAR(500) NOT NULL COMMENT '文章标题',
    summary TEXT COMMENT 'LLM 生成的摘要',
    source_type ENUM('file', 'web', 'manual') DEFAULT 'manual' COMMENT '来源类型',
    source_url VARCHAR(1000) COMMENT '来源 URL',
    file_path VARCHAR(500) COMMENT '原始文件存储路径',
    status ENUM('pending', 'processing', 'ready', 'failed') DEFAULT 'pending' COMMENT '处理状态',
    position INT DEFAULT 0 COMMENT '同级排序',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES knowledges(id) ON DELETE CASCADE,
    INDEX idx_knowledge_kb (kb_id),
    INDEX idx_knowledge_parent (parent_id),
    INDEX idx_knowledge_status (status)
  )`,

  // 18. Knowledge_Points 表（知识点）
  `CREATE TABLE IF NOT EXISTS knowledge_points (
    id VARCHAR(20) PRIMARY KEY,
    knowledge_id VARCHAR(20) NOT NULL COMMENT '所属文章',
    title VARCHAR(500) COMMENT '知识点标题',
    content MEDIUMTEXT NOT NULL COMMENT 'Markdown 格式内容',
    context TEXT COMMENT '上下文信息（用于向量化）',
    embedding VECTOR(1024) COMMENT '向量（1024维）',
    position INT DEFAULT 0 COMMENT '排序位置',
    token_count INT DEFAULT 0 COMMENT 'Token 数量',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (knowledge_id) REFERENCES knowledges(id) ON DELETE CASCADE,
    INDEX idx_kp_knowledge (knowledge_id)
  )`,

  // 19. Knowledge_Relations 表（知识点关联）
  `CREATE TABLE IF NOT EXISTS knowledge_relations (
    id VARCHAR(20) PRIMARY KEY,
    source_id VARCHAR(20) NOT NULL COMMENT '源知识点',
    target_id VARCHAR(20) NOT NULL COMMENT '目标知识点',
    relation_type ENUM('depends_on', 'references', 'related_to', 'contradicts', 'extends', 'example_of') NOT NULL COMMENT '关系类型',
    confidence DECIMAL(3,2) DEFAULT 1.00 COMMENT 'LLM 置信度 (0-1)',
    created_by ENUM('llm', 'manual') DEFAULT 'llm' COMMENT '创建方式',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES knowledge_points(id) ON DELETE CASCADE,
    UNIQUE KEY unique_relation (source_id, target_id, relation_type),
    INDEX idx_kr_source (source_id),
    INDEX idx_kr_target (target_id),
    INDEX idx_kr_type (relation_type)
  )`,

  // ==================== 知识库表（新版 KB Refactor） ====================
  
  // 20. KB_Articles 表
  `CREATE TABLE IF NOT EXISTS kb_articles (
    id VARCHAR(20) PRIMARY KEY,
    kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
    title VARCHAR(500) NOT NULL COMMENT '文章标题',
    summary TEXT COMMENT '文章摘要',
    source_type ENUM('upload', 'url', 'manual') DEFAULT 'manual' COMMENT '来源类型',
    source_url VARCHAR(1000) COMMENT '来源URL',
    file_path VARCHAR(500) COMMENT '本地文件路径',
    status ENUM('pending', 'processing', 'ready', 'error') DEFAULT 'pending' COMMENT '状态',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    INDEX idx_article_kb (kb_id),
    INDEX idx_article_status (status)
  ) COMMENT='文章表'`,

  // 21. KB_Sections 表
  `CREATE TABLE IF NOT EXISTS kb_sections (
    id VARCHAR(20) PRIMARY KEY,
    article_id VARCHAR(20) NOT NULL COMMENT '所属文章',
    parent_id VARCHAR(20) DEFAULT NULL COMMENT '父节ID（自指向，形成无限层级）',
    title VARCHAR(500) NOT NULL COMMENT '节标题',
    level INT DEFAULT 1 COMMENT '层级深度（1=章, 2=节, 3=小节...）',
    position INT DEFAULT 0 COMMENT '排序位置（同级内的顺序）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
    INDEX idx_section_article (article_id),
    INDEX idx_section_parent (parent_id),
    INDEX idx_section_level (level),
    INDEX idx_section_position (position)
  ) COMMENT='节表（无限层级）'`,

  // 22. KB_Paragraphs 表
  `CREATE TABLE IF NOT EXISTS kb_paragraphs (
    id VARCHAR(20) PRIMARY KEY,
    section_id VARCHAR(20) NOT NULL COMMENT '所属节',
    title VARCHAR(500) COMMENT '段落标题（可选）',
    content TEXT NOT NULL COMMENT '段落内容',
    is_knowledge_point BIT(1) DEFAULT b'0' COMMENT '是否是知识点',
    embedding VECTOR(384) COMMENT '向量（只有知识点才向量化）',
    position INT DEFAULT 0 COMMENT '排序位置（同一节内的顺序）',
    token_count INT DEFAULT 0 COMMENT 'Token 数量',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (section_id) REFERENCES kb_sections(id) ON DELETE CASCADE,
    INDEX idx_paragraph_section (section_id),
    INDEX idx_paragraph_kp (is_knowledge_point),
    INDEX idx_paragraph_position (position)
  ) COMMENT='段表'`,

  // 23. KB_Tags 表
  `CREATE TABLE IF NOT EXISTS kb_tags (
    id VARCHAR(20) PRIMARY KEY,
    kb_id VARCHAR(20) NOT NULL COMMENT '所属知识库',
    name VARCHAR(100) NOT NULL COMMENT '标签名',
    description VARCHAR(500) COMMENT '标签描述',
    article_count INT DEFAULT 0 COMMENT '关联文章数（缓存）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (kb_id) REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    UNIQUE KEY uk_kb_tag (kb_id, name),
    INDEX idx_tag_kb (kb_id)
  ) COMMENT='标签表'`,

  // 24. KB_Article_Tags 表（复合主键，无独立 id）
  `CREATE TABLE IF NOT EXISTS kb_article_tags (
    article_id VARCHAR(20) NOT NULL COMMENT '文章ID',
    tag_id VARCHAR(20) NOT NULL COMMENT '标签ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_id, tag_id),
    FOREIGN KEY (article_id) REFERENCES kb_articles(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES kb_tags(id) ON DELETE CASCADE,
    INDEX idx_at_article (article_id),
    INDEX idx_at_tag (tag_id)
  ) COMMENT='文章-标签关联表'`,

  // ==================== 系统设置表 ====================
  
  // 25. System_Settings 表
  `CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    value_type VARCHAR(20) DEFAULT 'string',
    description VARCHAR(500),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

  // ==================== 助理系统表 ====================
  
  // 26. Assistants 表
  `CREATE TABLE IF NOT EXISTS assistants (
    assistant_type VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '显示名称',
    icon VARCHAR(32) COMMENT '图标',
    description TEXT COMMENT '能力描述',
    model_id VARCHAR(32) COMMENT '关联 ai_models.id',
    prompt_template TEXT COMMENT '系统提示词模板',
    max_tokens INT DEFAULT 4096,
    temperature DECIMAL(3,2) DEFAULT 0.7,
    estimated_time INT DEFAULT 30 COMMENT '预估执行时间（秒）',
    timeout INT DEFAULT 120 COMMENT '超时时间（秒）',
    tool_name VARCHAR(64) COMMENT '工具名称，如 ocr_analyze',
    tool_description TEXT COMMENT '工具描述',
    tool_parameters LONGTEXT COMMENT 'JSON Schema 格式的参数定义',
    can_use_skills BIT(1) DEFAULT b'0' COMMENT '是否允许助理调用技能',
    execution_mode ENUM('direct', 'llm', 'hybrid') DEFAULT 'llm' COMMENT '执行模式',
    is_active BIT(1) DEFAULT b'1' COMMENT '是否启用',
    is_builtin BIT(1) DEFAULT b'0' COMMENT '是否为内置助理（不可删除）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_assistant_active (is_active),
    INDEX idx_assistant_mode (execution_mode)
  ) COMMENT='助理配置表'`,

  // 27. Assistant_Requests 表
  `CREATE TABLE IF NOT EXISTS assistant_requests (
    request_id VARCHAR(64) PRIMARY KEY,
    assistant_type VARCHAR(32) NOT NULL,
    expert_id VARCHAR(32) COMMENT '调用专家ID',
    contact_id VARCHAR(64) COMMENT '联系人ID',
    user_id VARCHAR(32) COMMENT '用户ID',
    topic_id VARCHAR(32) COMMENT '话题ID',
    status ENUM('pending', 'running', 'completed', 'failed', 'timeout', 'cancelled') DEFAULT 'pending',
    input JSON NOT NULL COMMENT '输入参数',
    result LONGTEXT COMMENT '执行结果',
    error_message TEXT COMMENT '错误信息',
    tokens_input INT DEFAULT 0 COMMENT '输入 Token 数',
    tokens_output INT DEFAULT 0 COMMENT '输出 Token 数',
    model_used VARCHAR(128) COMMENT '实际使用的模型',
    latency_ms INT DEFAULT 0 COMMENT '执行耗时（毫秒）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME COMMENT '开始执行时间',
    completed_at DATETIME COMMENT '完成时间',
    is_archived BIT(1) DEFAULT b'0' COMMENT '是否已归档',
    INDEX idx_request_expert (expert_id),
    INDEX idx_request_user (user_id),
    INDEX idx_request_status (status),
    INDEX idx_request_created (created_at)
  ) COMMENT='助理委托记录表'`,

  // 28. Assistant_Messages 表
  `CREATE TABLE IF NOT EXISTS assistant_messages (
    id BIGINT NOT NULL AUTO_INCREMENT,
    request_id VARCHAR(64) NOT NULL COMMENT '关联 assistant_requests.request_id',
    parent_message_id VARCHAR(64) DEFAULT NULL COMMENT '父消息 ID，用于树状结构',
    role ENUM('expert', 'assistant', 'tool', 'system') NOT NULL COMMENT '消息角色',
    message_type ENUM(
      'task', 'context', 'assistant_response', 'tool_call', 'tool_result',
      'final', 'error', 'retry', 'status', 'note'
    ) NOT NULL COMMENT '消息类型',
    content LONGTEXT DEFAULT NULL COMMENT '文本内容',
    content_preview VARCHAR(512) DEFAULT NULL COMMENT '摘要，用于列表展示',
    tool_name VARCHAR(128) DEFAULT NULL COMMENT '工具名称',
    tool_call_id VARCHAR(64) DEFAULT NULL COMMENT '工具调用链路 ID',
    status ENUM('pending', 'running', 'completed', 'failed', 'skipped') DEFAULT NULL COMMENT '消息状态',
    sequence_no INT NOT NULL COMMENT '同一 request 内顺序号',
    metadata JSON DEFAULT NULL COMMENT '扩展字段',
    tokens_input INT DEFAULT NULL COMMENT '本条消息相关输入 token',
    tokens_output INT DEFAULT NULL COMMENT '本条消息相关输出 token',
    latency_ms INT DEFAULT NULL COMMENT '本步骤耗时',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (id),
    KEY idx_request_id (request_id),
    KEY idx_request_seq (request_id, sequence_no),
    KEY idx_tool_call_id (tool_call_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='助理内部消息表'`,

  // ==================== 组织架构表 ====================
  
  // 29. Departments 表
  `CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT '部门名称',
    parent_id VARCHAR(20) NULL COMMENT '父部门ID',
    path VARCHAR(255) NULL COMMENT '层级路径，如 /1/2/3',
    level INT DEFAULT 1 COMMENT '层级深度(1-4)',
    sort_order INT DEFAULT 0 COMMENT '同级排序',
    description TEXT NULL COMMENT '部门描述',
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_parent (parent_id),
    INDEX idx_path (path),
    INDEX idx_status (status),
    UNIQUE INDEX uk_path (path)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表'`,

  // 30. Positions 表
  `CREATE TABLE IF NOT EXISTS positions (
    id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL COMMENT '职位名称',
    department_id VARCHAR(20) NOT NULL COMMENT '所属部门',
    is_manager BIT(1) DEFAULT b'0' COMMENT '是否为负责人职位',
    sort_order INT DEFAULT 0 COMMENT '排序',
    description TEXT NULL COMMENT '职位描述',
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_department (department_id),
    INDEX idx_status (status),
    CONSTRAINT fk_position_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='职位表'`,

  // ==================== 解决方案模块 ====================
  
  // 31. Solutions 表
  `CREATE TABLE IF NOT EXISTS solutions (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(200) NOT NULL COMMENT '解决方案名称',
    slug VARCHAR(100) UNIQUE COMMENT 'URL友好标识',
    description TEXT COMMENT '简要描述（适用场景）',
    guide LONGTEXT COMMENT '执行指南（Markdown）',
    tags LONGTEXT COMMENT '标签数组（JSON格式）',
    is_active BIT(1) DEFAULT b'1' COMMENT '是否启用',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_slug (slug),
    INDEX idx_active (is_active)
  ) COMMENT='解决方案表'`,

  // ==================== 任务预览 Token 表 ====================
  
  // 32. Task_Token 表
  `CREATE TABLE IF NOT EXISTS task_token (
    id INT PRIMARY KEY AUTO_INCREMENT,
    token VARCHAR(64) NOT NULL UNIQUE COMMENT 'Token字符串(随机生成，非JWT)',
    task_id VARCHAR(32) NOT NULL COMMENT '关联的任务ID',
    user_id VARCHAR(32) NOT NULL COMMENT '创建Token的用户ID',
    expires_at DATETIME NOT NULL COMMENT '过期时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token (token),
    INDEX idx_task_user (task_id, user_id),
    INDEX idx_expires_at (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务预览Token表'`,

  // 33. Task_Token_Access_Log 表
  `CREATE TABLE IF NOT EXISTS task_token_access_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    token_id INT NOT NULL COMMENT '关联的Token ID',
    file_path VARCHAR(512) NOT NULL COMMENT '访问的文件路径',
    ip_address VARCHAR(45) NOT NULL COMMENT '访问者IP地址',
    user_agent VARCHAR(512) COMMENT '浏览器User-Agent',
    accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_token_id (token_id),
    INDEX idx_accessed_at (accessed_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Token访问日志表'`,

  // ==================== 邀请注册系统 ====================
  
  // 34. Invitations 表
  `CREATE TABLE IF NOT EXISTS invitations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(32) NOT NULL UNIQUE COMMENT '邀请码',
    creator_id VARCHAR(32) NOT NULL COMMENT '创建者用户ID',
    max_uses INT DEFAULT 5 COMMENT '最大使用次数',
    used_count INT DEFAULT 0 COMMENT '已使用次数',
    expires_at DATETIME DEFAULT NULL COMMENT '过期时间，NULL表示永不过期',
    status ENUM('active', 'exhausted', 'expired', 'revoked') DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_creator (creator_id),
    INDEX idx_status (status),
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请码表'`,

  // 35. Invitation_Usages 表
  `CREATE TABLE IF NOT EXISTS invitation_usages (
    id INT PRIMARY KEY AUTO_INCREMENT,
    invitation_id INT NOT NULL COMMENT '邀请ID',
    user_id VARCHAR(32) NOT NULL COMMENT '注册用户ID',
    used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (invitation_id) REFERENCES invitations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_invitation (invitation_id),
    INDEX idx_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请使用记录表'`,

  // ==================== 用户技能参数表 ====================
  
  // 36. User_Skill_Parameters 表
  `CREATE TABLE IF NOT EXISTS user_skill_parameters (
    id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL COMMENT '用户ID',
    skill_id VARCHAR(64) NOT NULL COMMENT '技能ID',
    param_name VARCHAR(100) NOT NULL COMMENT '参数名',
    param_value TEXT COMMENT '参数值',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_skill_param (user_id, skill_id, param_name),
    INDEX idx_user_id (user_id),
    INDEX idx_skill_id (skill_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
  ) COMMENT='用户技能参数表（只存储用户覆盖的参数）'`,
];

// 初始数据
async function getInitialData() {
  // 创建默认密码哈希
  const defaultPassword = await bcrypt.hash('password123', 10);

  // 生成Provider ID（使用newID）
  const providerIds = {
    openai: Utils.newID(20),
    deepseek: Utils.newID(20),
    ollama: Utils.newID(20),
  };

  // 生成模型ID（使用newID）
  const modelIds = {
    deepseekChat: Utils.newID(20),
    deepseekReasoner: Utils.newID(20),
    gpt4: Utils.newID(20),
    gpt35: Utils.newID(20),
    llama3: Utils.newID(20),
  };

  // 生成角色ID（使用newID）
  const roleIds = {
    admin: Utils.newID(20),
    creator: Utils.newID(20),
    user: Utils.newID(20),
  };

  return {
    providers: [
      { id: providerIds.openai, name: 'OpenAI', base_url: 'https://api.openai.com/v1', api_key: '' },
      { id: providerIds.deepseek, name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', api_key: '' },
      { id: providerIds.ollama, name: 'Ollama Local', base_url: 'http://localhost:11434/v1', api_key: 'ollama' },
    ],
    models: [
      { id: modelIds.deepseekChat, name: 'DeepSeek Chat', model_name: 'deepseek-chat', provider_id: providerIds.deepseek, max_tokens: 4096, cost_per_1k_input: 0.001, cost_per_1k_output: 0.002 },
      { id: modelIds.deepseekReasoner, name: 'DeepSeek Reasoner', model_name: 'deepseek-reasoner', provider_id: providerIds.deepseek, max_tokens: 8192, cost_per_1k_input: 0.002, cost_per_1k_output: 0.004 },
      { id: modelIds.gpt4, name: 'GPT-4 Turbo', model_name: 'gpt-4-turbo', provider_id: providerIds.openai, max_tokens: 4096, cost_per_1k_input: 0.01, cost_per_1k_output: 0.03 },
      { id: modelIds.gpt35, name: 'GPT-3.5 Turbo', model_name: 'gpt-3.5-turbo', provider_id: providerIds.openai, max_tokens: 4096, cost_per_1k_input: 0.0015, cost_per_1k_output: 0.002 },
      { id: modelIds.llama3, name: 'Llama 3.1', model_name: 'llama3.1', provider_id: providerIds.ollama, max_tokens: 4096, cost_per_1k_input: 0, cost_per_1k_output: 0 },
    ],
    users: [
      { id: Utils.newID(20), username: 'admin', email: 'admin@example.com', password_hash: defaultPassword, nickname: '管理员' },
      { id: Utils.newID(20), username: 'test', email: 'test@example.com', password_hash: defaultPassword, nickname: '测试用户' },
    ],
    roles: [
      { id: roleIds.admin, mark: 'admin', name: '平台管理员', description: '拥有所有权限', level: 'admin', is_system: true },
      { id: roleIds.creator, mark: 'creator', name: '专家创作者', description: '可以创建和管理自己的专家', level: 'power_user', is_system: true },
      { id: roleIds.user, mark: 'user', name: '普通用户', description: '可以使用聊天功能', level: 'user', is_system: true },
    ],
    roleIds: roleIds,
  };
}

async function initDatabase() {
  let connection;

  try {
    // 先连接不指定数据库，创建数据库
    connection = await mysql.createConnection({
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
    });

    console.log('Creating database...');
    await connection.execute(
      `CREATE DATABASE IF NOT EXISTS ${DB_CONFIG.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.end();

    // 重新连接指定数据库
    connection = await mysql.createConnection({
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
      database: DB_CONFIG.database,
    });

    console.log('Dropping existing tables...');
    // 按依赖顺序删除表（先删除有外键的表）
    const dropTables = [
      // 新知识库表
      'kb_article_tags', 'kb_tags', 'kb_paragraphs', 'kb_sections', 'kb_articles',
      // 邀请系统
      'invitation_usages', 'invitations',
      // 任务 Token
      'task_token_access_log', 'task_token',
      // 解决方案
      'solutions',
      // 用户技能参数
      'user_skill_parameters',
      // 助理系统
      'assistant_messages', 'assistant_requests', 'assistants',
      // 组织架构
      'positions', 'departments',
      // 旧知识库表
      'knowledge_relations', 'knowledge_points', 'knowledges', 'knowledge_bases',
      // 核心业务表
      'messages', 'topics', 'tasks', 'user_profiles', 'user_roles', 'role_permissions', 'role_experts',
      'permissions', 'roles', 'users', 'expert_skills', 'skill_parameters', 'skill_tools', 'skills', 'experts',
      'ai_models', 'providers',
      // 系统设置
      'system_settings'
    ];
    for (const table of dropTables) {
      await connection.execute(`DROP TABLE IF EXISTS ${table}`);
    }

    console.log('Creating tables...');
    for (const sql of TABLES) {
      await connection.execute(sql);
    }

    console.log('Inserting initial data...');
    const data = await getInitialData();

    // 插入 providers
    for (const p of data.providers) {
      await connection.execute(
        `INSERT INTO providers (id, name, base_url, api_key) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE base_url=VALUES(base_url), api_key=VALUES(api_key)`,
        [p.id, p.name, p.base_url, p.api_key]
      );
    }
    console.log(`  - ${data.providers.length} providers`);

    // 插入 models
    for (const m of data.models) {
      await connection.execute(
        `INSERT INTO ai_models (id, name, model_name, provider_id, max_tokens, cost_per_1k_input, cost_per_1k_output)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
         name=VALUES(name), model_name=VALUES(model_name), max_tokens=VALUES(max_tokens),
         cost_per_1k_input=VALUES(cost_per_1k_input), cost_per_1k_output=VALUES(cost_per_1k_output)`,
        [m.id, m.name, m.model_name, m.provider_id, m.max_tokens, m.cost_per_1k_input, m.cost_per_1k_output]
      );
    }
    console.log(`  - ${data.models.length} models`);

    // 插入 users
    for (const u of data.users) {
      await connection.execute(
        `INSERT INTO users (id, username, email, password_hash, nickname, status)
         VALUES (?, ?, ?, ?, ?, 'active')
         ON DUPLICATE KEY UPDATE username=VALUES(username), email=VALUES(email), nickname=VALUES(nickname)`,
        [u.id, u.username, u.email, u.password_hash, u.nickname]
      );
    }
    console.log(`  - ${data.users.length} users (default password: password123)`);

    // 技能数据通过 init-skills-from-json.js 导入
    console.log('  - 技能数据请运行 init-skills-from-json.js 导入');

    // 插入 roles（使用新字段名）
    for (const r of data.roles) {
      await connection.execute(
        `INSERT INTO roles (id, mark, name, description, level, is_system) VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mark=VALUES(mark), name=VALUES(name)`,
        [r.id, r.mark, r.name, r.description, r.level, r.is_system]
      );
    }
    console.log('  - 3 roles (admin, creator, user)');

    // 插入 permissions（菜单权限）
    const menuPermissions = [
      { code: 'menu:chat', name: '聊天', route_path: '/chat', component: 'ChatView.vue', icon: 'MessageOutlined', order: 1 },
      { code: 'menu:topics', name: '话题管理', route_path: '/topics', component: 'TopicsView.vue', icon: 'FolderOutlined', order: 2 },
      { code: 'menu:studio', name: '专家工作室', route_path: '/studio', component: 'StudioView.vue', icon: 'EditOutlined', order: 10 },
      { code: 'menu:studio:experts', name: '我的专家', route_path: '/studio/experts', component: 'StudioExperts.vue', icon: null, order: 11 },
      { code: 'menu:studio:models', name: '模型配置', route_path: '/studio/models', component: 'StudioModels.vue', icon: null, order: 12 },
      { code: 'menu:studio:skills', name: '技能管理', route_path: '/studio/skills', component: 'StudioSkills.vue', icon: null, order: 13 },
      { code: 'menu:admin', name: '管理后台', route_path: '/admin', component: 'AdminView.vue', icon: 'SettingOutlined', order: 20 },
      { code: 'menu:admin:users', name: '用户管理', route_path: '/admin/users', component: 'AdminUsers.vue', icon: null, order: 21 },
      { code: 'menu:admin:roles', name: '角色权限', route_path: '/admin/roles', component: 'AdminRoles.vue', icon: null, order: 22 },
      { code: 'menu:admin:providers', name: '服务提供商', route_path: '/admin/providers', component: 'AdminProviders.vue', icon: null, order: 23 },
      { code: 'menu:admin:system', name: '系统设置', route_path: '/admin/system', component: 'AdminSystem.vue', icon: null, order: 24 },
    ];

    for (const p of menuPermissions) {
      await connection.execute(
        `INSERT INTO permissions (id, code, name, type, route_path, route_component, route_icon, sort_order)
         VALUES (?, ?, ?, 'menu', ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), route_path=VALUES(route_path)`,
        [Utils.newID(20), p.code, p.name, p.route_path, p.component, p.icon, p.order]
      );
    }

    // 插入 API 权限
    const apiPermissions = [
      'api:user:read', 'api:user:update', 'api:user:delete',
      'api:expert:create', 'api:expert:read', 'api:expert:update', 'api:expert:delete',
      'api:topic:create', 'api:topic:read', 'api:topic:update', 'api:topic:delete',
      'api:message:create', 'api:message:read', 'api:message:delete',
      'api:model:create', 'api:model:read', 'api:model:update', 'api:model:delete',
      'api:admin:access'
    ];

    for (const code of apiPermissions) {
      const name = code.replace(/:/g, '_').toUpperCase();
      await connection.execute(
        `INSERT INTO permissions (id, code, name, type) VALUES (?, ?, ?, 'api')
         ON DUPLICATE KEY UPDATE name=VALUES(name)`,
        [Utils.newID(20), code, name]
      );
    }
    console.log('  - permissions (menus & apis)');

    // 为角色分配权限
    const { roleIds } = data;

    // admin: 所有权限
    await connection.execute(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions
       ON DUPLICATE KEY UPDATE role_id=role_id`,
      [roleIds.admin]
    );

    // creator: 用户端 + 工作室权限
    const creatorPermissions = [
      'menu:chat', 'menu:topics', 'menu:studio', 'menu:studio:experts',
      'menu:studio:models', 'menu:studio:skills',
      'api:user:read', 'api:user:update',
      'api:expert:create', 'api:expert:read', 'api:expert:update', 'api:expert:delete',
      'api:topic:create', 'api:topic:read', 'api:topic:update', 'api:topic:delete',
      'api:message:create', 'api:message:read',
      'api:model:read'
    ];
    for (const code of creatorPermissions) {
      await connection.execute(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES (?, (SELECT id FROM permissions WHERE code = ?))
         ON DUPLICATE KEY UPDATE role_id=role_id`,
        [roleIds.creator, code]
      );
    }

    // user: 仅用户端权限
    const userPermissions = [
      'menu:chat', 'menu:topics',
      'api:user:read', 'api:user:update',
      'api:expert:read',
      'api:topic:create', 'api:topic:read', 'api:topic:update', 'api:topic:delete',
      'api:message:create', 'api:message:read'
    ];
    for (const code of userPermissions) {
      await connection.execute(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES (?, (SELECT id FROM permissions WHERE code = ?))
         ON DUPLICATE KEY UPDATE role_id=role_id`,
        [roleIds.user, code]
      );
    }
    console.log('  - role_permissions assigned');

    // 为测试用户分配角色
    const adminUserId = data.users[0].id;
    const testUserId = data.users[1].id;
    await connection.execute(
      `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?), (?, ?)
       ON DUPLICATE KEY UPDATE user_id=user_id`,
      [adminUserId, roleIds.admin, testUserId, roleIds.user]
    );
    console.log('  - user_roles assigned');

    // 插入系统默认配置
    const defaultSettings = [
      { key: 'llm.context_threshold', value: '0.70', type: 'number', desc: '上下文压缩阈值' },
      { key: 'llm.temperature', value: '0.70', type: 'number', desc: '表达温度默认值' },
      { key: 'llm.reflective_temperature', value: '0.30', type: 'number', desc: '反思温度默认值' },
      { key: 'llm.top_p', value: '1.0', type: 'number', desc: 'Top-p 采样默认值' },
      { key: 'llm.frequency_penalty', value: '0.0', type: 'number', desc: '频率惩罚默认值' },
      { key: 'llm.presence_penalty', value: '0.0', type: 'number', desc: '存在惩罚默认值' },
      { key: 'llm.max_tokens', value: '4096', type: 'number', desc: '最大 Token 默认值' },
      { key: 'connection.max_per_user', value: '5', type: 'number', desc: '每用户最大 SSE 连接数' },
      { key: 'connection.max_per_expert', value: '100', type: 'number', desc: '每 Expert 最大 SSE 连接数' },
      { key: 'token.access_expiry', value: '15m', type: 'string', desc: 'Access Token 过期时间' },
      { key: 'token.refresh_expiry', value: '7d', type: 'string', desc: 'Refresh Token 过期时间' },
      { key: 'pagination.default_size', value: '20', type: 'number', desc: '默认分页大小' },
      { key: 'pagination.max_size', value: '100', type: 'number', desc: '最大分页大小' },
      { key: 'registration.allow_self_registration', value: 'false', type: 'boolean', desc: '是否允许自主注册（无需邀请码）' },
      { key: 'registration.default_invitation_quota', value: '1', type: 'number', desc: '用户默认可生成的邀请码数量' },
      { key: 'registration.default_invitation_max_uses', value: '5', type: 'number', desc: '每个邀请码默认可邀请人数' },
      { key: 'registration.invitation_expiry_days', value: '0', type: 'number', desc: '邀请码默认有效天数（0=永久）' },
    ];
    
    for (const setting of defaultSettings) {
      await connection.execute(
        `INSERT INTO system_settings (setting_key, setting_value, value_type, description)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
        [setting.key, setting.value, setting.type, setting.desc]
      );
    }
    console.log('  - system_settings initialized');

    console.log('\n✅ Database initialization completed successfully!');
    console.log(`\nTest accounts:`);
    console.log(`  Admin:    admin / admin@example.com / password123`);
    console.log(`  User:     test / test@example.com / password123`);

  } catch (error) {
    console.error('❌ Initialization failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 检查必需的环境变量
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

initDatabase();
