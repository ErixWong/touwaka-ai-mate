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
 * 参数设计：
 * - model_id, prompt, max_tokens 等通过 skill_parameters 表配置，注入为环境变量
 * - 专家只需传入需要处理的文件路径或额外指令
 * - 本地文件会自动转 base64
 * 
 * Issue: #80
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// 配置
const CONFIG = {
  internalApiBase: process.env.API_BASE || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_KEY || '',
  defaultTimeout: 10000,
  dataBasePath: process.env.DATA_BASE_PATH || process.cwd(),
};

/**
 * 从环境变量读取 skill_parameters 注入的默认值
 * 环境变量格式：SKILL_{PARAM_NAME}（如 SKILL_MODEL_ID）
 */
function getDefaultsFromEnv() {
  return {
    model_id: process.env.SKILL_MODEL_ID || null,
    prompt: process.env.SKILL_PROMPT || null,
    system_prompt: process.env.SKILL_SYSTEM_PROMPT || null,
    max_tokens: process.env.SKILL_MAX_TOKENS ? parseInt(process.env.SKILL_MAX_TOKENS) : 4096,
    temperature: process.env.SKILL_TEMPERATURE ? parseFloat(process.env.SKILL_TEMPERATURE) : 0.7,
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
 * 通过内部 API 获取模型 ID（支持名称查找）
 * 注意：如果已经是 ID 格式，直接返回，不做正则验证
 */
async function resolveModelId(modelIdOrName) {
  // 直接返回，让后端验证
  // 后端 /internal/models/:model_id 会处理 ID 或名称查找
  return modelIdOrName;
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
 * 读取本地文件并转换为 base64
 * @param {string} filePath - 文件路径（相对 DATA_BASE_PATH 或绝对路径）
 * @returns {{ base64: string, mimeType: string, filename: string, dataUrl: string }}
 */
function fileToBase64(filePath) {
  // 解析路径
  let fullPath = filePath;
  if (!path.isAbsolute(filePath)) {
    // 相对路径：相对于 DATA_BASE_PATH
    fullPath = path.join(CONFIG.dataBasePath, filePath);
  }
  
  // 检查文件是否存在
  if (!fs.existsSync(fullPath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }
  
  // 读取文件
  const fileBuffer = fs.readFileSync(fullPath);
  const base64 = fileBuffer.toString('base64');
  
  // 获取 MIME 类型
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json',
  };
  const mimeType = mimeTypes[ext] || 'application/octet-stream';
  
  return {
    base64,
    mimeType,
    filename: path.basename(filePath),
    dataUrl: `data:${mimeType};base64,${base64}`,
  };
}

/**
 * 构建带图片的 prompt（OpenAI Vision 格式）
 * @param {string} basePrompt - 基础 prompt
 * @param {Array<{base64: string, mimeType: string, dataUrl: string}>} images - 图片数组
 * @returns {string|Array} OpenAI 格式的消息内容
 */
function buildPromptWithImages(basePrompt, images) {
  if (!images || images.length === 0) {
    return basePrompt;
  }
  
  // 构建 OpenAI Vision 格式的消息内容
  const content = [
    { type: 'text', text: basePrompt },
  ];
  
  for (const img of images) {
    content.push({
      type: 'image_url',
      image_url: {
        url: img.dataUrl,
      },
    });
  }
  
  return content;
}

/**
 * 技能入口函数
 * @param {string} toolName - 工具名称
 * @param {Object} params - 工具参数（可选）
 * @param {string} params.file - 本地文件路径（可选，用于图片/文件处理）
 * @param {Array<string>} params.files - 本地文件路径数组（可选，多个文件）
 * @param {string} params.prompt - 额外的提示内容（可选，会追加到默认 prompt 后）
 * @param {Object} context - 执行上下文（由 skill-runner 注入）
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
  
  // 从环境变量获取用户/专家信息
  const user_id = process.env.USER_ID || context.USER_ID || context.user_id;
  const expert_id = process.env.EXPERT_ID || context.expertId || context.expert_id;

  // 参数验证 - 用户和专家信息
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

  // 参数验证 - model_id（必须有默认值）
  if (!defaults.model_id) {
    return {
      success: false,
      error: '缺少模型配置：请在 skill_parameters 表配置 model_id 默认值',
    };
  }

  try {
    // 处理文件转 base64
    const imageData = [];
    const filePaths = [];
    
    // 单个文件
    if (params.file) {
      filePaths.push(params.file);
    }
    
    // 多个文件
    if (params.files && Array.isArray(params.files)) {
      filePaths.push(...params.files);
    }
    
    // 转换文件
    for (const filePath of filePaths) {
      try {
        const fileData = fileToBase64(filePath);
        // 只处理图片（其他文件类型暂不支持）
        if (fileData.mimeType.startsWith('image/')) {
          imageData.push(fileData);
        }
      } catch (fileError) {
        // 文件读取失败，记录但继续
        console.error(`[remote-llm] 文件读取失败: ${filePath}`, fileError.message);
      }
    }

    // 构建 prompt
    let finalPrompt = defaults.prompt || '';
    
    // 如果有额外 prompt，追加
    if (params.prompt) {
      finalPrompt = finalPrompt 
        ? `${finalPrompt}\n\n${params.prompt}` 
        : params.prompt;
    }

    // 如果有图片，构建多模态内容
    const promptContent = buildPromptWithImages(finalPrompt, imageData);

    // 直接使用配置的 model_id，不做正则验证
    // 后端会验证 ID 是否有效
    const resolvedModelId = defaults.model_id;

    // 调用驻留进程
    const result = await invokeResidentTool({
      skill_id: 'remote-llm',
      tool_name: 'remote-llm-executor',
      params: {
        user_id,
        expert_id,
        model_id: resolvedModelId,
        prompt: promptContent,
        system_prompt: defaults.system_prompt,
        temperature: defaults.temperature,
        max_tokens: defaults.max_tokens,
      },
    });

    // 返回确认消息
    const fileInfo = imageData.length > 0 
      ? `（已附加 ${imageData.length} 个图片）` 
      : '';
    
    return {
      success: true,
      task_id: result.task_id || `task_${Date.now()}`,
      message: `${result.message || '已放入队列，待执行完成后会通知您'}${fileInfo}`,
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