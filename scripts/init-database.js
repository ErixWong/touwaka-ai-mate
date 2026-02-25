/**
 * Database Initialization Script
 * 使用 newID() 生成随机 ID 初始化数据库
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

// 表结构定�?
const TABLES = [
  // 1. Providers �?
  // timeout 字段单位为毫秒，默认 60 �?= 60000 毫秒
  `CREATE TABLE IF NOT EXISTS providers (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    base_url VARCHAR(512) NOT NULL,
    api_key VARCHAR(512),
    timeout INT DEFAULT 60000 COMMENT '请求超时时间（毫秒）',
    is_active BIT(1) DEFAULT b'1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // 2. AI Models 表（用于前端模型管理�?
  `CREATE TABLE IF NOT EXISTS ai_models (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    model_name VARCHAR(128) NOT NULL COMMENT 'API调用使用的模型标识符',
    provider_id VARCHAR(32),
    max_tokens INT DEFAULT 4096,
    cost_per_1k_input DECIMAL(10, 6) DEFAULT 0,
    cost_per_1k_output DECIMAL(10, 6) DEFAULT 0,
    description TEXT,
    is_active BIT(1) DEFAULT b'1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL,
    INDEX idx_provider (provider_id),
    INDEX idx_active (is_active)
  )`,

  // 3. Experts �?
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
    avatar_base64 TEXT COMMENT '小头像Base64（日常使用）',
    avatar_large_base64 MEDIUMTEXT COMMENT '大头像Base64（对话框背景�?,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (expressive_model_id) REFERENCES ai_models(id) ON DELETE SET NULL,
    FOREIGN KEY (reflective_model_id) REFERENCES ai_models(id) ON DELETE SET NULL,
    INDEX idx_active (is_active)
  )`,

  // 4. Skills �?
  // 注：index_js �?config 字段已移�?
  // - 代码通过 source_path 从文件系统加�?
  // - 配置通过 skill_parameters 表管�?
  // 扩展字段：license, argument_hint, disable_model_invocation, user_invocable, allowed_tools
  `CREATE TABLE IF NOT EXISTS skills (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    version VARCHAR(32),
    author VARCHAR(128),
    tags JSON,
    source_type ENUM('url', 'zip', 'local') DEFAULT 'local',
    source_path VARCHAR(512),
    source_url VARCHAR(512),
    skill_md TEXT,
    security_score INT DEFAULT 100,
    security_warnings JSON,
    license TEXT COMMENT '许可证信�?,
    argument_hint VARCHAR(128) DEFAULT '' COMMENT '参数提示',
    disable_model_invocation BIT(1) DEFAULT b'0' COMMENT '禁用模型调用',
    user_invocable BIT(1) DEFAULT b'1' COMMENT '用户可调�?,
    allowed_tools TEXT COMMENT '允许的工具列表（JSON数组�?,
    is_active BIT(1) DEFAULT b'1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,

  // 4.1 Skill_Tools 表（技能工具清单）
  // 注：type, command, endpoint, method 字段已移�?
  // - 工具通过 index.js �?execute() 函数执行
  `CREATE TABLE IF NOT EXISTS skill_tools (
    id VARCHAR(32) PRIMARY KEY,
    skill_id VARCHAR(64) NOT NULL,
    name VARCHAR(64) NOT NULL,
    description TEXT,
    \`parameters\` TEXT COMMENT 'JSON Schema 格式的参数定义',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY idx_skill_name (skill_id, name),
    INDEX idx_skill_id (skill_id)
  )`,

  // 5. Expert_Skills �?
  `CREATE TABLE IF NOT EXISTS expert_skills (
    id VARCHAR(32) PRIMARY KEY,
    expert_id VARCHAR(32) NOT NULL,
    skill_id VARCHAR(32) NOT NULL,
    is_enabled BIT(1) DEFAULT b'1',
    config JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
    UNIQUE KEY uk_expert_skill (expert_id, skill_id)
  )`,

  // 6. Users 表（用户固有属性，全局一致）
  `CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(32) PRIMARY KEY,
    username VARCHAR(32) UNIQUE,
    email VARCHAR(256) UNIQUE,
    password_hash VARCHAR(256),
    nickname VARCHAR(128),
    avatar VARCHAR(512),
    gender VARCHAR(16) COMMENT '性别：male/female/other',
    birthday DATE COMMENT '生日',
    occupation VARCHAR(128) COMMENT '职业',
    location VARCHAR(128) COMMENT '所在地',
    status ENUM('active', 'inactive', 'banned') DEFAULT 'active',
    preferences JSON,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_status (status)
  )`,

  // 7. User_Profiles 表（用户画像：专家对用户的认知）
  `CREATE TABLE IF NOT EXISTS user_profiles (
    id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL,
    expert_id VARCHAR(32) NOT NULL,
    preferred_name VARCHAR(128) COMMENT '用户希望被称呼的名字',
    introduction TEXT COMMENT '用户自我介绍',
    background TEXT COMMENT '背景画像（LLM总结生成�?,
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

  // 8. Topics 表（更新：添�?provider_name, model_name, status 等字段）
  `CREATE TABLE IF NOT EXISTS topics (
    id VARCHAR(32) PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL,
    expert_id VARCHAR(32),
    provider_name VARCHAR(128),
    model_name VARCHAR(128),
    title VARCHAR(256) NOT NULL,
    description TEXT,
    category VARCHAR(128),
    status ENUM('active', 'archived', 'deleted') DEFAULT 'active',
    message_count INT DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (expert_id) REFERENCES experts(id) ON DELETE SET NULL,
    INDEX idx_user_status (user_id, status),
    INDEX idx_expert (expert_id),
    INDEX idx_updated (updated_at)
  )`,

  // 9. Messages 表（更新：添�?user_id, expert_id 字段�?
  `CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(32) PRIMARY KEY,
    topic_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL COMMENT '消息所属用户ID，便于直接查�?,
    expert_id VARCHAR(32) COMMENT '专家ID，便于直接查�?,
    role ENUM('system', 'user', 'assistant') NOT NULL,
    content TEXT NOT NULL,
    content_type ENUM('text', 'image', 'file') DEFAULT 'text',
    prompt_tokens INT DEFAULT 0 COMMENT '输入 token 数量',
    completion_tokens INT DEFAULT 0 COMMENT '输出 token 数量',
    cost DECIMAL(10, 6) DEFAULT 0,
    latency_ms INT DEFAULT 0,
    provider_name VARCHAR(128),
    model_name VARCHAR(128),
    inner_voice JSON,
    tool_calls JSON,
    error_info JSON,
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

  // 10. Roles 表（RBAC权限系统�?
  `CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL COMMENT '角色标识：admin/creator/user',
    label VARCHAR(100) NOT NULL COMMENT '角色显示名称',
    description TEXT COMMENT '角色描述',
    is_system BIT(1) DEFAULT b'0' COMMENT '系统角色，不可删�?,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name)
  )`,

  // 11. Permissions 表（权限定义，含菜单路由配置�?
  `CREATE TABLE IF NOT EXISTS permissions (
    id VARCHAR(32) PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL COMMENT '权限码：user:create, expert:edit�?,
    name VARCHAR(100) NOT NULL COMMENT '权限名称',
    type ENUM('menu', 'button', 'api') DEFAULT 'api' COMMENT '权限类型',
    parent_id VARCHAR(32) DEFAULT NULL COMMENT '父权限ID，用于菜单层�?,
    route_path VARCHAR(255) COMMENT 'Vue路由路径，菜单权限用',
    route_component VARCHAR(255) COMMENT 'Vue组件路径',
    route_icon VARCHAR(100) COMMENT '菜单图标',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES permissions(id) ON DELETE SET NULL,
    INDEX idx_code (code),
    INDEX idx_type (type)
  )`,

  // 12. Role_Permissions 表（角色-权限关联�?
  `CREATE TABLE IF NOT EXISTS role_permissions (
    role_id VARCHAR(32) NOT NULL,
    permission_id VARCHAR(32) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
  )`,

  // 13. User_Roles 表（用户-角色关联，支持多角色�?
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id VARCHAR(32) NOT NULL,
    role_id VARCHAR(32) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, role_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
  )`,
];

// 初始数据
async function getInitialData() {
  const expertId = Utils.newID(20);

  // 创建默认密码哈希
  const defaultPassword = await bcrypt.hash('password123', 10);

  // 生成Provider ID（使用newID�?
  const providerIds = {
    openai: Utils.newID(20),
    deepseek: Utils.newID(20),
    ollama: Utils.newID(20),
  };

  // 生成模型ID（使用newID�?
  const modelIds = {
    deepseekChat: Utils.newID(20),
    deepseekReasoner: Utils.newID(20),
    gpt4: Utils.newID(20),
    gpt35: Utils.newID(20),
    llama3: Utils.newID(20),
  };

  // 生成角色ID（使用newID�?
  const roleIds = {
    admin: Utils.newID(20),
    creator: Utils.newID(20),
    user: Utils.newID(20),
  };

  return {
    providers: [
      { id: providerIds.openai, name: 'OpenAI', base_url: 'https://api.openai.com/v1', api_key: process.env.OPENAI_API_KEY || '' },
      { id: providerIds.deepseek, name: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', api_key: process.env.DEEPSEEK_API_KEY || '' },
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
      { id: Utils.newID(20), username: 'admin', email: 'admin@example.com', password_hash: defaultPassword, nickname: '管理�? },
      { id: Utils.newID(20), username: 'test', email: 'test@example.com', password_hash: defaultPassword, nickname: '测试用户' },
    ],
    expert: {
      id: expertId,
      name: 'Eric',
      introduction: '34岁，程序员，来自镇江，现在在上海B站工作。正在参加相亲�?,
      speaking_style: '用程序员的方式表达，保持自信但不自负，偶尔说一些镇江话',
      core_values: '真诚待人，不欺骗\n尊重对方的选择和边界\n保持适度的幽默感',
      behavioral_guidelines: '先倾听再回应\n保持礼貌和尊重\n展现真实的自�?,
      taboos: '不尊重对方\n强迫对方做不愿意的事\n说谎或欺�?,
      emotional_tone: '温和、自信、幽�?,
      expressive_model_id: modelIds.deepseekChat,
      reflective_model_id: modelIds.gpt35,
      prompt_template: '你是一�?4岁的程序员，来自镇江，现在在上海工作。请用温和、自信、幽默的语气回答用户的问题�?,
    },
    skills: [
      {
        id: Utils.newID(20),
        name: '搜索',
        description: '搜索互联网获取信�?,
        version: '1.0.0',
        author: 'System',
        source_type: 'local',
        skill_md: '# Search Skill\n\n## 描述\n搜索互联网获取信�?..',
      },
      {
        id: Utils.newID(20),
        name: '天气',
        description: '查询天气信息',
        version: '1.0.0',
        author: 'System',
        source_type: 'local',
        skill_md: '# Weather Skill\n\n## 描述\n查询指定城市的天气信�?..',
      },
    ],
    roles: [
      { id: roleIds.admin, name: 'admin', label: '平台管理�?, description: '拥有所有权�?, is_system: true },
      { id: roleIds.creator, name: 'creator', label: '专家创作�?, description: '可以创建和管理自己的专家', is_system: true },
      { id: roleIds.user, name: 'user', label: '普通用�?, description: '可以使用聊天功能', is_system: true },
    ],
    roleIds: roleIds,
  };
}

async function initDatabase() {
  let connection;

  try {
    // 先连接不指定数据库，创建数据�?
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

    // 重新连接指定数据�?
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
      'messages', 'topics', 'user_profiles', 'user_roles', 'role_permissions',
      'permissions', 'roles', 'users', 'expert_skills', 'skill_tools', 'skills', 'experts',
      'ai_models', 'providers'
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

    // 插入 expert
    await connection.execute(
      `INSERT INTO experts (id, name, introduction, speaking_style, core_values, behavioral_guidelines, taboos, emotional_tone, expressive_model_id, reflective_model_id, prompt_template)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name=VALUES(name)`,
      [data.expert.id, data.expert.name, data.expert.introduction, data.expert.speaking_style,
       data.expert.core_values, data.expert.behavioral_guidelines, data.expert.taboos,
       data.expert.emotional_tone, data.expert.expressive_model_id, data.expert.reflective_model_id, data.expert.prompt_template]
    );
    console.log(`  - 1 expert: ${data.expert.name} (ID: ${data.expert.id})`);

    // 插入 skills
    for (const s of data.skills) {
      await connection.execute(
        `INSERT INTO skills (id, name, description, version, author, source_type, skill_md) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name)`,
        [s.id, s.name, s.description, s.version, s.author, s.source_type, s.skill_md]
      );
    }
    console.log(`  - ${data.skills.length} skills`);

    // 插入 roles
    for (const r of data.roles) {
      await connection.execute(
        `INSERT INTO roles (id, name, label, description, is_system) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), label=VALUES(label)`,
        [r.id, r.name, r.label, r.description, r.is_system]
      );
    }
    console.log('  - 3 roles (admin, creator, user)');

    // 插入 permissions（菜单权限）
    const menuPermissions = [
      { code: 'menu:chat', name: '聊天', route_path: '/chat', component: 'ChatView.vue', icon: 'MessageOutlined', order: 1 },
      { code: 'menu:topics', name: '话题管理', route_path: '/topics', component: 'TopicsView.vue', icon: 'FolderOutlined', order: 2 },
      { code: 'menu:studio', name: '专家工作�?, route_path: '/studio', component: 'StudioView.vue', icon: 'EditOutlined', order: 10 },
      { code: 'menu:studio:experts', name: '我的专家', route_path: '/studio/experts', component: 'StudioExperts.vue', icon: null, order: 11 },
      { code: 'menu:studio:models', name: '模型配置', route_path: '/studio/models', component: 'StudioModels.vue', icon: null, order: 12 },
      { code: 'menu:studio:skills', name: '技能管�?, route_path: '/studio/skills', component: 'StudioSkills.vue', icon: null, order: 13 },
      { code: 'menu:admin', name: '管理后台', route_path: '/admin', component: 'AdminView.vue', icon: 'SettingOutlined', order: 20 },
      { code: 'menu:admin:users', name: '用户管理', route_path: '/admin/users', component: 'AdminUsers.vue', icon: null, order: 21 },
      { code: 'menu:admin:roles', name: '角色权限', route_path: '/admin/roles', component: 'AdminRoles.vue', icon: null, order: 22 },
      { code: 'menu:admin:providers', name: '服务提供�?, route_path: '/admin/providers', component: 'AdminProviders.vue', icon: null, order: 23 },
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

    // 为角色分配权�?
    const { roleIds } = data;

    // admin: 所有权�?
    await connection.execute(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions
       ON DUPLICATE KEY UPDATE role_id=role_id`,
      [roleIds.admin]
    );

    // creator: 用户�?+ 工作室权�?
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

    // 为测试用户分配角�?
    const adminUserId = data.users[0].id;
    const testUserId = data.users[1].id;
    await connection.execute(
      `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?), (?, ?)
       ON DUPLICATE KEY UPDATE user_id=user_id`,
      [adminUserId, roleIds.admin, testUserId, roleIds.user]
    );
    console.log('  - user_roles assigned');

    console.log('\n�?Database initialization completed successfully!');
    console.log(`\nTest accounts:`);
    console.log(`  Admin:    admin / admin@example.com / password123`);
    console.log(`  User:     test / test@example.com / password123`);
    console.log(`\nExpert ID: ${data.expert.id}`);

  } catch (error) {
    console.error('�?Initialization failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

// 检查必需的环境变�?
if (!DB_CONFIG.user || !DB_CONFIG.password || !DB_CONFIG.database) {
  console.error('Error: DB_USER, DB_PASSWORD, DB_NAME environment variables are required');
  process.exit(1);
}

initDatabase();
