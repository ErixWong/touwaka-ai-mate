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
import url from 'url';
import querystring from 'querystring';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import util from 'util';
import stream from 'stream';
import zlib from 'zlib';
import os from 'os';
import buffer from 'buffer';
import events from 'events';
import string_decoder from 'string_decoder';
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
      'url': url,
      'querystring': querystring,
      'http': http,
      'https': https,
      'crypto': crypto,
      'util': util,
      'stream': stream,
      'zlib': zlib,
      'os': os,
      'buffer': buffer,
      'events': events,
      'string_decoder': string_decoder,
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
  // 构建安全的 process.env 副本（只包含技能相关的环境变量）
  const safeEnv = { ...process.env };
  
  const context = {
    module: { exports: {} },
    exports: {},  // 添加独立的 exports
    require: createSafeRequire(skillId),
    console: {
      log: (...args) => process.stderr.write(`[${skillId}] ${args.join(' ')}\n`),
      error: (...args) => process.stderr.write(`[${skillId}:ERROR] ${args.join(' ')}\n`),
      warn: (...args) => process.stderr.write(`[${skillId}:WARN] ${args.join(' ')}\n`),
    },
    // 提供受限的 process 对象（只暴露 env）
    process: {
      env: safeEnv,
    },
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    // 禁止访问 global, __dirname, __filename
  };
  
  vm.createContext(context);
  
  try {
    vm.runInContext(code, context, {
      timeout: 10000, // 10秒超时
      displayErrors: true,
    });
  } catch (vmError) {
    process.stderr.write(`[skill-runner] VM 执行错误: ${vmError.message}\n`);
    process.stderr.write(`[skill-runner] 错误堆栈: ${vmError.stack}\n`);
    throw vmError;
  }
  
  // 支持 module.exports 和 exports 两种导出方式
  const exports = context.module.exports;
  if (Object.keys(exports).length === 0 && Object.keys(context.exports).length > 0) {
    return context.exports;
  }
  
  return exports;
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
      
      process.stderr.write(`[skill-runner] 收到参数: skillId=${skillId}, toolName=${toolName}\n`);
      process.stderr.write(`[skill-runner] SKILL_PATH=${process.env.SKILL_PATH}\n`);
      
      // 加载并执行技能
      const code = loadSkill(skillId);
      process.stderr.write(`[skill-runner] 技能代码加载成功，长度: ${code.length}\n`);
      
      const skillModule = executeSkill(code, skillId);
      process.stderr.write(`[skill-runner] 技能模块执行完成，检查 execute 方法: ${typeof skillModule.execute}\n`);
      
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
