/**
 * Builtin Tools - 内置工具集
 *
 * 提供完整的文件操作、搜索、管理和网络请求能力。
 * 所有文件操作限制在 data 目录内。
 *
 * 目录说明：
 * - data/: 数据目录，用于存放项目文件、代码仓库、技能等（可通过 Docker 挂载）
 *
 * 环境变量：
 * - DATA_ROOT: 自定义 data 目录路径（默认为 ./data）
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { URL } from 'url';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

// 获取项目根目录（从当前模块位置向上查找）
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..'); // tools/builtin -> tools -> project_root

// 允许访问的根目录列表（只允许 data 目录，避免 AI 搞混当前目录）
const ALLOWED_ROOTS = [
  process.env.DATA_ROOT || path.join(PROJECT_ROOT, 'data'),
];

// 默认配置
const DEFAULTS = {
  readLinesCount: 100,
  readBytesCount: 50000,
  executeTimeout: 30000,
  httpTimeout: 10000,
  maxResponseSize: 1000000, // 1MB
};

// 危险命令黑名单
const DANGEROUS_COMMANDS = [
  /^rm\s+-rf\s+\//,           // rm -rf /
  /^rm\s+-rf\s+~/,            // rm -rf ~
  /^:\(\)\{\s*:\|:\s*&\s*\};\s*:/, // fork bomb
  /^mkfs/,                     // 格式化
  /^dd\s+if=/,                // dd 写入
  /^shutdown/,                 // 关机
  /^reboot/,                   // 重启
  /^init\s+0/,                // 关机
  /^halt/,                     // 停机
];

/**
 * 安全路径检查
 * 确保路径在允许的目录内（data 目录）
 * @param {string} targetPath - 目标路径（可以是相对路径或绝对路径）
 * @returns {string} 解析后的绝对路径
 */
function safePath(targetPath) {
  // 如果是绝对路径，直接使用
  let resolved = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : null;
  
  // 如果是相对路径，分阶段解析
  if (!resolved) {
    const normalizedTarget = targetPath.replace(/[/\\]$/, ''); // 移除末尾斜杠
    
    // 阶段1：首先检查所有根目录的 basename（精确匹配）
    for (const root of ALLOWED_ROOTS) {
      const rootBasename = path.basename(root);
      if (normalizedTarget === rootBasename) {
        resolved = root;
        break;
      }
    }
    
    // 阶段2：检查是否以某个根目录名称开头（如 "skills/subdir" 或 "work/tmp"）
    if (!resolved) {
      for (const root of ALLOWED_ROOTS) {
        const rootBasename = path.basename(root);
        if (normalizedTarget.startsWith(rootBasename + '/') || normalizedTarget.startsWith(rootBasename + '\\')) {
          const subPath = normalizedTarget.slice(rootBasename.length + 1);
          resolved = path.join(root, subPath);
          break;
        }
      }
    }
    
    // 阶段3：在根目录下解析相对路径（仅当路径不包含任何根目录名时）
    if (!resolved) {
      // 检查路径是否包含任何根目录名
      const containsRootName = ALLOWED_ROOTS.some(root => {
        const rootBasename = path.basename(root);
        return normalizedTarget === rootBasename ||
               normalizedTarget.startsWith(rootBasename + '/') ||
               normalizedTarget.startsWith(rootBasename + '\\');
      });
      
      // 如果不包含根目录名，在第一个根目录下解析
      if (!containsRootName) {
        const tryPath = path.resolve(ALLOWED_ROOTS[0], targetPath);
        const normalizedRoot = path.resolve(ALLOWED_ROOTS[0]);
        if (tryPath.startsWith(normalizedRoot)) {
          resolved = tryPath;
        }
      }
    }
  }
  
  // 检查解析后的路径是否在允许的目录内
  if (resolved) {
    for (const root of ALLOWED_ROOTS) {
      const normalizedRoot = path.resolve(root);
      if (resolved.startsWith(normalizedRoot)) {
        return resolved;
      }
    }
  }
  
  // 提供更友好的错误信息
  const allowedDirs = ALLOWED_ROOTS.map(r => path.basename(r)).join(' 或 ');
  throw new Error(`Path access denied: ${targetPath} is outside allowed directories (${allowedDirs})`);
}

