/**
 * Unifuncs Skill
 *
 * Unifuncs API 服务集成，提供网页内容提取等多种能力。
 * 支持微信公众号、知乎、头条等主流平台。
 *
 * @module unifuncs
 */

const https = require('https');

// API 配置
const API_BASE = 'api.unifuncs.com';
const API_PATH = '/api/web-reader/';

// 默认超时（30秒）
const DEFAULT_TIMEOUT = 30000;

// 最大响应大小（5MB）
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;

/**
 * 发起 HTTPS 请求
 */
function makeRequest(urlPath, timeout = DEFAULT_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: API_BASE,
      port: 443,
      path: urlPath,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      timeout: timeout,
    };

    const req = https.request(requestOptions, (res) => {
      let data = [];
      let dataSize = 0;

      res.on('data', (chunk) => {
        dataSize += chunk.length;
        if (dataSize <= MAX_RESPONSE_SIZE) {
          data.push(chunk);
        }
      });

      res.on('end', () => {
        const rawData = Buffer.concat(data);
        const contentType = res.headers['content-type'] || '';

        let body;
        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(rawData.toString('utf-8'));
          } catch (e) {
            body = rawData.toString('utf-8');
          }
        } else {
          body = rawData.toString('utf-8');
        }

        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: body,
          size: dataSize,
        });
      });
    });

    req.on('error', (e) => {
      reject(new Error(`Request failed: ${e.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * 读取网页内容
 *
 * @param {object} params - 参数对象
 * @param {string} params.url - 要读取的网页 URL（必需）
 * @param {number} params.timeout - 超时时间（可选，默认 30000ms）
 * @returns {Promise<object>} 读取结果
 */
async function readWebPage(params) {
  const { url, timeout = DEFAULT_TIMEOUT } = params;

  // 从环境变量获取 API Key（由 skill-loader 从 skill_parameters 表注入）
  // 系统会自动添加 SKILL_ 前缀，所以需要检查 SKILL_UNIFUNCS_API_KEY
  // 同时保留对无前缀版本的支持，方便本地测试
  const apiKey = process.env.SKILL_UNIFUNCS_API_KEY || process.env.UNIFUNCS_API_KEY;

  // 🔍 调试日志：输出环境变量和参数信息
  console.log('[unifuncs] ========== DEBUG INFO ==========');
  console.log('[unifuncs] params:', JSON.stringify(params, null, 2));
  console.log('[unifuncs] SKILL_UNIFUNCS_API_KEY:', process.env.SKILL_UNIFUNCS_API_KEY ? `${process.env.SKILL_UNIFUNCS_API_KEY.substring(0, 8)}...` : '(not set)');
  console.log('[unifuncs] UNIFUNCS_API_KEY:', process.env.UNIFUNCS_API_KEY ? `${process.env.UNIFUNCS_API_KEY.substring(0, 8)}...` : '(not set)');
  console.log('[unifuncs] resolved apiKey:', apiKey ? `${apiKey.substring(0, 8)}...` : '(not set)');
  console.log('[unifuncs] ==============================');

  if (!url) {
    throw new Error('URL is required');
  }

  if (!apiKey) {
    throw new Error('UNIFUNCS_API_KEY is not configured. Please add it to skill_parameters table. ' +
      'Note: System will auto-add SKILL_ prefix, looking for SKILL_UNIFUNCS_API_KEY in env.');
  }

  try {
    // URL 编码
    const encodedUrl = encodeURIComponent(url);
    const urlPath = `${API_PATH}${encodedUrl}?apiKey=${apiKey}`;

    // 🔍 调试日志：输出请求信息（隐藏完整 API Key）
    console.log('[unifuncs] Request URL:', `https://${API_BASE}${API_PATH}${encodedUrl}?apiKey=${apiKey.substring(0, 8)}...`);
    console.log('[unifuncs] Timeout:', timeout);

    const result = await makeRequest(urlPath, timeout);

    // 🔍 调试日志：输出响应信息
    console.log('[unifuncs] Response status:', result.statusCode, result.statusMessage);
    console.log('[unifuncs] Response size:', result.size, 'bytes');
    if (!result.success) {
      console.log('[unifuncs] Response body:', JSON.stringify(result.body).substring(0, 500));
    }

    return {
      success: result.success,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      headers: result.headers,
      body: result.body,
      size: result.size,
      originalUrl: url,
    };
  } catch (error) {
    console.log('[unifuncs] Error:', error.message);
    return {
      success: false,
      error: error.message,
      originalUrl: url,
    };
  }
}

/**
 * Skill execute function - 被 skill-runner 调用
 *
 * @param {string} toolName - 工具名称
 * @param {object} params - 工具参数
 * @param {object} context - 执行上下文
 * @returns {Promise<object>} 执行结果
 */
async function execute(toolName, params, context = {}) {
  switch (toolName) {
    case 'read_web_page':
    case 'readWebPage':
    case 'read':
      return await readWebPage(params);

    default:
      throw new Error(`Unknown tool: ${toolName}. Available tools: read_web_page`);
  }
}

module.exports = {
  execute,
  readWebPage,
  name: 'unifuncs',
  description: 'Unifuncs API 服务集成，提供网页内容提取等多种能力',
};