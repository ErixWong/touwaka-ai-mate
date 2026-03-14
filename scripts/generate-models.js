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
    
    // 注入多对多关联到 init-models.js（基于外键自动检测）
    injectManyToManyAssociations(outputDir, data);
    
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

/**
 * 注入多对多关联到 init-models.js
 * sequelize-auto 只会生成 belongsTo 和 hasMany，需要手动添加 belongsToMany
 * 
 * 自动检测逻辑：通过分析 data.foreignKeys 找到有两个外键的中间表
 */
function injectManyToManyAssociations(outputDir, data) {
  const initModelsPath = path.join(outputDir, 'init-models.js');
  
  if (!fs.existsSync(initModelsPath)) {
    console.log('⚠️  init-models.js not found, skipping many-to-many injection');
    return;
  }
  
  let content = fs.readFileSync(initModelsPath, 'utf-8');
  
  // 检查是否已经注入过
  if (content.includes('// ===== 多对多关联 (自动检测) =====')) {
    console.log('✓ Many-to-many associations already injected');
    return;
  }
  
  // 从 data.foreignKeys 分析多对多关联
  // foreignKeys 格式: { tableName: { columnName: { source_table, target_table, ... } } }
  const foreignKeys = data.foreignKeys || {};
  
  // 找出所有中间表：包含恰好两个外键且指向不同表的表
  const junctionTables = [];
  
  for (const [tableName, columns] of Object.entries(foreignKeys)) {
    const fkColumns = Object.entries(columns);
    
    // 只处理恰好有两个外键的表
    if (fkColumns.length === 2) {
      const [col1, fk1] = fkColumns[0];
      const [col2, fk2] = fkColumns[1];
      
      // 两个外键必须指向不同的表
      const targetTable1 = fk1.target_table;
      const targetTable2 = fk2.target_table;
      
      if (targetTable1 && targetTable2 && targetTable1 !== targetTable2) {
        junctionTables.push({
          through: tableName,
          leftTable: targetTable1,
          rightTable: targetTable2,
          leftKey: col1,
          rightKey: col2,
        });
      }
    }
  }
  
  if (junctionTables.length === 0) {
    console.log('✓ No junction tables detected, skipping many-to-many injection');
    return;
  }
  
  console.log(`\n🔗 Detected ${junctionTables.length} junction table(s):`);
  junctionTables.forEach(jt => {
    console.log(`   - ${jt.through}: ${jt.leftTable} <-> ${jt.rightTable}`);
  });
  
  // 生成关联代码
  const associationLines = [];
  
  for (const jt of junctionTables) {
    // 转换为模型名（snake_case -> camelCase）
    const throughModel = jt.through;
    const leftModel = jt.leftTable;
    const rightModel = jt.rightTable;
    
    // 生成别名：去掉表名前缀和 _id 后缀
    const leftAs = jt.leftTable.replace(/^.+?_/, '').replace(/s$/, ''); // e.g., kb_article -> article
    const rightAs = jt.rightTable.replace(/^.+?_/, '').replace(/s$/, ''); // e.g., kb_tag -> tag
    
    associationLines.push(`  // ${leftModel} <-> ${rightModel} (through ${throughModel})`);
    associationLines.push(`  ${leftModel}.belongsToMany(${rightModel}, { as: "${rightAs}s", through: ${throughModel}, foreignKey: "${jt.leftKey}", otherKey: "${jt.rightKey}" });`);
    associationLines.push(`  ${rightModel}.belongsToMany(${leftModel}, { as: "${leftAs}s", through: ${throughModel}, foreignKey: "${jt.rightKey}", otherKey: "${jt.leftKey}" });`);
  }
  
  // 在 return 语句之前插入
  const returnMatch = content.match(/\n  return \{/);
  if (returnMatch) {
    const insertPos = returnMatch.index;
    const beforeContent = content.substring(0, insertPos);
    const afterContent = content.substring(insertPos);
    
    content = beforeContent + '\n  // ===== 多对多关联 (自动检测) =====\n' + associationLines.join('\n') + '\n' + afterContent;
    
    fs.writeFileSync(initModelsPath, content);
    console.log('✓ Injected many-to-many associations into init-models.js');
  } else {
    console.log('⚠️  Could not find insertion point in init-models.js');
  }
}

