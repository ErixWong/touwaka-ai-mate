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
import ConfigLoader from './config-loader.js';
import DocumentRetrievalService from './document-retrieval-service.js';
import DocAccessService from './doc-access-service.js';

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
      description: `执行代码或脚本。支持四种模式：
1) javascript - 在 VM 沙箱中执行 JS 代码片段，可访问 console、Buffer、URL 等基础 API
2) shell - 执行白名单内的安全命令，用于文件查看和文本处理
3) nodejs - 执行任务目录中的 Node.js 脚本文件（真正的 Node.js 运行时）
4) python - 执行任务目录中的 Python 脚本文件

当前平台: ${isWindowsPlatform() ? 'Windows' : 'Unix/Linux'}。
${isWindowsPlatform() ? 'Windows 支持命令: type, dir, find, findstr, echo, cd, date, time, ver, vol, attrib, sort, more, path' : 'Unix 支持命令: cat, head, tail, grep, wc, sort, uniq, cut, tr, diff, ls, pwd, echo, file, stat, which, date, uname, whoami, find'}

安全限制：
- javascript/shell: 仅允许相对路径、禁止重定向/管道/命令替换、禁止访问系统目录
- nodejs/python: 脚本只能读写当前任务目录内的文件，禁止越权访问任务目录外路径
- 30秒超时、1MB输出限制`,
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['javascript', 'shell', 'nodejs', 'python'],
            description: '执行类型：javascript (VM沙箱执行JS代码), shell (白名单命令), nodejs (Node.js脚本文件), python (Python脚本文件)',
          },
          code: {
            type: 'string',
            description: `要执行的代码。仅 type=javascript 或 shell 时有效。javascript 为 JS 代码片段，shell 为系统命令。`,
          },
          script_path: {
            type: 'string',
            description: '脚本文件路径，相对于当前任务目录。当 type=nodejs 或 python 时必填。当 type=javascript 时可选，用于从文件加载代码。',
          },
          args: {
            type: 'array',
            items: { type: 'string' },
            description: '（可选）脚本执行时的命令行参数，传递给 Node.js 或 Python 脚本。仅 type=nodejs 或 python 时有效。',
          },
        },
        required: ['type'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'execute',
      allowedRoles: ['admin', 'creator'],
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
  // ============================================================
  // document_retrieval skill — 系统级文档检索能力（纯多 tool 模式）
  //
  // LLM 可见 3 个独立 tool，按"用户任务意图"拆分：
  //   answer_from_documents — 基于文档证据回答问题
  //   find_document          — 定位可能相关的文档
  //   verify_fact            — 校验命题是否得到文档支持
  //
  // 历史说明：
  //   - 旧 document_retrieval 单入口（含 goal 参数）已于 Round 04 删除
  //   - 旧 executeDocumentRetrieval() 兼容壳层已于 Round 04 删除
  //   - 内部检索链路（DocumentRetrievalService → Search → Recall → Packer）完全复用
  // ============================================================
  {
    type: 'function',
    function: {
      name: 'answer_from_documents',
      description: `基于文档平台证据回答用户问题。从文档平台检索与用户问题相关的证据，返回结构化证据包供回答编排。

使用场景：
- 用户询问文档中的具体信息（合同条款、发票内容、报告数据等）
- "根据制度说明某个规定"
- "文档里对某问题如何描述"
- "请基于内部文档给出答案"

权限说明：
- 检索范围自动限定为用户有权访问的文档集合（DocAccessService 硬权限边界）
- collection_id / doc_types 仅用于缩小范围，不承担授权职责

返回结构化证据，包含 evidence_sufficiency（证据充分性）、suggested_response_mode（建议回答模式）、documents（候选文档及其 top evidence）。`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索查询文本。应提取用户问题的核心语义，而非原样传入整段对话。',
          },
          collection_id: {
            type: 'string',
            description: '（可选）限定检索的文档集合ID。不传则在用户有权访问的所有集合中检索。',
          },
          doc_types: {
            type: 'array',
            items: { type: 'string' },
            description: '（可选）限定文档类型，如 ["contract", "invoice"]。不传则不限制类型。仅用于缩小范围，不做权限判定。',
          },
        },
        required: ['query'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'answer_from_documents',
      skillNamespace: 'document_retrieval',
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_document',
      description: `在文档平台中定位可能相关的文档，不以直接回答问题为目标。

使用场景：
- "帮我找某份制度/合同/资料"
- "哪个文档里提到某项规则"
- "我只记得模糊线索，帮我定位文档"

与 answer_from_documents 的区别：
- find_document 返回文档候选列表（不含 chunk 级证据）
- 适用于用户只想定位文档、或在多候选场景下先确认目标文档

权限说明：
- 检索范围自动限定为用户有权访问的文档集合
- 不回退到 chunk-first 全库搜索`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索查询文本。描述要查找的文档特征（类型、关键词、标题片段等）。',
          },
          collection_id: {
            type: 'string',
            description: '（可选）限定检索的文档集合ID。',
          },
          doc_types: {
            type: 'array',
            items: { type: 'string' },
            description: '（可选）限定文档类型，如 ["contract", "policy"]。',
          },
        },
        required: ['query'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'find_document',
      skillNamespace: 'document_retrieval',
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_fact',
      description: `校验某个命题是否得到文档平台中的证据支持。

使用场景：
- "文档里是不是这么写"
- "某个说法是否有依据"
- "是否存在相关证据"

返回 verdict 判定（supported / insufficient_evidence）及支撑证据。

能力边界：
- 当前仅稳定支持 supported / insufficient_evidence 判定
- 不支持真正的"反驳"判定（contradicted），该能力正在规划中

权限说明：
- 检索范围自动限定为用户有权访问的文档集合`,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '需要核实的事实或命题描述。',
          },
          collection_id: {
            type: 'string',
            description: '（可选）限定检索的文档集合ID。',
          },
          doc_types: {
            type: 'array',
            items: { type: 'string' },
            description: '（可选）限定文档类型。',
          },
        },
        required: ['query'],
      },
    },
    _meta: {
      builtin: true,
      toolName: 'verify_fact',
      skillNamespace: 'document_retrieval',
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
 * @param {string|null} workingDirectory - 工作目录（必须是绝对路径或null）
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

    // 确定工作目录：只接受绝对路径或null
    let cwd;
    if (workingDirectory && workingDirectory.trim() !== '') {
      if (!path.isAbsolute(workingDirectory)) {
        resolve({
          success: false,
          error: `工作目录必须是绝对路径，收到: ${workingDirectory}`,
          stdout: '',
          stderr: '',
          exitCode: -1,
        });
        return;
      }
      cwd = path.resolve(workingDirectory);
    } else {
      cwd = getDataBasePath();
    }
    
    // 检查工作目录是否存在
    if (cwd && !fs.existsSync(cwd)) {
      try {
        fs.mkdirSync(cwd, { recursive: true });
      } catch (err) {
        logger.warn(`[ToolManager] 创建工作目录失败: ${cwd}`, err.message);
        cwd = getDataBasePath();
      }
    }
    
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
        let truncated = stdout.substring(0, MAX_OUTPUT_SIZE);
        const lastChar = truncated.charCodeAt(truncated.length - 1);
        if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
          truncated = truncated.substring(0, truncated.length - 1);
        }
        stdout = truncated + '\n...[output truncated]';
      }
    });

    proc.stderr.on('data', (data) => {
      if (killed) return;
      stderr += data.toString();
      if (stderr.length > MAX_OUTPUT_SIZE) {
        let truncated = stderr.substring(0, MAX_OUTPUT_SIZE);
        const lastChar = truncated.charCodeAt(truncated.length - 1);
        if (lastChar >= 0xD800 && lastChar <= 0xDBFF) {
          truncated = truncated.substring(0, truncated.length - 1);
        }
        stderr = truncated + '\n...[stderr truncated]';
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

    // MCP 工具注册表（toolId -> { serverName, toolName, description, inputSchema }）
    this.mcpToolRegistry = new Map();

    // 是否已初始化
    this.initialized = false;

    // NotesStore 单例缓存
    this._notesStore = null;

    // 文档检索相关服务（懒初始化）
    this._configLoader = null;
    this._docRetrievalService = null;
    this._docAccessService = null;
  }

  /**
   * 获取 ConfigLoader 实例（懒初始化）
   */
  _getConfigLoader() {
    if (!this._configLoader) {
      this._configLoader = new ConfigLoader(this.db);
    }
    return this._configLoader;
  }

  /**
   * 获取 DocumentRetrievalService 实例（懒初始化）
   */
  _getDocRetrievalService() {
    if (!this._docRetrievalService) {
      this._docRetrievalService = new DocumentRetrievalService(
        this.db,
        this._getConfigLoader()
      );
    }
    return this._docRetrievalService;
  }

  /**
   * 获取 DocAccessService 实例（懒初始化）
   */
  _getDocAccessService() {
    if (!this._docAccessService) {
      this._docAccessService = new DocAccessService(this.db);
    }
    return this._docAccessService;
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
   * 获取 NotesStore 单例（P0 修复：使用全局共享实例，避免跨组件不一致）
   * @returns {Promise<INotesStore>}
   */
  async _getNotesStore() {
    if (this._notesStore) return this._notesStore;

    // P0 修复：使用全局共享 NotesStore
    const { getSharedNotesStore } = await import('./psyche-store/index.js');
    this._notesStore = await getSharedNotesStore();
    logger.debug(`[ToolManager] 使用共享 NotesStore 实例`);
    
    return this._notesStore;
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
   * @param {object} context - 可选的上下文对象，包含 userId 用于获取 MCP 工具
   * @returns {Array} OpenAI 格式的工具定义数组（不含 _meta，节省 token）
   */
  async getToolDefinitions(context = {}) {
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

    // 添加 MCP 工具（从 MCP Client 驻留进程获取）
    try {
      const mcpTools = await this.getMcpToolDefinitions(context);
      if (mcpTools && mcpTools.length > 0) {
        definitions.push(...mcpTools);
        logger.info(`[ToolManager] 添加了 ${mcpTools.length} 个 MCP 工具`);
      }
    } catch (err) {
      logger.warn('[ToolManager] 获取 MCP 工具失败:', err.message);
    }

    return definitions;
  }

  /**
   * 获取 MCP 工具定义（从 MCP Client 驻留进程）
   * @param {object} context - 上下文对象，包含 userId
   * @returns {Promise<Array>} MCP 工具定义数组
   */
  async getMcpToolDefinitions(context = {}) {
    const residentSkillManager = global.residentSkillManager;
    if (!residentSkillManager) {
      logger.debug('[ToolManager] ResidentSkillManager 未初始化，跳过 MCP 工具');
      return [];
    }

    const userId = context.userId || context.user_id || '';

    try {
      // 调用 MCP Client 驻留进程获取工具列表
      const result = await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        { action: 'list_tools' },
        { userId },
        30000  // 30 秒超时
      );

      if (!result || !result.tools || !Array.isArray(result.tools)) {
        logger.debug('[ToolManager] MCP Client 返回空工具列表');
        return [];
      }

      // 转换 MCP 工具为 OpenAI 格式
      const mcpTools = result.tools.map(tool => {
        // mcp-client list_tools 返回结构:
        // { name: "mcp_{server}_{tool}", server_name, original_name, description, inputSchema, ... }
        // name 已经是完整的工具 ID（如 mcp_github_search_repos）
        const toolId = tool.name;
        const serverName = tool.server_name;
        const origName = tool.original_name;
        
        // 注册到 MCP 工具注册表
        this.mcpToolRegistry.set(toolId, {
          serverName: serverName,
          toolName: origName,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });

        return {
          type: 'function',
          function: {
            name: toolId,
            description: `[MCP/${serverName}] ${tool.description}`,
            parameters: tool.inputSchema || { type: 'object', properties: {} },
          },
          _meta: {
            mcp: true,
            serverName: serverName,
            toolName: origName,
          },
        };
      });

      return mcpTools.map(tool => {
        const { _meta, ...llmTool } = tool;
        return llmTool;
      });
    } catch (err) {
      logger.error('[ToolManager] 获取 MCP 工具失败:', err.message);
      return [];
    }
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
   * @param {string} toolId - 工具 ID（skill_tools.id 或 mcp_{serverName}_{toolName}）
   * @returns {string} 友好的显示名称，如 "SearXNG/web_search" 或 "MCP/github/search_repositories"
   */
  formatToolDisplay(toolId) {
    // 检查是否是 MCP 工具
    if (toolId.startsWith('mcp_')) {
      const mcpInfo = this.mcpToolRegistry.get(toolId);
      if (mcpInfo) {
        return `MCP/${mcpInfo.serverName}/${mcpInfo.toolName}`;
      }
      // 如果注册表中没有，尝试从工具名解析
      const parts = toolId.split('_');
      if (parts.length >= 3) {
        const serverName = parts.slice(1, -1).join('_');
        const toolName = parts[parts.length - 1];
        return `MCP/${serverName}/${toolName}`;
      }
      return toolId;
    }
    
    // 普通技能工具
    const info = this.toolRegistry.get(toolId);
    if (!info) {
      return toolId;  // 未找到，返回原始 ID
    }
    return `${info.skillName}/${info.toolName}`;
  }

  /**
   * 获取工具的详细信息
   * @param {string} toolId - 工具 ID
   * @returns {object|null} 工具信息 { skillId, skillName, toolName } 或 MCP 工具信息 { serverName, toolName }
   */
  getToolInfo(toolId) {
    // 检查是否是 MCP 工具
    if (toolId.startsWith('mcp_')) {
      const mcpInfo = this.mcpToolRegistry.get(toolId);
      if (mcpInfo) {
        return { ...mcpInfo, isMcp: true };
      }
      return null;
    }
    
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

    // 检查是否是 MCP 工具（工具名以 mcp_ 开头）
    if (toolId.startsWith('mcp_')) {
      return await this.executeMcpTool(toolId, params, context, display);
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
      // 1. 优先使用绝对路径（absolute_workspace_path）
      // 2. 无任务时：使用用户 temp 目录
      let workingDirectory;
      if (taskContext?.absolute_workspace_path) {
        workingDirectory = taskContext.absolute_workspace_path;
        logger.info(`[ToolManager] 使用任务工作目录(绝对路径): ${workingDirectory}`);
      } else if (userId) {
        const { getDefaultWorkspaceAbsolutePath } = await import('./paths.js');
        workingDirectory = getDefaultWorkspaceAbsolutePath(userId);
        logger.info(`[ToolManager] 使用用户 temp 目录(绝对路径): ${workingDirectory}`);
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

    // 执行文档检索 skill 工具族（answer_from_documents / find_document / verify_fact）
    if (this._isDocRetrievalTool(toolId)) {
      return await this._dispatchDocRetrievalTool(toolId, params, context, display);
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
   * 执行代码或脚本
   * 统一处理 execute 工具的执行逻辑
   *
   * @param {object} params - 工具参数
   * @param {string} params.type - 执行类型：'javascript', 'shell', 'nodejs', 'python'
   * @param {string} params.code - 要执行的代码或命令（nodejs/python时可选）
   * @param {string} params.script_path - 脚本路径（nodejs/python时必填）
   * @param {string[]} params.args - 脚本执行参数（nodejs/python时有效）
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeCode(params, context, display) {
    const startTime = Date.now();
    const { type, code, script_path, args } = params;

    const validTypes = ['javascript', 'shell', 'nodejs', 'python'];
    
    if (!type || !validTypes.includes(type)) {
      return {
        success: false,
        error: `Missing or invalid required parameter: type (must be one of: ${validTypes.join(', ')})`,
        toolId: 'execute',
        toolName: display,
      };
    }

    if (type === 'nodejs' || type === 'python') {
      if (!script_path) {
        return {
          success: false,
          error: `Missing required parameter: script_path is required when type="${type}"`,
          toolId: 'execute',
          toolName: display,
        };
      }
    } else {
      if (!code) {
        return {
          success: false,
          error: 'Missing required parameter: code is required for javascript/shell types',
          toolId: 'execute',
          toolName: display,
        };
      }
    }

    const userId = context.userId || context.user_id;
    const taskContext = context.taskContext;
    let workingDirectory;
    if (taskContext?.absolute_workspace_path) {
      workingDirectory = taskContext.absolute_workspace_path;
    } else if (userId) {
      const { getDefaultWorkspaceAbsolutePath } = await import('./paths.js');
      workingDirectory = getDefaultWorkspaceAbsolutePath(userId);
    }

    if ((type === 'nodejs' || type === 'python') && !workingDirectory) {
      return {
        success: false,
        error: `Script execution requires a working directory (task workspace or user temp directory)`,
        toolId: 'execute',
        toolName: display,
      };
    }

    try {
      let result;

      if (type === 'javascript') {
        result = await this.skillLoader.executeUserCode(code, {
          userId,
          expertId: context.expertId || context.expert_id,
          accessToken: context.accessToken,
          workingDirectory,
          isAdmin: context?.session?.isAdmin || false,
          isSkillCreator: context?.session?.roles?.includes('creator') || false,
        }, script_path);
      } else if (type === 'shell') {
        result = await executeSafeShell(code, workingDirectory, 30000);
      } else if (type === 'nodejs') {
        result = await this.executeNodeScript(script_path, args || [], workingDirectory, context);
      } else if (type === 'python') {
        result = await this.executePythonScript(script_path, args || [], workingDirectory, context);
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
   * 执行 Node.js 脚本文件
   * 使用 node-sandbox.js wrapper，在任务目录沙箱中运行
   *
   * @param {string} scriptPath - 脚本路径（相对于工作目录）
   * @param {string[]} args - 命令行参数
   * @param {string} workingDirectory - 工作目录（任务目录绝对路径）
   * @param {object} context - 执行上下文
   * @returns {Promise<object>} 执行结果
   */
  async executeNodeScript(scriptPath, args, workingDirectory, context) {
    const startTime = Date.now();
    const dataBasePath = getDataBasePath();

    let absoluteWorkingDir;
    if (path.isAbsolute(workingDirectory)) {
      absoluteWorkingDir = workingDirectory;
    } else {
      absoluteWorkingDir = path.join(dataBasePath, workingDirectory);
    }

    if (!fs.existsSync(absoluteWorkingDir)) {
      fs.mkdirSync(absoluteWorkingDir, { recursive: true });
    }

    const normalizedScriptPath = path.normalize(scriptPath);
    if (normalizedScriptPath.startsWith('..') || normalizedScriptPath.includes('..' + path.sep)) {
      throw new Error(`Path traversal not allowed: ${scriptPath}`);
    }

    if (path.isAbsolute(normalizedScriptPath)) {
      throw new Error(`Absolute path not allowed for script_path: ${scriptPath}`);
    }

    const fullScriptPath = path.resolve(absoluteWorkingDir, normalizedScriptPath);

    const resolvedWorkingDirLower = path.resolve(absoluteWorkingDir).toLowerCase();
    const fullScriptPathLower = fullScriptPath.toLowerCase();
    if (!fullScriptPathLower.startsWith(resolvedWorkingDirLower + path.sep) &&
        fullScriptPathLower !== resolvedWorkingDirLower) {
      throw new Error(`Script path must be within working directory: ${scriptPath}`);
    }

    if (!fs.existsSync(fullScriptPath)) {
      throw new Error(`Script file not found: ${scriptPath}`);
    }

    const ext = path.extname(fullScriptPath).toLowerCase();
    if (ext !== '.js' && ext !== '.cjs') {
      throw new Error(`Script must be a .js or .cjs file: ${scriptPath}`);
    }

    const wrapperPath = path.join(__dirname, 'script-wrapper', 'node-sandbox.js');

    return new Promise((resolve) => {
      const MAX_OUTPUT_SIZE = 1024 * 1024;
      let stdout = '';
      let stderr = '';

      const minimalEnv = {
        NODE_ENV: process.env.NODE_ENV || 'development',
        DATA_BASE_PATH: dataBasePath,
        USER_ID: context.userId || context.user_id || '',
        EXPERT_ID: context.expertId || context.expert_id || '',
        SANDBOX_ROOT: absoluteWorkingDir,
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        TEMP: process.env.TEMP || '',
        TMP: process.env.TMP || '',
      };

      const proc = spawn('node', [wrapperPath, scriptPath, ...args], {
        cwd: absoluteWorkingDir,
        env: minimalEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT_SIZE) {
          proc.kill('SIGTERM');
          stdout = stdout.substring(0, MAX_OUTPUT_SIZE) + '\n...[output truncated]';
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.substring(0, MAX_OUTPUT_SIZE) + '\n...[stderr truncated]';
        }
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;

        if (code === null) {
          resolve({
            success: false,
            error: `Script execution timed out after 30 seconds`,
            stdout: stdout.substring(0, MAX_OUTPUT_SIZE),
            stderr: stderr.substring(0, MAX_OUTPUT_SIZE),
            exitCode: -1,
            duration,
            script_path: scriptPath,
          });
        } else {
          resolve({
            success: code === 0,
            stdout: stdout.substring(0, MAX_OUTPUT_SIZE),
            stderr: stderr.substring(0, MAX_OUTPUT_SIZE),
            exitCode: code,
            duration,
            script_path: scriptPath,
            working_directory: absoluteWorkingDir,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute Node.js script: ${error.message}`,
          stdout: '',
          stderr: '',
          exitCode: -1,
          duration: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * 执行 Python 脚本文件
   * 使用 python-sandbox.py wrapper，在任务目录沙箱中运行
   *
   * @param {string} scriptPath - 脚本路径（相对于工作目录）
   * @param {string[]} args - 命令行参数
   * @param {string} workingDirectory - 工作目录（任务目录绝对路径）
   * @param {object} context - 执行上下文
   * @returns {Promise<object>} 执行结果
   */
  async executePythonScript(scriptPath, args, workingDirectory, context) {
    const startTime = Date.now();
    const dataBasePath = getDataBasePath();

    let absoluteWorkingDir;
    if (path.isAbsolute(workingDirectory)) {
      absoluteWorkingDir = workingDirectory;
    } else {
      absoluteWorkingDir = path.join(dataBasePath, workingDirectory);
    }

    if (!fs.existsSync(absoluteWorkingDir)) {
      fs.mkdirSync(absoluteWorkingDir, { recursive: true });
    }

    const normalizedScriptPath = path.normalize(scriptPath);
    if (normalizedScriptPath.startsWith('..') || normalizedScriptPath.includes('..' + path.sep)) {
      throw new Error(`Path traversal not allowed: ${scriptPath}`);
    }

    if (path.isAbsolute(normalizedScriptPath)) {
      throw new Error(`Absolute path not allowed for script_path: ${scriptPath}`);
    }

    const fullScriptPath = path.resolve(absoluteWorkingDir, normalizedScriptPath);

    const resolvedWorkingDirLower = path.resolve(absoluteWorkingDir).toLowerCase();
    const fullScriptPathLower = fullScriptPath.toLowerCase();
    if (!fullScriptPathLower.startsWith(resolvedWorkingDirLower + path.sep) &&
        fullScriptPathLower !== resolvedWorkingDirLower) {
      throw new Error(`Script path must be within working directory: ${scriptPath}`);
    }

    if (!fs.existsSync(fullScriptPath)) {
      throw new Error(`Script file not found: ${scriptPath}`);
    }

    const ext = path.extname(fullScriptPath).toLowerCase();
    if (ext !== '.py') {
      throw new Error(`Script must be a .py file: ${scriptPath}`);
    }

    const pythonCmd = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
    const wrapperPath = path.join(__dirname, 'script-wrapper', 'python-sandbox.py');

    return new Promise((resolve) => {
      const MAX_OUTPUT_SIZE = 1024 * 1024;
      let stdout = '';
      let stderr = '';

      const minimalEnv = {
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
        DATA_BASE_PATH: dataBasePath,
        USER_ID: context.userId || context.user_id || '',
        EXPERT_ID: context.expertId || context.expert_id || '',
        SANDBOX_ROOT: absoluteWorkingDir,
        PATH: process.env.PATH || '',
        HOME: process.env.HOME || '',
        TEMP: process.env.TEMP || '',
        TMP: process.env.TMP || '',
        LANG: process.env.LANG || '',
      };

      const proc = spawn(pythonCmd, [wrapperPath, scriptPath, ...args], {
        cwd: absoluteWorkingDir,
        env: minimalEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        if (stdout.length > MAX_OUTPUT_SIZE) {
          proc.kill('SIGTERM');
          stdout = stdout.substring(0, MAX_OUTPUT_SIZE) + '\n...[output truncated]';
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > MAX_OUTPUT_SIZE) {
          stderr = stderr.substring(0, MAX_OUTPUT_SIZE) + '\n...[stderr truncated]';
        }
      });

      proc.on('close', (code) => {
        const duration = Date.now() - startTime;

        if (code === null) {
          resolve({
            success: false,
            error: `Script execution timed out after 30 seconds`,
            stdout: stdout.substring(0, MAX_OUTPUT_SIZE),
            stderr: stderr.substring(0, MAX_OUTPUT_SIZE),
            exitCode: -1,
            duration,
            script_path: scriptPath,
          });
        } else {
          resolve({
            success: code === 0,
            stdout: stdout.substring(0, MAX_OUTPUT_SIZE),
            stderr: stderr.substring(0, MAX_OUTPUT_SIZE),
            exitCode: code,
            duration,
            script_path: scriptPath,
            working_directory: absoluteWorkingDir,
          });
        }
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute Python script: ${error.message}`,
          stdout: '',
          stderr: '',
          exitCode: -1,
          duration: Date.now() - startTime,
        });
      });
    });
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
      // 动态导入 NotesManager
      const { default: NotesManager } = await import('../lib/notes/notes-manager.js');
      
      // 使用缓存的 NotesStore（P0：避免每次调用创建新实例）
      const notesStore = await this._getNotesStore();
      
      // 正确注入 NotesStore 到 NotesManager
      const notesManager = new NotesManager(notesStore);

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

  // ============================================================
  // document_retrieval skill tool 族
  // ============================================================

  /**
   * 判断 toolId 是否属于 document_retrieval skill namespace
   * 兼容期：仅 document_retrieval 单 tool；未来扩展 find_document / verify_fact 等
   */
  _isDocRetrievalTool(toolId) {
    // document_retrieval skill 下辖的 3 个 LLM 可见独立 tool
    return ['answer_from_documents', 'find_document', 'verify_fact'].includes(toolId);
  }

  /**
   * document_retrieval skill 统一 dispatch 入口（纯多 tool 模式）
   *
   * 按 toolId 直接路由到对应 handler，不再依赖 goal 参数做主路径分流。
   *
   * @param {string} toolId - LLM 调用的 tool 名称
   * @param {object} params - tool 参数
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 结构化结果
   */
  async _dispatchDocRetrievalTool(toolId, params, context, display) {
    switch (toolId) {
      case 'find_document':
        return await this._handleFindDocument(params, context, display);
      case 'verify_fact':
        return await this._handleVerifyFact(params, context, display);
      case 'answer_from_documents':
      default:
        return await this._handleAnswerFromDocuments(params, context, display);
    }
  }

  /**
   * 执行文档检索工具（document_retrieval）
   *
   * 内部 handler：answer_from_documents
   * 这是"专家依据文档平台回答"能力的主入口。
   * 内部复用 DocumentRetrievalService 走 document-first 检索链路，
   * 返回结构化 evidence packet 供回答编排层消费。
   *
   * 权限边界：检索范围严格限定为用户可访问的文档集合（DocAccessService），
   * collection_id / doc_types 仅作为缩小范围的过滤条件，不承担授权职责。
   *
   * @param {object} params - 工具参数
   * @param {string} params.query - 检索查询文本
   * @param {string} [params.collection_id] - 限定集合ID（可选，仅过滤）
   * @param {string[]} [params.doc_types] - 限定文档类型（可选，仅过滤）
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 结构化 evidence 结果
   */
  async _handleAnswerFromDocuments(params, context, display) {
    const startTime = Date.now();
    const { query, collection_id, doc_types } = params;
    const userId = context.userId || context.user_id;
    const effectiveToolName = 'answer_from_documents';

    logger.info('[ToolManager] answer_from_documents:', {
      tool_name: effectiveToolName,
      query_length: query?.length || 0,
      collection_id,
      doc_types,
      userId,
    });

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Missing required parameter: query',
        toolId: effectiveToolName,
        toolName: display,
      };
    }

    try {
      const retrievalService = this._getDocRetrievalService();
      const accessService = this._getDocAccessService();

      // 获取用户可访问的集合列表（唯一硬权限边界）
      const accessibleIds = await accessService.getAccessibleCollectionIds(userId);
      logger.info('[ToolManager] 文档检索权限:', {
        userId,
        accessible_collections: accessibleIds?.length || 0,
        requested_collection: collection_id,
      });

      // 如果用户指定了 collection_id，验证其在可访问范围内
      let effectiveCollectionId = collection_id;
      if (collection_id && accessibleIds.length > 0) {
        if (!accessibleIds.includes(collection_id)) {
          logger.warn('[ToolManager] 用户指定的集合不在可访问范围内:', {
            requested: collection_id,
            accessible: accessibleIds,
          });
          effectiveCollectionId = null; // 回退到全范围检索
        }
      }

      // 调用文档检索服务
      const result = await retrievalService.retrieve(query.trim(), {
        userId,
        doc_types: doc_types?.length > 0 ? doc_types : undefined,
        collection_id: effectiveCollectionId || undefined,
        top_k_candidates: 10,
        top_k_evidence: 5,
        evidence_threshold: 0.1,
        allow_fallback: true,
      });

      const packet = result.packet;
      const duration = Date.now() - startTime;

      // 构建结构化返回结果
      // Round 05 P0-2: scoped identity info + do_not_requery 反重查提示
      const scopedConfirmed = packet?.meta?.scoped_identity_confirmed || false;
      const response = {
        success: true,
        tool_name: effectiveToolName,
        skill_namespace: 'document_retrieval',
        strategy: result.strategy,
        query: query.trim(),
        evidence_sufficiency: packet?.meta?.evidence_sufficiency || 'none',
        reason_codes: packet?.meta?.reason_codes || [],
        should_clarify: packet?.meta?.should_clarify || false,
        should_answer_conservatively: packet?.meta?.should_answer_conservatively || false,
        suggested_response_mode: packet?.meta?.suggested_response_mode || 'conservative_answer',
        // Round 05 P0-2: scoped identity 信号
        scoped_identity: scopedConfirmed ? {
          confirmed: true,
          document_id: packet.meta.scoped_document_id,
          identity_label: packet.meta.scoped_identity_label,
          identity_source: packet.meta.scoped_identity_source,
          hint: '文档身份已通过 chunk 命中确认。如需了解更多文档元信息（完整标题、版本、附件名等），请直接使用已知的 document_id 查询，无需重新发起全局文档搜索。',
        } : { confirmed: false },
        documents: (packet?.documents || []).map(doc => ({
          document_id: doc.document_id,
          document_title: doc.document_title_display || doc.document_title,
          document_title_raw: doc.document_title_display ? doc.document_title : undefined,
          doc_type: doc.doc_type,
          collection_name: doc.collection_name,
          relevance_score: doc.relevance_score,
          candidate_confidence: doc.candidate_confidence,
          identity_confidence: doc.identity_confidence || 'unknown',
          identity_source: doc.identity_source || 'inferred',
          // Round 05 P0-2: enriched identity fields
          best_identity_label: doc.best_identity_label,
          identity_label_source: doc.identity_label_source,
          attachment_filenames: doc.attachment_filenames,
          evidence_count: doc.evidence?.length || 0,
          top_evidence: (doc.evidence || []).slice(0, 3).map(ev => ({
            content: ev.content?.substring(0, 500) || '',
            score: ev.score,
          })),
        })),
        toolId: effectiveToolName,
        toolName: display,
        duration,
      };

      // 统一可观测性日志：覆盖审计要求的所有字段
      logger.info('[ToolManager] answer_from_documents 完成:', {
        tool_name: effectiveToolName,
        strategy: result.strategy,
        evidence_sufficiency: response.evidence_sufficiency,
        duration_ms: duration,
        reason_codes: response.reason_codes,
        document_count: response.documents.length,
        should_clarify: response.should_clarify,
        suggested_response_mode: response.suggested_response_mode,
        scoped_identity: response.scoped_identity,
        identity_distribution: response.documents?.map(d => ({
          id: d.document_id, confidence: d.identity_confidence, source: d.identity_source, label: d.best_identity_label,
        })) || [],
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('[ToolManager] answer_from_documents 失败:', {
        tool_name: effectiveToolName,
        error: error.message,
        duration_ms: duration,
      });
      return {
        success: false,
        error: error.message,
        toolId: effectiveToolName,
        toolName: display,
        tool_name: effectiveToolName,
        skill_namespace: 'document_retrieval',
        strategy: 'error',
        evidence_sufficiency: 'none',
        should_clarify: true,
        should_answer_conservatively: true,
        suggested_response_mode: 'conservative_answer',
        scoped_identity: { confirmed: false },
        documents: [],
        duration,
      };
    }
  }

  /**
   * find_document handler
   *
   * 与 answer_from_documents 的区别：
   * - 不返回 chunk 级 evidence，仅返回文档级候选列表
   * - 重点输出文档 identity、候选置信度、匹配原因
   * - 默认 strategy 以 document_first 为主
   */
  async _handleFindDocument(params, context, display) {
    const startTime = Date.now();
    const { query, collection_id, doc_types } = params;
    const userId = context.userId || context.user_id;
    const effectiveToolName = 'find_document';

    logger.info('[ToolManager] find_document:', {
      tool_name: effectiveToolName,
      query_length: query?.length || 0,
      collection_id,
      doc_types,
      userId,
    });

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Missing required parameter: query',
        toolId: effectiveToolName,
        toolName: display,
      };
    }

    try {
      const retrievalService = this._getDocRetrievalService();
      const accessService = this._getDocAccessService();

      const accessibleIds = await accessService.getAccessibleCollectionIds(userId);
      let effectiveCollectionId = collection_id;
      if (collection_id && accessibleIds.length > 0 && !accessibleIds.includes(collection_id)) {
        effectiveCollectionId = null;
      }

      // find_document：走 document-first 检索，单候选高置信时补最小 supporting evidence
      const result = await retrievalService.retrieve(query.trim(), {
        userId,
        doc_types: doc_types?.length > 0 ? doc_types : undefined,
        collection_id: effectiveCollectionId || undefined,
        top_k_candidates: 10,
        top_k_evidence: 3,  // P0-3: 补最小证据用于身份验证
        evidence_threshold: 0.1,
        allow_fallback: false,  // find_document 不回退到 chunk-first
      });

      const packet = result.packet;
      const duration = Date.now() - startTime;

      let docs = packet?.documents || [];

      // Round 05 P0-3: document-level 0 命中时，尝试 attachment 文件名 fallback
      if (docs.length === 0) {
        try {
          const attachmentCandidates = await retrievalService.searchService.searchByAttachmentFilenames(
            query.trim(), { userId, doc_types, top_k: 5 }
          );
          if (attachmentCandidates && attachmentCandidates.length > 0) {
            logger.info('[ToolManager] find_document attachment fallback 命中:', {
              count: attachmentCandidates.length,
              query: query.trim(),
            });
            // 将 attachment fallback 结果转换为标准 docs 格式
            docs = attachmentCandidates.map(c => ({
              document_id: c.document_id,
              document_title: c.document_title,
              doc_type: c.doc_type,
              collection_name: c.collection_name,
              relevance_score: c.relevance_score || 1,
              candidate_confidence: 'low',
              identity_confidence: 'probable',
              identity_source: 'attachment_filename_match',
              match_reason: `附件文件名匹配: ${c.matched_attachment || ''}`,
              evidence: [],
              best_identity_label: c.best_identity_label || c.document_title,
              identity_label_source: 'attachment_filename_match',
              attachment_filenames: c.attachment_filenames || [],
            }));
          }
        } catch (attachFallbackErr) {
          logger.warn('[ToolManager] find_document attachment fallback 失败:', attachFallbackErr.message);
        }
      }

      const isSingleHighConf = docs.length === 1 && docs[0]?.candidate_confidence === 'high';

      const candidates = docs.map(doc => ({
        document_id: doc.document_id,
        document_title: doc.best_identity_label || doc.document_title_display || doc.document_title,
        document_title_raw: (doc.best_identity_label || doc.document_title_display) ? doc.document_title : undefined,
        doc_type: doc.doc_type,
        collection_name: doc.collection_name,
        relevance_score: doc.relevance_score,
        candidate_confidence: doc.candidate_confidence,
        identity_confidence: doc.identity_confidence || 'unknown',
        identity_source: doc.identity_source || 'search_match',
        // Round 05 P0-3: enriched identity fields
        best_identity_label: doc.best_identity_label,
        identity_label_source: doc.identity_label_source,
        attachment_filenames: doc.attachment_filenames,
        match_reason: doc.match_reason || (doc.candidate_confidence === 'high' ? '关键词匹配' : '语义相似'),
        // P0-3: 单候选高置信时附带 1-3 条 supporting evidence 供身份验证
        supporting_evidence: (isSingleHighConf
          ? (doc.evidence || []).slice(0, 3).map(ev => ({ content: ev.content?.substring(0, 300) || '' }))
          : undefined),
      }));

      // find_document 的 response_mode 语义：
      // - candidate_list: 多候选，需用户确认（共享 mode，chat-service 统一处理）
      // - single_document: 单候选，可直接展示文档信息
      // - clarify: 无候选，需澄清
      const response = {
        success: true,
        tool_name: effectiveToolName,
        skill_namespace: 'document_retrieval',
        strategy: result.strategy,
        query: query.trim(),
        evidence_sufficiency: packet?.meta?.evidence_sufficiency || 'none',
        reason_codes: packet?.meta?.reason_codes || [],
        should_clarify: packet?.meta?.should_clarify || candidates.length === 0,
        should_answer_conservatively: false,
        suggested_response_mode: candidates.length > 1 ? 'candidate_list'
          : candidates.length === 1 ? 'single_document'
          : 'clarify',
        candidates,
        total_candidates: candidates.length,
        toolId: effectiveToolName,
        toolName: display,
        duration,
      };

      logger.info('[ToolManager] find_document 完成:', {
        tool_name: effectiveToolName,
        strategy: result.strategy,
        evidence_sufficiency: response.evidence_sufficiency,
        duration_ms: duration,
        document_count: candidates.length,
        should_clarify: response.should_clarify,
        suggested_response_mode: response.suggested_response_mode,
        identity_distribution: candidates.map(c => ({
          id: c.document_id, confidence: c.identity_confidence, source: c.identity_source,
        })),
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('[ToolManager] find_document 失败:', {
        tool_name: effectiveToolName,
        error: error.message,
        duration_ms: duration,
      });
      return {
        success: false,
        error: error.message,
        toolId: effectiveToolName,
        toolName: display,
        tool_name: effectiveToolName,
        skill_namespace: 'document_retrieval',
        strategy: 'error',
        evidence_sufficiency: 'none',
        should_clarify: true,
        suggested_response_mode: 'clarify',
        candidates: [],
        total_candidates: 0,
        duration,
      };
    }
  }

  /**
   * verify_fact handler
   *
   * 与 answer_from_documents 的区别：
   * - 返回 verdict 枚举（supported / insufficient_evidence）
   * - 区分支持证据和反驳证据（contradicted 能力规划中）
   */
  async _handleVerifyFact(params, context, display) {
    const startTime = Date.now();
    const { query, collection_id, doc_types } = params;
    const userId = context.userId || context.user_id;
    const effectiveToolName = 'verify_fact';

    logger.info('[ToolManager] verify_fact:', {
      tool_name: effectiveToolName,
      query_length: query?.length || 0,
      collection_id,
      doc_types,
      userId,
    });

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Missing required parameter: query',
        toolId: effectiveToolName,
        toolName: display,
      };
    }

    try {
      const retrievalService = this._getDocRetrievalService();
      const accessService = this._getDocAccessService();

      const accessibleIds = await accessService.getAccessibleCollectionIds(userId);
      let effectiveCollectionId = collection_id;
      if (collection_id && accessibleIds.length > 0 && !accessibleIds.includes(collection_id)) {
        effectiveCollectionId = null;
      }

      const result = await retrievalService.retrieve(query.trim(), {
        userId,
        doc_types: doc_types?.length > 0 ? doc_types : undefined,
        collection_id: effectiveCollectionId || undefined,
        top_k_candidates: 10,
        top_k_evidence: 5,
        evidence_threshold: 0.1,
        allow_fallback: true,
      });

      const packet = result.packet;
      const duration = Date.now() - startTime;

      // verify_fact: 基于证据充分性推断 verdict
      const sufficiency = packet?.meta?.evidence_sufficiency || 'none';
      let verdict;
      if (sufficiency === 'strong' || sufficiency === 'medium') {
        verdict = 'supported';
      } else if (sufficiency === 'weak') {
        verdict = 'insufficient_evidence';
      } else {
        verdict = 'insufficient_evidence';
      }

      // 收集证据（当前实现不区分支持/反驳，全部作为 supporting）
      const allEvidence = [];
      for (const doc of (packet?.documents || [])) {
        for (const ev of (doc.evidence || [])) {
          allEvidence.push({
            content: ev.content?.substring(0, 500) || '',
            document_id: doc.document_id,
            document_title: doc.document_title,
            score: ev.score,
          });
        }
      }

      // verify_fact 能力诚实性：
      // - contradicted 判定需要独立的反驳证据链路（当前未实现）
      // - 当前仅稳定支持 supported / insufficient_evidence
      // - contradicted_available: false 明确告知消费方当前不支持真正反驳判定
      const response = {
        success: true,
        tool_name: effectiveToolName,
        skill_namespace: 'document_retrieval',
        verdict,
        contradicted_available: false,
        strategy: result.strategy,
        query: query.trim(),
        evidence_sufficiency: sufficiency,
        reason_codes: packet?.meta?.reason_codes || [],
        supporting_evidence: verdict === 'supported' ? allEvidence.slice(0, 5) : [],
        contradicting_evidence: [],
        related_documents: (packet?.documents || []).map(d => ({
          document_id: d.document_id,
          document_title: d.document_title,
        })),
        toolId: effectiveToolName,
        toolName: display,
        duration,
      };

      logger.info('[ToolManager] verify_fact 完成:', {
        tool_name: effectiveToolName,
        verdict,
        strategy: result.strategy,
        evidence_sufficiency: sufficiency,
        duration_ms: duration,
        reason_codes: response.reason_codes,
        document_count: response.related_documents.length,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('[ToolManager] verify_fact 失败:', {
        tool_name: effectiveToolName,
        error: error.message,
        duration_ms: duration,
      });
      return {
        success: false,
        error: error.message,
        toolId: effectiveToolName,
        toolName: display,
        tool_name: effectiveToolName,
        skill_namespace: 'document_retrieval',
        verdict: 'insufficient_evidence',
        contradicted_available: false,
        strategy: 'error',
        evidence_sufficiency: 'none',
        supporting_evidence: [],
        contradicting_evidence: [],
        related_documents: [],
        duration,
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
   * 执行 MCP 工具（通过 MCP Client 驻留进程）
   * @param {string} toolId - 工具 ID（mcp_{serverName}_{toolName} 格式）
   * @param {object} params - 工具参数
   * @param {object} context - 执行上下文
   * @param {string} display - 工具显示名称
   * @returns {Promise<object>} 执行结果
   */
  async executeMcpTool(toolId, params, context, display) {
    logger.info(`[ToolManager] 执行 MCP 工具: ${toolId}`);

    // 从 mcpToolRegistry 获取工具信息
    let mcpToolInfo = this.mcpToolRegistry.get(toolId);
    
    if (!mcpToolInfo) {
      // 如果注册表中没有，尝试从工具名解析
      const parts = toolId.split('_');
      if (parts.length < 3) {
        return {
          success: false,
          error: `Invalid MCP tool ID format: ${toolId}. Expected: mcp_{serverName}_{toolName}`,
          toolId,
          toolName: display,
        };
      }
      // mcp_serverName_toolName 格式，serverName 可能包含下划线
      // 取第一个 mcp 后面的部分作为 serverName，最后一个部分作为 toolName
      const serverName = parts.slice(1, -1).join('_');
      const toolName = parts[parts.length - 1];
      
      if (!serverName || !toolName) {
        return {
          success: false,
          error: `Invalid MCP tool ID format: ${toolId}`,
          toolId,
          toolName: display,
        };
      }
      
      // 创建临时的工具信息对象
      mcpToolInfo = { serverName, toolName };
    }

    const { serverName, toolName } = mcpToolInfo;

    // 获取 ResidentSkillManager
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
      const userId = context.userId || context.user_id || '';
      let workingDirectory = null;
      if (context.taskContext?.absolute_workspace_path) {
        workingDirectory = context.taskContext.absolute_workspace_path;
      } else if (userId) {
        const { getDefaultWorkspaceAbsolutePath } = await import('./paths.js');
        workingDirectory = getDefaultWorkspaceAbsolutePath(userId);
      }

      // 调用 MCP Client 驻留进程执行工具
      const result = await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        {
          action: 'call_tool',
          server_name: serverName,
          tool_name: toolName,
          arguments: params,
        },
        { userId, workingDirectory },
        120000  // MCP 工具可能需要较长时间，设置 2 分钟超时
      );

      const duration = Date.now() - startTime;
      logger.info(`[ToolManager] MCP 工具执行成功: ${toolId} (${duration}ms)`);

      return {
        success: true,
        data: result,
        toolId,
        toolName: display,
        duration,
      };
    } catch (error) {
      logger.error(`[ToolManager] MCP 工具执行失败: ${toolId}`, error.message);
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
   * 注意: 图片 dataUrl 不再嵌入 tool 消息（OpenAI tool role 只接受 string），
   * 改由 LLMClient.injectImageUserMessages() 在上层注入合成 user 消息
   *
   * @param {Array} results - 工具执行结果数组
   * @param {number} maxLength - 单个结果最大长度（字符数）
   * @returns {Array} LLM 消息数组
   */
  formatToolResultsForLLM(results, maxLength = 10000) {
    return results.map(result => {
      // 构建返回给 LLM 的内容
      const { toolCallId, toolName, duration, ...resultData } = result;

      // 检测图片 dataUrl（保留在 result 对象中供 injectImageUserMessages 使用）
      let hasImage = false;
      if (result.success && result.data?.dataUrl) {
        const dataUrl = result.data.dataUrl;
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
          hasImage = true;
          const imageSize = dataUrl.length;
          logger.info(`[ToolManager] 工具 ${result.toolName} 返回图片 dataUrl，长度: ${imageSize}`);
        }
      }

      let content = JSON.stringify(
        result.success !== undefined && result.data !== undefined
          ? { success: result.success, data: result.data, error: result.error }
          : resultData
      );

      // 如果有图片，附加简短提示而非 base64 数据
      if (hasImage) {
        content += '\n[工具返回了图片数据，将在后续消息中以多模态格式展示]';
      }

      // 截断过长的结果
      if (content.length > maxLength && !hasImage) {
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
      logger.debug(`[ToolManager] 技能 ${skill.id} 的工具:`, toolNames);
      
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
