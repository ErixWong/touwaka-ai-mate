/**
 * Skill Manager - 技能管理工具
 * 
 * 用于管理技能的注册、查询、分配等操作
 * 仅在 skill-studio 专家上下文中使用
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseSkillMd, validateSkillPath } from '../../lib/skill-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

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

export default {
  name: 'skill-manager',
  description: '技能管理工具集：注册技能、分配技能、查询技能等',

  /**
   * 定义工具清单
   */
  getTools() {
    return [
      {
        type: 'function',
        function: {
          name: 'register_skill',
          description: '从本地目录注册或更新技能到数据库。会先读取 SKILL.md 解析技能信息，然后注册到数据库。同名技能会覆盖更新。',
          parameters: {
            type: 'object',
            properties: {
              source_path: {
                type: 'string',
                description: '技能目录的相对路径（相对于 data 目录）或绝对路径。例如：skills/searxng'
              },
              name: {
                type: 'string',
                description: '技能名称（可选，默认从目录名提取）'
              }
            },
            required: ['source_path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'list_all_skills',
          description: '列出数据库中所有已注册的技能（非当前专家的）',
          parameters: {
            type: 'object',
            properties: {
              include_inactive: {
                type: 'boolean',
                description: '是否包含已禁用的技能',
                default: false
              }
            },
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_skill_detail',
          description: '获取技能的详细信息',
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
          description: '将技能分配给指定专家',
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
          description: '启用或禁用技能',
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
      },
      {
        type: 'function',
        function: {
          name: 'delete_skill',
          description: '从数据库中删除技能（谨慎使用）',
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
      }
    ];
  },

  /**
   * 执行工具调用
   */
  async execute(toolName, params, context) {
    // 检查数据库实例是否可用
    if (!context?.db) {
      return {
        success: false,
        error: 'Database not available. This tool requires database context.'
      };
    }

    try {
      switch (toolName) {
        case 'register_skill':
          return await this.registerSkill(params, context);
        case 'list_all_skills':
          return await this.listAllSkills(params, context);
        case 'get_skill_detail':
          return await this.getSkillDetail(params, context);
        case 'assign_skill_to_expert':
          return await this.assignSkillToExpert(params, context);
        case 'unassign_skill_from_expert':
          return await this.unassignSkillFromExpert(params, context);
        case 'toggle_skill':
          return await this.toggleSkill(params, context);
        case 'delete_skill':
          return await this.deleteSkill(params, context);
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * 注册技能
   */
  async registerSkill(params, context) {
    const { source_path, name: providedName } = params;
    const db = context.db;

    // 安全验证：确保路径在允许的目录内
    const pathValidation = await validateSkillPath(source_path, PROJECT_ROOT, ['data', 'skills']);
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

    // 使用公共模块解析 SKILL.md
    const skillInfo = parseSkillMd(skillMd);
    const skillName = providedName || skillInfo.name || path.basename(fullPath);

    // 检查 index.js 是否存在
    const indexJsPath = path.join(fullPath, 'index.js');
    if (!fs.existsSync(indexJsPath)) {
      return {
        success: false,
        error: `index.js not found in ${source_path}. Each skill must have an index.js file.`
      };
    }

    // 检查是否已存在同名技能
    const existingSkill = await db.query(
      'SELECT id FROM skills WHERE name = ?',
      [skillName]
    );

    const skillId = existingSkill.length > 0 ? existingSkill[0].id : newID();

    // 插入或更新技能
    await db.execute(
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
        skillInfo.description || '',
        skillInfo.version || '1.0.0',
        skillInfo.author || '',
        skillInfo.tags ? JSON.stringify(skillInfo.tags) : '[]',
        fullPath,
        skillMd
      ]
    );

    // 删除旧的工具定义
    await db.execute('DELETE FROM skill_tools WHERE skill_id = ?', [skillId]);

    // 尝试加载 index.js 获取工具定义
    try {
      // 动态导入 index.js
      const indexModule = await import(indexJsPath + '?t=' + Date.now());
      const skillModule = indexModule.default || indexModule;

      if (skillModule.getTools && typeof skillModule.getTools === 'function') {
        const tools = skillModule.getTools();
        
        // 插入工具定义
        for (const tool of tools) {
          const toolName = tool.function?.name || tool.name;
          const toolDesc = tool.function?.description || tool.description;
          const toolParams = tool.function?.parameters || tool.parameters;

          await db.execute(
            `INSERT INTO skill_tools (id, skill_id, name, description, parameters)
             VALUES (?, ?, ?, ?, ?)`,
            [
              newID(),
              skillId,
              toolName,
              toolDesc || '',
              JSON.stringify(toolParams || {})
            ]
          );
        }
      }
    } catch (err) {
      console.warn(`Warning: Could not parse tools from ${source_path}:`, err.message);
    }

    const isUpdate = existingSkill.length > 0;
    return {
      success: true,
      skill_id: skillId,
      name: skillName,
      action: isUpdate ? 'updated' : 'created',
      message: `✅ Skill "${skillName}" ${isUpdate ? 'updated' : 'registered'} successfully`
    };
  },

  /**
   * 列出所有技能
   */
  async listAllSkills(params, context) {
    const { include_inactive = false } = params;
    const db = context.db;

    const whereClause = include_inactive ? '' : 'WHERE s.is_active = 1';

    const skills = await db.query(
      `SELECT s.id, s.name, s.description, s.version, s.author, s.tags, 
              s.source_path, s.is_active, s.created_at, s.updated_at,
              COUNT(st.id) as tool_count
       FROM skills s
       LEFT JOIN skill_tools st ON s.id = st.skill_id
       ${whereClause}
       GROUP BY s.id
       ORDER BY s.name`
    );

    return {
      success: true,
      total: skills.length,
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        author: s.author,
        tags: s.tags ? (typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags) : [],
        source_path: s.source_path,
        is_active: s.is_active === 1 || s.is_active === true,
        tool_count: s.tool_count,
        created_at: s.created_at,
        updated_at: s.updated_at
      }))
    };
  },

  /**
   * 获取技能详情
   */
  async getSkillDetail(params, context) {
    const { skill_id } = params;
    const db = context.db;

    // 通过ID或名称查找
    const skill = await db.query(
      `SELECT s.* FROM skills s WHERE s.id = ? OR s.name = ?`,
      [skill_id, skill_id]
    );

    if (skill.length === 0) {
      return {
        success: false,
        error: `Skill not found: ${skill_id}`
      };
    }

    const s = skill[0];

    // 获取工具列表
    const tools = await db.query(
      `SELECT id, name, description, parameters, created_at
       FROM skill_tools
       WHERE skill_id = ?`,
      [s.id]
    );

    // 获取分配的专家
    const experts = await db.query(
      `SELECT e.id, e.name, e.introduction, es.is_enabled
       FROM experts e
       INNER JOIN expert_skills es ON e.id = es.expert_id
       WHERE es.skill_id = ?`,
      [s.id]
    );

    return {
      success: true,
      skill: {
        id: s.id,
        name: s.name,
        description: s.description,
        version: s.version,
        author: s.author,
        tags: s.tags ? (typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags) : [],
        source_path: s.source_path,
        source_type: s.source_type,
        is_active: s.is_active === 1 || s.is_active === true,
        skill_md: s.skill_md,
        tools: tools.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          parameters: t.parameters ? (typeof t.parameters === 'string' ? JSON.parse(t.parameters) : t.parameters) : null
        })),
        assigned_experts: experts.map(e => ({
          id: e.id,
          name: e.name,
          introduction: e.introduction,
          is_enabled: e.is_enabled === 1 || e.is_enabled === true
        })),
        created_at: s.created_at,
        updated_at: s.updated_at
      }
    };
  },

  /**
   * 分配技能给专家
   */
  async assignSkillToExpert(params, context) {
    const { skill_id, expert_id } = params;
    const db = context.db;

    // 查找技能
    const skill = await db.query(
      'SELECT id FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }
    const actualSkillId = skill[0].id;

    // 查找专家
    const expert = await db.query(
      'SELECT id FROM experts WHERE id = ? OR name = ?',
      [expert_id, expert_id]
    );
    if (expert.length === 0) {
      return { success: false, error: `Expert not found: ${expert_id}` };
    }
    const actualExpertId = expert[0].id;

    // 检查是否已关联
    const existing = await db.query(
      'SELECT id FROM expert_skills WHERE expert_id = ? AND skill_id = ?',
      [actualExpertId, actualSkillId]
    );

    if (existing.length > 0) {
      // 更新为启用状态
      await db.execute(
        'UPDATE expert_skills SET is_enabled = 1 WHERE expert_id = ? AND skill_id = ?',
        [actualExpertId, actualSkillId]
      );
      return {
        success: true,
        message: `✅ Skill already assigned, enabled now`
      };
    }

    // 创建关联
    await db.execute(
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
  async unassignSkillFromExpert(params, context) {
    const { skill_id, expert_id } = params;
    const db = context.db;

    // 查找技能
    const skill = await db.query(
      'SELECT id FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }
    const actualSkillId = skill[0].id;

    // 查找专家
    const expert = await db.query(
      'SELECT id FROM experts WHERE id = ? OR name = ?',
      [expert_id, expert_id]
    );
    if (expert.length === 0) {
      return { success: false, error: `Expert not found: ${expert_id}` };
    }
    const actualExpertId = expert[0].id;

    // 删除关联
    const result = await db.execute(
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
  async toggleSkill(params, context) {
    const { skill_id, is_active } = params;
    const db = context.db;

    const skill = await db.query(
      'SELECT id, name FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }

    await db.execute(
      'UPDATE skills SET is_active = ? WHERE id = ?',
      [is_active ? 1 : 0, skill[0].id]
    );

    return {
      success: true,
      message: `✅ Skill "${skill[0].name}" ${is_active ? 'enabled' : 'disabled'}`
    };
  },

  /**
   * 删除技能
   */
  async deleteSkill(params, context) {
    const { skill_id } = params;
    const db = context.db;

    const skill = await db.query(
      'SELECT id, name FROM skills WHERE id = ? OR name = ?',
      [skill_id, skill_id]
    );
    if (skill.length === 0) {
      return { success: false, error: `Skill not found: ${skill_id}` };
    }

    const actualSkillId = skill[0].id;
    const skillName = skill[0].name;

    // 先删除关联
    await db.execute('DELETE FROM expert_skills WHERE skill_id = ?', [actualSkillId]);
    await db.execute('DELETE FROM skill_tools WHERE skill_id = ?', [actualSkillId]);
    await db.execute('DELETE FROM skills WHERE id = ?', [actualSkillId]);

    return {
      success: true,
      message: `✅ Skill "${skillName}" deleted successfully`
    };
  }
};
