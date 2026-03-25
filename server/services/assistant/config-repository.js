/**
 * ConfigRepository - 助理配置管理模块
 * 
 * 负责：
 * - 助理配置 CRUD
 * - 配置缓存管理
 */

import { Sequelize } from 'sequelize';
import logger from '../../../lib/logger.js';
import Utils from '../../../lib/utils.js';

/**
 * 刷新助理配置缓存
 * @param {Database} db - 数据库实例
 * @returns {Promise<Map>} 助理缓存 Map
 */
export async function refreshAssistantsCache(db) {
  const Assistant = db.getModel('assistant');
  
  // 使用 Sequelize.literal 处理 BIT 类型字段
  const assistants = await Assistant.findAll({
    where: Sequelize.literal('is_active = 1'),
    raw: true,
  });

  const assistantsCache = new Map();
  for (const assistant of assistants) {
    // 将 BIT(1) 转换为布尔值
    assistant.can_use_skills = !!assistant.can_use_skills;
    assistant.is_active = !!assistant.is_active;
    assistantsCache.set(assistant.id, assistant);
  }

  logger.info(`[ConfigRepository] 缓存了 ${assistantsCache.size} 个助理配置`);
  
  return assistantsCache;
}

/**
 * 获取助理配置
 * @param {Map} assistantsCache - 助理缓存
 * @param {string} assistantId - 助理ID
 * @returns {object|null}
 */
export function getAssistant(assistantsCache, assistantId) {
  return assistantsCache?.get(assistantId) || null;
}

/**
 * 列出所有可用助理
 * @param {Map} assistantsCache - 助理缓存
 * @returns {Array}
 */
export function roster(assistantsCache) {
  return Array.from(assistantsCache.values()).map(a => ({
    id: a.id,
    name: a.name,
    icon: a.icon,
    description: a.description,
    model_id: a.model_id,
    prompt_template: a.prompt_template,
    max_tokens: a.max_tokens,
    temperature: a.temperature,
    timeout: a.timeout,
    estimated_time: a.estimated_time,
    tool_name: a.tool_name,
    tool_description: a.tool_description,
    tool_parameters: a.tool_parameters,
    can_use_skills: a.can_use_skills,
    execution_mode: a.execution_mode,
    is_active: a.is_active,
  }));
}

/**
 * 获取单个助理详情
 * @param {Database} db - 数据库实例
 * @param {string} assistantId - 助理ID
 * @returns {Promise<object|null>}
 */
export async function getAssistantDetail(db, assistantId) {
  const Assistant = db.getModel('assistant');
  
  const assistant = await Assistant.findOne({
    where: { id: assistantId },
    raw: true,
  });

  if (!assistant) {
    return null;
  }

  // 将 BIT(1) 转换为布尔值
  assistant.can_use_skills = !!assistant.can_use_skills;
  assistant.is_active = !!assistant.is_active;

  return assistant;
}

/**
 * 创建新助理
 * @param {Database} db - 数据库实例
 * @param {object} data - 助理数据
 * @returns {Promise<object>}
 */
export async function createAssistant(db, data) {
  const Assistant = db.getModel('assistant');
  
  // 必填字段检查
  if (!data.name) {
    throw new Error('name is required');
  }

  // 自动生成 id（格式：asst_xxxxxxxx）
  const assistantId = `asst_${Utils.newID(8)}`;

  // 创建助理
  const assistantData = {
    id: assistantId,
    name: data.name,
    icon: data.icon || '🤖',
    description: data.description || '',
    model_id: data.model_id || null,
    prompt_template: data.prompt_template || null,
    max_tokens: data.max_tokens || 4096,
    temperature: data.temperature ?? 0.7,
    estimated_time: data.estimated_time || 30,
    timeout: data.timeout || 120,
    tool_name: data.tool_name || null,
    tool_description: data.tool_description || null,
    tool_parameters: data.tool_parameters || null,
    execution_mode: data.execution_mode || 'llm',
    can_use_skills: data.can_use_skills ?? false,
    is_active: data.is_active ?? true,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await Assistant.create(assistantData);

  logger.info(`[ConfigRepository] 创建助理成功: ${assistantId} (${data.name})`);

  // 返回创建的数据
  return getAssistantDetail(db, assistantId);
}

/**
 * 更新助理配置
 * @param {Database} db - 数据库实例
 * @param {string} assistantId - 助理ID
 * @param {object} updates - 更新内容
 * @returns {Promise<object>}
 */
export async function updateAssistant(db, assistantId, updates) {
  const Assistant = db.getModel('assistant');
  
  const assistant = await Assistant.findOne({
    where: { id: assistantId },
  });

  if (!assistant) {
    throw new Error(`Assistant not found: ${assistantId}`);
  }

  // 允许更新的字段
  const allowedFields = [
    'name',
    'icon',
    'description',
    'model_id',
    'execution_mode',
    'prompt_template',
    'max_tokens',
    'temperature',
    'estimated_time',
    'timeout',
    'tool_name',
    'tool_description',
    'tool_parameters',
    'can_use_skills',
    'is_active',
  ];

  const updateData = {};
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      updateData[field] = updates[field];
    }
  }

  updateData.updated_at = new Date();

  await Assistant.update(updateData, {
    where: { id: assistantId },
  });

  // 返回更新后的数据
  return getAssistantDetail(db, assistantId);
}

/**
 * 删除助理
 * @param {Database} db - 数据库实例
 * @param {string} assistantId - 助理ID
 * @returns {Promise<object>}
 */
export async function deleteAssistant(db, assistantId) {
  const Assistant = db.getModel('assistant');
  
  const assistant = await Assistant.findOne({
    where: { id: assistantId },
  });

  if (!assistant) {
    throw new Error(`Assistant not found: ${assistantId}`);
  }

  await assistant.destroy();

  logger.info(`[ConfigRepository] 删除助理成功: ${assistantId}`);

  return { success: true, id: assistantId };
}

export default {
  refreshAssistantsCache,
  getAssistant,
  roster,
  getAssistantDetail,
  createAssistant,
  updateAssistant,
  deleteAssistant,
};