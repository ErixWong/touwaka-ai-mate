/**
 * Remote LLM Executor - 远程 LLM 调用驻留进程
 * 
 * 这是一个驻留式技能，用于：
 * 1. 接收专家的 LLM 调用请求
 * 2. 通过内部 API 查询模型配置（ai_models + providers 表）
 * 3. 发起远程 LLM API 调用
 * 4. 完成后通过内部 API 将结果推送给专家
 * 
 * Issue: #80
 * 
 * 注意：此文件作为独立子进程运行，使用 ES Module 格式
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
// const readline = require('readline'); // 沙箱禁止使用，改用 stdin 事件

// 配置（超时从环境变量读取，由 skill-loader 通过数据库设置）
const CONFIG = {
  // 内部 API 配置
  internalApiBase: process.env.INTERNAL_API_BASE || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_KEY || '',
  
  // 超时配置（毫秒）- 支持环境变量覆盖
  // TIMEOUT_RESIDENT_SKILL 来自 system_settings.timeout.resident_skill（秒）-> 转换为毫秒
  defaultTimeout: parseInt(process.env.TIMEOUT_RESIDENT_SKILL || '300000', 10),
};

// 任务队列
const taskQueue = [];
let isProcessing = false;

/**
 * 日志输出到 stderr（stdout 用于通信）
 */
function log(message) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [remote-llm-executor] ${message}\n`);
}

/**
 * 发送响应到 stdout
 */
function sendResponse(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

/**
 * 发送日志消息
 */
function sendLog(message) {
  sendResponse({ type: 'log', message });
}

/**
 * HTTP 请求封装
 */
async function httpRequest(url, options, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      timeout: options.timeout || CONFIG.defaultTimeout,
    };

    const req = transport.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${json.error?.message || JSON.stringify(json)}`));
          }
        } catch (err) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * 通过内部 API 获取模型配置
 */
async function getModelConfig(modelId) {
  const url = `${CONFIG.internalApiBase}/internal/models/${modelId}`;
  
  const headers = {};
  if (CONFIG.internalApiKey) {
    headers['X-Internal-Key'] = CONFIG.internalApiKey;
  }

  const response = await httpRequest(url, {
    method: 'GET',
    headers,
    timeout: 10000,
  });

  // API 返回格式: { code: 200, message: 'success', data: {...} }
  if (response.code !== 200 || !response.data) {
    throw new Error(response.message || '获取模型配置失败');
  }

  return response.data;
}

/**
 * 调用远程 LLM API
 * 支持多模态内容（图片）
 */
