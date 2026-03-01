/**
 * HTTP Client Skill - Node.js Implementation
 * 
 * HTTP client for making GET and POST requests.
 * Use when you need to fetch web content or call APIs.
 * 
 * @module http-client-skill
 */

const https = require('https');
const http = require('http');
const url = require('url');

// Default timeout (10 seconds)
const DEFAULT_TIMEOUT = 10000;

// Maximum response size (1MB)
const MAX_RESPONSE_SIZE = 1024 * 1024;

/**
 * Make an HTTP request
 */
function makeRequest(requestUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new url.URL(requestUrl);
    const isHttps = parsedUrl.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      timeout: options.timeout || DEFAULT_TIMEOUT,
      headers: options.headers || {},
    };

    // Add content-type for POST requests
    if (options.method === 'POST' && !requestOptions.headers['Content-Type']) {
      requestOptions.headers['Content-Type'] = 'application/json';
    }

    const req = httpModule.request(requestOptions, (res) => {
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

    // Send body for POST requests
    if (options.body) {
      const bodyData = typeof options.body === 'string' 
        ? options.body 
        : JSON.stringify(options.body);
      req.write(bodyData);
    }

    req.end();
  });
}

/**
 * Send an HTTP GET request
 */
async function httpGet(params) {
  const { url: requestUrl, headers = {}, timeout = DEFAULT_TIMEOUT } = params;
  
  if (!requestUrl) {
    throw new Error('URL is required');
  }
  
  try {
    const result = await makeRequest(requestUrl, {
      method: 'GET',
      headers,
      timeout,
    });
    
    return {
      success: result.success,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      headers: result.headers,
      body: result.body,
      size: result.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Send an HTTP POST request
 */
async function httpPost(params) {
  const { 
    url: requestUrl, 
    body, 
    headers = {}, 
    timeout = DEFAULT_TIMEOUT 
  } = params;
  
  if (!requestUrl) {
    throw new Error('URL is required');
  }
  
  try {
    const result = await makeRequest(requestUrl, {
      method: 'POST',
      headers,
      body,
      timeout,
    });
    
    return {
      success: result.success,
      statusCode: result.statusCode,
      statusMessage: result.statusMessage,
      headers: result.headers,
      body: result.body,
      size: result.size,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Skill execute function - called by skill-runner
 * 
 * @param {string} toolName - Name of the tool to execute
 * @param {object} params - Tool parameters
 * @param {object} context - Execution context
 * @returns {Promise<object>} Execution result
 */
async function execute(toolName, params, context = {}) {
  switch (toolName) {
    case 'http_get':
    case 'httpGet':
    case 'get':
      return await httpGet(params);
      
    case 'http_post':
    case 'httpPost':
    case 'post':
      return await httpPost(params);
      
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { execute, httpGet, httpPost };