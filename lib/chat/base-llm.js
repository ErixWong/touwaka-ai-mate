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
import { normalizeBaseUrl } from '../llm-url-utils.js';
import { getTaskTimeoutMs } from '../internal-llm-timeout.js';
import { withLLMSlot, llmConcurrencyStats } from '../llm-concurrency.js';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_USER_AGENT = 'Version: 5.10.0 (c3d4709c)';
// R18-1: 流式响应绝对超时（AbortController 计时，解决"滴漏保活永不完成"被 socket 空闲超时漏掉的场景）
// - STREAM_TOTAL_TIMEOUT_MS：首个字节到达后的总时长上限（默认 300s，参考 26k token 轮次 ~65s，留 ~4 倍余量）
// - STREAM_IDLE_TIMEOUT_MS：最后字节后 N 秒无新字节且未完成（默认 120s）
// 均不约束"慢首字"（reasoning 模型首轮思考可 >30s，socket 空闲超时仍兜底连接层）
const DEFAULT_STREAM_TOTAL_TIMEOUT_MS = 300000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 120000;
const injectedStreamFailureKeys = new Set();

let _baseLlmTimeoutMs = null;
let _baseLlmTimeoutCachedAt = 0;
const TASK_TIMEOUT_CACHE_TTL = 60000;
let _baseLlmDb = null;

export function setBaseLlmDb(db) {
  _baseLlmDb = db;
}

async function _resolveBaseLlmTimeout() {
  if (_baseLlmTimeoutMs && (Date.now() - _baseLlmTimeoutCachedAt) < TASK_TIMEOUT_CACHE_TTL) {
    return _baseLlmTimeoutMs;
  }
  if (_baseLlmDb) {
    try {
      _baseLlmTimeoutMs = await getTaskTimeoutMs(_baseLlmDb);
    } catch {
      _baseLlmTimeoutMs = _baseLlmTimeoutMs || DEFAULT_TIMEOUT;
    }
  } else {
    _baseLlmTimeoutMs = _baseLlmTimeoutMs || DEFAULT_TIMEOUT;
  }
  _baseLlmTimeoutCachedAt = Date.now();
  return _baseLlmTimeoutMs;
}

function resolveBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string') {
    throw new Error(`Invalid base_url type: ${typeof baseUrl}`);
  }

  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error('Invalid base_url: empty');
  }

  const normalized = normalizeBaseUrl(trimmed);
  if (normalized !== trimmed) {
    logger.debug(`[BaseLLM] base_url normalized: original="${trimmed}" → normalized="${normalized}"`);
  }
  return normalized;
}

