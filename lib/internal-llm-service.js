/**
 * Internal LLM Service
 * 提供轻量级的 LLM 调用能力，用于内部判断任务
 *
 * 特点：
 * - 不注入专家人设 prompt，由调用方自行提供 systemPrompt 和 userPrompt
 * - 通过 expertId 获取专家关联的模型配置（优先使用反思模型）
 * - 使用较低温度（默认 0.3），输出更确定
 * - 支持 JSON 输出格式和 Schema 校验
 * - 底层使用 LLMClient 进行 API 调用
 */

import logger from './logger.js';
import { retryWithBackoff, isRetryableError } from './llm-retry.js';
import LLMClient from './llm-client.js';
import ConfigLoader from './config-loader.js';

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

    // 缓存层 1: 模型配置缓存（减少数据库查询）
    this.modelConfigCache = new Map();

    // 缓存层 2: HTTP 客户端缓存（复用 TCP 连接，减少网络开销）
    this.httpClientCache = new Map();

    // 共享 ConfigLoader 实例
    this.configLoader = new ConfigLoader();
  }

  /**
   * 获取指定专家的 HTTP 客户端实例
   * @param {string} expertId - 专家ID
   * @returns {Promise<LLMClient>}
   */
  async getHttpClient(expertId) {
    if (this.httpClientCache.has(expertId)) {
      return this.httpClientCache.get(expertId);
    }
    const httpClient = new LLMClient(this.configLoader, expertId);
    await httpClient.loadConfig();
    this.httpClientCache.set(expertId, httpClient);
    return httpClient;
  }

  /**
   * 估算文本的 token 数
   * 中文字符 ≈ 1.5 token，其他字符 ≈ 0.25 token
   * @param {string} text
   * @returns {number}
   */
  estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 1.5 + otherChars * 0.25);
  }

  /**
   * 根据模型上下文限制截断文本
   * @param {Object} model - 模型配置
   * @param {string} systemPrompt
   * @param {string} userPrompt
   * @returns {{ systemPrompt: string, userPrompt: string, truncated: boolean }}
   */
  truncateForContext(model, systemPrompt, userPrompt) {
    const maxTokens = model.max_tokens || 128000;
    const maxOutput = model.max_output_tokens || 4096;
    const maxInput = maxTokens - maxOutput;
    const safetyRatio = 0.85;

    const systemTokens = this.estimateTokens(systemPrompt);
    const userTokens = this.estimateTokens(userPrompt);
    const totalTokens = systemTokens + userTokens;

    const limit = Math.floor(maxInput * safetyRatio);

    if (totalTokens <= limit) {
      return { systemPrompt, userPrompt, truncated: false };
    }

    const availableForUser = limit - systemTokens;
    if (availableForUser <= 0) {
      logger.warn(`[InternalLLMService] System prompt alone exceeds context limit (${systemTokens} > ${limit})`);
      return { systemPrompt, userPrompt, truncated: true };
    }

    const estimatedCharsPerToken = userTokens > 0 ? userPrompt.length / userTokens : 4;
    const safeChars = Math.floor(availableForUser * estimatedCharsPerToken * 0.9);

    const truncated = userPrompt.substring(0, safeChars) + '\n\n[... 文本因超出模型上下文限制已截断 ...]';
    logger.warn(`[InternalLLMService] Input truncated: ${totalTokens} tokens → ~${limit} tokens (model max=${maxTokens}, output reserve=${maxOutput})`);

    return { systemPrompt, userPrompt: truncated, truncated: true };
  }

  /**
   * 获取模型配置（优先使用反思模型）
   * @param {string} expertId - 专家ID
   * @returns {Promise<Object>} 模型配置
   */
  async getModelConfig(expertId) {
    // 检查缓存
    const cacheKey = `expert:${expertId}`;
    if (this.modelConfigCache.has(cacheKey)) {
      return this.modelConfigCache.get(cacheKey);
    }

    // 从数据库获取专家配置
    const expert = await this.db.getExpert(expertId);
    if (!expert) {
      throw new Error(`Expert not found: ${expertId}`);
    }

    // 优先使用反思模型，如果没有则使用表达模型
    const modelId = expert.reflective_model_id || expert.expressive_model_id;
    if (!modelId) {
      throw new Error(`No model configured for expert: ${expertId}`);
    }

    const modelConfig = await this.db.getModelConfig(modelId);
    if (!modelConfig) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // 缓存配置
    this.modelConfigCache.set(cacheKey, modelConfig);
    return modelConfig;
}

  /**
    * 获取默认 VL 模型（多模态模型）
    * @returns {Promise<Object>} 模型配置
    */
  async getDefaultVLModel() {
    const cacheKey = 'defaultVL';
    if (this.modelConfigCache.has(cacheKey)) {
      return this.modelConfigCache.get(cacheKey);
    }

    const AiModel = this.db.getModel('ai_model');
    if (!AiModel) {
      throw new Error('ai_model model not available');
    }

    const model = await AiModel.findOne({
      where: { 
        is_active: true,
        model_type: 'multimodal'
      },
      order: [['created_at', 'DESC']],
      raw: true,
    });

    if (!model) {
      throw new Error('No active multimodal model found');
    }

    const modelConfig = await this.db.getModelConfig(model.id);
    if (!modelConfig) {
      throw new Error(`Model config not found: ${model.id}`);
    }

    this.modelConfigCache.set(cacheKey, modelConfig);
    logger.info(`[InternalLLMService] Default VL model: ${modelConfig.model_name}`);
    return modelConfig;
  }

  /**
    * 直接通过模型ID获取模型配置
   * @param {string} modelId - 模型ID
   * @returns {Promise<Object>} 模型配置
   */
  async getModelConfigById(modelId) {
    const cacheKey = `model:${modelId}`;
    if (this.modelConfigCache.has(cacheKey)) {
      return this.modelConfigCache.get(cacheKey);
    }

    const modelConfig = await this.db.getModelConfig(modelId);
    if (!modelConfig) {
      throw new Error(`Model not found: ${modelId}`);
    }

    this.modelConfigCache.set(cacheKey, modelConfig);
    return modelConfig;
  }

