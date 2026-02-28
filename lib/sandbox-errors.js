/**
 * SandboxErrors - 沙箱执行器统一错误处理
 * 
 * 提供用户友好的错误消息和错误码
 */

// 错误码定义
export const ErrorCodes = {
  // 平台相关
  UNSUPPORTED_PLATFORM: 'E001',
  SANDBOX_NOT_INSTALLED: 'E002',
  SANDBOX_CONFIG_MISSING: 'E003',
  
  // 权限相关
  PERMISSION_DENIED: 'E101',
  SKILL_NOT_ALLOWED: 'E102',
  ROLE_INSUFFICIENT: 'E103',
  
  // 执行相关
  COMMAND_TIMEOUT: 'E201',
  COMMAND_FAILED: 'E202',
  DANGEROUS_COMMAND: 'E203',
  
  // 文件相关
  PATH_ACCESS_DENIED: 'E301',
  FILE_NOT_FOUND: 'E302',
  
  // 未知错误
  UNKNOWN_ERROR: 'E999',
};

// 错误码描述
export const ErrorCodeDescriptions = {
  [ErrorCodes.UNSUPPORTED_PLATFORM]: {
    message: '当前操作系统不支持沙箱隔离功能',
    suggestion: '请使用 Windows (安装 Sandboxie Plus) 或 Linux (安装 Firejail) 系统',
  },
  [ErrorCodes.SANDBOX_NOT_INSTALLED]: {
    message: '系统检测到沙箱软件未安装或不可用',
    suggestion: 'Windows: 安装 Sandboxie Plus | Linux: sudo apt install firejail',
  },
  [ErrorCodes.SANDBOX_CONFIG_MISSING]: {
    message: '用户的沙箱配置不存在',
    suggestion: '请联系系统管理员添加沙箱配置',
  },
  [ErrorCodes.PERMISSION_DENIED]: {
    message: '您没有权限执行此操作',
    suggestion: '请联系管理员提升您的角色权限',
  },
  [ErrorCodes.SKILL_NOT_ALLOWED]: {
    message: '当前角色无法使用此技能',
    suggestion: '请检查您的角色权限或联系管理员',
  },
  [ErrorCodes.ROLE_INSUFFICIENT]: {
    message: '您的角色权限不足以执行此操作',
    suggestion: '此操作需要更高权限的角色',
  },
  [ErrorCodes.COMMAND_TIMEOUT]: {
    message: '命令执行时间过长，已被终止',
    suggestion: '请尝试增加超时时间或优化命令',
  },
  [ErrorCodes.COMMAND_FAILED]: {
    message: '命令执行返回非零退出码',
    suggestion: '请检查命令语法和参数',
  },
  [ErrorCodes.DANGEROUS_COMMAND]: {
    message: '检测到危险命令，已被阻止',
    suggestion: '此命令可能对系统造成损害',
  },
  [ErrorCodes.PATH_ACCESS_DENIED]: {
    message: '您没有权限访问此路径',
    suggestion: '请确保路径在允许访问的目录范围内',
  },
  [ErrorCodes.FILE_NOT_FOUND]: {
    message: '指定的文件或目录不存在',
    suggestion: '请检查路径是否正确',
  },
  [ErrorCodes.UNKNOWN_ERROR]: {
    message: '发生了一个未知错误',
    suggestion: '请查看详细错误信息或联系技术支持',
  },
};

