import Database from '../lib/db.js';
import SkillLoader from '../lib/skill-loader.js';
import ToolManager from '../lib/tool-manager.js';
import fs from 'fs';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 替换配置文件中的环境变量占位符
function resolveEnvVars(obj) {
  const resolved = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      resolved[key] = process.env[envVar];
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

async function test() {
  console.log('初始化数据库...');
  
  // 读取数据库配置并替换环境变量
  const dbConfigRaw = JSON.parse(fs.readFileSync('./config/database.json', 'utf-8'));
  const dbConfig = resolveEnvVars(dbConfigRaw);
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
