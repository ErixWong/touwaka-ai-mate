/**
 * Skill Manager - 技能管理技能
 * 
 * 用于管理技能的注册、删除、分配等操作
 * 仅供技能管理专家（如 skill-studio）使用
 * 
 * 注意：此技能运行在沙箱中，需要通过环境变量获取数据库配置
 * 数据库配置通过 skill_parameters 表注入，格式为：
 * - SKILL_DB_HOST: 数据库主机
 * - SKILL_DB_PORT: 数据库端口
 * - SKILL_DB_NAME: 数据库名称
 * - SKILL_DB_USER: 数据库用户
 * - SKILL_DB_PASSWORD: 数据库密码
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// 从环境变量获取数据库配置（由 skill-loader 注入）
const DB_CONFIG = {
  host: process.env.SKILL_DB_HOST || 'localhost',
  port: parseInt(process.env.SKILL_DB_PORT || '3306'),
  database: process.env.SKILL_DB_NAME || 'touwaka_mate',
  user: process.env.SKILL_DB_USER || 'root',
  password: process.env.SKILL_DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: 2,  // 技能只需要少量连接
};

/**
 * 生成唯一ID
 */
function newID(length = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 解析 SKILL.md 内容，提取技能元信息
 * （内联实现，避免引用主程序代码）
 */
function parseSkillMd(content) {
  const info = {
    name: '',
    description: '',
    version: '',
    author: '',
    tags: [],
  };

  if (!content || typeof content !== 'string') {
    return info;
  }

  const lines = content.split('\n');

  // 提取标题（第一个 # 开头的行）
  const titleMatch = content.match(/^#\s+(.+)$/m);
  if (titleMatch) {
    info.name = titleMatch[1].trim();
  }

  // 提取描述（第一个 ## 描述/Description 下的内容）
  const descMatch = content.match(/##\s*(?:描述|Description)\s*\n+([^#]+)/i);
  if (descMatch) {
    info.description = descMatch[1].trim();
  }

  // 尝试解析 YAML frontmatter
  const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (yamlMatch) {
    const yaml = yamlMatch[1];
    const versionMatch = yaml.match(/version:\s*(.+)/);
    const authorMatch = yaml.match(/author:\s*(.+)/);
    const tagsMatch = yaml.match(/tags:\s*\[(.*?)\]/);

    if (versionMatch) info.version = versionMatch[1].trim();
    if (authorMatch) info.author = authorMatch[1].trim();
    if (tagsMatch) {
      info.tags = tagsMatch[1].split(',').map(t => t.trim().replace(/['"]/g, ''));
    }
  }

  // 遍历行解析元数据（支持行内格式）
  for (const line of lines) {
    const trimmed = line.trim();

    // 解析版本（version: 或 版本:）
    if (/^(version|版本)\s*:/i.test(trimmed)) {
      info.version = trimmed.split(':')[1]?.trim() || info.version;
    }

    // 解析作者（author: 或 作者:）
    if (/^(author|作者)\s*:/i.test(trimmed)) {
      info.author = trimmed.split(':')[1]?.trim() || info.author;
    }

    // 解析标签（tags: 或 标签:）
    if (/^(tags|标签)\s*:/i.test(trimmed)) {
      const tagsStr = trimmed.split(':')[1]?.trim() || '';
      if (tagsStr && info.tags.length === 0) {
        info.tags = tagsStr.split(',').map(t => t.trim()).filter(Boolean);
      }
    }
  }

  return info;
}

/**
 * 验证技能路径是否安全（防止路径遍历攻击）
 * （内联实现，避免引用主程序代码）
 *
 * @param {string} sourcePath - 相对于 dataBasePath 的路径（如 "skills/file-operations"）
 * @param {string} dataBasePath - 数据基础路径（如 "/shared" 或 "cwd/data"）
 * @returns {{ valid: boolean, fullPath?: string, relativePath?: string, error?: string }}
 */
function validateSkillPath(sourcePath, dataBasePath) {
  // 规范化路径
  let fullPath;
  if (path.isAbsolute(sourcePath)) {
    fullPath = path.normalize(sourcePath);
  } else {
    // 相对路径：source_path 是相对于 dataBasePath 的路径
    // 例如：source_path = "skills/file-operations" → dataBasePath/skills/file-operations
    fullPath = path.normalize(path.join(dataBasePath, sourcePath));
  }

  // 检查路径是否在允许的目录内（dataBasePath 下的 skills 子目录）
  const allowedPath = path.join(dataBasePath, 'skills');
  const isAllowed = fullPath.startsWith(allowedPath + path.sep) || fullPath === allowedPath;

  if (!isAllowed) {
    return {
      valid: false,
      fullPath,
      error: `Invalid path: skill must be in dataBasePath/skills directory. source_path should be like "skills/your-skill-name"`,
    };
  }

  // 检查路径是否存在
  if (!fs.existsSync(fullPath)) {
    return {
      valid: false,
      fullPath,
      error: `Directory not found: ${sourcePath}`,
    };
  }

  // 计算相对于 dataBasePath 的相对路径（用于存储到数据库）
  const relativePath = path.relative(dataBasePath, fullPath);
  
  return { valid: true, fullPath, relativePath };
}

/**
 * 获取数据库连接
 */
async function getConnection(pool) {
  try {
    const connection = await pool.getConnection();
    return connection;
  } catch (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }
}

// 创建连接池（延迟初始化）
let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = mysql.createPool(DB_CONFIG);
  }
  return _pool;
}

module.exports = {
  name: 'skill-manager',
  description: '技能管理工具：注册、删除、分配技能',

  /**
   * 定义工具清单
   */
  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'register_skill',
          description: '从本地目录注册或更新技能到数据库。需要先读取 SKILL.md，理解工具定义后调用此工具。同名技能会覆盖更新。',
          parameters: {
            type: 'object',
            properties: {
              source_path: {
                type: 'string',
                description: '技能目录相对于 dataBasePath 的路径。例如：skills/searxng（注意：包含 skills/ 前缀）'
              },
              name: {
                type: 'string',
                description: '技能名称（可选，默认从 SKILL.md 的 name 字段提取）'
              },
              description: {
                type: 'string',
                description: '技能描述（可选，默认从 SKILL.md 的 description 字段提取）'
              },
              tools: {
                type: 'array',
                description: '工具定义数组。每个工具包含 name、description、parameters 字段。parameters 是 JSON Schema 格式。',
                items: {
                  type: 'object',
                  properties: {
                    name: {
                      type: 'string',
                      description: '工具名称，如 web_search、read_lines'
                    },
                    description: {
                      type: 'string',
                      description: '工具功能描述'
                    },
                    parameters: {
                      type: 'object',
                      description: 'JSON Schema 格式的参数定义，包含 type、properties、required 字段'
                    }
                  },
                  required: ['name', 'description', 'parameters']
                }
              }
            },
            required: ['source_path', 'tools']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'delete_skill',
          description: '从数据库中删除技能（谨慎使用，会同时删除关联的工具定义）',
          parameters: {
            type: 'object',
            properties: {
              skill_id: {
                type: 'string',
                description: '技能ID或名称'
              }
            },
            required: ['skill_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'assign_skill_to_expert',
          description: '将技能分配给指定专家（下次对话生效）',
          parameters: {
            type: 'object',
            properties: {
              skill_id: {
                type: 'string',
                description: '技能ID或名称'
              },
              expert_id: {
                type: 'string',
                description: '专家ID或名称'
              }
            },
            required: ['skill_id', 'expert_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'unassign_skill_from_expert',
          description: '取消技能与专家的关联',
          parameters: {
            type: 'object',
            properties: {
              skill_id: {
                type: 'string',
                description: '技能ID或名称'
              },
              expert_id: {
                type: 'string',
                description: '专家ID或名称'
              }
            },
            required: ['skill_id', 'expert_id']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'toggle_skill',
          description: '启用或禁用技能（下次对话生效）',
          parameters: {
            type: 'object',
            properties: {
              skill_id: {
                type: 'string',
                description: '技能ID或名称'
              },
              is_active: {
                type: 'boolean',
                description: '是否启用'
              }
            },
            required: ['skill_id', 'is_active']
          }
        }
      }
    ];
  },

  /**
   * 执行工具调用
   */
  async execute(toolName, params, context) {
    // 获取数据库连接池
    const pool = getPool();
    
    try {
      switch (toolName) {
        case 'register_skill':
          return await this.registerSkill(params, pool);
        case 'delete_skill':
          return await this.deleteSkill(params, pool);
        case 'assign_skill_to_expert':
          return await this.assignSkillToExpert(params, pool);
        case 'unassign_skill_from_expert':
          return await this.unassignSkillFromExpert(params, pool);
        case 'toggle_skill':
          return await this.toggleSkill(params, pool);
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 注册技能
   *
   * 新流程：由专家（LLM）读取 SKILL.md，理解工具定义后调用此工具
   * 工具定义通过 tools 参数传入，不再从 index.js 的 getTools() 获取
   */
  async registerSkill(params, pool) {
    const { source_path, name: providedName, description: providedDesc, tools: providedTools } = params;

    // 验证必须提供 tools 参数
    if (!providedTools || !Array.isArray(providedTools) || providedTools.length === 0) {
      return {
        success: false,
        error: 'tools 参数是必需的。请先读取 SKILL.md，理解工具定义后传入 tools 数组。'
      };
    }

    // 获取数据基础路径（从环境变量）
    const dataBasePath = process.env.DATA_BASE_PATH || path.join(process.cwd(), 'data');
    
    // 安全验证：确保路径在允许的目录内
    const pathValidation = validateSkillPath(source_path, dataBasePath);
    if (!pathValidation.valid) {
      return {
        success: false,
        error: pathValidation.error || 'Invalid skill path'
      };
    }
    const fullPath = pathValidation.fullPath;

    // 读取 SKILL.md
    const skillMdPath = path.join(fullPath, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return {
        success: false,
        error: `SKILL.md not found in ${source_path}. Each skill must have a SKILL.md file.`
      };
    }

    const skillMd = fs.readFileSync(skillMdPath, 'utf-8');

    // 使用内联函数解析 SKILL.md 的基本信息
    const skillInfo = parseSkillMd(skillMd);
    const skillName = providedName || skillInfo.name || path.basename(fullPath);
    const skillDesc = providedDesc || skillInfo.description || '';

    // 检查是否已存在同名技能
    const [existingSkill] = await pool.query(
      'SELECT id FROM skills WHERE name = ?',
      [skillName]
    );

    const skillId = existingSkill.length > 0 ? existingSkill[0].id : newID();

    // 插入或更新技能
    await pool.execute(
      `INSERT INTO skills (id, name, description, version, author, tags, source_type, source_path, skill_md, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 'local', ?, ?, 1)
       ON DUPLICATE KEY UPDATE
       description = VALUES(description),
       version = VALUES(version),
       author = VALUES(author),
       tags = VALUES(tags),
       source_path = VALUES(source_path),
       skill_md = VALUES(skill_md),
       updated_at = CURRENT_TIMESTAMP`,
      [
        skillId,
        skillName,
        skillDesc,
        skillInfo.version || '1.0.0',
        skillInfo.author || '',
        skillInfo.tags ? JSON.stringify(skillInfo.tags) : '[]',
        pathValidation.relativePath,
        skillMd
      ]
    );

    // 删除旧的工具定义
    await pool.execute('DELETE FROM skill_tools WHERE skill_id = ?', [skillId]);

    // 使用传入的 tools 参数插入工具定义
    let registeredTools = 0;
    for (const tool of providedTools) {
      if (!tool.name || !tool.description) {
        console.warn(`Skipping invalid tool definition:`, tool);
        continue;
      }

      await pool.execute(
        `INSERT INTO skill_tools (id, skill_id, name, description, parameters)
         VALUES (?, ?, ?, ?, ?)`,
        [
          newID(),
          skillId,
          tool.name,
          tool.description,
          JSON.stringify(tool.parameters || { type: 'object', properties: {} })
        ]
      );
      registeredTools++;
    }

    const isUpdate = existingSkill.length > 0;
    return {
      success: true,
      skill_id: skillId,
      name: skillName,
      action: isUpdate ? 'updated' : 'created',
      tools_registered: registeredTools,
      message: `✅ Skill "${skillName}" ${isUpdate ? 'updated' : 'registered'} with ${registeredTools} tools`
    };
  },

  /**
   * 删除技能
   */
  async deleteSkill(params, pool) {
    const { skill_id } = params;

    const [skill] = await pool.query(
      'SELECT id, name FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }

    const actualSkillId = skill[0].id;
    const skillName = skill[0].name;

    // 先删除关联
    await pool.execute('DELETE FROM expert_skills WHERE skill_id = ?', [actualSkillId]);
    await pool.execute('DELETE FROM skill_tools WHERE skill_id = ?', [actualSkillId]);
    await pool.execute('DELETE FROM skills WHERE id = ?', [actualSkillId]);

    return {
      success: true,
      message: `✅ Skill "${skillName}" deleted successfully`
    };
  },

  /**
   * 分配技能给专家
   */
  async assignSkillToExpert(params, pool) {
    const { skill_id, expert_id } = params;

    // 查找技能
    const [skill] = await pool.query(
      'SELECT id FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }
    const actualSkillId = skill[0].id;

    // 查找专家
    const [expert] = await pool.query(
      'SELECT id FROM experts WHERE id = ? OR name = ?',
      [expert_id, expert_id]
    );
    if (expert.length === 0) {
      return { success: false, error: `Expert not found: ${expert_id}` };
    }
    const actualExpertId = expert[0].id;

    // 检查是否已关联
    const [existing] = await pool.query(
      'SELECT id FROM expert_skills WHERE expert_id = ? AND skill_id = ?',
      [actualExpertId, actualSkillId]
    );

    if (existing.length > 0) {
      // 更新为启用状态
      await pool.execute(
        'UPDATE expert_skills SET is_enabled = 1 WHERE expert_id = ? AND skill_id = ?',
        [actualExpertId, actualSkillId]
      );
      return {
        success: true,
        message: `✅ Skill already assigned, enabled now`
      };
    }

    // 创建关联
    await pool.execute(
      `INSERT INTO expert_skills (id, expert_id, skill_id, is_enabled) VALUES (?, ?, ?, 1)`,
      [newID(), actualExpertId, actualSkillId]
    );

    return {
      success: true,
      message: `✅ Skill assigned to expert successfully`
    };
  },

  /**
   * 取消技能分配
   */
  async unassignSkillFromExpert(params, pool) {
    const { skill_id, expert_id } = params;

    // 查找技能
    const [skill] = await pool.query(
      'SELECT id FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }
    const actualSkillId = skill[0].id;

    // 查找专家
    const [expert] = await pool.query(
      'SELECT id FROM experts WHERE id = ? OR name = ?',
      [expert_id, expert_id]
    );
    if (expert.length === 0) {
      return { success: false, error: `Expert not found: ${expert_id}` };
    }
    const actualExpertId = expert[0].id;

    // 删除关联
    const [result] = await pool.execute(
      'DELETE FROM expert_skills WHERE expert_id = ? AND skill_id = ?',
      [actualExpertId, actualSkillId]
    );

    if (result.affectedRows === 0) {
      return {
        success: false,
        error: `Skill was not assigned to this expert`
      };
    }

    return {
      success: true,
      message: `✅ Skill unassigned from expert successfully`
    };
  },

  /**
   * 启用/禁用技能
   */
  async toggleSkill(params, pool) {
    const { skill_id, is_active } = params;

    const [skill] = await pool.query(
      'SELECT id, name FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }

    await pool.execute(
      'UPDATE skills SET is_active = ? WHERE id = ?',
      [is_active ? 1 : 0, skill[0].id]
    );

    return {
      success: true,
      message: `✅ Skill "${skill[0].name}" ${is_active ? 'enabled' : 'disabled'}`
    };
  }
};


// 命令行入口点仅在直接运行时执行（非 vm 沙箱环境）
// vm 沙箱中 process.argv 和 process.exit 不可用
if (typeof process.argv !== 'undefined' && process.argv[1] && process.argv[1].endsWith('index.js')) {
  async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
      console.log(JSON.stringify({ success: false, error: 'Usage: node index.js <toolName> <paramsJSON>' }));
      process.exit(1);
    }

    const toolName = args[0];
    let params = {};
    
    try {
      params = JSON.parse(args[1]);
    } catch (e) {
      console.log(JSON.stringify({ success: false, error: 'Invalid JSON params' }));
      process.exit(1);
    }

    const skill = module.exports;
    const result = await skill.execute(toolName, params, {});
    console.log(JSON.stringify(result));
  }

  main().catch(err => {
    console.log(JSON.stringify({ success: false, error: err.message, stack: err.stack }));
    process.exit(1);
  });

  // 确保 unhandled rejection 被捕获
  process.on('unhandledRejection', (reason, promise) => {
    console.log(JSON.stringify({ success: false, error: String(reason) }));
    process.exit(1);
  });
}
