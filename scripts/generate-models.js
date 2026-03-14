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
    
    console.log('\n⚠️  Note: Model associations are auto-generated from foreign keys.');
    console.log('   You may still need to adjust field types or add validation rules.');
  })
  .catch((err) => {
    console.error('\n❌ Failed to generate models:', err.message);
    if (err.original) {
      console.error('   Original error:', err.original.message);
    }
    process.exit(1);
  });


