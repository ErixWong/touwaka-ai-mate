import SkillLoader from '../lib/skill-loader.js';
import db from '../lib/db.js';
import logger from '../lib/logger.js';

(async () => {
  try {
    await db.init();
    
    const skillLoader = new SkillLoader(db);
    
    // 模拟数据库中的 skill 记录
    const skillRow = {
      id: 'mm1ohcedgjw66943firi',
      name: 'searxng',
      description: 'Search the web',
      skill_md: null,
      source_path: 'data/skills/searxng',
      disable_model_invocation: false,
      user_invocable: true,
      allowed_tools: '["Bash(curl *)"]',
      argument_hint: '[query]',
      license: ''
    };
    
    // 加载技能
    const skill = await skillLoader.loadSkillFromDatabase(skillRow);
    
    console.log('=== 技能信息 ===');
    console.log('ID:', skill.id);
    console.log('Name:', skill.name);
    console.log('Tools count:', skill.tools.length);
    
    if (skill.tools.length > 0) {
      const tool = skill.tools[0];
      console.log('\n=== 工具信息 ===');
      console.log('Tool ID:', tool.function.name);
      console.log('Description:', tool.function.description);
      console.log('Parameters:', JSON.stringify(tool.function.parameters, null, 2));
      console.log('\n_meta:', JSON.stringify(tool._meta, null, 2));
    }
    
    process.exit(0);
  } catch (e) {
    console.error('错误:', e);
    process.exit(1);
  }
})();
