/**
 * Tool Manager - 工具管理器
 * 负责管理技能、生成工具定义、执行工具调用
 *
 * 工作流程：
 * 1. 从数据库加载专家启用的技能
 * 2. 生成工具定义供 LLM 使用
 * 3. 处理 LLM 的工具调用请求
 * 4. 执行工具并返回结果
 *
 * 注：builtin 工具已迁移为普通技能（data/skills/），所有技能统一通过 skill-runner 执行
 */

import SkillLoader from './skill-loader.js';
import logger from './logger.js';
import { getAssistantManager } from '../server/services/assistant/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs';
import { getDataBasePath } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 内置工具定义
 * 这些工具不依赖技能目录，直接在代码中定义
 */
const BUILTIN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'execute',
      description: `执行 JavaScript 代码或安全的系统命令。支持两种模式：1) javascript - 在 VM 沙箱中执行 JS 代码，可访问 console、Buffer、URL 等基础 API；2) shell - 执行白名单内的安全命令，用于文件查看和文本处理。当前平台: ${isWindowsPlatform() ? 'Windows' : 'Unix/Linux'}。${isWindowsPlatform() ? 'Windows 支持命令: type, dir, find, findstr, echo, cd, date, time, ver, vol, attrib, sort, more, path' : 'Unix 支持命令: cat, head, tail, grep, wc, sort, uniq, cut, tr, diff, ls, pwd, echo, file, stat, which, date, uname, whoami, find'}。安全限制：仅允许相对路径、禁止重定向/管道/命令替换、禁止访问系统目录、30秒超时、1MB输出限制。`,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['javascript', 'shell'],
            description: '执行类型：javascript 表示执行 JS 代码，shell 表示执行系统命令',
          },
          code: {
            type: 'string',
            description: `要执行的代码。当 type=javascript 时为 JS 代码；当 type=shell 时为系统命令。${isWindowsPlatform() ? 'Windows 示例: "dir", "type file.txt", "findstr \"keyword\" file.txt"' : 'Unix 示例: "ls -la", "cat file.txt", "grep -n \"keyword\" file.txt"'}。shell 命令必须使用相对路径，禁止包含 | > < $() \` 等特殊字符。`,
          },
          script_path: {
            type: 'string',
            description: '（可选）脚本文件路径，相对于工作目录。如果提供，将从文件加载代码执行。',
          },
        },
        required: ['type', 'code'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'execute',
      // 权限控制：仅 admin 和 creator 可执行脚本
      allowedRoles: ['admin', 'creator'],
      // 平台信息
      platform: isWindowsPlatform() ? 'windows' : 'unix',
    },
  },
  {
    type: 'function',
    function: {
      name: 'recall',
      description: `回忆历史话题或消息。支持两种查询维度：
1) topic - 查询话题维度：列出话题、搜索话题、获取话题内的消息清单
2) messages - 查询消息维度：列出最近消息（跨话题）、获取单条消息明细

使用方式：
- {mode: 'topic', action: 'list', start: 0, count: 10} 列出最近10个话题
- {mode: 'topic', action: 'search', keyword: 'xxx', start: 0, count: 10} 搜索话题
- {mode: 'topic', action: 'messages', topic_id: 'xxx', start: 0, count: 20} 获取某话题的消息清单
- {mode: 'messages', action: 'list', start: 0, count: 10} 列出最近10条消息（跨话题）
- {mode: 'messages', action: 'detail', message_id: 'xxx'} 获取单条消息完整内容`,
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['topic', 'messages'],
            description: '查询维度：topic 查询话题，messages 查询消息',
          },
          action: {
            type: 'string',
            enum: ['list', 'search', 'messages', 'detail'],
            description: '操作类型：list 列出，search 搜索话题（mode=topic时），messages 获取消息清单（mode=topic时），detail 获取明细（mode=messages时）',
          },
          topic_id: {
            type: 'string',
            description: '话题ID。mode=topic 且 action=messages 时必填',
          },
          message_id: {
            type: 'string',
            description: '消息ID。mode=messages 且 action=detail 时必填',
          },
          keyword: {
            type: 'string',
            description: '搜索关键词。mode=topic 且 action=search 时必填',
          },
          start: {
            type: 'integer',
            description: '分页起始位置（从0开始）。默认 0',
          },
          count: {
            type: 'integer',
            description: '查询数量。默认 10',
          },
        },
        required: ['mode', 'action'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'recall',
    },
  },
  // Notes 工具 - Psyche 上下文管理的手抄功能
  {
    type: 'function',
    function: {
      name: 'notes.take',
      description: '将材料存入 Notes，供后续对话使用。当获取到大量信息（如搜索结果、文档内容、历史消息）时，提取关键信息存入 Notes，避免重复查询。',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '笔记标识，用于后续读取。建议使用有意义的名称，如 "q1_budget"、"server_config"。',
          },
          content: {
            type: 'string',
            description: '笔记内容，可以是关键信息摘要、配置参数、搜索结果等。',
          },
          type: {
            type: 'string',
            description: '笔记类型，如 "search_result"、"document"、"config"、"history" 等，用于分类管理。',
          },
          relevance: {
            type: 'number',
            description: '相关性评分（0-1），表示此笔记对当前任务的重要程度。高相关性笔记更不容易被自动遗忘。',
          },
        },
        required: ['key', 'content'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'notes.take',
    },
  },
  {
    type: 'function',
    function: {
      name: 'notes.read',
      description: '从 Notes 加载笔记内容。当 Psyche 中显示有可用笔记时，使用此工具获取详细内容。',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: '笔记标识，即之前使用 notes.take 存储时使用的 key。',
          },
        },
        required: ['key'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'notes.read',
    },
  },
  {
    type: 'function',
    function: {
      name: 'notes.list',
      description: '列出当前 Notes 中的所有笔记清单，查看有哪些可用材料。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    _meta: {
      builtin: true,
      toolName: 'notes.list',
    },
  },
];

/**
 * 检测当前平台
 * @returns {boolean} 是否为 Windows 平台
 */
function isWindowsPlatform() {
  return process.platform === 'win32';
}

/**
 * Unix 平台 Shell 命令白名单
 * 只允许执行这些安全的只读命令
 */
const UNIX_COMMAND_WHITELIST = [
  // 文本处理类（只读）
  'cat', 'head', 'tail', 'grep', 'wc', 'sort', 'uniq', 'cut', 'tr', 'diff',
  // 信息查看类
  'ls', 'pwd', 'echo', 'file', 'stat', 'which',
  // 系统信息类
  'date', 'uname', 'whoami',
  // 文件查找（禁止 -exec, -delete）
  'find',
];

/**
 * Windows 平台 Shell 命令白名单
 * Windows 使用 cmd.exe 内置命令和部分 Unix 工具
 */