/**
 * 检查危险命令
 */
function isDangerousCommand(command) {
  const cmd = command.trim().toLowerCase();
  return DANGEROUS_COMMANDS.some(pattern => pattern.test(cmd));
}

export default {
  name: 'builtin',
  description: '系统内置工具集：文件读写、搜索、管理、网络请求',

  /**
   * 定义工具清单
   */
  getTools() {
    return [
      // 环境信息
      {
        type: 'function',
        function: {
          name: 'get_env_info',
          description: '获取当前环境信息，包括允许访问的目录路径、当前工作目录等。当需要知道可以访问哪些目录时使用此工具。',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      // 技能检索
      {
        type: 'function',
        function: {
          name: 'list_skills',
          description: '检索当前专家可用的外部技能列表。通过 expert_skills 表关联查询当前专家已启用的技能，返回技能名称、描述、工具列表等信息。',
          parameters: {
            type: 'object',
            properties: {
              include_tools: {
                type: 'boolean',
                description: '是否包含每个技能的工具列表（skill_tools 表），默认 true',
                default: true
              }
            },
            required: []
          }
        }
      },
      // 读取类
      {
        type: 'function',
        function: {
          name: 'read_lines',
          description: '按行读取文件内容，默认读取100行。路径相对于 data 目录，也可以使用绝对路径',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径（data 目录下的相对路径，或绝对路径）' },
              start: { type: 'number', description: '起始行（0-based），默认0', default: 0 },
              count: { type: 'number', description: '读取行数，默认100', default: DEFAULTS.readLinesCount }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'read_bytes',
          description: '按字节读取文件内容，默认读取50KB',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              start: { type: 'number', description: '起始字节，默认0', default: 0 },
              count: { type: 'number', description: '读取字节数，默认50000', default: DEFAULTS.readBytesCount }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'list_files',
          description: '列出目录内容。路径相对于 data 目录，也可以使用绝对路径',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '目录路径（data 目录下的相对路径，或绝对路径）' },
              recursive: { type: 'boolean', description: '是否递归列出', default: false },
              pattern: { type: 'string', description: '文件过滤模式（如 *.js）' }
            },
            required: ['path']
          }
        }
      },
      // 写入类
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: '写入文件（覆盖已有内容）',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              content: { type: 'string', description: '文件内容' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'append_file',
          description: '追加内容到文件末尾',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              content: { type: 'string', description: '追加内容' }
            },
            required: ['path', 'content']
          }
        }
      },
      // 编辑类
      {
        type: 'function',
        function: {
          name: 'replace_in_file',
          description: '精确替换文件中的文本',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              search: { type: 'string', description: '搜索文本' },
              replace: { type: 'string', description: '替换文本' },
              replaceAll: { type: 'boolean', description: '是否替换全部匹配', default: false }
            },
            required: ['path', 'search', 'replace']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'insert_at_line',
          description: '在指定行后插入内容',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              line: { type: 'number', description: '在第几行后插入（0表示文件开头）' },
              content: { type: 'string', description: '插入内容' }
            },
            required: ['path', 'line', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'delete_lines',
          description: '删除指定行',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              start: { type: 'number', description: '起始行（0-based）' },
              count: { type: 'number', description: '删除行数', default: 1 }
            },
            required: ['path', 'start']
          }
        }
      },
      // 搜索类
      {
        type: 'function',
        function: {
          name: 'search_in_file',
          description: '在文件中搜索（带上下文）',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '搜索路径' },
              pattern: { type: 'string', description: '搜索模式（正则表达式）' },
              filePattern: { type: 'string', description: '文件过滤（如 *.js）' },
              contextLines: { type: 'number', description: '上下文行数', default: 2 }
            },
            required: ['path', 'pattern']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'grep',
          description: '跨文件正则搜索',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '搜索路径' },
              pattern: { type: 'string', description: '正则模式' },
              filePattern: { type: 'string', description: '文件过滤（如 *.{js,ts}）' },
              ignoreCase: { type: 'boolean', description: '忽略大小写', default: false }
            },
            required: ['path', 'pattern']
          }
        }
      },
      // 管理类
      {
        type: 'function',
        function: {
          name: 'copy_file',
          description: '复制文件',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: '源文件路径' },
              dest: { type: 'string', description: '目标路径' }
            },
            required: ['source', 'dest']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'move_file',
          description: '移动文件',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: '源文件路径' },
              dest: { type: 'string', description: '目标路径' }
            },
            required: ['source', 'dest']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'delete_file',
          description: '删除文件或目录',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件或目录路径' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_dir',
          description: '创建目录（递归创建）',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '目录路径' }
            },
            required: ['path']
          }
        }
      },
      // 压缩类
      {
        type: 'function',
        function: {
          name: 'zip',
          description: '创建ZIP压缩包',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: '源文件或目录' },
              dest: { type: 'string', description: '目标ZIP路径' },
              recursive: { type: 'boolean', description: '递归压缩', default: true }
            },
            required: ['source', 'dest']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'unzip',
          description: '解压ZIP文件',
          parameters: {
            type: 'object',
            properties: {
              source: { type: 'string', description: 'ZIP文件路径' },
              dest: { type: 'string', description: '解压目标目录' },
              overwrite: { type: 'boolean', description: '覆盖已存在文件', default: false }
            },
            required: ['source', 'dest']
          }
        }
      },
      // 执行类
      {
        type: 'function',
        function: {
          name: 'execute',
          description: '执行脚本命令',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: '命令或脚本路径' },
              args: { type: 'array', items: { type: 'string' }, description: '命令参数' },
              timeout: { type: 'number', description: '超时（毫秒）', default: DEFAULTS.executeTimeout },
              cwd: { type: 'string', description: '工作目录' }
            },
            required: ['command']
          }
        }
      },
      // 网络类
      {
        type: 'function',
        function: {
          name: 'http_get',
          description: '发送HTTP GET请求',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '请求URL' },
              headers: { type: 'object', description: '请求头' },
              timeout: { type: 'number', description: '超时（毫秒）', default: DEFAULTS.httpTimeout }
            },
            required: ['url']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'http_post',
          description: '发送HTTP POST请求',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '请求URL' },
              body: { description: '请求体（对象或字符串）' },
              headers: { type: 'object', description: '请求头' },
              timeout: { type: 'number', description: '超时（毫秒）', default: DEFAULTS.httpTimeout }
            },
            required: ['url']
          }
        }
      }
    ];
  },

  /**
   * 执行工具调用
   */
  async execute(toolName, params, context) {
    try {
      switch (toolName) {
        // 环境信息
        case 'get_env_info':
          return await this.getEnvInfo(params);
        
        // 技能检索
        case 'list_skills':
          return await this.listSkills(params, context);
        
        // 读取类
        case 'read_lines':
          return await this.readLines(params);
        case 'read_bytes':
          return await this.readBytes(params);
        case 'list_files':
          return await this.listFiles(params);
        
        // 写入类
        case 'write_file':
          return await this.writeFile(params);
        case 'append_file':
          return await this.appendFile(params);
        
        // 编辑类
        case 'replace_in_file':
          return await this.replaceInFile(params);
        case 'insert_at_line':
          return await this.insertAtLine(params);
        case 'delete_lines':
          return await this.deleteLines(params);
        
        // 搜索类
        case 'search_in_file':
          return await this.searchInFile(params);
        case 'grep':
          return await this.grep(params);
        
        // 管理类
        case 'copy_file':
          return await this.copyFile(params);
        case 'move_file':
          return await this.moveFile(params);
        case 'delete_file':
          return await this.deleteFile(params);
        case 'create_dir':
          return await this.createDir(params);
        
        // 压缩类
        case 'zip':
          return await this.zipFiles(params);
        case 'unzip':
          return await this.unzipFiles(params);
        
        // 执行类
        case 'execute':
          return await this.executeCommand(params);
        
        // 网络类
        case 'http_get':
          return await this.httpGet(params);
        case 'http_post':
          return await this.httpPost(params);
        
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // ==================== 环境信息 ====================

  async getEnvInfo(params) {
    return {
      success: true,
      cwd: process.cwd(),
      allowedRoots: ALLOWED_ROOTS.map(root => ({
        name: path.basename(root),
        path: root,
        exists: fs.existsSync(root),
      })),
      platform: process.platform,
      nodeVersion: process.version,
    };
  },

  // ==================== 技能检索 ====================

  /**
   * 检索当前专家可用的外部技能列表
   * 从 expert_skills 表关联 skills 表和 skill_tools 表获取数据
   * @param {object} params - 参数
   * @param {boolean} params.include_tools - 是否包含工具列表，默认 true
   * @param {object} context - 上下文，包含 db 实例和 expert_id
   */
  async listSkills(params, context) {
    const { include_tools = true } = params;
    
    // 检查数据库实例是否可用
    if (!context?.db) {
      return {
        success: false,
        error: 'Database not available. This tool requires database context.'
      };
    }

    // 检查专家ID是否可用
    if (!context?.expert_id) {
      return {
        success: false,
        error: 'Expert ID not available. This tool requires expert context.'
      };
    }

    try {
      const db = context.db;
      const expertId = context.expert_id;
      
      // 1. 查询当前专家启用的技能（通过 expert_skills 表关联）
      const skills = await db.query(
        `SELECT s.id, s.name, s.description, s.source_type, s.source_path, s.version, s.author, s.tags,
                s.created_at, s.updated_at, es.config as expert_config
         FROM skills s
         INNER JOIN expert_skills es ON s.id = es.skill_id
         WHERE es.expert_id = ? AND es.is_enabled = 1 AND s.is_active = 1`,
        [expertId]
      );

      // 2. 如果需要工具列表，查询 skill_tools 表
      let skillTools = [];
      if (include_tools && skills.length > 0) {
        const skillIds = skills.map(s => s.id);
        const placeholders = skillIds.map(() => '?').join(',');
        skillTools = await db.query(
          `SELECT id, skill_id, name, description, type, \`usage\`, command, endpoint, method, created_at
           FROM skill_tools
           WHERE skill_id IN (${placeholders})`,
          skillIds
        );
      }

      // 3. 组装结果
      const result = skills.map(skill => {
        const skillData = {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          source_type: skill.source_type,
          source_path: skill.source_path,
          version: skill.version,
          author: skill.author,
          tags: skill.tags ? (typeof skill.tags === 'string' ? JSON.parse(skill.tags) : skill.tags) : [],
          created_at: skill.created_at,
          updated_at: skill.updated_at,
        };

        // 添加工具列表
        if (include_tools) {
          skillData.tools = skillTools
            .filter(t => t.skill_id === skill.id)
            .map(t => ({
              id: t.id,
              name: t.name,
              description: t.description,
              type: t.type,
              usage: t.usage ? (typeof t.usage === 'string' ? JSON.parse(t.usage) : t.usage) : null,
              command: t.command,
              endpoint: t.endpoint,
              method: t.method,
            }));
        }

        return skillData;
      });

      return {
        success: true,
        expert_id: expertId,
        total: result.length,
        skills: result,
      };

    } catch (error) {
      return {
        success: false,
        error: `Failed to list skills: ${error.message}`
      };
    }
  },

  // ==================== 读取类 ====================

  async readLines(params) {
    const { path: filePath, start = 0, count = DEFAULTS.readLinesCount } = params;
    const fullPath = safePath(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const totalLines = lines.length;
    const selectedLines = lines.slice(start, start + count);
    
    return {
      success: true,
      content: selectedLines.join('\n'),
      start,
      returnedLines: selectedLines.length,
      totalLines,
      hasMore: start + count < totalLines
    };
  },

  async readBytes(params) {
    const { path: filePath, start = 0, count = DEFAULTS.readBytesCount } = params;
    const fullPath = safePath(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    
    const stats = fs.statSync(fullPath);
    const totalBytes = stats.size;
    
    const fd = fs.openSync(fullPath, 'r');
    const buffer = Buffer.alloc(Math.min(count, totalBytes - start));
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, start);
    fs.closeSync(fd);
    
    return {
      success: true,
      content: buffer.toString('utf-8', 0, bytesRead),
      start,
      bytesRead,
      totalBytes,
      hasMore: start + bytesRead < totalBytes
    };
  },

  async listFiles(params) {
    const { path: dirPath, recursive = false, pattern } = params;
    const fullPath = safePath(dirPath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Directory not found: ${dirPath}` };
    }
    
    const results = [];
    const patternRegex = pattern ? new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.')) : null;
    
    function scan(dir, base) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const item of items) {
        const relativePath = base ? `${base}/${item.name}` : item.name;
        
        if (item.isDirectory()) {
          results.push({ name: item.name, type: 'directory', path: relativePath });
          if (recursive) {
            scan(path.join(dir, item.name), relativePath);
          }
        } else if (item.isFile()) {
          if (!patternRegex || patternRegex.test(item.name)) {
            const stats = fs.statSync(path.join(dir, item.name));
            results.push({ 
              name: item.name, 
              type: 'file', 
              path: relativePath,
              size: stats.size 
            });
          }
        }
      }
    }
    
    scan(fullPath, '');
    
    return { success: true, files: results };
  },

  // ==================== 写入类 ====================

  async writeFile(params) {
    const { path: filePath, content } = params;
    const fullPath = safePath(filePath);
    
    // 确保目录存在
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content, 'utf-8');
    const stats = fs.statSync(fullPath);
    
    return { success: true, path: filePath, size: stats.size };
  },

  async appendFile(params) {
    const { path: filePath, content } = params;
    const fullPath = safePath(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    
    const beforeSize = fs.statSync(fullPath).size;
    fs.appendFileSync(fullPath, content, 'utf-8');
    const afterSize = fs.statSync(fullPath).size;
    
    return { success: true, appendedSize: afterSize - beforeSize };
  },

  // ==================== 编辑类 ====================

  async replaceInFile(params) {
    const { path: filePath, search, replace, replaceAll = false } = params;
    const fullPath = safePath(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    
    let content = fs.readFileSync(fullPath, 'utf-8');
    let replacements = 0;
    
    if (replaceAll) {
      const matches = content.split(search).length - 1;
      content = content.split(search).join(replace);
      replacements = matches;
    } else {
      const idx = content.indexOf(search);
      if (idx !== -1) {
        content = content.substring(0, idx) + replace + content.substring(idx + search.length);
        replacements = 1;
      }
    }
    
    if (replacements > 0) {
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
    
    return { success: true, replacements };
  },

  async insertAtLine(params) {
    const { path: filePath, line, content } = params;
    const fullPath = safePath(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const lines = fileContent.split('\n');
    
    // 在指定行后插入
    const insertIndex = Math.min(Math.max(0, line), lines.length);
    lines.splice(insertIndex, 0, content);
    
    fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
    
    return { success: true, insertedAt: insertIndex };
  },

  async deleteLines(params) {
    const { path: filePath, start, count = 1 } = params;
    const fullPath = safePath(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `File not found: ${filePath}` };
    }
    
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    
    const deletedCount = Math.min(count, lines.length - start);
    lines.splice(start, deletedCount);
    
    fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
    
    return { success: true, deletedLines: deletedCount };
  },

  // ==================== 搜索类 ====================

  async searchInFile(params) {
    const { path: searchPath, pattern, filePattern, contextLines = 2 } = params;
    const fullPath = safePath(searchPath);
    const regex = new RegExp(pattern, 'g');
    const fileRegex = filePattern ? 
      new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.')) : null;
    
    const matches = [];
    
    function searchFile(filePath, relativePath) {
      if (!fs.statSync(filePath).isFile()) return;
      if (fileRegex && !fileRegex.test(path.basename(filePath))) return;
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const context = [];
          for (let j = Math.max(0, i - contextLines); j <= Math.min(lines.length - 1, i + contextLines); j++) {
            context.push(lines[j]);
          }
          
          matches.push({
            file: relativePath,
            line: i,
            content: lines[i],
            context
          });
        }
        
        // 重置正则的 lastIndex
        regex.lastIndex = 0;
      }
    }
    
    function scan(dir, base) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const itemPath = path.join(dir, item.name);
        const relativePath = base ? `${base}/${item.name}` : item.name;
        
        if (item.isDirectory()) {
          scan(itemPath, relativePath);
        } else {
          searchFile(itemPath, relativePath);
        }
      }
    }
    
    if (fs.statSync(fullPath).isFile()) {
      searchFile(fullPath, path.basename(fullPath));
    } else {
      scan(fullPath, '');
    }
    
    return { success: true, matches, totalMatches: matches.length };
  },

  async grep(params) {
    const { path: searchPath, pattern, filePattern, ignoreCase = false } = params;
    const fullPath = safePath(searchPath);
    const flags = ignoreCase ? 'gi' : 'g';
    const regex = new RegExp(pattern, flags);
    const fileRegex = filePattern ? 
      new RegExp(filePattern.replace(/\*/g, '.*').replace(/\?/g, '.').replace(/[{}]/g, (m) => 
        m === '{' ? '(' : m === '}' ? ')' : m
      )) : null;
    
    const matches = [];
    
    function grepFile(filePath, relativePath) {
      if (!fs.statSync(filePath).isFile()) return;
      if (fileRegex && !fileRegex.test(path.basename(filePath))) return;
      
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({
            file: relativePath,
            line: i,
            content: lines[i].trim()
          });
        }
        regex.lastIndex = 0;
      }
    }
    
    function scan(dir, base) {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        const itemPath = path.join(dir, item.name);
        const relativePath = base ? `${base}/${item.name}` : item.name;
        
        if (item.isDirectory()) {
          scan(itemPath, relativePath);
        } else {
          grepFile(itemPath, relativePath);
        }
      }
    }
    
    if (fs.statSync(fullPath).isFile()) {
      grepFile(fullPath, path.basename(fullPath));
    } else {
      scan(fullPath, '');
    }
    
    return { success: true, matches };
  },

  // ==================== 管理类 ====================

  async copyFile(params) {
    const { source, dest } = params;
    const sourcePath = safePath(source);
    const destPath = safePath(dest);
    
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source not found: ${source}` };
    }
    
    // 确保目标目录存在
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    fs.copyFileSync(sourcePath, destPath);
    
    return { success: true, source, dest };
  },

  async moveFile(params) {
    const { source, dest } = params;
    const sourcePath = safePath(source);
    const destPath = safePath(dest);
    
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source not found: ${source}` };
    }
    
    // 确保目标目录存在
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    fs.renameSync(sourcePath, destPath);
    
    return { success: true, source, dest };
  },

  async deleteFile(params) {
    const { path: filePath } = params;
    const fullPath = safePath(filePath);
    
    if (!fs.existsSync(fullPath)) {
      return { success: false, error: `Path not found: ${filePath}` };
    }
    
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    
    return { success: true, deletedPath: filePath, wasDirectory: stats.isDirectory() };
  },

  async createDir(params) {
    const { path: dirPath } = params;
    const fullPath = safePath(dirPath);
    
    fs.mkdirSync(fullPath, { recursive: true });
    
    return { success: true, path: dirPath };
  },

  // ==================== 压缩类 ====================

  async zipFiles(params) {
    const { source, dest, recursive = true } = params;
    const sourcePath = safePath(source);
    const destPath = safePath(dest);
    
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `Source not found: ${source}` };
    }
    
    const zip = new AdmZip();
    let filesCount = 0;
    
    if (fs.statSync(sourcePath).isDirectory()) {
      zip.addLocalFolder(sourcePath, path.basename(sourcePath));
      // 计算文件数
      const entries = zip.getEntries();
      filesCount = entries.length;
    } else {
      zip.addLocalFile(sourcePath);
      filesCount = 1;
    }
    
    // 确保目标目录存在
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    zip.writeZip(destPath);
    const stats = fs.statSync(destPath);
    
    return { 
      success: true, 
      filesCount, 
      compressedSize: stats.size,
      dest 
    };
  },

  async unzipFiles(params) {
    const { source, dest, overwrite = false } = params;
    const sourcePath = safePath(source);
    const destPath = safePath(dest);
    
    if (!fs.existsSync(sourcePath)) {
      return { success: false, error: `ZIP file not found: ${source}` };
    }
    
    const zip = new AdmZip(sourcePath);
    const entries = zip.getEntries();
    
    // 确保目标目录存在
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }
    
    zip.extractAllTo(destPath, overwrite);
    
    return { 
      success: true, 
      files: entries.map(e => e.entryName),
      extractedTo: dest 
    };
  },

  // ==================== 执行类 ====================

  async executeCommand(params) {
    const { command, args = [], timeout = DEFAULTS.executeTimeout, cwd } = params;
    
    // 检查危险命令
    if (isDangerousCommand(command)) {
      return { success: false, error: `Dangerous command blocked: ${command}` };
    }
    
    // 默认使用第一个允许的根目录（skills）作为工作目录
    const workDir = cwd ? safePath(cwd) : ALLOWED_ROOTS[0];
    
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      // 解析命令
      let cmd = command;
      let cmdArgs = [...args];
      
      // 处理脚本文件
      if (command.endsWith('.sh')) {
        cmd = 'bash';
        cmdArgs = [command, ...args];
      } else if (command.endsWith('.py')) {
        cmd = 'python';
        cmdArgs = [command, ...args];
      } else if (command.endsWith('.js')) {
        cmd = 'node';
        cmdArgs = [command, ...args];
      }
      
      const proc = spawn(cmd, cmdArgs, {
        cwd: workDir,
        shell: true,
        timeout
      });
      
      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        resolve({
          success: code === 0,
          exitCode: code,
          stdout: stdout.slice(0, 10000), // 限制输出大小
          stderr: stderr.slice(0, 5000),
          timedOut
        });
      });
      
      proc.on('error', (error) => {
        resolve({
          success: false,
          error: error.message
        });
      });
      
      // 超时处理
      setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeout);
    });
  },

  // ==================== 网络类 ====================

  async httpGet(params) {
    const { url, headers = {}, timeout = DEFAULTS.httpTimeout } = params;
    
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const req = client.get(url, {
          headers: {
            'User-Agent': 'TouwakaMate/1.0',
            ...headers
          },
          timeout
        }, (res) => {
          let data = '';
          let size = 0;
          
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size <= DEFAULTS.maxResponseSize) {
              data += chunk.toString();
            }
          });
          
          res.on('end', () => {
            resolve({
              success: true,
              statusCode: res.statusCode,
              headers: res.headers,
              body: data.slice(0, DEFAULTS.maxResponseSize),
              truncated: size > DEFAULTS.maxResponseSize
            });
          });
        });
        
        req.on('error', (error) => {
          resolve({ success: false, error: error.message });
        });
        
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Request timeout' });
        });
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  },

  async httpPost(params) {
    const { url, body, headers = {}, timeout = DEFAULTS.httpTimeout } = params;
    
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const bodyStr = typeof body === 'object' ? JSON.stringify(body) : (body || '');
        
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr),
            'User-Agent': 'TouwakaMate/1.0',
            ...headers
          },
          timeout
        };
        
        const req = client.request(options, (res) => {
          let data = '';
          let size = 0;
          
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size <= DEFAULTS.maxResponseSize) {
              data += chunk.toString();
            }
          });
          
          res.on('end', () => {
            resolve({
              success: true,
              statusCode: res.statusCode,
              headers: res.headers,
              body: data.slice(0, DEFAULTS.maxResponseSize),
              truncated: size > DEFAULTS.maxResponseSize
            });
          });
        });
        
        req.on('error', (error) => {
          resolve({ success: false, error: error.message });
        });
        
        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Request timeout' });
        });
        
        req.write(bodyStr);
        req.end();
      } catch (error) {
        resolve({ success: false, error: error.message });
      }
    });
  }
};
