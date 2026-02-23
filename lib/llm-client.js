/**
 * LLM Client
 * 支持二分心智架构（Expressive Mind + Reflective Mind）
 * 两种心智使用不同的模型配置
 */

import https from 'https';
import http from 'http';
import logger from './logger.js';

class LLMClient {
  /**
   * @param {ConfigLoader} configLoader - 配置加载器
   * @param {string} expertId - 专家ID
   */
  constructor(configLoader, expertId) {
    this.configLoader = configLoader;
    this.expertId = expertId;
    this.config = null;
  }

  /**
   * 从数据库加载配置
   */
  async loadConfig() {
    this.config = await this.configLoader.loadExpertConfig(this.expertId);
    logger.info(`LLM Client config loaded for expert: ${this.expertId}`);
  }

  /**
   * 获取指定心智的模型配置
   * @param {'expressive'|'reflective'} mindType - 心智类型
   * @returns {Object} 模型配置
   */
  getModelForMind(mindType) {
    if (!this.config) {
      throw new Error('Config not loaded. Call loadConfig() first.');
    }

    const model = mindType === 'expressive'
      ? this.config.expressiveModel
      : this.config.reflectiveModel;

    if (!model) {
      throw new Error(`Model config not found for ${mindType} mind`);
    }

    return model;
  }

  /**
   * 调用 Expressive Mind（生成对话回复）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} LLM 响应
   */
  async callExpressive(messages, options = {}) {
    const model = this.getModelForMind('expressive');
    return this.callWithRetry(model, messages, options);
  }