/**
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
      model = await this.getModelConfigById(modelId);
    } else if (expertId) {
      model = await this.getModelConfig(expertId);
    } else if (images && images.length > 0) {
      model = await this.getDefaultVLModel();
    } else {
      throw new Error('Either expertId, modelId, or images must be provided');
    }

    const modelName = model.model_name?.toLowerCase() || '';
    const isQwen = modelName.startsWith('qwen');
    const shouldDisableThinking = isQwen || true;
    const finalSystemPrompt = shouldDisableThinking ? systemPrompt + '\n/no_think' : systemPrompt;

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
      const response = await this.callWithRetry(model, messages, {
        expertId,
        temperature,
        response_format: { type: 'json_object' },
        max_tokens: options.max_tokens || model.max_output_tokens || 16384,
        enableThinking: false,
        thinkingBudget: options.thinkingBudget,
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
      model = await this.getModelConfigById(modelId);
    } else if (expertId) {
      model = await this.getModelConfig(expertId);
    } else if (images && images.length > 0) {
      model = await this.getDefaultVLModel();
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

const response = await this.callWithRetry(model, messages, {
      expertId,
      temperature,
      enableThinking: options.enableThinking,
      thinkingBudget: options.thinkingBudget,
      max_tokens: options.max_tokens,
    });
    return response.content;
}

  /**
   * 通用 LLM 调用方法 - 使用 LLMClient
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @param {string} options.expertId - 专家ID（用于获取 LLMClient）
   * @returns {Promise<Object>} 包含 content 和 usage 的响应
   */
  async call(model, messages, options = {}) {
    const { expertId, enableThinking } = options;
    const shouldDisableThinking = enableThinking === false || enableThinking === undefined;

    const finalMessages = shouldDisableThinking && messages.length > 0
      ? messages.map((m, i) => i === 0 && m.role === 'system'
        ? { ...m, content: m.content + '\n/no_think' }
        : m)
      : messages;

    if (shouldDisableThinking) {
      logger.info(`[InternalLLMService] Thinking DISABLED: model=${model.model_name}`);
    }

    logger.debug('[InternalLLMService] 开始调用:', {
      model: model.model_name,
      messages_count: messages.length,
    });

    // 获取对应的 HTTP 客户端实例
    const httpClient = expertId ? await this.getHttpClient(expertId) : await this.getAnyHttpClient();

    // 使用 LLMClient.call() 进行非流式调用
    const result = await httpClient.call(model, finalMessages, {
      temperature: options.temperature ?? this.defaultTemperature,
      top_p: options.top_p ?? 1.0,
      frequency_penalty: options.frequency_penalty ?? 0.0,
      presence_penalty: options.presence_penalty ?? 0.0,
      max_tokens: options.max_tokens || model.max_output_tokens || 8192,
      response_format: options.response_format,
      timeout: options.timeout || this.timeout,
    });

    return {
      content: result.content,
      usage: result.usage,
      model: model.model_name,
    };
  }

  /**
   * 获取任意一个缓存的 HTTP 客户端实例
   * @returns {Promise<LLMClient>}
   */
  async getAnyHttpClient() {
    const first = this.httpClientCache.values().next().value;
    if (first) return first;
    throw new Error('No HTTP client available. Call getHttpClient(expertId) first.');
  }

  /**
   * 带重试机制的 LLM 调用（使用公共重试模块）
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} LLM 响应
   */
  async callWithRetry(model, messages, options = {}) {
    return retryWithBackoff(
      () => this.call(model, messages, options),
      {
        maxRetries: this.maxRetries,
        baseDelayMs: 2000,
        maxDelayMs: 30000,
        loggerPrefix: '[InternalLLMService]',
      }
    );
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
    if (key) {
      this.modelConfigCache.delete(key);
      this.httpClientCache.delete(key);
    } else {
      this.modelConfigCache.clear();
      this.httpClientCache.clear();
    }
 }
}

export default InternalLLMService;