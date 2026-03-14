/**
 * User Code Executor - 用户代码执行器
 * 
 * 在安全沙箱中执行用户自定义代码。
 * 注意：此技能本身已在 skill-runner 的 VM 沙箱中运行，
 * 因此直接使用 eval/Function 执行用户代码即可。
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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
function getTools() {
  return [
    {
      name: 'execute_javascript',
      description: '在当前沙箱中执行 JavaScript 代码。可以执行内联代码或加载用户工作目录中的脚本文件。',
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
            description: '要执行的 Python 代码（与 code 二选一）'
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
async function execute(toolName, params, context) {
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
 * 在当前上下文中执行代码（使用 Function 构造器）
 * 由于此技能已在 skill-runner 的 VM 沙箱中，直接执行即可
 */
function runInSandbox(code, source) {
  const startTime = Date.now();
  const stdout = [];
  const stderr = [];
  
  // 创建自定义 console
  const customConsole = {
    log: (...args) => {
      const msg = args.join(' ');
      stdout.push(msg);
      console.log('[user-code]', msg);
    },
    error: (...args) => {
      const msg = args.join(' ');
      stderr.push(msg);
      console.error('[user-code:ERROR]', msg);
    },
    warn: (...args) => {
      const msg = args.join(' ');
      stderr.push(msg);
      console.error('[user-code:WARN]', msg);
    },
    info: (...args) => {
      const msg = args.join(' ');
      stdout.push(msg);
      console.log('[user-code:INFO]', msg);
    },
  };

  return new Promise((resolve) => {
    // 超时控制
    const timeoutId = setTimeout(() => {
      resolve({
        success: false,
        error: `执行超时（超过 ${JS_TIMEOUT}ms）`,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        duration: Date.now() - startTime,
        source,
      });
    }, JS_TIMEOUT);

    try {
      // 使用 Function 构造器执行代码
      // 创建一个异步函数包装器，支持 async/await
      const wrappedCode = `
        return (async function() {
          ${code}
        })();
      `;
      
      // 创建函数并执行
      const fn = new Function('console', 'require', 'process', wrappedCode);
      const result = fn(customConsole, require, process);
      
      // 处理 Promise 结果
      Promise.resolve(result)
        .then((value) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;
          console.log(`[user-code-executor] 执行成功，耗时: ${duration}ms`);
          
          resolve({
            success: true,
            result: value,
            stdout: stdout.join('\n'),
            stderr: stderr.join('\n'),
            duration,
            source,
          });
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          const duration = Date.now() - startTime;
          console.error(`[user-code-executor] 执行失败:`, error.message);
          
          resolve({
            success: false,
            error: error.message,
            stack: error.stack,
            stdout: stdout.join('\n'),
            stderr: stderr.join('\n'),
            duration,
            source,
          });
        });
    } catch (error) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      console.error(`[user-code-executor] 语法错误:`, error.message);
      
      resolve({
        success: false,
        error: error.message,
        stack: error.stack,
        stdout: stdout.join('\n'),
        stderr: stderr.join('\n'),
        duration,
        source,
      });
    }
  });
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
function runPythonSandbox(code, source) {
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

module.exports = {
  getTools,
  execute,
};