  /**
   * 调用 Reflective Mind（生成内心独白）
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} LLM 响应
   */
  async callReflective(messages, options = {}) {
    const model = this.getModelForMind('reflective');
    logger.info('[LLMClient] 准备调用 Reflective Mind:', {
      model_name: model.model_name,
      base_url: model.base_url,
      has_api_key: !!model.api_key,
      messages_count: messages.length,
      model_timeout: model.timeout,
    });
    return this.callWithRetry(model, messages, {
      ...options,
      temperature: 0.3, // 反思心智使用较低温度，更确定性
      // 反思阶段需要更长的超时时间，因为需要生成结构化的 JSON 输出
      // 如果模型配置的 timeout 小于 90 秒，则使用 90 秒
      timeout: Math.max(model.timeout || 60000, 90000),
      _reflective: true, // 标记为反思请求，用于日志区分
    });
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
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens || model.max_tokens || 4096,
      ...(options.tools && { tools: options.tools }),
      ...(options.tool_choice && { tool_choice: options.tool_choice }),
      ...(options.response_format && { response_format: options.response_format }),
    });

    const url = new URL(model.base_url);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // 优先使用 options 中的 timeout（毫秒），否则使用模型配置的 timeout（秒）转换为毫秒，默认 60 秒
    const timeoutSec = model.timeout || 60;
    const timeoutValue = options.timeout || (timeoutSec * 1000);

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
      },
      timeout: timeoutValue,
      agent: new (isHttps ? https : http).Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        timeout: timeoutValue,
      }),
    };

    // 详细日志：区分反思请求和正常请求
    const callType = options._reflective ? '反思' : '非流式';
    logger.info(`[LLMClient] 开始${callType}调用:`, {
      model_name: model.model_name,
      url: `${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`,
      timeout: timeoutValue,
      timeout_source: options.timeout ? 'options' : (model.timeout ? 'model' : 'default'),
      body_length: requestBody.length,
      messages_count: messages.length,
      temperature: options.temperature ?? 0.7,
    });

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const req = httpModule.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              logger.error('[LLMClient] 非流式调用失败:', {
                status_code: res.statusCode,
                response: data.substring(0, 500),
                model: model.model_name,
              });
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
              return;
            }
            
            const response = JSON.parse(data);
            const content = response.choices?.[0]?.message?.content;
            const toolCalls = response.choices?.[0]?.message?.tool_calls;
            
            const duration = Date.now() - startTime;
            logger.debug(`LLM call completed in ${duration}ms`, {
              model: model.model_name,
              tokens: response.usage?.total_tokens,
            });
            
            resolve({
              content,
              toolCalls,
              usage: response.usage,
              model: model.model_name,
            });
          } catch (error) {
            logger.error('[LLMClient] 解析响应失败:', {
              error: error.message,
              response_preview: data.substring(0, 200),
            });
            reject(new Error(`Parse error: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        logger.error('[LLMClient] 请求错误:', {
          error: error.message,
          error_code: error.code,
          model: model.model_name,
          url: `${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`,
        });
        reject(error);
      });

      req.on('timeout', () => {
        logger.error('[LLMClient] 请求超时:', {
          timeout: requestOptions.timeout,
          model: model.model_name,
        });
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 带重试机制的 LLM 调用
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<Object>} LLM 响应
   */
  async callWithRetry(model, messages, options = {}, maxRetries = 3) {
    const errors = [];
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.call(model, messages, options);
      } catch (error) {
        errors.push(error);
        
        // 判断是否应该重试
        if (!this.isRetryableError(error) || attempt === maxRetries) {
          const aggregateError = new Error(
            `LLM call failed after ${attempt} attempts: ${error.message}`
          );
          aggregateError.errors = errors;
          throw aggregateError;
        }
        
        // 指数退避: 10s, 20s, 40s，最大 120s
        // 较长的间隔避免对本地 Ollama 等服务造成压力
        const delay = Math.min(10000 * Math.pow(2, attempt - 1), 120000);
        logger.warn(
          `LLM call failed (attempt ${attempt}/${maxRetries}), ` +
          `retrying in ${delay / 1000}s: ${error.message}`
        );
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 判断错误是否可重试
   * @param {Error} error - 错误对象
   * @returns {boolean} 是否可重试
   */
  isRetryableError(error) {
    if (!error) return false;
    
    // 网络相关错误
    if (error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'EPIPE' ||
        error.code === 'ECONNABORTED') {
      return true;
    }
    
    // HTTP 状态码相关
    const message = error.message || '';
    
    // Socket 相关错误消息
    if (message.includes('socket hang up') ||
        message.includes('ECONNRESET') ||
        message.includes('connection reset') ||
        message.includes('broken pipe')) {
      return true;
    }
    
    // 429: 请求过多，需要限流重试
    if (message.includes('429') || message.includes('Too Many Requests')) {
      return true;
    }
    
    // 503: 服务暂时不可用
    if (message.includes('503') || message.includes('Service Unavailable')) {
      return true;
    }
    
    // 502/504: 网关错误
    if (message.includes('502') || message.includes('504')) {
      return true;
    }
    
    // 超时错误
    if (message.includes('timeout') || message.includes('Timeout')) {
      return true;
    }
    
    // 5xx 服务器错误
    if (message.match(/HTTP 5\d{2}/)) {
      return true;
    }
    
    // 4xx 客户端错误通常不可重试（除非是 429）
    return false;
  }

  /**
   * 调用支持工具函数的 Expressive Mind
   * @param {Array} messages - 消息数组
   * @param {Array} tools - 工具定义
   * @param {Object} options - 可选参数
   * @returns {Promise<Object>} 包含 content 或 toolCalls 的响应
   */
  async callExpressiveWithTools(messages, tools, options = {}) {
    const model = this.getModelForMind('expressive');
    return this.callWithRetry(model, messages, {
      ...options,
      tools,
      tool_choice: options.tool_choice || 'auto',
    });
  }

  /**
   * 估算 token 数量（简单估算）
   * @param {string} text - 文本
   * @returns {number} 估算的 token 数
   */
  estimateTokens(text) {
    if (!text) return 0;
    
    // 中文约 1.5 字符/token，英文约 4 字符/token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 估算消息数组的 token 数量
   * @param {Array} messages - 消息数组
   * @returns {number} 估算的 token 数
   */
  estimateMessagesTokens(messages) {
    let total = 0;
    
    for (const msg of messages) {
      // 每条消息有约 4 个 token 的开销
      total += 4;
      total += this.estimateTokens(msg.content);
      if (msg.name) {
        total += this.estimateTokens(msg.name);
      }
      if (msg.tool_calls) {
        total += this.estimateTokens(JSON.stringify(msg.tool_calls));
      }
    }
    
    return total;
  }

  /**
   * 流式调用 LLM
   * @param {Object} model - 模型配置
   * @param {Array} messages - 消息数组
   * @param {Object} options - 可选参数
   * @param {Array} options.tools - 工具定义
   * @param {Function} options.onDelta - 收到增量内容的回调
   * @param {Function} options.onToolCall - 收到工具调用的回调
   * @param {Function} options.onUsage - 收到 usage 信息的回调（流式结束时调用）
   * @returns {Promise<void>}
   */
  async callStream(model, messages, options = {}) {
    const { tools, onDelta, onToolCall, onUsage } = options;
    
    logger.info('[LLMClient] 开始流式调用:', {
      model_name: model.model_name,
      base_url: model.base_url,
      has_api_key: !!model.api_key,
      api_key_prefix: model.api_key?.substring(0, 10) + '...',
      messages_count: messages.length,
      has_tools: !!tools,
    });
    
    const requestBody = JSON.stringify({
      model: model.model_name,
      messages: messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens || model.max_tokens || 4096,
      stream: true,
      stream_options: { include_usage: true },  // 请求流式响应中包含 usage 信息
      ...(tools && { tools }),
      ...(options.tool_choice && { tool_choice: options.tool_choice }),
    });

    const url = new URL(model.base_url);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    // 使用数据库中配置的 timeout（秒）转换为毫秒，默认 60 秒
    const timeoutSec = model.timeout || 60;
    const streamTimeout = timeoutSec * 1000;
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.api_key}`,
        'Content-Length': Buffer.byteLength(requestBody),
        'Accept': 'text/event-stream',
        'Connection': 'keep-alive',
      },
      timeout: streamTimeout,
      // 添加 agent 配置以支持 keep-alive
      agent: new (isHttps ? https : http).Agent({
        keepAlive: true,
        keepAliveMsecs: 30000,
        timeout: streamTimeout,
      }),
    };
    
    logger.debug('[LLMClient] 请求详情:', {
      url: `${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`,
      timeout: requestOptions.timeout,
      timeout_sec: Math.round(requestOptions.timeout / 1000) + 's',
      body_length: requestBody.length,
    });

    return new Promise((resolve, reject) => {
      const req = httpModule.request(requestOptions, (res) => {
        if (res.statusCode !== 200) {
          let errorData = '';
          res.on('data', chunk => errorData += chunk);
          res.on('end', () => {
            reject(new Error(`HTTP ${res.statusCode}: ${errorData}`));
          });
          return;
        }

        let buffer = '';
        let accumulatedToolCalls = {};  // 累积工具调用（按 index 累积）
        
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          
          // 处理 SSE 数据行
          const lines = buffer.split('\n');
          buffer = lines.pop(); // 保留不完整的最后一行
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              
              if (data === '[DONE]') {
                // 流结束，处理累积的工具调用
                const finalToolCalls = Object.values(accumulatedToolCalls)
                  .sort((a, b) => a.index - b.index)
                  .map(tc => ({
                    id: tc.id,
                    type: tc.type || 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    },
                  }));
                
                if (finalToolCalls.length > 0) {
                  logger.info('[LLMClient] 流式工具调用完成:', {
                    count: finalToolCalls.length,
                    tools: finalToolCalls.map(tc => tc.function.name),
                  });
                  onToolCall?.(finalToolCalls);
                }
                resolve();
                return;
              }
              
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                
                if (delta?.content) {
                  onDelta?.(delta.content);
                }
                
                // 累积工具调用（流式模式下是增量返回的）
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!accumulatedToolCalls[idx]) {
                      accumulatedToolCalls[idx] = { index: idx, function: {} };
                    }
                    // 累积各个字段
                    if (tc.id) accumulatedToolCalls[idx].id = tc.id;
                    if (tc.type) accumulatedToolCalls[idx].type = tc.type;
                    if (tc.function?.name) {
                      accumulatedToolCalls[idx].function.name = tc.function.name;
                    }
                    if (tc.function?.arguments) {
                      accumulatedToolCalls[idx].function.arguments =
                        (accumulatedToolCalls[idx].function.arguments || '') + tc.function.arguments;
                    }
                  }
                }
                
                // 处理 usage 信息（流式响应的最后一个 chunk 会包含 usage）
                if (parsed.usage) {
                  logger.info('[LLMClient] 流式响应收到 usage:', {
                    prompt_tokens: parsed.usage.prompt_tokens,
                    completion_tokens: parsed.usage.completion_tokens,
                    total_tokens: parsed.usage.total_tokens,
                  });
                  onUsage?.(parsed.usage);
                }
              } catch (error) {
                logger.warn('[LLMClient] 解析流式数据失败:', error.message);
              }
            }
          }
        });

        res.on('end', () => {
          // 确保在 res.on('end') 时也处理累积的工具调用（以防 [DONE] 没有被触发）
          const finalToolCalls = Object.values(accumulatedToolCalls)
            .filter(tc => tc.id && tc.function?.name)  // 确保是完整的工具调用
            .sort((a, b) => a.index - b.index)
            .map(tc => ({
              id: tc.id,
              type: tc.type || 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            }));
          
          if (finalToolCalls.length > 0) {
            logger.info('[LLMClient] 流式结束，处理累积工具调用:', {
              count: finalToolCalls.length,
              tools: finalToolCalls.map(tc => tc.function.name),
            });
            onToolCall?.(finalToolCalls);
          }
          resolve();
        });

        res.on('error', (error) => {
          reject(error);
        });
      });

      req.on('error', (error) => {
        logger.error('[LLMClient] 流式请求错误:', {
          error: error.message,
          error_code: error.code,
          model: model.model_name,
          url: `${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`,
        });
        reject(error);
      });

      req.on('timeout', () => {
        logger.error('[LLMClient] 流式请求超时:', {
          timeout: requestOptions.timeout,
          model: model.model_name,
        });
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // 监听 socket 级别错误
      req.on('socket', (socket) => {
        socket.on('error', (error) => {
          logger.error('[LLMClient] Socket 错误:', {
            error: error.message,
            error_code: error.code,
            model: model.model_name,
          });
        });
      });

      req.write(requestBody);
      req.end();
    });
  }

  /**
   * 检查是否需要截断消息以适应上下文限制
   * @param {Array} messages - 消息数组
   * @param {number} maxTokens - 最大 token 数
   * @returns {Array} 截断后的消息数组
   */
  truncateMessages(messages, maxTokens = null) {
    const model = this.getModelForMind('expressive');
    const contextSize = maxTokens || model.context_size || 128000;
    
    let totalTokens = this.estimateMessagesTokens(messages);
    
    if (totalTokens <= contextSize * 0.8) {
      return messages; // 不需要截断
    }

    logger.warn(`Messages exceed context limit (${totalTokens} > ${contextSize * 0.8}), truncating...`);
    
    // 保留系统消息和最近的消息
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    
    // 从后往前保留消息，直到 token 数合适
    const truncated = [...systemMessages];
    let currentTokens = this.estimateMessagesTokens(truncated);
    
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const msgTokens = this.estimateTokens(msg.content) + 4;
      
      if (currentTokens + msgTokens > contextSize * 0.8) {
        break;
      }
      
      truncated.splice(systemMessages.length, 0, msg);
      currentTokens += msgTokens;
    }
    
    return truncated;
  }
}

export default LLMClient;
