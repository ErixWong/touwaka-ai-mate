/**
 * Remote LLM Call - 远程 LLM 调用驻留技能
 * 
 * 这是一个驻留式技能示例，展示如何：
 * 1. 作为驻留进程运行，通过 stdio 与主进程通信
 * 2. 接收任务请求，调用远程 LLM API
 * 3. 通过内部 API 将结果推送给专家
 * 
 * Issue: #80
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import readline from 'readline';

// 配置（超时从环境变量读取，由 skill-loader 通过数据库设置）
const CONFIG = {
  // 内部 API 配置
  internalApiBase: process.env.INTERNAL_API_BASE || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_KEY || '',
  
  // 超时配置（毫秒）- 支持环境变量覆盖
  // TIMEOUT_RESIDENT_SKILL 来自 system_settings.timeout.resident_skill（秒）-> 转换为毫秒
  defaultTimeout: parseInt(process.env.TIMEOUT_RESIDENT_SKILL || '300000', 10),
};

/**
 * 日志输出到 stderr（stdout 用于通信）
 */
function log(message) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [remote-llm] ${message}\n`);
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
      method: options.method || 'POST',
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
            reject(new Error(`HTTP ${res.statusCode}: ${json.error?.message || data}`));
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
 * 调用远程 LLM API
 */
async function callRemoteLLM(params) {
  const {
    api_base,
    api_key,
    model,
    messages,
    temperature = 0.7,
    max_tokens = 4096,
    ...extra
  } = params;

  if (!api_base) {
    throw new Error('api_base is required');
  }
  if (!api_key) {
    throw new Error('api_key is required');
  }
  if (!model) {
    throw new Error('model is required');
  }

  const response = await httpRequest(api_base, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${api_key}`,
    },
    timeout: CONFIG.defaultTimeout,
  }, {
    model,
    messages,
    temperature,
    max_tokens,
    ...extra,
  });

  return response;
}

/**
 * 通过内部 API 将消息插入给专家
 */
async function notifyExpert(params) {
  const { user_id, expert_id, content, role = 'assistant' } = params;

  if (!user_id || !expert_id || !content) {
    throw new Error('user_id, expert_id, and content are required for notify_expert');
  }

  const url = `${CONFIG.internalApiBase}/internal/messages/insert`;
  
  const headers = {};
  if (CONFIG.internalApiKey) {
    headers['X-Internal-Key'] = CONFIG.internalApiKey;
  }

  const response = await httpRequest(url, {
    method: 'POST',
    headers,
    timeout: 30000,
  }, {
    user_id,
    expert_id,
    content,
    role,
  });

  return response;
}

/**
 * 处理任务调用
 */
async function handleInvoke(taskId, params) {
  try {
    const action = params.action || 'call_llm';
    
    let result;
    
    switch (action) {
      case 'call_llm': {
        // 调用远程 LLM
        result = await callRemoteLLM(params);
        
        // 如果指定了 notify 参数，自动通知专家
        if (params.notify && result.choices?.[0]?.message?.content) {
          const notifyResult = await notifyExpert({
            user_id: params.notify.user_id,
            expert_id: params.notify.expert_id,
            content: result.choices[0].message.content,
          });
          result._notify_result = notifyResult;
        }
        break;
      }
        
      case 'notify_expert': {
        // 仅通知专家
        result = await notifyExpert(params);
        break;
      }
        
      case 'ping': {
        // 健康检查
        result = { pong: true, timestamp: Date.now() };
        break;
      }
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    sendResponse({
      task_id: taskId,
      result,
    });

  } catch (error) {
    sendResponse({
      task_id: taskId,
      error: error.message,
    });
  }
}

/**
 * 主循环：读取 stdin，处理命令
 */
async function main() {
  log('Remote LLM skill started (resident mode)');
  log(`Internal API: ${CONFIG.internalApiBase}`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;

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
  });

  // 发送启动就绪信号
  sendResponse({ type: 'ready', timestamp: Date.now() });
}

// 启动
main().catch((err) => {
  log(`Fatal error: ${err.message}`);
  process.exit(1);
});