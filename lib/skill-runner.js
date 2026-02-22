/**
 * Skill Runner - 技能执行子进程
 * 在独立进程中运行技能代码，提供真正的沙箱隔离
 * 
 * 使用方式: node skill-runner.js <skillId> <toolName>
 * 通过 stdin 接收参数，stdout 返回结果
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 白名单模块
const MODULE_WHITELIST = [
  'fs', 'path', 'url', 'querystring', 'crypto',
  'util', 'stream', 'http', 'https', 'zlib',
  'string_decoder', 'buffer', 'events', 'os',
];

/**
 * 创建安全的 require 函数
 * 注意：ESM 中不支持动态 require，这里使用静态导入映射
 */
function createSafeRequire(skillId) {
  return (moduleName) => {
    if (!MODULE_WHITELIST.includes(moduleName)) {
      throw new Error(`Module '${moduleName}' is not allowed in skill ${skillId}`);
    }
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      throw new Error(`Relative imports are not allowed in skill ${skillId}`);
    }
    // ESM 中需要使用静态导入，这里返回内置模块
    // 由于 vm 沙箱的限制，我们需要手动映射
    const moduleMap = {
      'fs': fs,
      'path': path,
    };
    if (moduleMap[moduleName]) {
      return moduleMap[moduleName];
    }
    throw new Error(`Module '${moduleName}' cannot be loaded in ESM sandbox`);
  };
}

/**
 * 加载技能代码
 */
function loadSkill(skillId) {
  const skillPath = process.env.SKILL_PATH || path.join('/shared/skills', skillId);
  const indexJsPath = path.join(skillPath, 'index.js');
  
  if (!fs.existsSync(indexJsPath)) {
    throw new Error(`Skill not found: ${indexJsPath}`);
  }
  
  return fs.readFileSync(indexJsPath, 'utf-8');
}

/**
 * 执行技能代码
 */
function executeSkill(code, skillId) {
  const context = {
    module: { exports: {} },
    require: createSafeRequire(skillId),
    console: {
      log: (...args) => process.stderr.write(`[${skillId}] ${args.join(' ')}\n`),
      error: (...args) => process.stderr.write(`[${skillId}:ERROR] ${args.join(' ')}\n`),
      warn: (...args) => process.stderr.write(`[${skillId}:WARN] ${args.join(' ')}\n`),
    },
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // 禁止访问 process, global, __dirname, __filename
  };
  
  vm.createContext(context);
  vm.runInContext(code, context, {
    timeout: 10000, // 10秒超时
    displayErrors: true,
  });
  
  return context.module.exports;
}

/**
 * 执行工具
 */
async function executeTool(skillModule, toolName, params, context) {
  if (typeof skillModule.execute !== 'function') {
    throw new Error(`Skill does not have an execute method`);
  }
  
  return await skillModule.execute(toolName, params, context);
}

/**
 * 主函数
 */
async function main() {
  const skillId = process.argv[2];
  const toolName = process.argv[3];
  
  if (!skillId || !toolName) {
    console.error('Usage: node skill-runner.js <skillId> <toolName>');
    process.exit(1);
  }
  
  // 从 stdin 读取参数
  let input = '';
  process.stdin.setEncoding('utf8');
  
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  
  process.stdin.on('end', async () => {
    try {
      const { params, context } = JSON.parse(input || '{}');
      
      // 加载并执行技能
      const code = loadSkill(skillId);
      const skillModule = executeSkill(code, skillId);
      
      // 执行工具
      const result = await executeTool(skillModule, toolName, params, context);
      
      // 返回结果
      process.stdout.write(JSON.stringify({
        success: true,
        data: result,
      }));
      
      process.exit(0);
    } catch (error) {
      process.stdout.write(JSON.stringify({
        success: false,
        error: error.message,
        stack: error.stack,
      }));
      process.exit(1);
    }
  });
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