// 用户友好的错误消息
const ErrorMessages = {
  [ErrorCodes.UNSUPPORTED_PLATFORM]: {
    title: '平台不支持',
    message: '当前操作系统不支持沙箱隔离功能。',
    solution: '请使用 Windows (安装 Sandboxie Plus) 或 Linux (安装 Firejail) 系统。',
  },
  [ErrorCodes.SANDBOX_NOT_INSTALLED]: {
    title: '沙箱未安装',
    message: '系统检测到沙箱软件未安装或不可用。',
    solution: {
      windows: '请安装 Sandboxie Plus: https://github.com/sandboxie-plus/Sandboxie',
      linux: '请运行: sudo apt install firejail',
    },
  },
  [ErrorCodes.SANDBOX_CONFIG_MISSING]: {
    title: '沙箱配置缺失',
    message: '用户的沙箱配置不存在，需要管理员配置。',
    solution: '请联系系统管理员添加沙箱配置，或查看日志中的配置模板。',
  },
  [ErrorCodes.PERMISSION_DENIED]: {
    title: '权限不足',
    message: '您没有权限执行此操作。',
    solution: '请联系管理员提升您的角色权限。',
  },
  [ErrorCodes.SKILL_NOT_ALLOWED]: {
    title: '技能不可用',
    message: '当前角色无法使用此技能。',
    solution: '请检查您的角色是否有权使用该技能，或联系管理员。',
  },
  [ErrorCodes.ROLE_INSUFFICIENT]: {
    title: '角色权限不足',
    message: '您的角色权限不足以执行此操作。',
    solution: '此操作需要更高权限的角色（如 power_user 或 admin）。',
  },
  [ErrorCodes.COMMAND_TIMEOUT]: {
    title: '命令执行超时',
    message: '命令执行时间过长，已被终止。',
    solution: '请尝试增加超时时间，或优化命令执行效率。',
  },
  [ErrorCodes.COMMAND_FAILED]: {
    title: '命令执行失败',
    message: '命令执行返回非零退出码。',
    solution: '请检查命令语法和参数是否正确。',
  },
  [ErrorCodes.DANGEROUS_COMMAND]: {
    title: '危险命令被阻止',
    message: '检测到危险命令，已被系统阻止执行。',
    solution: '此命令可能对系统造成损害，禁止执行。',
  },
  [ErrorCodes.PATH_ACCESS_DENIED]: {
    title: '路径访问被拒绝',
    message: '您没有权限访问此路径。',
    solution: '请确保路径在允许访问的目录范围内。',
  },
  [ErrorCodes.FILE_NOT_FOUND]: {
    title: '文件不存在',
    message: '指定的文件或目录不存在。',
    solution: '请检查路径是否正确。',
  },
  [ErrorCodes.UNKNOWN_ERROR]: {
    title: '未知错误',
    message: '发生了一个未知错误。',
    solution: '请查看详细错误信息，或联系技术支持。',
  },
};

/**
 * 创建沙箱错误对象
 * @param {string} code - 错误码
 * @param {string} details - 详细错误信息
 * @param {Error} originalError - 原始错误对象
 * @param {object} context - 上下文信息
 * @returns {Error} 错误对象
 */
export function createSandboxError(code, details = '', originalError = null, context = {}) {
  const errorInfo = ErrorMessages[code] || ErrorMessages[ErrorCodes.UNKNOWN_ERROR];
  
  const error = new Error(details || errorInfo.message);
  error.code = code;
  error.title = errorInfo.title;
  error.solution = errorInfo.solution;
  error.context = context;
  error.isUserError = true;
  error.originalError = originalError;
  
  // 保留原始错误的堆栈
  if (originalError?.stack) {
    error.stack = originalError.stack;
  }
  
  return error;
}

/**
 * 格式化错误响应
 * @param {Error} error - 错误对象
 * @param {boolean} includeDetails - 是否包含详细信息（调试模式）
 * @returns {object} 格式化的错误响应
 */
export function formatErrorResponse(error, includeDetails = false) {
  const response = {
    success: false,
    error: error.message,
    code: error.code || ErrorCodes.UNKNOWN_ERROR,
    title: error.title || '错误',
    solution: error.solution || null,
  };
  
  if (includeDetails) {
    response.details = {
      stack: error.stack,
      context: error.context,
    };
  }
  
  return response;
}

/**
 * 判断是否为沙箱错误
 * @param {Error} error - 错误对象
 * @returns {boolean}
 */
export function isSandboxError(error) {
  return error && error.isUserError === true;
}

/**
 * 获取用户友好的错误消息
 * @param {string} code - 错误码
 * @returns {object} 错误信息
 */
export function getErrorMessage(code) {
  return ErrorMessages[code] || ErrorMessages[ErrorCodes.UNKNOWN_ERROR];
}

export default {
  ErrorCodes,
  createSandboxError,
  formatErrorResponse,
  isSandboxError,
  getErrorMessage,
};