async function callRemoteLLM(modelConfig, params) {
  const { model, provider } = modelConfig;
  
  if (!provider) {
    throw new Error('模型未配置 Provider');
  }
  
  const { base_url, api_key, timeout } = provider;
  const { prompt, system_prompt, temperature = 0.7, max_tokens } = params;
  
  // 构建消息
  const messages = [];
  if (system_prompt) {
    messages.push({ role: 'system', content: system_prompt });
  }
  
  // 支持多模态内容：prompt 可能是字符串或数组
  // 字符串：普通文本 prompt
  // 数组：OpenAI Vision 格式 [{ type: 'text', text: '...' }, { type: 'image_url', image_url: { url: 'data:...' } }]
  messages.push({
    role: 'user',
    content: prompt
  });
  
  // 构建请求 URL
  const apiUrl = base_url.endsWith('/')
    ? `${base_url}chat/completions`
    : `${base_url}/chat/completions`;
  
  // 日志：显示 prompt 类型
  const promptType = Array.isArray(prompt) ? `multimodal (${prompt.length} parts)` : 'text';
  log(`Calling LLM API: ${apiUrl}, model: ${model.model_name}, prompt: ${promptType}`);
  
  const startTime = Date.now();
  
  // 计算 max_tokens，不超过模型的 max_output_tokens 限制
  const effectiveMaxTokens = Math.min(
    max_tokens || model.max_output_tokens || 4096,
    model.max_output_tokens || 98304
  );
  
  const requestBody = {
    model: model.model_name,
    messages,
    temperature,
    max_tokens: effectiveMaxTokens,
  };
  
  // 打印完整请求体
  log(`Request body: ${JSON.stringify(requestBody, null, 2)}`);
  
  const response = await httpRequest(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${api_key}`,
    },
    timeout: timeout || CONFIG.defaultTimeout,
  }, requestBody);
  
  const latencyMs = Date.now() - startTime;
  
  return {
    content: response.choices?.[0]?.message?.content || '',
    tokens: {
      prompt: response.usage?.prompt_tokens || 0,
      completion: response.usage?.completion_tokens || 0,
      total: response.usage?.total_tokens || 0,
    },
    latency_ms: latencyMs,
    model: model.model_name,
  };
}

/**
 * 通过内部 API 将结果推送给专家
 * @param {Object} params - 参数对象
 * @param {string} params.user_id - 用户ID
 * @param {string} params.expert_id - 专家ID
 * @param {string} params.content - 消息内容
 * @param {string} [params.task_id] - 任务ID
 * @param {boolean} [params.trigger_expert=true] - 是否触发专家响应
 * @param {string} [params.error] - 错误信息（可选）
 */
async function notifyExpert(params) {
  const { user_id, expert_id, content, task_id, trigger_expert = true, error } = params;

  const url = `${CONFIG.internalApiBase}/internal/messages/insert`;
  
  const headers = {};
  if (CONFIG.internalApiKey) {
    headers['X-Internal-Key'] = CONFIG.internalApiKey;
  }

  const body = {
    user_id,
    expert_id,
    content,
    role: 'assistant',
    trigger_expert,  // 传递触发专家标志
  };
  
  // 如果有 task_id，可以添加到 metadata
  if (task_id) {
    body.metadata = { task_id };
  }

  log(`Notifying expert: ${expert_id}, trigger_expert: ${trigger_expert}`);
  
  const response = await httpRequest(url, {
    method: 'POST',
    headers,
    timeout: 30000,
  }, body);

  return response;
}

/**
 * 处理单个任务
 */
async function processTask(task) {
  const { task_id, params } = task;
  const { user_id, expert_id, model_id, prompt, system_prompt, temperature, max_tokens } = params;

  try {
    log(`Processing task ${task_id}, model: ${model_id}`);
    
    // 1. 获取模型配置
    const modelConfig = await getModelConfig(model_id);
    log(`Got model config: ${modelConfig.model.model_name}`);
    
    // 2. 调用远程 LLM
    const result = await callRemoteLLM(modelConfig, params);
    log(`LLM call completed, latency: ${result.latency_ms}ms`);
    
    // 3. 推送结果给专家
    const notificationContent = `【远程 LLM 调用完成】\n\n模型: ${result.model}\n耗时: ${result.latency_ms}ms\nToken: ${result.tokens.total}\n\n---\n\n${result.content}`;
    
    await notifyExpert({
      user_id,
      expert_id,
      content: notificationContent,
      task_id,
    });
    
    log(`Task ${task_id} completed and notified`);
    
  } catch (error) {
    log(`Task ${task_id} failed: ${error.message}`);
    
    // 推送错误通知
    try {
      await notifyExpert({
        user_id,
        expert_id,
        content: `【远程 LLM 调用失败】\n\n任务ID: ${task_id}\n错误: ${error.message}`,
        task_id,
      });
    } catch (notifyError) {
      log(`Failed to notify error: ${notifyError.message}`);
    }
  }
}

/**
 * 处理任务队列
 */
async function processQueue() {
  if (isProcessing || taskQueue.length === 0) {
    return;
  }
  
  isProcessing = true;
  
  while (taskQueue.length > 0) {
    const task = taskQueue.shift();
    await processTask(task);
  }
  
  isProcessing = false;
}

/**
 * 处理任务调用
 */
async function handleInvoke(taskId, params) {
  // 立即返回确认
  sendResponse({
    task_id: taskId,
    result: {
      status: 'queued',
      message: '已放入队列，待执行完成后会通知您',
    },
  });
  
  // 添加到队列
  taskQueue.push({
    task_id: taskId,
    params,
  });
  
  // 异步处理队列
  processQueue().catch(err => {
    log(`Queue processing error: ${err.message}`);
  });
}

/**
 * 主循环：读取 stdin，处理命令
 */
async function main() {
  log('Remote LLM Executor started (resident mode)');
  log(`Internal API: ${CONFIG.internalApiBase}`);

  // 使用 stdin 事件替代 readline（沙箱不允许 readline 模块）
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // 保留不完整的行
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const command = JSON.parse(line);
        
        switch (command.command) {
          case 'invoke':
            handleInvoke(command.task_id, command.params);
            break;
            
          case 'exit':
            log('Received exit command, shutting down...');
            process.exit(0);
            
          case 'ping':
            sendResponse({ type: 'pong', timestamp: Date.now() });
            break;
            
          default:
            sendResponse({
              task_id: command.task_id,
              error: `Unknown command: ${command.command}`,
            });
        }
      } catch (err) {
        log(`Error parsing command: ${err.message}`);
        sendResponse({ error: err.message });
      }
    }
  });

  process.stdin.on('end', () => {
    log('stdin ended, shutting down...');
    process.exit(0);
  });

  // 发送启动就绪信号
  sendResponse({ type: 'ready', timestamp: Date.now() });
}

// 启动
main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});