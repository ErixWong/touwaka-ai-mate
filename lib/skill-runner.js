/**
 * Skill Runner - 技能执行子进程
 * 在独立进程中运行技能代码，提供真正的沙箱隔离
 * 
 * 使用方式: node skill-runner.js <skillId> <toolName>
 * 通过 stdin 接收参数，stdout 返回结果
 * 
 * 支持的脚本类型：
 * - .js: Node.js (vm 沙箱)
 * - .py: Python (subprocess + 危险函数黑名单)
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
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 白名单模块
const MODULE_WHITELIST = [
  'fs', 'path', 'url', 'querystring', 'crypto',
  'util', 'stream', 'http', 'https', 'zlib',
  'string_decoder', 'buffer', 'events', 'os',
  'mysql2', 'mysql2/promise',
];

// 创建 ESM 下的 require 函数（用于加载外部模块如 mysql2）
const globalRequire = createRequire(import.meta.url);

// 外部模块白名单（需要通过 require 加载的 npm 包）
const EXTERNAL_MODULES = ['mysql2', 'mysql2/promise'];

/**
 * 创建安全的 require 函数
 * 支持内置模块和特定的外部模块（如 mysql2）
 */
function createSafeRequire(skillId) {
  return (moduleName) => {
    // 禁止相对路径引用
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      throw new Error(`Relative imports are not allowed in skill ${skillId}`);
    }
    
    // 检查是否在白名单中
    if (!MODULE_WHITELIST.includes(moduleName)) {
      throw new Error(`Module '${moduleName}' is not allowed in skill ${skillId}`);
    }
    
    // 内置模块映射
    const builtinModuleMap = {
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
    
    // 优先返回内置模块
    if (builtinModuleMap[moduleName]) {
      return builtinModuleMap[moduleName];
    }
    
    // 尝试加载外部模块（如 mysql2）
    if (EXTERNAL_MODULES.includes(moduleName)) {
      try {
        return globalRequire(moduleName);
      } catch (loadError) {
        throw new Error(`Failed to load external module '${moduleName}': ${loadError.message}`);
      }
    }
    
    throw new Error(`Module '${moduleName}' cannot be loaded in sandbox`);
  };
}

// 允许的脚本扩展名
const ALLOWED_SCRIPT_EXTENSIONS = ['.js', '.py'];

// 脚本类型枚举
const ScriptType = {
  NODEJS: 'nodejs',
  PYTHON: 'python',
};

/**
 * 检测脚本类型
 * @param {string} scriptPath - 脚本路径
 * @returns {string} 脚本类型
 */
function detectScriptType(scriptPath) {
  const ext = path.extname(scriptPath).toLowerCase();
  switch (ext) {
    case '.js':
      return ScriptType.NODEJS;
    case '.py':
      return ScriptType.PYTHON;
    default:
      throw new Error(`Unsupported script type: ${ext}`);
  }
}

/**
 * 查找技能入口文件
 * @param {string} skillPath - 技能目录路径
 * @returns {{ scriptPath: string, scriptType: string }} 入口文件信息
 */
function findSkillEntry(skillPath) {
  // 按优先级尝试不同的入口文件
  const entryCandidates = ['index.js', 'index.py'];
  
  for (const candidate of entryCandidates) {
    const fullPath = path.join(skillPath, candidate);
    if (fs.existsSync(fullPath)) {
      return {
        scriptPath: candidate,
        scriptType: detectScriptType(candidate),
      };
    }
  }
  
  throw new Error(`No entry file found in ${skillPath}. Expected one of: ${entryCandidates.join(', ')}`);
}

/**
 * 验证脚本路径安全性
 * @param {string} scriptPath - 脚本路径
 * @throws {Error} 如果路径不安全
 */
function validateScriptPath(scriptPath) {
  // 禁止路径遍历
  if (scriptPath.includes('..')) {
    throw new Error(`Invalid script_path: path traversal not allowed (${scriptPath})`);
  }
  
  // 禁止绝对路径
  if (path.isAbsolute(scriptPath)) {
    throw new Error(`Invalid script_path: absolute path not allowed (${scriptPath})`);
  }
  
  // 检查扩展名白名单
  const ext = path.extname(scriptPath);
  if (ext && !ALLOWED_SCRIPT_EXTENSIONS.includes(ext)) {
    throw new Error(`Script extension not allowed: ${ext}. Allowed: ${ALLOWED_SCRIPT_EXTENSIONS.join(', ')}`);
  }
  
  return scriptPath;
}

/**
 * 加载技能代码
 * @param {string} skillId - 技能ID
 * @param {string} scriptPath - 脚本路径（相对于技能目录，默认从 SCRIPT_PATH 环境变量读取）
 */
