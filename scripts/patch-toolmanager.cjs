// 临时脚本：修改 tool-manager.js，添加权限检查
const fs = require('fs');
const path = require('path');

const filePath = path.join(process.cwd(), 'lib', 'tool-manager.js');
let content = fs.readFileSync(filePath, 'utf8');

// 1. 在文件开头添加 import（如果还没有）
if (!content.includes("from './skill-meta.js'")) {
  content = content.replace(
    `import logger from './logger.js';`,
    `import logger from './logger.js';
import { hasSkillAccess, validateSkillAccess, SKILL_META } from './skill-meta.js';`
  );
  console.log('✅ 添加了 skill-meta import');
}

// 2. 在 executeTool 方法中添加权限检查（如果还没有）
if (!content.includes('Phase 2 权限检查')) {
  content = content.replace(
    `    // 从 toolRegistry 获取工具信息
    const toolInfo = this.toolRegistry.get(toolId);
    if (!toolInfo) {`,
    `    // Phase 2 权限检查
    const userRole = context?.user_role || 'user';
    const validation = validateSkillAccess(userRole, toolId);
    if (!validation.allowed) {
      logger.warn(\`[ToolManager] 权限拒绝: \${display} - \${validation.error}\`);
      return {
        success: false,
        error: validation.error,
        toolId,
        toolName: display,
        permissionDenied: true,
      };
    }

    // 从 toolRegistry 获取工具信息
    const toolInfo = this.toolRegistry.get(toolId);
    if (!toolInfo) {`
  );
  console.log('✅ 添加了权限检查逻辑');
}

// 保存文件
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ tool-manager.js 修改完成！');