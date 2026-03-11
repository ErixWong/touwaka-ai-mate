/**
 * Remote LLM Submit - 专家调用远程 LLM 的入口工具
 * 
 * 这个工具是专家调用的入口，用于：
 * 1. 接收专家的 LLM 调用请求
 * 2. 通过内部 API 转发给驻留进程
 * 3. 立即返回确认消息
 * 
 * 驻留进程完成调用后会通过内部 API 通知专家
 * 
 * 参数注入优先级：
 * 1. 专家调用参数（params）
 * 2. 环境变量默认值（skill_parameters 表注入）
 * 
 * Issue: #80
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// 配置
const CONFIG = {
  internalApiBase: process.env.API_BASE || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_KEY || '',
  defaultTimeout: 10000,
};

/**
 * 从环境变量读取 skill_parameters 注入的默认值
 * 环境变量格式：SKILL_{PARAM_NAME}（如 SKILL_MODEL_ID）
 */
function getDefaultsFromEnv() {
  return {
    model_id: process.env.SKILL_MODEL_ID || null,
    prompt: process.env.SKILL_PROMPT || null,
    max_tokens: process.env.SKILL_MAX_TOKENS ? parseInt(process.env.SKILL_MAX_TOKENS) : null,
  };
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
 * 通过内部 API 获取模型 ID
 * 支持 model_id 或 model_name 查找
 */
async function resolveModelId(modelIdOrName) {
  // 如果看起来像 ID（20位十六进制），直接返回
  if (/^[a-f0-9]{20}$/i.test(modelIdOrName)) {
    return modelIdOrName;
  }

  // 否则按名称查找
  const url = `${CONFIG.internalApiBase}/internal/models/resolve?name=${encodeURIComponent(modelIdOrName)}`;
  
  const headers = {};
  if (CONFIG.internalApiKey) {
    headers['X-Internal-Key'] = CONFIG.internalApiKey;
  }

  const response = await httpRequest(url, {
    method: 'GET',
    headers,
    timeout: CONFIG.defaultTimeout,
  });

  // API 返回格式: { code: 200, message: 'success', data: {...} }
  if (response.code !== 200 || !response.data?.model_id) {
    throw new Error(response.message || `模型 "${modelIdOrName}" 不存在`);
  }

  return response.data.model_id;
}

/**
 * 通过内部 API 调用驻留进程
 */
async function invokeResidentTool(params) {
  const url = `${CONFIG.internalApiBase}/internal/resident/invoke`;
  
  const headers = {};
  if (CONFIG.internalApiKey) {
    headers['X-Internal-Key'] = CONFIG.internalApiKey;
  }

  const response = await httpRequest(url, {
    method: 'POST',
    headers,
    timeout: CONFIG.defaultTimeout,
  }, params);

  // API 返回格式: { code: 200, message: 'success', data: {...} }
  if (response.code !== 200) {
    throw new Error(response.message || '调用驻留进程失败');
  }

  return response.data;
}

/**
 * 技能入口函数
 * @param {string} toolName - 工具名称
 * @param {Object} params - 工具参数（可选，缺失时使用环境变量默认值）
 * @param {string} params.model_id - 目标模型 ID 或模型名称
 * @param {string} params.prompt - 发送给 LLM 的提示
 * @param {string} params.system_prompt - 系统提示（可选）
 * @param {number} params.temperature - 温度参数（可选，默认 0.7）
 * @param {number} params.max_tokens - 最大输出 token（可选）
 * @param {Object} context - 执行上下文（由 skill-runner 注入）
 * @param {string} context.USER_ID - 用户 ID（从环境变量注入）
 * @param {string} context.expertId - 专家 ID
 */
async function execute(toolName, params, context = {}) {
  // 只处理 submit 工具
  if (toolName !== 'submit' && toolName !== 'remote_llm_submit') {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
    };
  }
  
  // 从环境变量获取默认值（skill_parameters 表注入）
  const defaults = getDefaultsFromEnv();
  
  // 合并参数：专家参数优先，否则使用环境变量默认值
  const model_id = params.model_id || defaults.model_id;
  const prompt = params.prompt || defaults.prompt;
  const system_prompt = params.system_prompt || null;
  const temperature = params.temperature || 0.7;
  const max_tokens = params.max_tokens || defaults.max_tokens || 4096;
  
  // 从环境变量获取用户/专家信息
  // USER_ID 和 EXPERT_ID 由 skill-loader 注入（来自 context）
  const user_id = process.env.USER_ID || context.USER_ID || context.user_id;
  const expert_id = process.env.EXPERT_ID || context.expertId || context.expert_id;

  // 参数验证
  if (!model_id) {
    return {
      success: false,
      error: '缺少必要参数：model_id。请在 skill_parameters 表配置默认值，或在调用时传入。',
    };
  }

  if (!prompt) {
    return {
      success: false,
      error: '缺少必要参数：prompt。请在 skill_parameters 表配置默认值，或在调用时传入。',
    };
  }

  if (!user_id) {
    return {
      success: false,
      error: '缺少用户信息（USER_ID 环境变量未设置）',
    };
  }

  if (!expert_id) {
    return {
      success: false,
      error: '缺少专家信息（expertId 未传入）',
    };
  }

  try {
    // 解析模型 ID（支持名称查找）
    let resolvedModelId = model_id;
    if (!/^[a-f0-9]{20}$/i.test(model_id)) {
      // 不是 20 位十六进制 ID，尝试按名称查找
      resolvedModelId = await resolveModelId(model_id);
    }

    // 调用驻留进程
    const result = await invokeResidentTool({
      skill_id: 'remote-llm',
      tool_name: 'remote-llm-executor',
      params: {
        user_id,
        expert_id,
        model_id: resolvedModelId,
        prompt,
        system_prompt,
        temperature,
        max_tokens,
      },
    });

    // 返回确认消息
    return {
      success: true,
      task_id: result.task_id || `task_${Date.now()}`,
      message: result.message || '已放入队列，待执行完成后会通知您',
      status: result.status || 'queued',
    };

  } catch (error) {
    return {
      success: false,
      error: error.message || '调用远程 LLM 失败',
    };
  }
}

module.exports = { execute };