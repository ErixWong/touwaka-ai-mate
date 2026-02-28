// 临时脚本：修改 listSkills 方法
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'tools', 'builtin', 'index.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. 添加 userRole 获取
const search1 = `    try {
      const db = context.db;
      const expertId = context.expert_id;`;

const replace1 = `    // 获取用户角色（Phase 2 权限集成）
    const userRole = context?.user_role || 'user';

    try {
      const db = context.db;
      const expertId = context.expert_id;`;

// 2. 添加过滤逻辑
const search2 = `      // 2. 如果需要工具列表，查询 skill_tools`;
const replace2 = `      // 2. 根据用户角色过滤技能（Phase 2 权限集成）
      const filteredSkills = skills.filter(skill => {
        const skillName = skill.name || skill.id;
        const meta = SKILL_META[skillName];
        if (meta) {
          return hasSkillAccess(userRole, skillName);
        }
        return true;
      });

      // 3. 如果需要工具列表，查询 skill_tools`;

let modified = false;

if (content.includes(search1) && !content.includes('userRole = context?.user_role')) {
  content = content.replace(search1, replace1);
  modified = true;
  console.log('✅ 添加了 userRole 获取');
}

if (content.includes(search2) && !content.includes('filteredSkills')) {
  content = content.replace(search2, replace2);
  
  // 替换 skills 为 filteredSkills
  content = content.replace(/skills\.length > 0/g, 'filteredSkills.length > 0');
  content = content.replace(/skills\.map\(s => s\.id\)/g, 'filteredSkills.map(s => s.id)');
  content = content.replace(/skills\.map\(skill =>/g, 'filteredSkills.map(skill =>');
  
  modified = true;
  console.log('✅ 添加了 filteredSkills 过滤');
}

if (modified) {
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('✅ listSkills 方法修改完成！');
} else if (content.includes('userRole = context?.user_role')) {
  console.log('⚠️  已经修改过，跳过');
} else {
  console.log('❌ 未找到目标代码');
}