/**
 * 把散落在会话中后段的 system 消息统一提到开头。
 *
 * 长 agent 会话里上下文压缩 / 提示注入会往中段塞 system 消息，
 * OpenAI 兼容网关直接 400："System message must be at the beginning."，
 * 整个会话当场死掉（实测清洗 agent 跑到第 38 轮撞此错误）。
 * 已按顺位在头的不动，只把后面的提上来，相对顺序保持不变。
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function hoistSystemMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return messages;

  let seenNonSystem = false;
  let needsHoist = false;
  for (const msg of messages) {
    if (msg?.role === 'system') {
      if (seenNonSystem) {
        needsHoist = true;
        break;
      }
    } else {
      seenNonSystem = true;
    }
  }
  let ordered = messages;
  if (needsHoist) {
    const head = messages.filter(msg => msg?.role === 'system');
    const rest = messages.filter(msg => msg?.role !== 'system');
    logger.warn(
      `[BaseLLM] 检测到 ${head.length} 条 system 消息不在开头，已归位到会话首部（否则上游会 400）`
    );
    ordered = [...head, ...rest];
  }

  // 归位后还要**合并头部的多条 system**：引擎的 `canonicalToOpenAIMessages` 总会把
  // `request.system` 作为第 0 条 system，而折叠摘要/提示注入又可能让消息数组本身也以
  // system 开头 ⇒ 头部出现两条 system。归位不告警（它们本来就在开头），但部分
  // provider 只认**恰好一条**且必须在首位，会把后面的那条报成
  // `System message must be at the beginning`（实测：85 条消息的清洗轮次 HTTP 400）。
  // 只合并“全为字符串正文”的情形（实际上的全部场景）；带块状正文的先留着，
  // 由 400 诊断里的 `system_with_array_content` 计数提示再处理。
  let leading = 0;
  while (leading < ordered.length && ordered[leading]?.role === 'system') leading += 1;
  if (leading < 2) return ordered;

  const headList = ordered.slice(0, leading);
  if (headList.some(msg => typeof msg.content !== 'string')) {
    logger.warn(
      `[BaseLLM] 会话首部有 ${leading} 条 system 消息且含块状正文，未合并（保留原样）`
    );
    return ordered;
  }

  const merged = {
    ...headList[0],
    content: headList
      .map(msg => msg.content.trim())
      .filter(text => text.length > 0)
      .join('\n\n'),
  };
  logger.warn(
    `[BaseLLM] 会话首部 ${leading} 条 system 消息已合并为 1 条（部分 provider 只认恰好一条）`
  );
  return [merged, ...ordered.slice(leading)];
}

function buildRequestBody(model, messages, options = {}) {
  // 清理消息中的损坏 Unicode 代理字符
  const cleanedMessages = hoistSystemMessages(messages).map(msg => {
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
    ...(options.reasoning_effort && { reasoning_effort: options.reasoning_effort }),
    ...(options.enable_thinking !== undefined && { enable_thinking: options.enable_thinking }),
    ...(options.chat_template_kwargs && { chat_template_kwargs: options.chat_template_kwargs }),
  });
}

function buildRequestOptions(model, requestBody, timeoutValue, options = {}) {
  const url = new URL(resolveBaseUrl(model.base_url));
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

function attachRequestTimeoutHandlers(req, timeoutValue, startTime, loggerPrefix, onTimeout) {
  req.setTimeout(timeoutValue);

  req.on('socket', (socket) => {
    socket.setTimeout(timeoutValue);
    logger.debug(`${loggerPrefix} socket assigned: reused=${req.reusedSocket === true}, socket_timeout=${socket.timeout}`);
  });

  req.on('timeout', () => {
    const duration = Date.now() - startTime;
    logger.error(`${loggerPrefix} 请求超时:`, {
      timeout: timeoutValue,
      duration_ms: duration,
      reused_socket: req.reusedSocket === true,
      socket_timeout: req.socket?.timeout,
    });
    req.destroy();
    onTimeout?.();
  });
}

function getAgentTimeout(agent) {
  return typeof agent?.options?.timeout === 'number' ? agent.options.timeout : null;
}

function resolvePositiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseAttemptListEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  const values = raw
    .split(',')
    .map(part => Number.parseInt(part.trim(), 10))
    .filter(value => Number.isFinite(value) && value >= 0);
  return values.length > 0 ? new Set(values) : null;
}

function shouldInjectStreamFailure(options = {}) {
  const configuredRound = resolvePositiveIntegerEnv('CHAT_STREAM_TEST_FAIL_ROUND', -1);
  if (configuredRound < 0) return { enabled: false };

  const currentRound = Number(options.recovery_test_round || 0);
  if (currentRound !== configuredRound) return { enabled: false };

  const currentAttempt = Number(options.recovery_test_attempt || 0);
  const configuredAttempts = parseAttemptListEnv('CHAT_STREAM_TEST_FAIL_ATTEMPTS');
  if (configuredAttempts) {
    if (!configuredAttempts.has(currentAttempt)) return { enabled: false };
  } else {
    const configuredAttempt = resolvePositiveIntegerEnv('CHAT_STREAM_TEST_FAIL_ATTEMPT', 0);
    if (currentAttempt !== configuredAttempt) return { enabled: false };
  }

  const afterChunks = Math.max(resolvePositiveIntegerEnv('CHAT_STREAM_TEST_FAIL_AFTER_CHUNKS', 1), 1);
  const key = `${currentRound}:${currentAttempt}`;
  if (injectedStreamFailureKeys.has(key)) {
    return { enabled: false };
  }

  return { enabled: true, afterChunks, key };
}

/**
 * 400 `System message must be at the beginning` 的定向诊断。
 *
 * 为什么需要：出口已有 `hoistSystemMessages()` 把散落的 system 归位，但上游（网关后面的
 * provider）仍会报这一句，而告警计数为 0 —— 说明它拒收的形状与我们以为发出去的不一致。
 * 只抽角色级信息（角色序列/索引/条数），不打正文，既不看用户数据也不炸日志。
 *
 * @param {object[]} messages
 */
function describeMessageShape(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const roles = list.map(m => m?.role || '?');
  const systemIdx = [];
  roles.forEach((r, i) => { if (r === 'system') systemIdx.push(i); });
  const firstNonSystem = roles.findIndex(r => r !== 'system');
  return {
    count: list.length,
    head_roles: roles.slice(0, 8).join(','),
    tail_roles: roles.slice(-6).join(','),
    system_indexes: systemIdx.slice(0, 24).join(','),
    leading_systems: firstNonSystem === -1 ? list.length : firstNonSystem,
    first_tool_index: roles.indexOf('tool'),
    first_orphan_tool: roles.findIndex((r, i) => r === 'tool' && roles[i - 1] !== 'assistant'),
    system_with_array_content: list.filter(
      m => m?.role === 'system' && Array.isArray(m?.content)
    ).length,
  };
}

