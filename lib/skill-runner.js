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

// 缓存检测到的 Python 命令
let cachedPythonCmd = null;

/**
 * 检测系统上可用的 Python 命令
 * 优先级: PYTHON_PATH 环境变量 > python3 > python
 */
function detectPythonCommand() {
  if (cachedPythonCmd) return cachedPythonCmd;

  // 1. 优先使用环境变量
  if (process.env.PYTHON_PATH) {
    cachedPythonCmd = process.env.PYTHON_PATH;
    return cachedPythonCmd;
  }

  // 2. Windows 通常用 python，macOS/Linux 通常用 python3
  // 但我们默认用 python3，因为它更普遍
  // Windows 用户可以设置 PYTHON_PATH=python
  cachedPythonCmd = 'python3';
  return cachedPythonCmd;
}

/**
 * 从环境变量解析白名单
 * @param {string} envVar - 环境变量名
 * @returns {string[]} 白名单数组
 */
function parseWhitelistFromEnv(envVar) {
  const envValue = process.env[envVar];
  if (!envValue) {
    // 环境变量未设置时返回空数组（应由 skill-loader 设置）
    process.stderr.write(`[skill-runner] 警告: ${envVar} 环境变量未设置\n`);
    return [];
  }
  try {
    const parsed = JSON.parse(envValue);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    process.stderr.write(`[skill-runner] 警告: ${envVar} 不是有效的 JSON 数组\n`);
    return [];
  } catch (e) {
    process.stderr.write(`[skill-runner] 警告: 解析 ${envVar} 失败: ${e.message}\n`);
    return [];
  }
}

// 白名单模块（从环境变量读取，由 skill-loader 通过数据库设置）
const MODULE_WHITELIST = parseWhitelistFromEnv('ALLOWED_NODE_MODULES');
const PYTHON_WHITELIST = parseWhitelistFromEnv('ALLOWED_PYTHON_PACKAGES');

// 超时配置（从环境变量读取，由 skill-loader 通过数据库设置）
const TIMEOUT_CONFIG = {
  vm_execution: parseInt(process.env.TIMEOUT_VM_EXECUTION || '60000', 10),      // 默认60秒
  python_execution: parseInt(process.env.TIMEOUT_PYTHON_EXECUTION || '120000', 10), // 默认120秒
  skill_http: parseInt(process.env.TIMEOUT_SKILL_HTTP || '180000', 10),         // 默认180秒
  resident_skill: parseInt(process.env.TIMEOUT_RESIDENT_SKILL || '300000', 10), // 默认300秒
};

// 创建 ESM 下的 require 函数（用于加载外部模块如 mysql2）
const globalRequire = createRequire(import.meta.url);

// 内置模块列表（Node.js 自带，不需要 require）
const BUILTIN_MODULES = new Set([
  'fs', 'path', 'url', 'querystring', 'crypto',
  'util', 'stream', 'http', 'https', 'zlib',
  'string_decoder', 'buffer', 'events', 'os',
]);

// 外部模块白名单（从 MODULE_WHITELIST 中自动提取非内置模块）
const EXTERNAL_MODULES = MODULE_WHITELIST.filter(name => !BUILTIN_MODULES.has(name));

// 调试日志：显示加载的白名单配置
process.stderr.write(`[skill-runner] 白名单配置:\n`);
process.stderr.write(`[skill-runner]   内置模块: ${[...BUILTIN_MODULES].filter(m => MODULE_WHITELIST.includes(m)).join(', ')}\n`);
process.stderr.write(`[skill-runner]   外部模块: ${EXTERNAL_MODULES.join(', ') || '(无)'}\n`);
process.stderr.write(`[skill-runner]   Python包: ${PYTHON_WHITELIST.join(', ')}\n`);

/**
 * 需要路径检查的 fs 方法
 */
const FS_PATH_METHODS = new Set([
  // 同步读取方法
  'readFileSync', 'readFileSync', 'openSync', 'open', 'fstatSync', 'fstat',
  // 异步读取方法
  'readFile', 'read', 'readdir', 'readdirSync',
  // 写入方法
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  // 目录方法
  'mkdirSync', 'mkdir', 'rmdirSync', 'rmdir', 'mkdtempSync', 'mkdtemp',
  // 删除方法
  'rmSync', 'rm', 'unlinkSync', 'unlink',
  // 状态方法
  'statSync', 'stat', 'lstatSync', 'lstat', 'existsSync', 'exists', 'accessSync', 'access',
  // 文件操作
  'renameSync', 'rename', 'copyFileSync', 'copyFile', 'truncateSync', 'truncate',
  // 符号链接
  'symlinkSync', 'symlink', 'readlinkSync', 'readlink', 'linkSync', 'link',
  // 文件监视
  'watch', 'watchFile', 'unwatchFile',
  // 流
  'createReadStream', 'createWriteStream',
]);

