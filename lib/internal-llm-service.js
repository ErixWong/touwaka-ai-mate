/**
 * Internal LLM Service
 * 提供轻量级的 LLM 调用能力，用于内部判断任务
 *
 * 特点：
 * - 不注入专家人设 prompt，由调用方自行提供 systemPrompt 和 userPrompt
 * - 通过 expertId 获取专家关联的模型配置（优先使用反思模型）
 * - 使用较低温度（默认 0.3），输出更确定
 * - 支持 JSON 输出格式和 Schema 校验
 */

import https from 'https';
import http from 'http';
import logger from './logger.js';
import { retryWithBackoff, isRetryableError } from './llm-retry.js';

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
    this.modelCache = new Map();
  }

  /**
   * 获取模型配置（优先使用反思模型）
   * @param {string} expertId - 专家ID
   * @returns {Promise<Object>} 模型配置
   */
  async getModelConfig(expertId) {
    // 检查缓存
    const cacheKey = `expert:${expertId}`;
    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey);
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
    this.modelCache.set(cacheKey, modelConfig);
    return modelConfig;
  }

  /**
   * 直接通过模型ID获取模型配置
   * @param {string} modelId - 模型ID
   * @returns {Promise<Object>} 模型配置
   */
  async getModelConfigById(modelId) {
    const cacheKey = `model:${modelId}`;
    if (this.modelCache.has(cacheKey)) {
      return this.modelCache.get(cacheKey);
    }

    const modelConfig = await this.db.getModelConfig(modelId);
    if (!modelConfig) {
      throw new Error(`Model not found: ${modelId}`);
    }

    this.modelCache.set(cacheKey, modelConfig);
    return modelConfig;
  }

  /**
   * 执行判断任务（JSON 输出）
   * @param {string} systemPrompt - 系统提示词
   * @param {string} userPrompt - 用户输入
   * @param {Object} options - 可选配置
   * @param {string} options.expertId - 专家ID（用于获取模型配置）
   * @param {string} options.modelId - 模型ID（直接指定模型）
   * @param {number} options.temperature - 温度（默认 0.3）
   * @param {Object} options.schema - 输出 Schema（用于文档说明）
   * @param {*} options.defaultValue - 解析失败时的默认返回值
   * @returns {Promise<Object>} 解析后的 JSON 结果
   */
  async judge(systemPrompt, userPrompt, options = {}) {
    const { expertId, modelId, temperature = this.defaultTemperature, schema, defaultValue } = options;

    // 获取模型配置
    let model;
    if (modelId) {
      model = await this.getModelConfigById(modelId);
    } else if (expertId) {
      model = await this.getModelConfig(expertId);
    } else {
      throw new Error('Either expertId or modelId must be provided');
    }

    // 构建消息
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    try {
      // 调用 LLM
      const response = await this.callWithRetry(model, messages, {
        temperature,
        response_format: { type: 'json_object' },
      });

      // 解析 JSON
      const result = this.parseJSON(response.content);

      // Schema 校验（如果提供）
      if (schema && result !== null) {
        this.validateSchema(result, schema);
      }

      return result;
    } catch (error) {
      logger.error('[InternalLLMService] judge 失败:', error.message);

      // 如果有默认值，返回默认值
      if (defaultValue !== undefined) {
        logger.warn('[InternalLLMService] 使用默认值:', JSON.stringify(defaultValue));
        return defaultValue;
      }

      throw error;
    }
  }

  /**
   * 执行简单的文本生成任务
   * @param {string} systemPrompt - 系统提示词
   * @param {string} userPrompt - 用户输入
   * @param {Object} options - 可选配置
   * @returns {Promise<string>} 生成的文本
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    const { expertId, modelId, temperature = this.defaultTemperature } = options;

    // 获取模型配置
    let model;
    if (modelId) {
      model = await this.getModelConfigById(modelId);
    } else if (expertId) {
      model = await this.getModelConfig(expertId);
    } else {
      throw new Error('Either expertId or modelId must be provided');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.callWithRetry(model, messages, { temperature });
    return response.content;
  }

  /**
   * 通用 LLM 调用方法
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 包含 content 和 usage 的响应
   */
  async call(model, messages, options = {}) {
    const requestBody = JSON.stringify({
      model: model.model_name,
      messages,
      temperature: options.temperature ?? this.defaultTemperature,
      max_tokens: options.max_tokens || model.max_output_tokens || 8192,
      ...(options.response_format && { response_format: options.response_format }),
    });

    const url = new URL(model.base_url);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    const timeoutValue = options.timeout || this.timeout;

    // 使用 provider 配置的 user_agent，如果未配置则使用默认值
    const userAgent = model.user_agent || 'TouwakaMate/2.0';
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Length': Buffer.byteLength(requestBody),
        'Connection': 'keep-alive',
        'User-Agent': userAgent,
      },
      timeout: timeoutValue,
    };

    logger.debug('[InternalLLMService] 开始调用:', {
      model: model.model_name,
      base_url: model.base_url,
      temperature: options.temperature ?? this.defaultTemperature,
      messages_count: messages.length,
    });

    return new Promise((resolve, reject) => {
      const req = httpModule.request(requestOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              logger.error('[InternalLLMService] 调用失败:', {
                status_code: res.statusCode,
                response: data.substring(0, 500),
              });
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }

            const response = JSON.parse(data);
            const content = response.choices?.[0]?.message?.content;

            resolve({
              content,
              usage: response.usage,
              model: model.model_name,
            });
          } catch (error) {
            logger.error('[InternalLLMService] 解析响应失败:', error.message);
            reject(error);
          }
        });
      });

      req.on('error', (error) => {
        logger.error('[InternalLLMService] 请求错误:', error.message);
        reject(error);
      });

      req.on('timeout', () => {
        logger.error('[InternalLLMService] 请求超时');
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(requestBody);
      req.end();
    });
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

    try {
      // 尝试直接解析
      return JSON.parse(content);
    } catch (e) {
      // 尝试提取 JSON 块
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e2) {
          logger.warn('[InternalLLMService] JSON 提取解析失败:', e2.message);
        }
      }

      // 尝试提取数组
      const arrayMatch = content.match(/\[[\s\S]*\]/);
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
      this.modelCache.delete(key);
    } else {
      this.modelCache.clear();
    }
  }
}

export default InternalLLMService;