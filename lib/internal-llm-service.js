/**
 * Internal LLM Service
 * 提供轻量级的 LLM 调用能力，用于内部判断任务
 *
 * 特点：
 * - 不注入专家人设 prompt，由调用方自行提供 systemPrompt 和 userPrompt
 * - 通过 expertId 获取专家关联的模型配置（优先使用反思模型）
 * - 使用较低温度（默认 0.3），输出更确定
 * - 支持 JSON 输出格式和 Schema 校验
 * - 底层使用 BaseLLM 进行 API 调用
 */

import logger from './logger.js';
import { callWithRetry as baseCallWithRetry } from './chat/base-llm.js';
import modelRegistry from './model-registry.js';
import { estimateTokens, truncateForContext } from './token-utils.js';

class InternalLLMService {
  /**
   * @param {Database} db - 数据库实例
   * @param {Object} options - 配置选项
   * @param {number} options.defaultTemperature - 默认温度（默认 0.3）
   * @param {number} options.maxRetries - 最大重试次数（默认 3）
   * @param {number} options.timeout - 请求超时时间（毫秒，默认 90000）
   */
  constructor(db, options = {}) {
    this.db = db;
    this.defaultTemperature = options.defaultTemperature ?? 0.3;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeout = options.timeout ?? 90000;

    modelRegistry.init(db);
  }

  /**
  * 提取 JSON 结构化数据
   * 提取 JSON 结构化数据
    * @param {string} systemPrompt - 系统提示词
    * @param {string} userPrompt - 用户输入
    * @param {Object} options - 可选配置
    * @param {string} options.expertId - 专家ID（用于获取模型配置）
    * @param {string} options.modelId - 模型ID（直接指定模型）
    * @param {number} options.temperature - 温度（默认 0.3）
    * @param {Object} options.schema - 输出 Schema（用于文档说明）
    * @param {*} options.defaultValue - 解析失败时的默认返回值
    * @param {Array<string>} options.images - 图片数组（base64 dataUrl）
    * @returns {Promise<Object>} 解析后的 JSON 结果
    */
  async extractJson(systemPrompt, userPrompt, options = {}) {
    const { expertId, modelId, temperature = this.defaultTemperature, schema, defaultValue, images } = options;

    let model;
    if (modelId) {
      model = await modelRegistry.getModelConfig(modelId);
    } else if (expertId) {
      model = await modelRegistry.getExpertModelConfig(expertId);
    } else if (images && images.length > 0) {
      model = await modelRegistry.getDefaultVLModel();
    } else {
      throw new Error('Either expertId, modelId, or images must be provided');
    }

    const finalSystemPrompt = systemPrompt + '\n/no_think';

    let userContent;
    if (images && images.length > 0) {
      userContent = [];
      if (userPrompt) {
        userContent.push({ type: 'text', text: userPrompt });
      }
      for (const img of images) {
        userContent.push({ type: 'image_url', image_url: { url: img } });
      }
    } else {
      userContent = userPrompt;
    }

    const messages = [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: userContent },
    ];

try {
      const response = await baseCallWithRetry(model, messages, {
        temperature,
        response_format: { type: 'json_object' },
        max_tokens: options.max_tokens || model.max_output_tokens || 16384,
        timeout: options.timeout || this.timeout,
        maxRetries: options.maxRetries || this.maxRetries,
      });

      // 解析 JSON
      const result = this.parseJSON(response.content);

      // 如果解析失败，抛出错误以触发默认值的使用
      if (result === null) {
        throw new Error('JSON 解析失败，返回 null');
      }

      // Schema 校验（如果提供）
      if (schema && result !== null) {
        this.validateSchema(result, schema);
      }

      return result;
    } catch (error) {
      logger.error('[InternalLLMService] extractJson 失败:', error.message);

      // 如果有默认值，返回默认值
      if (defaultValue !== undefined) {
        logger.warn('[InternalLLMService] 使用默认值:', JSON.stringify(defaultValue));
        return defaultValue;
      }

      throw error;
    }
  }

  /**
    * 生成文本内容
    * @param {string} systemPrompt - 系统提示词
    * @param {string} userPrompt - 用户输入
    * @param {Object} options - 可选配置
    * @param {Array<string>} options.images - 图片数组（base64 dataUrl）
    * @returns {Promise<string>} 生成的文本
    */
  async generateText(systemPrompt, userPrompt, options = {}) {
    const { expertId, modelId, temperature = this.defaultTemperature, images } = options;

    let model;
    if (modelId) {
      model = await modelRegistry.getModelConfig(modelId);
    } else if (expertId) {
      model = await modelRegistry.getExpertModelConfig(expertId);
    } else if (images && images.length > 0) {
      model = await modelRegistry.getDefaultVLModel();
    } else {
      throw new Error('Either expertId, modelId, or images must be provided');
    }

    let userContent;
    if (images && images.length > 0) {
      userContent = [];
      if (userPrompt) {
        userContent.push({ type: 'text', text: userPrompt });
      }
      for (const img of images) {
        userContent.push({ type: 'image_url', image_url: { url: img } });
      }
    } else {
      userContent = userPrompt;
    }

    const finalSystemPrompt = systemPrompt + '\n/no_think';
    const messages = [
      { role: 'system', content: finalSystemPrompt },
      { role: 'user', content: userContent },
    ];

    const response = await baseCallWithRetry(model, messages, {
      temperature,
      max_tokens: options.max_tokens || model.max_output_tokens || 8192,
      timeout: options.timeout || this.timeout,
      maxRetries: options.maxRetries || this.maxRetries,
    });
    return response.content;
}

  /**
   * 解析 JSON 响应
   * @param {string} content - LLM 返回的内容
   * @returns {Object|null} 解析后的对象，解析失败返回 null
   */
  parseJSON(content) {
    if (!content) return null;

    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e2) {
          logger.warn('[InternalLLMService] JSON 提取解析失败:', e2.message);
        }
      }

      const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          return JSON.parse(arrayMatch[0]);
        } catch (e3) {
          logger.warn('[InternalLLMService] JSON 数组提取解析失败:', e3.message);
        }
      }

      logger.warn('[InternalLLMService] JSON 解析失败，原始内容:', content.substring(0, 200));
      return null;
    }
  }

  /**
   * 简单的 Schema 校验
   * @param {Object} result - 解析后的结果
   * @param {Object} schema - Schema 定义
   */
  validateSchema(result, schema) {
    // 简单校验：检查必需字段是否存在
    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (!(field in result)) {
          logger.warn(`[InternalLLMService] Schema 校验: 缺少必需字段 ${field}`);
        }
      }
    }

    // 类型校验
    if (schema.properties) {
      for (const [field, def] of Object.entries(schema.properties)) {
        if (field in result && def.type) {
          const actualType = Array.isArray(result[field]) ? 'array' : typeof result[field];
          if (actualType !== def.type && !(actualType === 'number' && def.type === 'integer')) {
            logger.warn(`[InternalLLMService] Schema 校验: 字段 ${field} 类型不匹配，期望 ${def.type}，实际 ${actualType}`);
          }
        }
      }
    }
  }

  /**
   * 清除模型缓存
   * @param {string} key - 缓存键（可选，不传则清除所有）
   */
    clearCache(key = null) {
    modelRegistry.clearCache(key);
  }
}

export default InternalLLMService;