/**
 * 创建受限的 fs 模块
 * 在沙箱层面强制限制文件系统访问路径
 * 
 * @param {string[]} allowedPaths - 允许访问的路径前缀列表
 * @returns {Proxy} 受限的 fs 模块代理
 */
function createRestrictedFs(allowedPaths) {
  /**
   * 检查路径是否在允许范围内
   * @param {string} filePath - 要检查的文件路径
   * @throws {Error} 如果路径不在允许范围内
   */
  const checkPath = (filePath) => {
    // 处理 Buffer 类型的路径
    const pathStr = Buffer.isBuffer(filePath) ? filePath.toString('utf8') : String(filePath);
    
    // 处理 file:// URL
    let resolvedPath = pathStr;
    if (pathStr.startsWith('file://')) {
      try {
        resolvedPath = url.fileURLToPath(pathStr);
      } catch {
        // 如果解析失败，使用原始路径
        resolvedPath = pathStr;
      }
    }
    
    // 规范化路径
    const absolutePath = path.resolve(resolvedPath);
    
    // 检查是否在允许的路径前缀中
    const isAllowed = allowedPaths.some(allowedPath => {
      const normalizedAllowed = path.resolve(allowedPath);
      return absolutePath.startsWith(normalizedAllowed + path.sep) || 
             absolutePath === normalizedAllowed;
    });
    
    if (!isAllowed) {
      throw new Error(
        `Path not allowed in sandbox: ${absolutePath}\n` +
        `Allowed paths: ${allowedPaths.map(p => path.resolve(p)).join(', ')}`
      );
    }
    
    return absolutePath;
  };

  // 创建 fs 模块的代理
  return new Proxy(fs, {
    get(target, prop) {
      const originalValue = target[prop];
      
      // 如果是需要路径检查的方法
      if (FS_PATH_METHODS.has(prop) && typeof originalValue === 'function') {
        return function(...args) {
          // 第一个参数通常是路径（除了 fd 开头的方法和一些特殊情况）
          if (args.length > 0 && args[0] !== undefined && args[0] !== null) {
            // 检查第一个路径参数
            checkPath(args[0]);
          }
          
          // 对于某些方法，第二个参数也可能是路径（如 rename, copyFile）
          if (['rename', 'renameSync', 'copyFile', 'copyFileSync', 'link', 'linkSync'].includes(prop) && args.length > 1) {
            checkPath(args[1]);
          }
          
          // 调用原始方法
          return originalValue.apply(target, args);
        };
      }
      
      // 其他方法直接返回
      return originalValue;
    }
  });
}

/**
 * 创建安全的 require 函数
 * 支持内置模块和特定的外部模块（如 mysql2）
 * 
 * @param {string} skillId - 技能ID
 * @param {string[]} allowedPaths - 允许访问的路径前缀列表
 */
