/**
 * 使用 sequelize-auto 从数据库生成 Sequelize 模型
 * 
 * 运行前确保：
 * 1. 数据库已创建并运行
 * 2. .env 文件已配置正确的数据库连接信息
 * 
 * 运行: node scripts/generate-models.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import SequelizeAuto from 'sequelize-auto';
import dotenv from 'dotenv';

// 显式指定 .env 文件路径（项目根目录）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// 数据库配置
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  dialect: 'mysql',
  // 可选：指定要生成的表，null 表示全部
  tables: null,
};

// 验证必需的环境变量
if (!dbConfig.database || !dbConfig.user || !dbConfig.password) {
  console.error('❌ Error: DB_NAME, DB_USER, and DB_PASSWORD are required in .env file');
  process.exit(1);
}

// 输出目录（直接生成到 models/ 目录）
const outputDir = path.join(__dirname, '..', 'models');

// 确保输出目录存在
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log('🔄 Generating Sequelize models from database...');
console.log(`   Database: ${dbConfig.database}`);
console.log(`   Host: ${dbConfig.host}:${dbConfig.port}`);
console.log(`   Output: ${outputDir}`);
console.log('');

// 创建 SequelizeAuto 实例
const auto = new SequelizeAuto(
  dbConfig.database,
  dbConfig.user,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    directory: outputDir,
    caseFile: 'pascal',         // 文件名使用 PascalCase（与表名一致）
    caseModel: 'pascal',        // 模型名使用 PascalCase
    caseProp: 'camel',          // 属性名使用 camelCase
    singularize: true,          // 模型名单数化
    lang: 'esm',                // 使用 ES Module 语法
    tables: dbConfig.tables,    // 指定表，null 表示全部
    additional: {
      timestamps: false,        // 表中没有统一的时间戳字段
      freezeTableName: true,    // 保持表名不变
    },
  }
);

// 运行生成
auto.run()
  .then((data) => {
    console.log('\n✅ Models generated successfully!');
    console.log(`\n📁 Generated files are in: ${outputDir}`);
    
    // 显示生成的表
    const tables = Object.keys(data.tables);
    console.log(`\n📊 Tables (${tables.length}):`);
    tables.forEach(table => console.log(`   - ${table}`));
    
    // 注入多对多关联到 init-models.js
    injectManyToManyAssociations(outputDir);
    
    // 创建自定义索引文件（包含关联关系）
    createIndexFile(outputDir, tables);
    
    console.log('\n⚠️  Note: Model associations have been added to index.js');
    console.log('   You may still need to adjust field types or add validation rules.');
  })
  .catch((err) => {
    console.error('\n❌ Failed to generate models:', err.message);
    if (err.original) {
      console.error('   Original error:', err.original.message);
    }
    process.exit(1);
  });

/**
 * 注入多对多关联到 init-models.js
 * sequelize-auto 只会生成 belongsTo 和 hasMany，需要手动添加 belongsToMany
 */
function injectManyToManyAssociations(outputDir) {
  const initModelsPath = path.join(outputDir, 'init-models.js');
  
  if (!fs.existsSync(initModelsPath)) {
    console.log('⚠️  init-models.js not found, skipping many-to-many injection');
    return;
  }
  
  let content = fs.readFileSync(initModelsPath, 'utf-8');
  
  // 定义需要注入的多对多关联
  // 格式: { through: 中间表, left: 左表, right: 右表, leftKey: 左外键, rightKey: 右外键, leftAs: 左别名, rightAs: 右别名 }
  const manyToManyAssociations = [
    {
      through: 'kb_article_tag',
      left: 'kb_article',
      right: 'kb_tag',
      leftKey: 'article_id',
      rightKey: 'tag_id',
      leftAs: 'tags',
      rightAs: 'articles',
    },
    // 可以在这里添加更多多对多关联
  ];
  
  // 检查是否已经注入过
  if (content.includes('// 多对多关联：文章 <-> 标签')) {
    console.log('✓ Many-to-many associations already injected');
    return;
  }
  
  // 找到注入点：在 kb_tag.hasMany(kb_article_tag, ...) 之后
  const injectPatterns = [
    {
      search: /kb_tag\.hasMany\(kb_article_tag, \{ as: "kb_article_tags", foreignKey: "tag_id"\}\);/,
      replacement: `kb_tag.hasMany(kb_article_tag, { as: "kb_article_tags", foreignKey: "tag_id"});
  // 多对多关联：文章 <-> 标签
  kb_article.belongsToMany(kb_tag, { as: "tags", through: kb_article_tag, foreignKey: "article_id", otherKey: "tag_id" });
  kb_tag.belongsToMany(kb_article, { as: "articles", through: kb_article_tag, foreignKey: "tag_id", otherKey: "article_id" });`,
    },
  ];
  
  for (const pattern of injectPatterns) {
    if (pattern.search.test(content)) {
      content = content.replace(pattern.search, pattern.replacement);
      break;
    }
  }
  
  fs.writeFileSync(initModelsPath, content);
  console.log('✓ Injected many-to-many associations into init-models.js');
}

/**
 * 创建模型索引文件（包含关联关系）
 */
function createIndexFile(outputDir, tables) {
  const indexPath = path.join(outputDir, 'index.js');
  
  const indexContent = `/**
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
`;

  fs.writeFileSync(indexPath, indexContent);
  console.log(`\n📝 Created index file: ${indexPath}`);
}
