/**
 * User Code Executor - 用户代码执行器
 * 
 * 在安全沙箱中执行用户自定义代码。
 * 复用 skill-runner 的安全机制。
 */

import vm from 'vm';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// 默认超时配置
const JS_TIMEOUT = parseInt(process.env.VM_TIMEOUT || '30000', 10);
const PYTHON_TIMEOUT = parseInt(process.env.PYTHON_TIMEOUT || '300000', 10);

// 用户工作目录
const USER_WORK_DIR = process.env.WORKING_DIRECTORY 
  ? path.join(process.env.DATA_BASE_PATH || process.cwd(), process.env.WORKING_DIRECTORY)
  : null;

/**
 * 获取工具定义
 */
export function getTools() {
  return [
    {
      name: 'execute_javascript',
      description: '在 VM 沙箱中执行 JavaScript 代码。可以执行内联代码或加载用户工作目录中的脚本文件。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 JavaScript 代码（与 script_path 二选一）'
          },
          script_path: {
            type: 'string',
            description: '脚本文件路径，相对于用户工作目录（与 code 二选一）'
          }
        }
      }
    },
    {
      name: 'execute_python',
      description: '在受限环境中执行 Python 代码。可以执行内联代码或加载用户工作目录中的脚本文件。',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '要执行的 Python 代码（与 script_path 二选一）'
          },
          script_path: {
            type: 'string',
            description: '脚本文件路径，相对于用户工作目录（与 code 二选一）'
          }
        }
      }
    }
  ];
}

/**
 * 执行工具
 */
export async function execute(toolName, params, context) {
  switch (toolName) {
    case 'execute_javascript':
      return await executeJavaScript(params, context);
    case 'execute_python':
      return await executePython(params, context);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

/**
 * 执行 JavaScript 代码
 */
async function executeJavaScript(params, context) {
  const { code: inlineCode, script_path } = params;
  
  // 确定要执行的代码
  let code = inlineCode;
  let source = 'inline';
  
  if (script_path) {
    // 从文件加载代码
    if (!USER_WORK_DIR) {
      throw new Error('用户工作目录未设置，无法加载脚本文件');
    }
    
    // 安全检查：防止路径遍历
    const normalizedPath = path.normalize(script_path);
    if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
      throw new Error(`非法脚本路径: ${script_path}`);
    }
    
    const fullPath = path.join(USER_WORK_DIR, normalizedPath);
    
    // 检查路径是否在工作目录内
    if (!fullPath.startsWith(USER_WORK_DIR)) {
      throw new Error(`脚本路径必须在用户工作目录内`);
    }
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`脚本文件不存在: ${script_path}`);
    }
    
    code = fs.readFileSync(fullPath, 'utf-8');
    source = script_path;
  }
  
  if (!code) {
    throw new Error('请提供 code 或 script_path 参数');
  }
  
  console.log(`[user-code-executor] 执行 JavaScript，来源: ${source}`);
  
  return runInSandbox(code, source);
}

/**
 * 在 VM 沙箱中执行代码
 */