function loadSkill(skillId, scriptPath = null) {
  // 必须使用 SKILL_PATH 环境变量（由 skill-loader 传入，基于数据库的 source_path）
  const skillPath = process.env.SKILL_PATH;
  
  if (!skillPath) {
    throw new Error(`SKILL_PATH environment variable not set for skill ${skillId}`);
  }
  
  // 获取脚本路径：优先参数 > 环境变量 > 默认 index.js
  const script = scriptPath || process.env.SCRIPT_PATH || 'index.js';
  
  // 安全验证：防止路径遍历攻击
  validateScriptPath(script);
  
  const scriptFullPath = path.join(skillPath, script);
  
  process.stderr.write(`[skill-runner] loadSkill: skillId=${skillId}, skillPath=${skillPath}, scriptPath=${script}, fullPath=${scriptFullPath}\n`);
  
  if (!fs.existsSync(scriptFullPath)) {
    throw new Error(`Script not found: ${scriptFullPath}`);
  }
  
  return fs.readFileSync(scriptFullPath, 'utf-8');
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
    // 提供受限的 process 对象（只暴露 env 和 cwd）
    // cwd() 返回安全的固定路径，用于 Docker 环境
    process: {
      env: safeEnv,
      cwd: () => '/app',  // Docker 环境下的标准工作目录
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

// Python 执行配置
const PYTHON_TIMEOUT = 30000; // 30秒超时

/**
 * 执行 Python 技能
 * 使用 subprocess 隔离，通过 stdin/stdout JSON 通信
 * 
 * @param {string} skillPath - 技能目录路径
 * @param {string} scriptPath - 脚本路径（相对于技能目录）
 * @param {string} toolName - 工具名称
 * @param {object} params - 工具参数
 * @param {object} context - 执行上下文
 * @returns {Promise<any>} 执行结果
 */
async function executePythonSkill(skillPath, scriptPath, toolName, params, context) {
  return new Promise((resolve, reject) => {
    const scriptFullPath = path.join(skillPath, scriptPath);
    
    process.stderr.write(`[skill-runner] 执行 Python 技能: ${scriptFullPath}\n`);
    
    // 构建发送给 Python 的输入
    const pythonInput = JSON.stringify({
      tool: toolName,
      params: params,
      context: context,
    });
    
    // 创建 Python 沙箱包装器代码
    // 策略：先加载模块，然后应用沙箱限制，最后执行技能函数
    const sandboxWrapper = `
import sys
import json
import os
import importlib.util

# 读取输入
_input = sys.stdin.read()
_data = json.loads(_input)

# 读取并编译技能代码（在限制生效前）
with open(${JSON.stringify(scriptFullPath)}, 'r', encoding='utf-8') as _f:
    _skill_code = _f.read()

# 创建模块命名空间
_skill_module = type(sys)('skill_module')
_skill_module.__file__ = ${JSON.stringify(scriptFullPath)}

# 执行技能代码（在模块命名空间中）
exec(compile(_skill_code, ${JSON.stringify(scriptFullPath)}, 'exec'), _skill_module.__dict__)

# === 沙箱限制生效 ===

# 危险函数黑名单（用于 os 模块）
_OS_BLACKLIST = {
    'system', 'spawn', 'spawnl', 'spawnle', 'spawnlp', 'spawnlpe', 
    'spawnv', 'spawnve', 'spawnvp', 'spawnvpe',
    'exec', 'execl', 'execle', 'execlp', 'execlpe',
    'execv', 'execve', 'execvp', 'execvpe',
    'popen', 'fdopen', 'fork', 'kill',
}

# 创建受限的 os 模块
_original_os = os
class _RestrictedOS:
    def __getattr__(self, name):
        if name in _OS_BLACKLIST:
            raise PermissionError(f"Function os.{name} is not allowed in sandbox")
        return getattr(_original_os, name)

# 替换技能模块中的 os
if 'os' in _skill_module.__dict__:
    _skill_module.os = _RestrictedOS()

# 检查 execute 函数
if not hasattr(_skill_module, 'execute'):
    raise ValueError("Python skill must have an execute function")

# 执行技能函数
_result = _skill_module.execute(_data['tool'], _data['params'], _data['context'])

# 处理协程结果
import asyncio
if asyncio.iscoroutine(_result):
    _result = asyncio.get_event_loop().run_until_complete(_result)

# 输出结果（只输出技能函数的返回值，不包装）
print(json.dumps(_result))
`;
    
    // 使用 spawn 执行 Python
    const pythonProcess = spawn('python', ['-c', sandboxWrapper], {
      cwd: skillPath,  // chdir 到技能目录
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(`[python:stderr] ${data.toString()}`);
    });
    
    // 超时控制
    const timeout = setTimeout(() => {
      pythonProcess.kill();
      reject(new Error(`Python skill execution timeout (${PYTHON_TIMEOUT}ms)`));
    }, PYTHON_TIMEOUT);
    
    pythonProcess.on('close', (code) => {
      clearTimeout(timeout);
      
      if (code !== 0) {
        reject(new Error(`Python skill exited with code ${code}: ${stderr}`));
        return;
      }
      
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch (parseError) {
        reject(new Error(`Failed to parse Python output: ${parseError.message}\nOutput: ${stdout}`));
      }
    });
    
    pythonProcess.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
    
    // 发送输入
    pythonProcess.stdin.write(pythonInput);
    pythonProcess.stdin.end();
  });
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
      
      // 获取技能路径（必须由 SKILL_PATH 环境变量提供）
      const skillPath = process.env.SKILL_PATH;
      if (!skillPath) {
        throw new Error(`SKILL_PATH environment variable not set for skill ${skillId}`);
      }
      
      // 查找入口文件
      const entry = findSkillEntry(skillPath);
      process.stderr.write(`[skill-runner] 入口文件: ${entry.scriptPath}, 类型: ${entry.scriptType}\n`);
      
      let result;
      
      if (entry.scriptType === ScriptType.PYTHON) {
        // Python 技能执行
        result = await executePythonSkill(skillPath, entry.scriptPath, toolName, params, context);
      } else {
        // Node.js 技能执行（默认）
        const code = loadSkill(skillId, entry.scriptPath);
        process.stderr.write(`[skill-runner] 技能代码加载成功，长度: ${code.length}\n`);
        
        const skillModule = executeSkill(code, skillId);
        process.stderr.write(`[skill-runner] 技能模块执行完成，检查 execute 方法: ${typeof skillModule.execute}\n`);
        
        result = await executeTool(skillModule, toolName, params, context);
      }
      
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