const WINDOWS_COMMAND_WHITELIST = [
  // 文件查看（对应 Unix 的 cat）
  'type',
  // 目录列表（对应 Unix 的 ls）
  'dir',
  // 查找文本（对应 Unix 的 grep）
  'find', 'findstr',
  // 信息查看
  'echo', 'cd', 'pwd',
  // 系统信息
  'date', 'time', 'ver', 'vol',
  // 文件信息
  'attrib',
  // 排序
  'sort',
  // 更多命令（分页查看）
  'more',
  // 路径
  'path',
  // 注意：copy 命令已移除，因为它可以覆盖文件造成安全风险
];

/**
 * 获取当前平台的命令白名单
 * @returns {string[]} 当前平台允许执行的命令列表
 */
function getPlatformWhitelist() {
  return isWindowsPlatform() ? WINDOWS_COMMAND_WHITELIST : UNIX_COMMAND_WHITELIST;
}

// 移除 awk 和 sed - 它们可以执行任意代码或修改文件
// awk 'BEGIN {system("rm -rf /")}'
// sed -i 's/a/b/' file (原地修改)

/**
 * 危险参数模式（正则表达式）
 * 如果命令参数匹配这些模式，将拒绝执行
 */
const DANGEROUS_ARG_PATTERNS = [
  // 重定向和管道操作
  />/,            // 输出重定向 >, >>
  /</,            // 输入重定向 <
  /\|/,           // 管道 |
  
  // 命令替换和子shell
  /\$\(/,         // 命令替换 $(...)
  /`/,            // 命令替换 `...`
  /\$\{/,         // 变量扩展 ${...}
  
  // 逻辑控制符
  /&&/,           // 逻辑与
  /\|\|/,        // 逻辑或
  /;/,            // 命令分隔符
  
  // 危险命令
  /\brm\b/,       // rm 命令
  /\bsh\b/,       // sh 命令
  /\bbash\b/,     // bash 命令
  /\bcurl\b/,     // curl 命令
  /\bwget\b/,     // wget 命令
  /\bnc\b/,       // netcat
  /\bpython\b/,   // python
  /\bnode\b/,     // node
  /\bperl\b/,     // perl
  /\bruby\b/,     // ruby
  
  // 特殊参数
  /-exec/,        // find -exec
  /-delete/,      // find -delete
  /-ok/,          // find -ok (交互式 -exec)
  /-execdir/,     // find -execdir
  /-okdir/,       // find -okdir
];

/**
 * 危险路径模式
 * 禁止访问敏感系统路径
 */
const DANGEROUS_PATH_PATTERNS = [
  // Unix 绝对路径（以 / 开头）
  /^\//,
  // Windows 绝对路径（如 C:\, D:\, \\server\share）
  /^[a-zA-Z]:\\/,
  /^\\\\/,
  // 父目录引用 ../ 或 ..\
  /\.\.\//,
  /\.\.\\/,
  // Unix 系统目录
  /\/etc\//,
  /\/proc\//,
  /\/sys\//,
  /\/dev\//,
  /\/root\//,
  /\/home\/[^/]+\/\./,
  // Windows 系统目录
  /\\Windows\\/i,
  /\\System32\\/i,
  /\\Program Files\\/i,
  /\\ProgramData\\/i,
  /\\Users\\[^\\]+\\/i,
  // 敏感文件和目录
  /\.env/,
  /\.ssh/,
  /\.git/,
  /config.*\.json/i,
  /password/i,
  /secret/i,
  /token/i,
];

/**
 * 验证 shell 命令是否安全
 * @param {string} command - 用户输入的命令
 * @returns {object} { safe: boolean, command?: string, error?: string }
 */
function validateShellCommand(command) {
  if (!command || typeof command !== 'string') {
    return { safe: false, error: 'Command is empty or invalid' };
  }

  // 去除首尾空白
  const trimmedCommand = command.trim();
  
  // 提取命令名（第一个单词）
  const firstSpaceIndex = trimmedCommand.search(/\s/);
  const cmdName = firstSpaceIndex > 0
    ? trimmedCommand.substring(0, firstSpaceIndex)
    : trimmedCommand;
  
  // 检查命令是否在白名单中
  const whitelist = getPlatformWhitelist();
  if (!whitelist.includes(cmdName)) {
    const platform = isWindowsPlatform() ? 'Windows' : 'Unix/Linux';
    return {
      safe: false,
      error: `Command "${cmdName}" is not in the ${platform} whitelist. Allowed commands: ${whitelist.join(', ')}`
    };
  }

  // 检查是否包含危险参数
  for (const pattern of DANGEROUS_ARG_PATTERNS) {
    if (pattern.test(trimmedCommand)) {
      return {
        safe: false,
        error: `Command contains dangerous pattern. Only read-only operations are allowed.`
      };
    }
  }

  // 检查路径参数是否包含危险路径
  const args = trimmedCommand.substring(firstSpaceIndex + 1).trim();
  if (args) {
    // 分割参数（简单处理，不考虑引号内的空格）
    const argList = args.split(/\s+/);
    for (const arg of argList) {
      // 跳过选项参数（以 - 开头）
      if (arg.startsWith('-')) continue;
      
      // 检查路径参数
      for (const pathPattern of DANGEROUS_PATH_PATTERNS) {
        if (pathPattern.test(arg)) {
          return {
            safe: false,
            error: `Path "${arg}" is not allowed for security reasons. Only relative paths within the working directory are permitted.`
          };
        }
      }
    }
  }

  // 特殊检查：find 命令禁止 -exec, -delete, -ok, -execdir, -okdir
  if (cmdName === 'find') {
    const dangerousFindOptions = /-(exec|delete|ok|execdir|okdir)\b/;
    if (dangerousFindOptions.test(trimmedCommand)) {
      return {
        safe: false,
        error: 'find command with -exec, -delete, -ok, -execdir, or -okdir is not allowed for security reasons.'
      };
    }
  }

  return { safe: true, command: trimmedCommand };
}

/**
 * 执行安全的 shell 命令
 * @param {string} command - 要执行的命令
 * @param {string} workingDirectory - 工作目录（相对于 DATA_BASE_PATH）
 * @param {number} timeout - 超时时间（毫秒）
 * @returns {Promise<object>} 执行结果
 */
async function executeSafeShell(command, workingDirectory, timeout = 30000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // 验证命令
    const validation = validateShellCommand(command);
    if (!validation.safe) {
      resolve({
        success: false,
        error: validation.error,
        stdout: '',
        stderr: '',
        exitCode: -1,
      });
      return;
    }

    // 获取 DATA_BASE_PATH
    const dataBasePath = getDataBasePath();
    
    // 拼接完整工作目录路径
    let cwd;
    if (workingDirectory) {
      // 如果 workingDirectory 已经是绝对路径，直接使用
      if (path.isAbsolute(workingDirectory)) {
        cwd = workingDirectory;
      } else {
        // 否则拼接 DATA_BASE_PATH
        cwd = path.join(dataBasePath, workingDirectory);
      }
    } else {
      cwd = dataBasePath;
    }
    
    // 检查工作目录是否存在
    if (cwd && !fs.existsSync(cwd)) {
      try {
        fs.mkdirSync(cwd, { recursive: true });
      } catch (err) {
        logger.warn(`[ToolManager] 创建工作目录失败: ${cwd}`, err.message);
        cwd = dataBasePath;
      }
    }
    
    // 红色输出工作目录信息（用于调试，输出到 stderr 避免污染 stdout）
    process.stderr.write(`\x1b[31m[executeSafeShell] 工作目录信息:\x1b[0m\n`);
    process.stderr.write(`\x1b[31m[executeSafeShell]   DATA_BASE_PATH = ${dataBasePath}\x1b[0m\n`);
    process.stderr.write(`\x1b[31m[executeSafeShell]   传入的 workingDirectory = ${workingDirectory || '(空)'}\x1b[0m\n`);
    process.stderr.write(`\x1b[31m[executeSafeShell]   拼接后的完整路径 = ${cwd}\x1b[0m\n`);
    process.stderr.write(`\x1b[31m[executeSafeShell]   执行的命令 = ${command}\x1b[0m\n`);

    // 设置输出限制（最大 1MB）
    const MAX_OUTPUT_SIZE = 1024 * 1024;
    let stdout = '';
    let stderr = '';
    let killed = false;

    // 使用 cmd.exe /c 执行命令（Windows）或 sh -c（Unix）
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : 'sh';
    const shellFlag = isWindows ? '/c' : '-c';
    
    // 构建受限的环境变量，只传递必要的变量
    const restrictedEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      LANG: process.env.LANG,
      LC_ALL: process.env.LC_ALL,
      // Windows 特定
      SystemRoot: process.env.SystemRoot,
      windir: process.env.windir,
      NUMBER_OF_PROCESSORS: process.env.NUMBER_OF_PROCESSORS,
    };

    const proc = spawn(shell, [shellFlag, validation.command], {
      cwd: cwd || process.cwd(),
      env: restrictedEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // 设置超时
    const timeoutId = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      // 5秒后强制终止
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    proc.stdout.on('data', (data) => {
      if (killed) return;
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_SIZE) {
        killed = true;
        proc.kill('SIGTERM');
        stdout = stdout.substring(0, MAX_OUTPUT_SIZE) + '\n...[output truncated]';
      }
    });

    proc.stderr.on('data', (data) => {
      if (killed) return;
      stderr += data.toString();
      if (stderr.length > MAX_OUTPUT_SIZE) {
        stderr = stderr.substring(0, MAX_OUTPUT_SIZE) + '\n...[stderr truncated]';
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      
      if (killed && code === null) {
        resolve({
          success: false,
          error: `Command timed out after ${timeout}ms or exceeded output limit`,
          stdout: stdout.substring(0, 10000),
          stderr: stderr.substring(0, 10000),
          exitCode: -1,
          duration,
        });
      } else {
        resolve({
          success: code === 0,
          stdout: stdout.substring(0, 10000), // 限制返回大小
          stderr: stderr.substring(0, 10000),
          exitCode: code,
          duration,
        });
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: `Failed to execute command: ${error.message}`,
        stdout: '',
        stderr: '',
        exitCode: -1,
        duration: Date.now() - startTime,
      });
    });
  });
}

class ToolManager {
  /**
   * @param {Database} db - 数据库实例
   * @param {string} expertId - 专家ID
   * @param {object} options - 配置选项
   */
  constructor(db, expertId, options = {}) {
    this.db = db;
    this.expertId = expertId;
    this.options = options;

    // 技能加载器
    this.skillLoader = new SkillLoader(db, options);

    // 已加载的技能
    this.skills = new Map();

    // 工具 ID 到技能的映射（toolId -> skillId）
    this.toolToSkill = new Map();

    // 工具注册表（toolId -> { skillId, skillName, toolName }）
    this.toolRegistry = new Map();

    // 是否已初始化
    this.initialized = false;
  }

  /**
   * 初始化工具管理器
   * 加载专家启用的所有技能
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    logger.info(`[ToolManager] 初始化专家 ${this.expertId} 的工具管理器`);

    // 加载专家技能
    const skills = await this.skillLoader.loadSkillsForExpert(this.expertId);

    // 注册技能
    for (const skill of skills) {
      this.registerSkill(skill);
    }

    this.initialized = true;
    logger.info(`[ToolManager] 初始化完成，注册了 ${this.skills.size} 个技能，${this.toolToSkill.size} 个工具`);
  }

  /**
   * 重新加载技能（用于动态更新）
   */
  async reload() {
    logger.info(`[ToolManager] 重新加载技能`);

    // 清除当前状态
    this.skills.clear();
    this.toolToSkill.clear();
    this.toolRegistry.clear();
    this.initialized = false;

    // 清除缓存
    this.skillLoader.invalidateCache();

    // 重新初始化
    await this.initialize();
  }

  /**
   * 注册技能
   * @param {object} skill - 技能实例
   */
  registerSkill(skill) {
    if (!skill || !skill.id) {
      logger.warn('[ToolManager] 尝试注册无效的技能');
      return;
    }

    this.skills.set(skill.id, skill);

    // 获取该技能提供的工具
    const tools = this.skillLoader.getToolDefinitions(skill);

    // 建立工具 ID 到技能的映射，并填充 toolRegistry
    for (const tool of tools) {
      const toolId = this.extractToolName(tool);
      if (toolId) {
        // 使用 _meta 中的信息
        const skillId = tool._meta?.skillId || skill.id;
        const skillName = tool._meta?.skillName || skill.name || skillId;
        const toolName = tool._meta?.toolName || toolId;
        const scriptPath = tool._meta?.scriptPath || 'index.js';  // 工具入口脚本路径
        
        // 映射 toolId -> skillId
        this.toolToSkill.set(toolId, skillId);
        
        // 注册到 toolRegistry（用于显示和执行）
        this.toolRegistry.set(toolId, {
          skillId,
          skillName,
          toolName,
          scriptPath,  // 添加脚本路径
        });
        
        logger.debug(`[ToolManager] 注册工具: ${toolId} -> ${skillId} (${skillName}/${toolName}, script: ${scriptPath})`);
      }
    }
  }

  /**
   * 提取工具名称
   * @param {object} tool - 工具定义
   * @returns {string|null} 工具名称
   */
  extractToolName(tool) {
    // OpenAI 格式: { type: 'function', function: { name: 'toolName' } }
    if (tool?.function?.name) {
      return tool.function.name;
    }

    // 简化格式: { name: 'toolName' }
    if (tool?.name) {
      return tool.name;
    }

    return null;
  }

  /**
   * 获取所有工具定义（供 LLM 使用）
   * @returns {Array} OpenAI 格式的工具定义数组（不含 _meta，节省 token）
   */
  getToolDefinitions() {
    const definitions = [];

    // 添加内置工具（execute_javascript 等）
    for (const tool of BUILTIN_TOOLS) {
      const { _meta, ...llmTool } = tool;
      definitions.push(llmTool);
    }

    // 添加所有技能工具
    for (const skill of this.skills.values()) {
      const tools = this.skillLoader.getToolDefinitions(skill);
      // 移除 _meta 字段，不发送给 LLM（节省 token）
      for (const tool of tools) {
        const { _meta, ...llmTool } = tool;
        definitions.push(llmTool);
      }
    }

    // 添加助理工具（核心服务工具）
    try {
      const assistantManager = getAssistantManager(this.db);
      if (assistantManager) {
        const assistantTools = assistantManager.getAssistantTools();
        definitions.push(...assistantTools);
      }
    } catch (err) {
      logger.warn('[ToolManager] 获取助理工具失败:', err.message);
    }

    return definitions;
  }

  /**
   * 检查是否有可用工具
   * @returns {boolean}
   */
  hasTools() {
    return this.toolToSkill.size > 0;
  }

  /**
   * 格式化工具显示名称（用于日志和 UI）
   * @param {string} toolId - 工具 ID（skill_tools.id）
   * @returns {string} 友好的显示名称，如 "SearXNG/web_search"
   */
  formatToolDisplay(toolId) {
    const info = this.toolRegistry.get(toolId);
    if (!info) {
      return toolId;  // 未找到，返回原始 ID
    }
    return `${info.skillName}/${info.toolName}`;
  }

  /**
   * 获取工具的详细信息
   * @param {string} toolId - 工具 ID
   * @returns {object|null} 工具信息 { skillId, skillName, toolName }
   */
  getToolInfo(toolId) {
    return this.toolRegistry.get(toolId) || null;
  }

  /**
   * 执行工具调用
   * 所有技能统一通过 skill-runner 子进程隔离执行
   * 支持驻留工具（resident:// 协议）直接调用 ResidentSkillManager
   *
   * @param {string} toolId - 工具 ID（toolName__skillIdShort 格式）
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} context.userId - 用户ID
   * @param {string} context.expertId - 专家ID
   * @param {string} context.accessToken - 用户 JWT Token（用于 API 调用）
   * @param {object} context.memorySystem - 记忆系统实例（可选）
   * @param {object} context.taskContext - 任务上下文（包含工作空间路径）
   * @param {Array} context.roles - 用户角色列表（用于权限检查）
   * @returns {Promise<object>} 工具执行结果
   */
  async executeTool(toolId, params, context = {}) {
    const display = this.formatToolDisplay(toolId);
    logger.info(`[ToolManager] 执行工具: ${display}`, { toolId, params });

    // 检查是否是内置工具
    const builtinTool = BUILTIN_TOOLS.find(t => t.function.name === toolId);
    if (builtinTool) {
      return await this.executeBuiltinTool(toolId, params, context, display);
    }

    // 检查是否是助理工具（核心服务）
    const assistantTools = ['assistant_summon', 'assistant_roster'];
    if (assistantTools.includes(toolId)) {
      try {
        const assistantManager = getAssistantManager(this.db);
        if (assistantManager) {
          return await assistantManager.executeTool(toolId, params, {
            expertId: context.expertId || context.expert_id,
            userId: context.userId || context.user_id,
            contactId: context.contactId,
            topicId: context.topicId,
            taskContext: context.taskContext,  // 传递任务上下文（包含工作空间路径）
          });
        }
      } catch (err) {
        logger.error(`[ToolManager] 执行助理工具失败: ${toolId}`, err.message);
        return { success: false, error: err.message };
      }
    }

    // 从 toolRegistry 获取工具信息
    const toolInfo = this.toolRegistry.get(toolId);
    if (!toolInfo) {
      return {
        success: false,
        error: `Tool not found: ${toolId}`,
      };
    }

    const { skillId, toolName, scriptPath } = toolInfo;

    // 检查是否是驻留工具（resident:// 协议）
    if (scriptPath && scriptPath.startsWith('resident://')) {
      return await this.executeResidentTool(scriptPath, skillId, params, context, display, toolId);
    }

    // 通过子进程隔离执行
    const skill = this.skills.get(skillId);
    if (!skill) {
      return {
        success: false,
        error: `Skill not found: ${skillId}`,
      };
    }

    try {
      const startTime = Date.now();

      // 兼容 userId/user_id 和 expertId/expert_id 两种格式
      const userId = context.userId || context.user_id;
      const expertId = context.expertId || context.expert_id;
      const accessToken = context.accessToken;  // 用户 JWT Token
      const taskContext = context.taskContext;  // 任务上下文

      // 确定工作目录：
      // 1. 有任务时：使用任务工作空间路径（如 work/userId/taskId）
      // 2. 无任务时：使用用户 temp 目录（如 work/userId/temp）
      let workingDirectory;
      if (taskContext?.fullWorkspacePath) {
        workingDirectory = taskContext.fullWorkspacePath;
        logger.info(`[ToolManager] 使用任务工作目录: ${workingDirectory}`);
      } else if (userId) {
        workingDirectory = `work/${userId}/temp`;
        logger.info(`[ToolManager] 使用用户 temp 目录: ${workingDirectory}`);
      } else {
        workingDirectory = null;
        logger.warn(`[ToolManager] 无法确定工作目录，userId 为空`);
      }

      // 使用 toolRegistry 中的 toolName（原始工具名称）和 scriptPath
      const result = await this.skillLoader.executeSkillTool(
        skillId,
        toolName,  // 使用原始工具名称
        params,
        {
          userId,
          expertId,
          accessToken,  // 传递用户 Token
          workingDirectory,  // 传递工作目录
          isAdmin: context?.session?.isAdmin || false,  // 从 session 读取管理员标识
          isSkillCreator: context?.session?.roles?.includes('creator') || false,  // 从 session 读取技能创作者标识
        },
        scriptPath || 'index.js',  // 传递脚本路径
      );
      
      const duration = Date.now() - startTime;

      logger.info(`[ToolManager] 工具执行成功: ${display} (${duration}ms)`);

      return {
        success: true,
        data: result,
        toolId,
        toolName: display,  // 返回友好名称
        duration,
      };
    } catch (error) {
      logger.error(`[ToolManager] 工具执行失败: ${display}`, error.message);

      return {
        success: false,
        error: error.message,
        toolId,
        toolName: display,
      };
    }
  }

  /**
   * 执行内置工具
   * @param {string} toolId - 工具 ID
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeBuiltinTool(toolId, params, context, display) {
    logger.info(`[ToolManager] 执行内置工具: ${toolId}`);

    // 获取内置工具定义
    const builtinTool = BUILTIN_TOOLS.find(t => t.function.name === toolId);
    
    // 权限检查：检查 allowedRoles
    if (builtinTool?._meta?.allowedRoles) {
      const userRole = this.getUserRole(context);
      const allowedRoles = builtinTool._meta.allowedRoles;
      
      if (!allowedRoles.includes(userRole)) {
        logger.warn(`[ToolManager] 权限拒绝: 用户角色 ${userRole} 无权执行 ${toolId}`);
        return {
          success: false,
          error: `Permission denied: Only ${allowedRoles.join(' and ')} can execute ${toolId}`,
          toolId,
          toolName: display,
          permissionDenied: true,
        };
      }
    }

    // 执行 execute（支持 javascript 和 shell 两种类型）
    if (toolId === 'execute') {
      return await this.executeCode(params, context, display);
    }

    // 执行 recall
    if (toolId === 'recall') {
      return await this.executeRecall(params, context, display);
    }

    // 执行 Notes 工具
    if (toolId.startsWith('notes.')) {
      return await this.executeNotesTool(toolId, params, context, display);
    }

    // 未知内置工具
    return {
      success: false,
      error: `Builtin tool not implemented: ${toolId}`,
      toolId,
      toolName: display,
    };
  }

  /**
   * 获取用户角色（用于权限检查）
   * @param {object} context - 执行上下文
   * @returns {string} 用户角色
   */
  getUserRole(context) {
    // 从 context.session.roles 数组中获取最高权限角色
    const roles = context?.session?.roles || [];
    
    // 角色优先级：admin > creator > user
    if (roles.includes('admin')) {
      return 'admin';
    }
    if (roles.includes('creator')) {
      return 'creator';
    }
    
    return 'user';
  }

  /**
   * 执行代码（JavaScript 或 Shell）
   * 统一处理 execute 工具的执行逻辑
   *
   * @param {object} params - 工具参数
   * @param {string} params.type - 执行类型：'javascript' 或 'shell'
   * @param {string} params.code - 要执行的代码或命令
   * @param {string} params.script_path - 可选的脚本路径
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeCode(params, context, display) {
    const startTime = Date.now();
    const { type, code, script_path } = params;

    // 参数校验
    if (!type || !['javascript', 'shell'].includes(type)) {
      return {
        success: false,
        error: 'Missing or invalid required parameter: type (must be "javascript" or "shell")',
        toolId: 'execute',
        toolName: display,
      };
    }

    if (!code) {
      return {
        success: false,
        error: 'Missing required parameter: code',
        toolId: 'execute',
        toolName: display,
      };
    }

    // 确定工作目录
    const userId = context.userId || context.user_id;
    const taskContext = context.taskContext;
    let workingDirectory;
    if (taskContext?.fullWorkspacePath) {
      workingDirectory = taskContext.fullWorkspacePath;
    } else if (userId) {
      workingDirectory = `work/${userId}/temp`;
    }

    try {
      let result;

      if (type === 'javascript') {
        // 执行 JavaScript 代码
        result = await this.skillLoader.executeUserCode(code, {
          userId,
          expertId: context.expertId || context.expert_id,
          accessToken: context.accessToken,
          workingDirectory,
          isAdmin: context?.session?.isAdmin || false,
          isSkillCreator: context?.session?.roles?.includes('creator') || false,
        }, script_path);
      } else if (type === 'shell') {
        // 执行 Shell 命令
        result = await executeSafeShell(code, workingDirectory, 30000);
      }

      const duration = Date.now() - startTime;
      logger.info(`[ToolManager] execute 工具执行成功: ${type} (${duration}ms)`);

      return {
        success: true,
        data: result,
        toolId: 'execute',
        toolName: display,
        duration,
        type,
      };
    } catch (error) {
      logger.error(`[ToolManager] execute 工具执行失败: ${type}`, error.message);
      return {
        success: false,
        error: error.message,
        toolId: 'execute',
        toolName: display,
        type,
      };
    }
  }

  /**
   * 执行 recall 工具（重构版）
   * 采用 mode + action 双参数结构
   * 
   * mode: topic - 查询话题维度
   *   - action: list - 列出话题
   *   - action: messages - 获取某话题的消息清单
   * 
   * mode: messages - 查询消息维度
   *   - action: list - 列出最近消息（跨话题）
   *   - action: detail - 获取单条消息明细
   *
   * @param {object} params - 工具参数
   * @param {string} params.mode - 'topic' | 'messages'
   * @param {string} params.action - 'list' | 'messages' | 'detail'
   * @param {string} params.topic_id - 话题ID（mode=topic, action=messages时必填）
   * @param {string} params.message_id - 消息ID（mode=messages, action=detail时必填）
   * @param {number} params.start - 分页起始（默认 0）
   * @param {number} params.count - 数量（默认 10）
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeRecall(params, context, display) {
    const startTime = Date.now();
    const { mode, action, topic_id, message_id, keyword, start = 0, count = 10 } = params;
    const userId = context.userId || context.user_id;

    // 日志：keyword 可能包含敏感信息，截断显示
    const keywordForLog = keyword ? `${keyword.substring(0, 20)}${keyword.length > 20 ? '...' : ''}` : null;
    logger.info(`[ToolManager] recall: mode=${mode}, action=${action}, topic_id=${topic_id}, message_id=${message_id}, keyword=${keywordForLog}, start=${start}, count=${count}, user=${userId}`);

    // 参数校验
    if (!mode || !['topic', 'messages'].includes(mode)) {
      return {
        success: false,
        error: `Invalid mode: ${mode}. Must be 'topic' or 'messages'`,
        toolId: 'recall',
        toolName: display,
      };
    }

    if (!action || !['list', 'search', 'messages', 'detail'].includes(action)) {
      return {
        success: false,
        error: `Invalid action: ${action}. Must be 'list', 'search', 'messages', or 'detail'`,
        toolId: 'recall',
        toolName: display,
      };
    }

    try {
      // ====== Topic 模式 ======
      if (mode === 'topic') {
        if (action === 'list') {
          return await this.recallTopicList(context, userId, start, count, display, startTime);
        }
        if (action === 'search') {
          if (!keyword || keyword.trim() === '') {
            return {
              success: false,
              error: 'keyword is required when mode=topic and action=search',
              toolId: 'recall',
              toolName: display,
            };
          }
          return await this.recallTopicSearch(context, userId, keyword, start, count, display, startTime);
        }
        if (action === 'messages') {
          if (!topic_id) {
            return {
              success: false,
              error: 'topic_id is required when mode=topic and action=messages',
              toolId: 'recall',
              toolName: display,
            };
          }
          return await this.recallTopicMessages(topic_id, userId, start, count, display, startTime);
        }
      }

      // ====== Messages 模式 ======
      if (mode === 'messages') {
        if (action === 'list') {
          return await this.recallMessagesList(userId, start, count, display, startTime);
        }
        if (action === 'detail') {
          if (!message_id) {
            return {
              success: false,
              error: 'message_id is required when mode=messages and action=detail',
              toolId: 'recall',
              toolName: display,
            };
          }
          return await this.recallMessageDetail(message_id, userId, display, startTime);
        }
      }

      // 未识别的组合
      return {
        success: false,
        error: `Unsupported combination: mode=${mode}, action=${action}`,
        toolId: 'recall',
        toolName: display,
      };

    } catch (error) {
      logger.error(`[ToolManager] recall 执行失败:`, error.message);
      return {
        success: false,
        error: error.message,
        toolId: 'recall',
        toolName: display,
      };
    }
  }

  /**
   * recall: mode=topic, action=list
   * 列出最近话题
   */
  async recallTopicList(context, userId, start, count, display, startTime) {
    const memorySystem = context.memorySystem;
    if (!memorySystem) {
      return {
        success: false,
        error: 'MemorySystem not available in context',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 获取话题（不限制状态）
    // TODO: MemorySystem 需要支持 offset 参数以实现真正的分页
    const MAX_TOPICS = 1000; // 临时方案：查询足够大的数量
    const topics = await memorySystem.getTopics(userId, MAX_TOPICS, null);
    logger.info(`[ToolManager] recall topic list: 查询到 ${topics?.length || 0} 个话题`);

    if (!topics || topics.length === 0) {
      return {
        success: true,
        data: {
          mode: 'topic',
          action: 'list',
          total_count: 0,
          start,
          count: 0,
          topics: [],
        },
        toolId: 'recall',
        toolName: display,
        duration: Date.now() - startTime,
      };
    }

    // 分页（内存分页，非数据库分页）
    const paginatedTopics = topics.slice(start, start + count);

    return {
      success: true,
      data: {
        mode: 'topic',
        action: 'list',
        total_count: topics.length,
        start,
        count: paginatedTopics.length,
        topics: paginatedTopics.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          message_count: t.message_count || 0,
          updated_at: t.updated_at,
        })),
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * recall: mode=topic, action=search
   * 搜索话题
   */
  async recallTopicSearch(context, userId, keyword, start, count, display, startTime) {
    const memorySystem = context.memorySystem;
    if (!memorySystem) {
      return {
        success: false,
        error: 'MemorySystem not available in context',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 搜索话题
    // TODO: MemorySystem 需要支持 offset 参数以实现真正的分页
    const MAX_SEARCH_RESULTS = 1000; // 临时方案：查询足够大的数量
    const topics = await memorySystem.searchTopics(userId, keyword, MAX_SEARCH_RESULTS);
    logger.info(`[ToolManager] recall topic search: 搜索 "${keyword}" 找到 ${topics?.length || 0} 个话题`);

    if (!topics || topics.length === 0) {
      return {
        success: true,
        data: {
          mode: 'topic',
          action: 'search',
          keyword,
          total_count: 0,
          start,
          count: 0,
          topics: [],
          message: `未找到包含 "${keyword}" 的话题`,
        },
        toolId: 'recall',
        toolName: display,
        duration: Date.now() - startTime,
      };
    }

    // 分页（内存分页，非数据库分页）
    const paginatedTopics = topics.slice(start, start + count);

    return {
      success: true,
      data: {
        mode: 'topic',
        action: 'search',
        keyword,
        total_count: topics.length,
        start,
        count: paginatedTopics.length,
        topics: paginatedTopics.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          message_count: t.message_count || 0,
          keywords: t.keywords,
          updated_at: t.updated_at,
        })),
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * recall: mode=topic, action=messages
   * 获取某话题的消息清单
   */
  async recallTopicMessages(topicId, userId, start, count, display, startTime) {
    // 验证话题权限
    const Topic = this.db.getModel('topic');
    if (!Topic) {
      return {
        success: false,
        error: 'Topic model not found',
        toolId: 'recall',
        toolName: display,
      };
    }

    const topic = await Topic.findOne({
      where: { id: topicId },
      raw: true,
    });

    if (!topic) {
      return {
        success: false,
        error: `Topic not found: ${topicId}`,
        toolId: 'recall',
        toolName: display,
      };
    }

    if (topic.user_id !== userId) {
      logger.warn(`[ToolManager] 权限拒绝: 用户 ${userId} 尝试访问不属于自己的话题 ${topicId}`);
      return {
        success: false,
        error: 'Permission denied: Topic does not belong to current user',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 获取消息
    const Message = this.db.getModel('message');
    if (!Message) {
      return {
        success: false,
        error: 'Message model not found',
        toolId: 'recall',
        toolName: display,
      };
    }

    const messages = await Message.findAll({
      where: { topic_id: topicId },
      order: [['created_at', 'ASC']],
      offset: start,
      limit: count,
      raw: true,
    });

    // 并行获取总数
    const totalCountPromise = Message.count({ where: { topic_id: topicId } });

    logger.info(`[ToolManager] recall topic messages: topic=${topicId}, 返回 ${messages.length} 条消息`);

    const total_count = await totalCountPromise;

    return {
      success: true,
      data: {
        mode: 'topic',
        action: 'messages',
        topic_id: topicId,
        topic_title: topic.title,
        start,
        count: messages.length,
        total_count,
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content ? m.content.substring(0, 200) + (m.content.length > 200 ? '...' : '') : '',
          has_full_content: (m.content?.length || 0) > 200,
          timestamp: m.created_at,
        })),
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * recall: mode=messages, action=list
   * 列出最近消息（跨话题）
   */
  async recallMessagesList(userId, start, count, display, startTime) {
    const Message = this.db.getModel('message');
    if (!Message) {
      return {
        success: false,
        error: 'Message model not found',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 获取用户最近消息（跨话题，按时间倒序）
    const messages = await Message.findAll({
      where: { user_id: userId },
      order: [['created_at', 'DESC']],
      offset: start,
      limit: count,
      raw: true,
    });

    // 并行查询总数和话题映射
    const totalCountPromise = Message.count({ where: { user_id: userId } });

    logger.info(`[ToolManager] recall messages list: 返回 ${messages.length} 条消息`);

    // 获取话题标题映射
    const topicIds = [...new Set(messages.map(m => m.topic_id).filter(Boolean))];
    const Topic = this.db.getModel('topic');
    let topicMap = new Map();
    if (Topic && topicIds.length > 0) {
      const topics = await Topic.findAll({
        where: { id: topicIds },
        attributes: ['id', 'title'],
        raw: true,
      });
      topicMap = new Map(topics.map(t => [t.id, t.title]));
    }

    const total_count = await totalCountPromise;

    return {
      success: true,
      data: {
        mode: 'messages',
        action: 'list',
        start,
        count: messages.length,
        total_count,
        messages: messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content ? m.content.substring(0, 200) + (m.content.length > 200 ? '...' : '') : '',
          has_full_content: (m.content?.length || 0) > 200,
          topic_id: m.topic_id,
          topic_title: topicMap.get(m.topic_id) || null,
          timestamp: m.created_at,
        })),
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * recall: mode=messages, action=detail
   * 获取单条消息明细（完整内容）
   */
  async recallMessageDetail(messageId, userId, display, startTime) {
    const Message = this.db.getModel('message');
    if (!Message) {
      return {
        success: false,
        error: 'Message model not found',
        toolId: 'recall',
        toolName: display,
      };
    }

    const message = await Message.findOne({
      where: { id: messageId },
      raw: true,
    });

    if (!message) {
      return {
        success: false,
        error: `Message not found: ${messageId}`,
        toolId: 'recall',
        toolName: display,
      };
    }

    // 权限验证
    if (message.user_id !== userId) {
      logger.warn(`[ToolManager] 权限拒绝: 用户 ${userId} 尝试访问不属于自己的消息 ${messageId}`);
      return {
        success: false,
        error: 'Permission denied: Message does not belong to current user',
        toolId: 'recall',
        toolName: display,
      };
    }

    // 解析 tool_calls JSON
    let toolMetaData = {};
    try {
      toolMetaData = typeof message.tool_calls === 'string'
        ? JSON.parse(message.tool_calls)
        : message.tool_calls || {};
    } catch (e) {
      logger.warn('[ToolManager] 解析 tool_calls 失败:', e.message);
    }

    // 优先从 tool_calls.result 获取完整结果
    let fullContent;
    let isFromResult = false;

    if (toolMetaData.result !== undefined && toolMetaData.result !== null) {
      fullContent = typeof toolMetaData.result === 'string'
        ? toolMetaData.result
        : JSON.stringify(toolMetaData.result);
      isFromResult = true;
      logger.info(`[ToolManager] recall message detail: 从 tool_calls.result 获取完整内容: id=${message.id}, length=${fullContent.length}`);
    } else {
      fullContent = message.content || '';
      logger.info(`[ToolManager] recall message detail: 从 content 获取内容: id=${message.id}, length=${fullContent.length}`);
    }

    return {
      success: true,
      data: {
        mode: 'messages',
        action: 'detail',
        message_id: messageId,
        role: message.role,
        content: fullContent,
        content_length: fullContent.length,
        tool_name: toolMetaData.name || null,
        is_from_result: isFromResult,
        topic_id: message.topic_id,
        timestamp: message.created_at,
      },
      toolId: 'recall',
      toolName: display,
      duration: Date.now() - startTime,
    };
  }

  /**
   * 执行 Notes 工具
   * Psyche 上下文管理的手抄功能
   *
   * @param {string} toolId - 工具 ID（notes.take, notes.read, notes.list）
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeNotesTool(toolId, params, context, display) {
    const startTime = Date.now();
    const userId = context.userId || context.user_id;
    const expertId = context.expertId || context.expert_id;

    logger.info(`[ToolManager] 执行 Notes 工具: ${toolId}`, { userId, expertId, params });

    try {
      // 动态导入 NotesManager（避免循环依赖）
      const { default: NotesManager } = await import('../lib/notes/notes-manager.js');
      const notesManager = new NotesManager();

      let result;

      switch (toolId) {
        case 'notes.take': {
          const { key, content, type = 'note', relevance = 0.8 } = params;
          if (!key || !content) {
            return {
              success: false,
              error: 'Missing required parameters: key and content',
              toolId,
              toolName: display,
            };
          }
          await notesManager.take(userId, expertId, key, {
            content,
            type,
            relevance,
            saved_at: new Date().toISOString(),
          });
          result = {
            success: true,
            message: `笔记 "${key}" 已保存`,
            key,
            type,
          };
          break;
        }

        case 'notes.read': {
          const { key } = params;
          if (!key) {
            return {
              success: false,
              error: 'Missing required parameter: key',
              toolId,
              toolName: display,
            };
          }
          const note = await notesManager.read(userId, expertId, key);
          if (!note) {
            result = {
              success: false,
              error: `笔记 "${key}" 不存在`,
              key,
            };
          } else {
            result = {
              success: true,
              key,
              content: note.content,
              type: note.type,
              metadata: note.metadata,
            };
          }
          break;
        }

        case 'notes.list': {
          const keys = await notesManager.list(userId, expertId);
          const notes = [];
          for (const key of keys) {
            const note = await notesManager.read(userId, expertId, key);
            if (note) {
              notes.push({
                key,
                type: note.type,
                relevance: note.metadata?.relevance || 0,
                saved_at: note.metadata?.saved_at,
                preview: note.content?.substring(0, 100) + (note.content?.length > 100 ? '...' : ''),
              });
            }
          }
          result = {
            success: true,
            count: notes.length,
            notes,
          };
          break;
        }

        default:
          return {
            success: false,
            error: `Unknown notes tool: ${toolId}`,
            toolId,
            toolName: display,
          };
      }

      const duration = Date.now() - startTime;
      logger.info(`[ToolManager] Notes 工具执行成功: ${toolId} (${duration}ms)`);

      return {
        ...result,
        toolId,
        toolName: display,
        duration,
      };
    } catch (error) {
      logger.error(`[ToolManager] Notes 工具执行失败: ${toolId}`, error.message);
      return {
        success: false,
        error: error.message,
        toolId,
        toolName: display,
      };
    }
  }

  /**
   * 执行驻留工具（通过 ResidentSkillManager）
   * @param {string} scriptPath - 脚本路径（resident://toolName 格式）
   * @param {string} skillId - 技能ID
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @param {string} toolId - 工具ID
   * @returns {Promise<object>} 执行结果
   */
  async executeResidentTool(scriptPath, skillId, params, context, display, toolId) {
    // 解析驻留工具名称
    const residentToolName = scriptPath.replace('resident://', '');
    
    logger.info(`[ToolManager] 执行驻留工具: ${residentToolName} (skill: ${skillId})`);

    // 获取 ResidentSkillManager（从全局或 context）
    const residentSkillManager = global.residentSkillManager;
    if (!residentSkillManager) {
      logger.error('[ToolManager] ResidentSkillManager 未初始化');
      return {
        success: false,
        error: 'ResidentSkillManager not initialized',
        toolId,
        toolName: display,
      };
    }

    try {
      const startTime = Date.now();

      // 构建用户上下文
      const userContext = {
        userId: context.userId || context.user_id || '',
        accessToken: context.accessToken || '',
        expertId: context.expertId || context.expert_id || '',
        isAdmin: context?.session?.isAdmin || false,  // 从 session 读取管理员标识
        isSkillCreator: context?.session?.roles?.includes('creator') || false,  // 从 session 读取技能创作者标识
      };

      // 调用驻留工具
      const result = await residentSkillManager.invokeByName(
        skillId,
        residentToolName,
        params,
        userContext,
        60000  // 默认超时 60 秒
      );

      const duration = Date.now() - startTime;
      logger.info(`[ToolManager] 驻留工具执行成功: ${display} (${duration}ms)`);

      return {
        success: true,
        data: result,
        toolId,
        toolName: display,
        duration,
      };
    } catch (error) {
      logger.error(`[ToolManager] 驻留工具执行失败: ${display}`, error.message);
      return {
        success: false,
        error: error.message,
        toolId,
        toolName: display,
      };
    }
  }

  /**
   * 批量执行工具调用（处理 LLM 返回的多个工具调用）
   * 支持实时回调，每执行完一个工具就通知调用方
   *
   * @param {Array} toolCalls - LLM 返回的工具调用数组
   * @param {object} context - 执行上下文
   * @param {Function} onToolComplete - 单个工具执行完成回调 (result) => void
   * @returns {Promise<Array>} 执行结果数组
   */
  async executeToolCalls(toolCalls, context = {}, onToolComplete = null) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      return [];
    }

    const results = [];

    for (const call of toolCalls) {
      // 处理不同格式的工具调用
      const toolName = call.function?.name || call.name;
      const params = this.parseToolArguments(
        call.function?.arguments || call.arguments || call.parameters
      );

      const result = await this.executeTool(toolName, params, context);
      const toolResult = {
        toolCallId: call.id || call.tool_call_id,
        toolName,
        arguments: params,  // 保存工具调用参数
        ...result,
      };
      
      results.push(toolResult);
      
      // 每执行完一个工具，立即回调通知
      if (onToolComplete) {
        onToolComplete(toolResult);
      }
    }

    return results;
  }

  /**
   * 解析工具参数
   * @param {string|object} args - 参数（可能是 JSON 字符串或对象）
   * @returns {object}
   */
  parseToolArguments(args) {
    if (!args) return {};
    if (typeof args === 'object') return args;

    try {
      return JSON.parse(args);
    } catch (parseError) {
      // 处理 LLM 返回多个 JSON 对象拼接的情况
      // 例如: {"path":"a.md"}{"path":"b.md"}{"path":"c.md"}
      // 尝试提取第一个完整的 JSON 对象
      try {
        const firstJsonMatch = args.match(/^\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/);
        if (firstJsonMatch) {
          const parsed = JSON.parse(firstJsonMatch[0]);
          logger.warn('[ToolManager] 工具参数包含多个 JSON 对象，仅使用第一个:', {
            original: args.substring(0, 200),
            extracted: firstJsonMatch[0],
          });
          return parsed;
        }
      } catch (extractError) {
        // 提取失败，继续
      }

      logger.warn('[ToolManager] 工具参数解析失败:', {
        error: parseError.message,
        args_preview: typeof args === 'string' ? args.substring(0, 200) : args,
      });
      return {};
    }
  }

  /**
   * 将工具结果格式化为 LLM 可用的消息
   * 自动截断过长的结果以防止上下文膨胀
   *
   * 多模态支持：当工具结果包含 dataUrl（图片 base64 数据）时，
   * 自动添加 Markdown 图片语法，让 processMultimodalMessages() 能正确转换
   *
   * @param {Array} results - 工具执行结果数组
   * @param {number} maxLength - 单个结果最大长度（字符数）
   * @returns {Array} LLM 消息数组
   */
  formatToolResultsForLLM(results, maxLength = 10000) {
    return results.map(result => {
      // 构建返回给 LLM 的内容
      // 如果有 data 字段，使用它；否则使用整个 result（排除元数据）
      const { toolCallId, toolName, duration, ...resultData } = result;
      
      // 检查是否包含图片 dataUrl（多模态支持）
      // 当 read_file 工具使用 mode="data_url" 读取图片时，返回 dataUrl 字段
      let imageDataUrl = null;
      if (result.success && result.data?.dataUrl) {
        imageDataUrl = result.data.dataUrl;
        // 验证是否是有效的 data URL
        if (typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image/')) {
          logger.info(`[ToolManager] 检测到图片 dataUrl，将添加 Markdown 图片语法: ${result.toolName}`);
        } else {
          imageDataUrl = null;  // 不是图片 dataUrl，忽略
        }
      }
      
      let content = JSON.stringify(
        result.success !== undefined && result.data !== undefined
          ? { success: result.success, data: result.data, error: result.error }
          : resultData
      );

      // 如果有图片 dataUrl，在 content 前添加 Markdown 图片语法
      // 这样 processMultimodalMessages() 就能正确识别并转换为多模态格式
      if (imageDataUrl) {
        // 使用简短的描述，让多模态模型知道这是工具读取的图片
        const imageMarkdown = `\n\n![工具读取的图片](${imageDataUrl})`;
        content = content + imageMarkdown;
        logger.info(`[ToolManager] 已添加 Markdown 图片语法，总长度: ${content.length}`);
      }

      // 截断过长的结果（但保留图片 dataUrl 不被截断）
      if (content.length > maxLength && !imageDataUrl) {
        const originalLength = content.length;
        content = content.substring(0, maxLength) +
          `\n...[truncated, original ${originalLength} chars]`;
        
        logger.warn(`[ToolManager] 工具结果被截断: ${result.toolName} ` +
          `(${originalLength} → ${maxLength} chars)`);
      }

      return {
        role: 'tool',
        tool_call_id: result.toolCallId,
        name: result.toolName,
        content,
      };
    });
  }

  /**
   * 获取技能列表（用于调试）
   * @returns {Array} 技能信息列表
   */
  getSkillList() {
    logger.info(`[ToolManager] getSkillList 被调用，当前有 ${this.skills.size} 个技能`);
    
    const list = Array.from(this.skills.values()).map(skill => {
      const tools = this.skillLoader.getToolDefinitions(skill);
      // 使用 function.name（skill_mark__tool_name 格式，如 "kb-search__search"）
      // 这是 LLM 实际调用时使用的名称
      const toolNames = tools.map(t => t.function?.name || this.extractToolName(t));
      logger.info(`[ToolManager] 技能 ${skill.id} 的工具:`, toolNames);
      
      return {
        id: skill.id,
        mark: skill.mark || skill.id,  // Issue #417: 技能标识，用于生成 tool_name
        name: skill.name,
        description: skill.description,
        tools: toolNames,
      };
    });
    
    logger.info(`[ToolManager] getSkillList 返回:`, list.map(s => ({ id: s.id, mark: s.mark })));
    return list;
  }

  /**
   * 获取技能详情
   * @param {string} skillId - 技能ID
   * @returns {object|null}
   */
  getSkill(skillId) {
    return this.skills.get(skillId) || null;
  }

  /**
   * 获取技能配置参数
   * @param {string} skillId - 技能ID
   * @returns {Promise<object>} 配置对象
   */
  async getSkillConfig(skillId) {
    return await this.skillLoader.getSkillConfig(skillId);
  }
}

export default ToolManager;
