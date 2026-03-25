/**
 * SimpleLLMClient - 简化的 LLM 客户端
 * 
 * 用于不需要专家配置的 LLM 调用场景（如 Assistant 系统）
 * 复用 LLMClient 的核心逻辑，但支持直接传入模型配置
 */

import https from 'https';
import http from 'http';
import logger from './logger.js';
import { retryWithBackoff } from './llm-retry.js';

/**
 * 调用 LLM API（非流式）
 * @param {Object} model - 模型配置
 * @param {string} model.model_name - 模型名称
 * @param {string} model.base_url - API 基础 URL
 * @param {string} model.api_key - API 密钥
 * @param {string} [model.user_agent] - User-Agent
 * @param {Array} messages - 消息数组
 * @param {Object} options - 可选参数
 * @param {number} [options.temperature] - 温度
 * @param {number} [options.max_tokens] - 最大输出 token
 * @param {number} [options.timeout] - 超时时间（毫秒）
 * @param {Array} [options.tools] - 工具定义
 * @param {Object} [options.response_format] - 响应格式
 * @returns {Promise<Object>} 包含 content, toolCalls, usage 的响应
 */
export async function callLLM(model, messages, options = {}) {
  const requestBody = JSON.stringify({
    model: model.model_name,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens || 4096,
    ...(options.tools && options.tools.length > 0 && { tools: options.tools }),
    ...(options.response_format && { response_format: options.response_format }),
  });

  const url = new URL(model.base_url);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  const userAgent = model.user_agent || 'TouwakaMate/2.0';
  const timeoutValue = options.timeout || 120000;

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
    agent: new (isHttps ? https : http).Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      timeout: timeoutValue,
    }),
  };

  logger.info('[SimpleLLMClient] LLM 调用:', {
    model: model.model_name,
    url: `${requestOptions.hostname}${requestOptions.path}`,
    messages_count: messages.length,
    tools_count: options.tools?.length || 0,
    timeout: timeoutValue,
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
            logger.error('[SimpleLLMClient] 调用失败:', {
              status_code: res.statusCode,
              response: data.substring(0, 500),
            });
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
            return;
          }

          const response = JSON.parse(data);
          const message = response.choices?.[0]?.message;
          const duration = Date.now() - startTime;

          logger.debug(`[SimpleLLMClient] 调用完成: ${duration}ms, tokens: ${response.usage?.total_tokens}`);

          // 检查是否有工具调用
          if (message?.tool_calls && message.tool_calls.length > 0) {
            resolve({
              content: message.content,
              tool_calls: message.tool_calls,
              usage: response.usage,
            });
          } else {
            resolve({
              content: message?.content,
              usage: response.usage,
            });
          }
        } catch (parseError) {
          logger.error('[SimpleLLMClient] 解析响应失败:', parseError.message);
          reject(new Error(`解析响应失败: ${parseError.message}`));
        }
      });
    });

    req.on('error', (error) => {
      logger.error('[SimpleLLMClient] 请求错误:', {
        error: error.message,
        error_code: error.code,
        model: model.model_name,
      });
      reject(error);
    });

    req.on('timeout', () => {
      logger.error('[SimpleLLMClient] 请求超时:', {
        timeout: timeoutValue,
        model: model.model_name,
      });
      req.destroy();
      reject(new Error('请求超时'));
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
 * @returns {Promise<Object>} LLM 响应
 */
export async function callLLMWithRetry(model, messages, options = {}) {
  return retryWithBackoff(
    () => callLLM(model, messages, options),
    {
      maxRetries: 3,
      baseDelayMs: 10000,
      maxDelayMs: 120000,
      loggerPrefix: '[SimpleLLMClient]',
    }
  );
}

/**
 * 流式调用 LLM
 * @param {Object} model - 模型配置
 * @param {Array} messages - 消息数组
 * @param {Object} options - 可选参数
 * @param {Array} [options.tools] - 工具定义
 * @param {Function} [options.onDelta] - 收到增量内容的回调
 * @param {Function} [options.onToolCall] - 收到工具调用的回调
 * @param {Function} [options.onUsage] - 收到 usage 信息的回调
 * @returns {Promise<void>}
 */
export async function callLLMStream(model, messages, options = {}) {
  const { tools, onDelta, onToolCall, onUsage } = options;

  const requestBody = JSON.stringify({
    model: model.model_name,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens || 4096,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools && tools.length > 0 && { tools }),
  });

  const url = new URL(model.base_url);
  const isHttps = url.protocol === 'https:';
  const httpModule = isHttps ? https : http;

  const userAgent = model.user_agent || 'TouwakaMate/2.0';
  const timeoutValue = options.timeout || 120000;

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
      'User-Agent': userAgent,
    },
    timeout: timeoutValue,
    agent: new (isHttps ? https : http).Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      timeout: timeoutValue,
    }),
  };

  logger.info('[SimpleLLMClient] 流式 LLM 调用:', {
    model: model.model_name,
    url: `${requestOptions.hostname}${requestOptions.path}`,
    messages_count: messages.length,
    tools_count: tools?.length || 0,
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
      let accumulatedToolCalls = {};
      let toolCallsSent = false;

      res.on('data', (chunk) => {
        buffer += chunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              if (!toolCallsSent) {
                const finalToolCalls = Object.values(accumulatedToolCalls)
                  .sort((a, b) => a.index - b.index)
                  .map((tc, i) => ({
                    id: tc.id || `tool_call_${Date.now()}_${i}`,
                    type: tc.type || 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    },
                  }));

                if (finalToolCalls.length > 0) {
                  toolCallsSent = true;
                  onToolCall?.(finalToolCalls);
                }
              }
              resolve();
              return;
            }

            try {
              const parsed = JSON.parse(data);

              if (parsed.error) {
                reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
                return;
              }

              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                onDelta?.(delta.content);
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!accumulatedToolCalls[idx]) {
                    accumulatedToolCalls[idx] = { index: idx, function: {} };
                  }
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

              if (parsed.usage) {
                onUsage?.(parsed.usage);
              }
            } catch (error) {
              logger.warn('[SimpleLLMClient] 解析流式数据失败:', error.message);
            }
          }
        }
      });

      res.on('end', () => {
        if (!toolCallsSent) {
          const finalToolCalls = Object.values(accumulatedToolCalls)
            .filter(tc => tc.function?.name)
            .sort((a, b) => a.index - b.index)
            .map((tc, i) => ({
              id: tc.id || `tool_call_${Date.now()}_${i}`,
              type: tc.type || 'function',
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            }));

          if (finalToolCalls.length > 0) {
            onToolCall?.(finalToolCalls);
          }
        }
        resolve();
      });

      res.on('error', (error) => {
        reject(error);
      });
    });

    req.on('error', (error) => {
      logger.error('[SimpleLLMClient] 流式请求错误:', error.message);
      reject(error);
    });

    req.on('timeout', () => {
      logger.error('[SimpleLLMClient] 流式请求超时');
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.write(requestBody);
    req.end();
  });
}

export default {
  call: callLLM,
  callWithRetry: callLLMWithRetry,
  callStream: callLLMStream,
};