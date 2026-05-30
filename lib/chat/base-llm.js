/**
 * BaseLLM - 基础 LLM 调用层
 * 
 * 只负责 HTTP 调用，无业务逻辑
 * - HTTP keep-alive
 * - 重试 + 指数退避
 * - 多模态消息处理
 * - 流式 / 非流式
 */

import https from 'https';
import http from 'http';
import logger from '../logger.js';
import { retryWithBackoff } from '../llm-retry.js';
import httpAgent from '../http-agent.js';
import { cleanSurrogates } from '../token-utils.js';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_USER_AGENT = 'Version: 5.10.0 (c3d4709c)';

function buildRequestBody(model, messages, options = {}) {
  // 清理消息中的损坏 Unicode 代理字符
  const cleanedMessages = messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { ...msg, content: cleanSurrogates(msg.content) };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map(part => {
          if (part.type === 'text' && typeof part.text === 'string') {
            return { ...part, text: cleanSurrogates(part.text) };
          }
          return part;
        }),
      };
    }
    return msg;
  });
  
  return JSON.stringify({
    model: model.model_name,
    messages: cleanedMessages,
    temperature: options.temperature ?? 0.7,
    top_p: options.top_p ?? 1.0,
    frequency_penalty: options.frequency_penalty ?? 0.0,
    presence_penalty: options.presence_penalty ?? 0.0,
    max_tokens: options.max_tokens || model.max_output_tokens || 32768,
    ...(options.tools && options.tools.length > 0 && { tools: options.tools }),
    ...(options.tools && options.tools.length > 0 && options.tool_choice && { tool_choice: options.tool_choice }),
    ...(options.response_format && { response_format: options.response_format }),
    ...(options.thinking && { thinking: options.thinking }),
    ...(options.reasoning && { reasoning: options.reasoning }),
  });
}

function buildRequestOptions(model, requestBody, options = {}) {
  const url = new URL(model.base_url);
  const timeoutValue = options.timeout || model.timeout || 120000;
  const userAgent = model.user_agent || DEFAULT_USER_AGENT;

  return {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
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
    agent: httpAgent.getAgent(url),
  };
}

export async function call(model, messages, options = {}) {
  const { onRequest } = options;
  const requestBody = buildRequestBody(model, messages, options);
  const requestOptions = buildRequestOptions(model, requestBody, options);
  const isHttps = new URL(model.base_url).protocol === 'https:';
  const httpModule = isHttps ? https : http;

  logger.info('[BaseLLM] 非流式调用:', {
    model: model.model_name,
    url: `${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`,
    messages_count: messages.length,
    tools_count: options.tools?.length || 0,
    timeout: requestOptions.timeout,
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
            logger.error('[BaseLLM] 调用失败:', {
              status_code: res.statusCode,
              response: data.substring(0, 500),
            });
            reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
            return;
          }

          const response = JSON.parse(data);
          const message = response.choices?.[0]?.message;
          const duration = Date.now() - startTime;

          logger.debug(`[BaseLLM] 调用完成: ${duration}ms, tokens: ${response.usage?.total_tokens}`);

          if (message?.tool_calls && message.tool_calls.length > 0) {
            resolve({
              content: message.content,
              toolCalls: message.tool_calls,
              usage: response.usage,
              model: model.model_name,
            });
          } else {
            resolve({
              content: message?.content,
              reasoningContent: message?.reasoning_content,
              usage: response.usage,
              model: model.model_name,
            });
          }
        } catch (parseError) {
          logger.error('[BaseLLM] 解析响应失败:', parseError.message);
          reject(new Error(`解析响应失败: ${parseError.message}`));
        }
      });
    });

    req.on('error', (error) => {
      logger.error('[BaseLLM] 请求错误:', {
        error: error.message,
        error_code: error.code,
        model: model.model_name,
      });
      reject(error);
    });

    req.on('timeout', () => {
      logger.error('[BaseLLM] 请求超时:', {
        timeout: requestOptions.timeout,
        model: model.model_name,
      });
      req.destroy();
      reject(new Error('请求超时'));
    });

    onRequest?.(req);

    req.write(requestBody);
    req.end();
  });
}

export async function callWithRetry(model, messages, options = {}) {
  return retryWithBackoff(
    () => call(model, messages, options),
    {
      maxRetries: options.maxRetries || 3,
      baseDelayMs: 10000,
      maxDelayMs: 120000,
      loggerPrefix: '[BaseLLM]',
    }
  );
}

export async function callStream(model, messages, options = {}) {
  const { tools, onDelta, onReasoningDelta, onToolCall, onUsage, onRequest } = options;

  // 清理消息中的损坏 Unicode 代理字符
  const cleanedMessages = messages.map(msg => {
    if (typeof msg.content === 'string') {
      return { ...msg, content: cleanSurrogates(msg.content) };
    }
    if (Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map(part => {
          if (part.type === 'text' && typeof part.text === 'string') {
            return { ...part, text: cleanSurrogates(part.text) };
          }
          return part;
        }),
      };
    }
    return msg;
  });

  const requestBody = JSON.stringify({
    model: model.model_name,
    messages: cleanedMessages,
    temperature: options.temperature ?? 0.7,
    top_p: options.top_p ?? 1.0,
    frequency_penalty: options.frequency_penalty ?? 0.0,
    presence_penalty: options.presence_penalty ?? 0.0,
    max_tokens: options.max_tokens || model.max_output_tokens || 32768,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools && tools.length > 0 && { tools }),
    ...(tools && tools.length > 0 && options.tool_choice && { tool_choice: options.tool_choice }),
    ...(options.response_format && { response_format: options.response_format }),
    ...(options.thinking && { thinking: options.thinking }),
    ...(options.reasoning && { reasoning: options.reasoning }),
  });

  const url = new URL(model.base_url);
  const timeoutValue = options.timeout || model.timeout || 120000;
  const userAgent = model.user_agent || DEFAULT_USER_AGENT;
  const sharedAgent = httpAgent.getAgent(url);

  const requestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
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
    agent: sharedAgent,
  };

  logger.info('[BaseLLM] 流式调用:', {
    model: model.model_name,
    url: `${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`,
    messages_count: messages.length,
    tools_count: tools?.length || 0,
  });

  return new Promise((resolve, reject) => {
    const httpModule = url.protocol === 'https:' ? https : http;
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
      let pendingContent = '';
      let toolCallContexts = {};

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
                    context: toolCallContexts[tc.index] || '',
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

              if (delta?.reasoning_content) {
                onReasoningDelta?.(delta.reasoning_content);
              }

              if (delta?.content) {
                pendingContent += delta.content;
                onDelta?.(delta.content);
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!accumulatedToolCalls[idx]) {
                    accumulatedToolCalls[idx] = { index: idx, function: {} };
                    toolCallContexts[idx] = pendingContent.trim();
                    pendingContent = '';
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
              logger.warn('[BaseLLM] 解析流式数据失败:', error.message);
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
              context: toolCallContexts[tc.index] || '',
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
      logger.error('[BaseLLM] 流式请求错误:', error.message);
      reject(error);
    });

    req.on('timeout', () => {
      logger.error('[BaseLLM] 流式请求超时');
      req.destroy();
      reject(new Error('请求超时'));
    });

    onRequest?.(req);

    req.write(requestBody);
    req.end();
  });
}

export default {
  call,
  callWithRetry,
  callStream,
};