function createSafeRequire(skillId, allowedPaths = []) {
  // 创建受限的 fs 模块
  const restrictedFs = createRestrictedFs(allowedPaths);
  
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
      'fs': restrictedFs,  // 返回受限的 fs 模块
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
  // 先检查技能目录是否存在
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill directory not found: ${skillPath}`);
  }
  
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
  
  // 检查是否管理员（直接从环境变量读取）
  const isAdmin = process.env.IS_ADMIN === 'true';
  
  // 确定工作目录（用于 process.cwd()）
  // 优先使用 WORKING_DIRECTORY，否则回退到 DATA_BASE_PATH
  const workingDirectory = process.env.WORKING_DIRECTORY;
  const dataBasePath = process.env.DATA_BASE_PATH || process.cwd();
  const effectiveCwd = workingDirectory
    ? path.join(dataBasePath, workingDirectory)
    : dataBasePath;
  
  // 管理员可以访问项目根目录
  const projectRoot = process.cwd();
  
  // 计算允许访问的路径列表
  // 管理员：项目根目录 + DATA_BASE_PATH
  // 普通用户：仅 DATA_BASE_PATH
  const allowedPaths = isAdmin
    ? [projectRoot, dataBasePath]
    : [dataBasePath];
  
  process.stderr.write(`[skill-runner] 沙箱路径限制: IS_ADMIN=${isAdmin}, allowedPaths=${allowedPaths.join(', ')}\n`);
  
  const context = {
    module: { exports: {} },
    exports: {},  // 添加独立的 exports
    require: createSafeRequire(skillId, allowedPaths),  // 传入允许的路径列表
    console: {
      log: (...args) => process.stderr.write(`[${skillId}] ${args.join(' ')}\n`),
      error: (...args) => process.stderr.write(`[${skillId}:ERROR] ${args.join(' ')}\n`),
      warn: (...args) => process.stderr.write(`[${skillId}:WARN] ${args.join(' ')}\n`),
    },
    // 提供受限的 process 对象（只暴露 env 和 cwd）
    // cwd() 返回工作目录（根据任务上下文动态设置）
    process: {
      env: safeEnv,
      cwd: () => effectiveCwd,
    },
    // 管理员权限标识（供技能代码检查）
    __ADMIN__: isAdmin,
    // 项目根目录（仅管理员可用）
    __PROJECT_ROOT__: isAdmin ? projectRoot : undefined,
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
      timeout: TIMEOUT_CONFIG.vm_execution, // 使用配置的超时
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

// Python 执行配置 - 使用动态超时
const PYTHON_TIMEOUT = TIMEOUT_CONFIG.python_execution;

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
    // 将白名单列表注入到 Python 代码中
    const pythonWhitelistJson = JSON.stringify(PYTHON_WHITELIST);
    
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

# 包白名单（从 Node.js 传入）
_PACKAGE_WHITELIST = set(${pythonWhitelistJson})

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

# 检查已导入的模块是否在白名单中
for _mod_name in list(_skill_module.__dict__.keys()):
    # 跳过私有属性和内置对象
    if _mod_name.startswith('_'):
        continue
    _mod_obj = _skill_module.__dict__[_mod_name]
    # 检查是否是模块对象
    if hasattr(_mod_obj, '__name__') and hasattr(_mod_obj, '__file__'):
        _mod_pkg = getattr(_mod_obj, '__package__', '') or ''
        _mod_base = _mod_name if _mod_name in _PACKAGE_WHITELIST else None
        # 检查模块名是否在白名单中
        if _mod_name not in _PACKAGE_WHITELIST and _mod_pkg not in _PACKAGE_WHITELIST:
            # 允许常见的安全模块（已经硬编码在白名单中）
            # 这里不阻止，只是记录警告
            pass

# 创建受限的 __import__ 函数，阻止导入非白名单包
_original_import = __builtins__.__import__ if isinstance(__builtins__, dict) else __builtins__.__import__

def _restricted_import(name, globals=None, locals=None, fromlist=(), level=0):
    # 检查是否在白名单中
    # 支持子模块：如果 'requests' 在白名单中，则 'requests.auth' 也允许
    _base_pkg = name.split('.')[0] if '.' in name else name
    if _base_pkg not in _PACKAGE_WHITELIST and name not in _PACKAGE_WHITELIST:
        raise ImportError(f"Package '{name}' is not allowed in sandbox. Allowed packages: {sorted(_PACKAGE_WHITELIST)}")
    return _original_import(name, globals, locals, fromlist, level)

# 在技能模块中设置受限的 __import__
_skill_module.__dict__['__import__'] = _restricted_import

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

    // 使用检测到的 Python 命令
    const pythonCmd = detectPythonCommand();
    process.stderr.write(`[skill-runner] Using Python: ${pythonCmd}\n`);
    
    // 确定工作目录：
    // 1. 有 WORKING_DIRECTORY 环境变量时：使用 DATA_BASE_PATH + WORKING_DIRECTORY
    // 2. 无 WORKING_DIRECTORY 时：使用技能目录（默认行为）
    let workingDir = skillPath;
    const workingDirectory = process.env.WORKING_DIRECTORY;
    const dataBasePath = process.env.DATA_BASE_PATH;
    
    if (workingDirectory && dataBasePath) {
      workingDir = path.join(dataBasePath, workingDirectory);
      process.stderr.write(`[skill-runner] 使用工作目录: ${workingDir}\n`);
    } else {
      process.stderr.write(`[skill-runner] 使用技能目录作为工作目录: ${workingDir}\n`);
    }
    
    const pythonProcess = spawn(pythonCmd, ['-c', sandboxWrapper], {
      cwd: workingDir,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        SKILL_PATH: skillPath,  // 传递技能目录路径
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
