import Database from '../lib/db.js';
import SkillLoader from '../lib/skill-loader.js';
import ToolManager from '../lib/tool-manager.js';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 验证必填环境变量
const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error(`数据库配置缺失: ${missing.join(', ')}`);
  console.error('请设置环境变量或在 .env 文件中配置');
  process.exit(1);
}

async function test() {
  console.log('初始化数据库...');
  
  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 10,
  };
  console.log('数据库配置:', { host: dbConfig.host, database: dbConfig.database, user: dbConfig.user });
  
  const database = new Database(dbConfig);
  await database.connect();
  
  console.log('\n=== 测试 SkillLoader ===');
  const loader = new SkillLoader(database);
  
  // 模拟加载技能 - 使用正确的专家 ID
  const skills = await loader.loadSkillsForExpert('mlxwd8ka35mx71yr1uw1');
  console.log('加载的技能数量:', skills.length);
  
  for (const skill of skills) {
    console.log('\n技能:', skill.id, skill.name);
    const tools = loader.getToolDefinitions(skill);
    console.log('工具数量:', tools.length);
    for (const tool of tools) {
      console.log('  - toolId:', tool.function.name);
      console.log('    _meta:', JSON.stringify(tool._meta));
    }
  }
  
  console.log('\n=== 测试 ToolManager ===');
  const toolManager = new ToolManager(database, 'mlxwd8ka35mx71yr1uw1');
  await toolManager.initialize();
  
  console.log('注册的技能数量:', toolManager.skills.size);
  console.log('注册的工具数量:', toolManager.toolRegistry.size);
  
  console.log('\n工具注册表:');
  for (const [toolId, info] of toolManager.toolRegistry) {
    console.log(`  ${toolId} -> ${info.skillName}/${info.toolName} (builtin: ${info.isBuiltin})`);
  }
  
  console.log('\n获取工具定义:');
  const definitions = toolManager.getToolDefinitions();
  console.log('工具定义数量:', definitions.length);
  for (const def of definitions.slice(0, 5)) {  // 只显示前5个
    console.log(`  - ${def.function.name}: ${def.function.description?.substring(0, 50)}...`);
  }
  
  process.exit(0);
}

test().catch(e => {
  console.error('错误:', e);
  process.exit(1);
});
