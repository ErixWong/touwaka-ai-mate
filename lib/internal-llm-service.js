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
import modelRegistry from './model-registry.js';
import { estimateTokens, truncateForContext } from './token-utils.js';
import { parseJsonLikeContent } from './json-parse-utils.js';
import { getInternalLlmTimeoutMs } from './internal-llm-timeout.js';
import { invokeWithRetry } from './message-llm-client.js';

class InternalLLMService {
  /**
   * @param {Database} db - 数据库实例
   * @param {Object} options - 配置选项
   * @param {number} options.defaultTemperature - 默认温度（默认 0.3）
   * @param {number} options.maxRetries - 最大重试次数（默认 3）
   * @param {number} options.timeout - 请求超时覆盖（毫秒），未设置时从 timeout.internal_llm 系统设置读取
   */
  constructor(db, options = {}) {
    this.db = db;
    this.defaultTemperature = options.defaultTemperature ?? 0.3;
    this.maxRetries = options.maxRetries ?? 3;
    this._timeoutOverride = options.timeout ?? null;
    this._cachedTimeoutMs = null;
    this._timeoutCachedAt = 0;
    this._timeoutCacheTTL = 60000;

    modelRegistry.init(db);
  }

  async _resolveTimeoutMs() {
    if (this._timeoutOverride) return this._timeoutOverride;
    if (this._cachedTimeoutMs !== null && (Date.now() - this._timeoutCachedAt) < this._timeoutCacheTTL) {
      return this._cachedTimeoutMs;
    }
    try {
      this._cachedTimeoutMs = await getInternalLlmTimeoutMs(this.db);
    } catch {
      this._cachedTimeoutMs = await getInternalLlmTimeoutMs();
    }
    this._timeoutCachedAt = Date.now();
    return this._cachedTimeoutMs;
  }

  clearTimeoutCache() {
    this._cachedTimeoutMs = null;
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
      // 未显式配置模型：告警（供管理员感知），使用系统默认文本模型。
      // 注意：文档内容处理场景必须在调用层显式传 modelId，禁止依赖此兜底。
      model = await modelRegistry.getDefaultTextModelConfig();
      if (!model) {
        throw new Error('Either expertId, modelId, or images must be provided');
      }
      logger.error(
        `[InternalLLMService] extractJson 未显式配置模型，使用默认模型 ${model.model_name}（${model.id}）。` +
        '文档内容处理请显式配置 model_id（qwen3.6:35b / mojfh2d7cvgl6uam7fnx），否则可能违反模型约束。'
      );
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

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    try {
      const response = await invokeWithRetry(model, messages, {
        temperature,
        response_format: { type: 'json_object' },
        max_tokens: options.max_tokens || model.max_output_tokens || 16384,
        thinking_policy: 'disable',
        logger_prefix: '[InternalLLMService]',
        timeout: options.timeout || await this._resolveTimeoutMs(),
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

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    const response = await invokeWithRetry(model, messages, {
      temperature,
      max_tokens: options.max_tokens || model.max_output_tokens || 8192,
      thinking_policy: 'disable',
      logger_prefix: '[InternalLLMService]',
      timeout: options.timeout || await this._resolveTimeoutMs(),
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
    const result = parseJsonLikeContent(content, {
      returnRawOnFail: false,
      logPrefix: '[InternalLLMService]',
    });

    if (result && result._parse_failed) {
      return null;
    }

    return result;
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