function runInSandbox(code, source = 'inline') {
  const startTime = Date.now();
  
  // 构建沙箱上下文
  const sandbox = {
    // 模块系统
    module: { exports: {} },
    exports: {},
    require: createSafeRequire(),
    
    // 控制台（输出到 stderr）
    console: {
      log: (...args) => console.error('[user-code]', ...args),
      error: (...args) => console.error('[user-code:ERROR]', ...args),
      warn: (...args) => console.error('[user-code:WARN]', ...args),
      info: (...args) => console.error('[user-code:INFO]', ...args),
    },
    
    // 受限的 process
    process: {
      env: { ...process.env },
      cwd: () => USER_WORK_DIR || process.cwd(),
    },
    
    // 全局对象
    Buffer,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    
    // 结果存储
    __result: undefined,
  };
  
  // 包装代码，捕获返回值
  const wrappedCode = `
    (function() {
      try {
        __result = ${code};
        if (__result === undefined) {
          // 如果代码没有返回值，尝试执行
          eval(${JSON.stringify(code)});
        }
      } catch (e) {
        __result = { error: e.message };
      }
    })();
  `;
  
  // 创建上下文
  vm.createContext(sandbox);
  
  try {
    // 执行代码
    vm.runInContext(wrappedCode, sandbox, {
      timeout: JS_TIMEOUT,
      displayErrors: true,
    });
    
    const duration = Date.now() - startTime;
    let result = sandbox.__result;
    
    // 如果结果是模块导出
    if (result === undefined && sandbox.module.exports) {
      const exports = sandbox.module.exports;
      if (Object.keys(exports).length > 0) {
        result = exports;
      }
    }
    
    console.log(`[user-code-executor] 执行成功，耗时: ${duration}ms`);
    
    return {
      success: true,
      result: result,
      duration,
      source,
    };
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[user-code-executor] 执行失败:`, error.message);
    
    // 处理超时
    if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return {
        success: false,
        error: `执行超时（超过 ${JS_TIMEOUT}ms）`,
        duration,
        source,
      };
    }
    
    return {
      success: false,
      error: error.message,
      stack: error.stack,
      duration,
      source,
    };
  }
}

/**
 * 创建安全的 require 函数
 */
function createSafeRequire() {
  // 模块白名单
  const allowedModules = new Set([
    // Node.js 内置模块
    'fs', 'path', 'url', 'querystring', 'crypto',
    'util', 'stream', 'http', 'https', 'zlib',
    'string_decoder', 'buffer', 'events', 'os',
  ]);
  
  return (moduleName) => {
    // 禁止相对路径
    if (moduleName.startsWith('./') || moduleName.startsWith('../')) {
      throw new Error(`相对路径导入不允许: ${moduleName}`);
    }
    
    // 检查白名单
    if (!allowedModules.has(moduleName)) {
      throw new Error(`模块不在白名单中: ${moduleName}`);
    }
    
    // 返回内置模块
    return require(moduleName);
  };
}

/**
 * 执行 Python 代码
 */
async function executePython(params, context) {
  const { code: inlineCode, script_path } = params;
  
  // 确定要执行的代码
  let code = inlineCode;
  let source = 'inline';
  
  if (script_path) {
    // 从文件加载代码
    if (!USER_WORK_DIR) {
      throw new Error('用户工作目录未设置，无法加载脚本文件');
    }
    
    // 安全检查
    const normalizedPath = path.normalize(script_path);
    if (normalizedPath.startsWith('..') || path.isAbsolute(normalizedPath)) {
      throw new Error(`非法脚本路径: ${script_path}`);
    }
    
    const fullPath = path.join(USER_WORK_DIR, normalizedPath);
    
    if (!fullPath.startsWith(USER_WORK_DIR)) {
      throw new Error(`脚本路径必须在用户工作目录内`);
    }
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`脚本文件不存在: ${script_path}`);
    }
    
    code = fs.readFileSync(fullPath, 'utf-8');
    source = script_path;
  }
  
  if (!code) {
    throw new Error('请提供 code 或 script_path 参数');
  }
  
  console.log(`[user-code-executor] 执行 Python，来源: ${source}`);
  
  return runPythonSandbox(code, source);
}

/**
 * 在受限环境中执行 Python 代码
 */
function runPythonSandbox(code, source = 'inline') {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    // Python 沙箱包装器
    const wrapper = `
import sys
import json

# 执行用户代码
_user_code = ${JSON.stringify(code)}
_local_vars = {}

try:
    exec(_user_code, {"__builtins__": __builtins__}, _local_vars)
    
    # 尝试获取结果
    if 'result' in _local_vars:
        _output = {"success": True, "result": _local_vars['result']}
    else:
        _output = {"success": True, "result": None}
        
except Exception as e:
    _output = {"success": False, "error": str(e)}

print(json.dumps(_output))
`;
    
    // 检测 Python 命令
    const pythonCmd = process.env.PYTHON_PATH || 'python3';
    
    const proc = spawn(pythonCmd, ['-c', wrapper], {
      cwd: USER_WORK_DIR || process.cwd(),
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error('[python:stderr]', data.toString());
    });
    
    // 超时控制
    const timeout = setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        error: `执行超时（超过 ${PYTHON_TIMEOUT}ms）`,
        duration: Date.now() - startTime,
        source,
        stderr,
      });
    }, PYTHON_TIMEOUT);
    
    proc.on('close', (code) => {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      
      if (code !== 0) {
        resolve({
          success: false,
          error: `Python 进程退出码: ${code}`,
          duration,
          source,
          stderr,
        });
        return;
      }
      
      try {
        const result = JSON.parse(stdout.trim());
        resolve({
          ...result,
          duration,
          source,
          stderr: stderr || undefined,
        });
      } catch (e) {
        resolve({
          success: false,
          error: `解析输出失败: ${e.message}`,
          output: stdout,
          duration,
          source,
          stderr,
        });
      }
    });
    
    proc.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        success: false,
        error: `启动 Python 进程失败: ${error.message}`,
        duration: Date.now() - startTime,
        source,
      });
    });
  });
}

export default {
  getTools,
  execute,
};