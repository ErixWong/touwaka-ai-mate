// 临时脚本：修改 listSkills 方法，添加角色过滤
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'tools', 'builtin', 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// 查找并替换 listSkills 方法中的关键代码
// 添加用户角色获取和技能过滤逻辑

const searchPattern = `    try {
      const db = context.db;
      const expertId = context.expert_id;
      
      // 1. 查询当前专家启用的技能（通过 expert_skills 表关联）
      const skills = await db.query(`;

const replacePattern = `    // 获取用户角色（Phase 2 权限集成）
    const userRole = context?.user_role || 'user';

    try {
      const db = context.db;
      const expertId = context.expert_id;
      
      // 1. 查询当前专家启用的技能（通过 expert_skills 表关联）
      const skills = await db.query(`;

if (content.includes(searchPattern) && !content.includes('userRole = context?.user_role')) {
  content = content.replace(searchPattern, replacePattern);
  
  // 继续修改：在查询技能后添加过滤逻辑
  const filterSearch = `      // 2. 如果需要工具列表，查询 skill_tools 表`;
  const filterReplace = `      // 2. 根据用户角色过滤技能（Phase 2 权限集成）
      const filteredSkills = skills.filter(skill => {
        const skillName = skill.name || skill.id;
        const meta = SKILL_META[skillName];
        if (meta) {
          return hasSkillAccess(userRole, skillName);
        }
        // 未知技能默认允许访问
        return true;
      });

      // 3. 如果需要工具列表，查询 skill_tools 表`;
  
  content = content.replace(filterSearch, filterReplace);
  
  // 修改：将 skills 改为 filteredSkills
  content = content.replace(/skills\.length > 0/g, 'filteredSkills.length > 0');
  content = content.replace(/skills\.map\(s => s\.id\)/g, 'filteredSkills.map(s => s.id)');
  content = content.replace(/skills\.map\(skill =>/g, 'filteredSkills.map(skill =>');
  
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ listSkills 方法修改成功！');
  console.log('   - 添加了 userRole 获取');
  console.log('   - 添加了 filteredSkills 过滤逻辑');
  console.log('   - 替换了 skills 为 filteredSkills');
} else if (content.includes('userRole = context?.user_role')) {
  console.log('⚠️  listSkills 方法已经被修改过，跳过');
} else {
  console.log('❌ 未找到目标代码');
}