async function callUngated(model, messages, options = {}) {
  const { onRequest } = options;
  const requestBody = buildRequestBody(model, messages, options);
  const timeoutValue = options.timeout || model.timeout || await _resolveBaseLlmTimeout() || DEFAULT_TIMEOUT;
  const requestOptions = buildRequestOptions(model, requestBody, timeoutValue, options);
  const normalizedBaseUrl = resolveBaseUrl(model.base_url);
  const isHttps = new URL(normalizedBaseUrl).protocol === 'https:';
  const httpModule = isHttps ? https : http;
  const agentTimeout = getAgentTimeout(requestOptions.agent);

  logger.info('[BaseLLM] 非流式调用:', {
    model: model.model_name,
    url: `${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`,
    messages_count: messages.length,
    tools_count: options.tools?.length || 0,
    timeout_ms: requestOptions.timeout,
    agent_timeout_ms: agentTimeout,
    body_size_kb: Math.round(requestBody.length / 1024),
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
            if (res.statusCode === 400 && /System message/i.test(data)) {
              logger.error('[BaseLLM] 400 System 位置诊断（非流式）:',
                describeMessageShape(hoistSystemMessages(messages)));
            }
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
      const duration = Date.now() - startTime;
      logger.error('[BaseLLM] 请求错误:', {
        error: error.message,
        error_code: error.code,
        error_name: error.name,
        error_stack: error.stack?.split('\n').slice(0, 3).join(' | '),
        model: model.model_name,
        body_size_kb: Math.round(requestBody.length / 1024),
        timeout_ms: requestOptions.timeout,
        agent_timeout_ms: agentTimeout,
        duration_ms: duration,
        reused_socket: req.reusedSocket === true,
        socket_timeout: req.socket?.timeout,
      });
      reject(error);
    });

    attachRequestTimeoutHandlers(req, requestOptions.timeout, startTime, '[BaseLLM]', () => {
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

async function callStreamUngated(model, messages, options = {}) {
  const { tools, onDelta, onReasoningDelta, onToolCall, onUsage, onRequest } = options;
  const streamFailureInjection = shouldInjectStreamFailure(options);

  // 清理消息中的损坏 Unicode 代理字符
  const cleanedMessages = hoistSystemMessages(messages).map(msg => {
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
    ...(options.reasoning_effort && { reasoning_effort: options.reasoning_effort }),
    ...(options.enable_thinking !== undefined && { enable_thinking: options.enable_thinking }),
    ...(options.chat_template_kwargs && { chat_template_kwargs: options.chat_template_kwargs }),
  });

  const url = new URL(resolveBaseUrl(model.base_url));
  const timeoutValue = options.timeout || model.timeout || await _resolveBaseLlmTimeout() || DEFAULT_TIMEOUT;
  const userAgent = model.user_agent || DEFAULT_USER_AGENT;
  const sharedAgent = httpAgent.getAgent(url);
  const agentTimeout = getAgentTimeout(sharedAgent);
  // R18-1: 流式绝对超时配置（可被调用方覆盖）
  const streamTotalTimeoutMs = resolvePositiveIntegerEnv(
    'CHAT_STREAM_TOTAL_TIMEOUT_MS',
    options.stream_total_timeout_ms || DEFAULT_STREAM_TOTAL_TIMEOUT_MS,
  );
  const streamIdleTimeoutMs = resolvePositiveIntegerEnv(
    'CHAT_STREAM_IDLE_TIMEOUT_MS',
    options.stream_idle_timeout_ms || DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  );

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
    timeout_ms: requestOptions.timeout,
    agent_timeout_ms: agentTimeout,
    stream_total_timeout_ms: streamTotalTimeoutMs,
    stream_idle_timeout_ms: streamIdleTimeoutMs,
  });

  return new Promise((resolve, reject) => {
    const httpModule = url.protocol === 'https:' ? https : http;
    const startTime = Date.now();
    // R18-1: 流式绝对超时（AbortController 计时）
    // firstByteAt —— 首个字节到达时间（慢首字不触发 total 计时）
    // lastDataAt —— 最后数据到达时间（停滞超时判定）
    let firstByteAt = null;
    let lastDataAt = null;
    let streamCompleted = false;
    let totalTimer = null;
    let idleTimer = null;

    const clearStreamTimers = () => {
      if (totalTimer) clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      totalTimer = null;
      idleTimer = null;
    };

    const abortStream = (reason) => {
      const error = new Error(reason);
      error.code = 'STREAM_TIMEOUT';
      error.isStreamTimeout = true;
      logger.warn('[BaseLLM] 流式绝对超时触发:', {
        reason,
        total_timeout_ms: streamTotalTimeoutMs,
        idle_timeout_ms: streamIdleTimeoutMs,
        duration_ms: Date.now() - startTime,
        first_byte_ms: firstByteAt ? firstByteAt - startTime : null,
        last_data_ms: lastDataAt ? Date.now() - lastDataAt : null,
      });
      req.destroy(error);
    };

    // 首次收到数据后启动"总时长"计时
    const ensureTotalTimer = () => {
      if (totalTimer) return;
      firstByteAt = Date.now();
      totalTimer = setTimeout(() => {
        if (streamCompleted) return;
        abortStream(`流式响应总时长超过 ${Math.round(streamTotalTimeoutMs / 1000)}s`);
      }, streamTotalTimeoutMs);
      if (totalTimer.unref) totalTimer.unref();
    };

    // 每次收到数据重置"停滞"计时
    const refreshIdleTimer = () => {
      if (streamCompleted) return;
      lastDataAt = Date.now();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (streamCompleted) return;
        abortStream(`流式响应停滞 ${Math.round(streamIdleTimeoutMs / 1000)}s 无新数据`);
      }, streamIdleTimeoutMs);
      if (idleTimer.unref) idleTimer.unref();
    };

    const req = httpModule.request(requestOptions, (res) => {
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => {
          if (res.statusCode === 400 && /System message/i.test(errorData)) {
            logger.error('[BaseLLM] 400 System 位置诊断（流式）:',
              describeMessageShape(hoistSystemMessages(messages)));
          }
          reject(new Error(`HTTP ${res.statusCode}: ${errorData}`));
        });
        return;
      }

      let buffer = '';
      let accumulatedToolCalls = {};
      let toolCallsSent = false;
      let pendingContent = '';
      let toolCallContexts = {};
      let streamedChunkCount = 0;

      res.on('data', (chunk) => {
        // R18-1: 收到数据 → 启动/刷新绝对超时计时
        ensureTotalTimer();
        refreshIdleTimer();

        streamedChunkCount += 1;
        if (streamFailureInjection.enabled && streamedChunkCount >= streamFailureInjection.afterChunks) {
          injectedStreamFailureKeys.add(streamFailureInjection.key);
          const injectedError = new Error(`Injected stream failure for recovery test (round=${options.recovery_test_round}, attempt=${options.recovery_test_attempt})`);
          injectedError.code = 'ECONNRESET';
          req.destroy(injectedError);
          return;
        }

        buffer += chunk.toString();

        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              streamCompleted = true;
              clearStreamTimers();
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
                streamCompleted = true;
                clearStreamTimers();
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
        streamCompleted = true;
        clearStreamTimers();
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
        streamCompleted = true;
        clearStreamTimers();
        reject(error);
      });
    });

    req.on('error', (error) => {
      const duration = Date.now() - startTime;
      logger.error('[BaseLLM] 流式请求错误:', {
        error: error.message,
        error_code: error.code,
        timeout_ms: requestOptions.timeout,
        agent_timeout_ms: agentTimeout,
        duration_ms: duration,
        reused_socket: req.reusedSocket === true,
        socket_timeout: req.socket?.timeout,
      });
      reject(error);
    });

    attachRequestTimeoutHandlers(req, requestOptions.timeout, startTime, '[BaseLLM] 流式', () => {
      reject(new Error('请求超时'));
    });

    onRequest?.(req);

    req.write(requestBody);
    req.end();
  });
}

/**
 * 非流式调用（受全局上游并发闸门约束）。
 *
 * `options.gate_priority === 'high'` 时在闸门队列里插队（折叠摘要器、判官这类
 * 关键路径上的短请求），总并发上限不变。
 */
export async function call(model, messages, options = {}) {
  return await withLLMSlot(
    () => callUngated(model, messages, options),
    { priority: options?.gate_priority }
  );
}

/**
 * 流式调用（受全局上游并发闸门约束；槽位持有到流结束）。
 */
export async function callStream(model, messages, options = {}) {
  return await withLLMSlot(
    () => callStreamUngated(model, messages, options),
    { priority: options?.gate_priority }
  );
}

export default {
  call,
  callWithRetry,
  callStream,
  llmConcurrencyStats,
};
