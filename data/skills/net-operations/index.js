/**
 * Network Operations Skill - Node.js Implementation
 * 
 * Network utilities including DNS lookup, ping, port check, and HTTP requests.
 * All operations are designed to be LLM-friendly with clear error messages.
 * 
 * @module net-operations-skill
 */

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawn } = require('child_process');

// Default timeouts
const DEFAULT_DNS_TIMEOUT = 5000;
const DEFAULT_PING_TIMEOUT = 5000;
const DEFAULT_PORT_TIMEOUT = 3000;
const DEFAULT_HTTP_TIMEOUT = 10000;

// Maximum response size (1MB)
const MAX_RESPONSE_SIZE = 1024 * 1024;

/**
 * DNS lookup - resolve hostname to IP addresses
 * DNS 查询 - 解析主机名为 IP 地址
 * 
 * @param {object} params - Parameters
 * @param {string} params.hostname - Hostname to resolve
 * @param {string} params.record_type - Record type: "A" (default), "AAAA", "MX", "TXT", "CNAME", "NS"
 * @param {number} params.timeout - Timeout in ms (default: 5000)
 * @returns {Promise<object>} DNS records
 */
async function dnsLookup(params) {
  const { hostname, record_type = 'A', timeout = DEFAULT_DNS_TIMEOUT } = params;
  
  if (!hostname) {
    throw new Error('hostname is required');
  }
  
  const recordType = record_type.toUpperCase();
  const validTypes = ['A', 'AAAA', 'MX', 'TXT', 'CNAME', 'NS'];
  
  if (!validTypes.includes(recordType)) {
    throw new Error(`Invalid record_type: ${record_type}. Valid types: ${validTypes.join(', ')}`);
  }
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`DNS lookup timeout for ${hostname}`));
    }, timeout);
    
    const callback = (err, records) => {
      clearTimeout(timer);
      
      if (err) {
        resolve({
          success: false,
          hostname,
          recordType,
          error: err.message,
        });
        return;
      }
      
      // Format records based on type
      let formattedRecords = records;
      if (recordType === 'MX') {
        formattedRecords = records.map(r => ({
          priority: r.priority,
          exchange: r.exchange,
        }));
      } else if (recordType === 'A' || recordType === 'AAAA') {
        formattedRecords = Array.isArray(records) ? records : [records];
      }
      
      resolve({
        success: true,
        hostname,
        recordType,
        records: formattedRecords,
        count: Array.isArray(formattedRecords) ? formattedRecords.length : 1,
      });
    };
    
    // Use appropriate DNS method
    switch (recordType) {
      case 'A':
        dns.resolve4(hostname, callback);
        break;
      case 'AAAA':
        dns.resolve6(hostname, callback);
        break;
      case 'MX':
        dns.resolveMx(hostname, callback);
        break;
      case 'TXT':
        dns.resolveTxt(hostname, (err, records) => {
          if (err) {
            callback(err);
            return;
          }
          // Flatten TXT records (they come as arrays of arrays)
          callback(null, records.map(r => r.join('')));
        });
        break;
      case 'CNAME':
        dns.resolveCname(hostname, callback);
        break;
      case 'NS':
        dns.resolveNs(hostname, callback);
        break;
    }
  });
}

/**
 * Ping - test connectivity to a host
 * 连通性测试 - 测试到主机的连通性
 * 
 * @param {object} params - Parameters
 * @param {string} params.host - Hostname or IP address
 * @param {number} params.count - Number of pings (default: 3, max: 5)
 * @param {number} params.timeout - Timeout in ms (default: 5000)
 * @returns {Promise<object>} Ping results
 */
// Host format validation regex
const HOST_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

async function pingHost(params) {
  const { host, count = 3, timeout = DEFAULT_PING_TIMEOUT } = params;
  
  if (!host) {
    throw new Error('host is required');
  }
  
  // Validate host format (domain or IP)
  if (!HOST_REGEX.test(host) && !IP_REGEX.test(host)) {
    throw new Error(`Invalid host format: ${host}`);
  }
  
  const pingCount = Math.min(Math.max(1, count), 5); // Limit to 1-5 pings
  
  // Determine ping command based on platform
  const isWindows = process.platform === 'win32';
  const pingCmd = isWindows ? 'ping' : 'ping';
  const pingArgs = isWindows 
    ? ['-n', String(pingCount), '-w', String(timeout), host]
    : ['-c', String(pingCount), '-W', String(Math.ceil(timeout / 1000)), host];
  
  return new Promise((resolve) => {
    let output = '';
    let errorOutput = '';
    
    const pingProcess = spawn(pingCmd, pingArgs, { timeout: timeout + 5000 });
    
    pingProcess.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    pingProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    pingProcess.on('close', (code) => {
      const success = code === 0;
      
      // Parse ping statistics
      const result = {
        success,
        host,
        count: pingCount,
        rawOutput: output,
      };
      
      // Try to extract statistics from output
      if (isWindows) {
        // Windows ping output parsing
        const avgMatch = output.match(/Average = (\d+)ms/);
        const minMatch = output.match(/Minimum = (\d+)ms/);
        const maxMatch = output.match(/Maximum = (\d+)ms/);
        const lossMatch = output.match(/\((\d+)% loss\)/);
        
        if (avgMatch) result.avgTime = parseInt(avgMatch[1]);
        if (minMatch) result.minTime = parseInt(minMatch[1]);
        if (maxMatch) result.maxTime = parseInt(maxMatch[1]);
        if (lossMatch) result.packetLoss = parseInt(lossMatch[1]);
      } else {
        // Unix ping output parsing
        const statsMatch = output.match(/(\d+) packets transmitted, (\d+) (?:packets )?received/);
        const rttMatch = output.match(/rtt min\/avg\/max\/mdev = ([\d.]+)\/([\d.]+)\/([\d.]+)/);
        
        if (statsMatch) {
          const transmitted = parseInt(statsMatch[1]);
          const received = parseInt(statsMatch[2]);
          result.packetLoss = Math.round((1 - received / transmitted) * 100);
        }
        
        if (rttMatch) {
          result.minTime = parseFloat(rttMatch[1]);
          result.avgTime = parseFloat(rttMatch[2]);
          result.maxTime = parseFloat(rttMatch[3]);
        }
      }
      
      if (!success) {
        result.error = errorOutput || 'Ping failed';
      }
      
      resolve(result);
    });
    
    pingProcess.on('error', (err) => {
      resolve({
        success: false,
        host,
        error: `Failed to execute ping: ${err.message}`,
      });
    });
  });
}

/**
 * Port check - test if a port is open
 * 端口检测 - 测试端口是否开放
 * 
 * @param {object} params - Parameters
 * @param {string} params.host - Hostname or IP address
 * @param {number} params.port - Port number
 * @param {number} params.timeout - Timeout in ms (default: 3000)
 * @returns {Promise<object>} Port check result
 */
async function checkPort(params) {
  const { host, port, timeout = DEFAULT_PORT_TIMEOUT } = params;
  
  if (!host) {
    throw new Error('host is required');
  }
  if (!port) {
    throw new Error('port is required');
  }
  
  const portNum = parseInt(port);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('port must be a number between 1 and 65535');
  }
  
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({
        success: false,
        host,
        port: portNum,
        status: 'timeout',
        message: `Connection timed out after ${timeout}ms`,
      });
    }, timeout);
    
    socket.connect(portNum, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({
        success: true,
        host,
        port: portNum,
        status: 'open',
        message: `Port ${portNum} is open on ${host}`,
      });
    });
    
    socket.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        host,
        port: portNum,
        status: 'closed',
        message: err.code === 'ECONNREFUSED' 
          ? `Port ${portNum} is closed on ${host}`
          : `Connection failed: ${err.message}`,
      });
    });
  });
}

// Maximum redirects
const MAX_REDIRECTS = 5;

/**
 * HTTP request - make HTTP/HTTPS requests
 * HTTP 请求 - 发送 HTTP/HTTPS 请求
 *
 * @param {object} params - Parameters
 * @param {string} params.url - Request URL
 * @param {string} params.method - HTTP method (default: "GET")
 * @param {object} params.headers - Request headers
 * @param {string|object} params.body - Request body
 * @param {number} params.timeout - Timeout in ms (default: 10000)
 * @param {boolean} params.follow_redirects - Follow redirects (default: true)
 * @param {number} redirectCount - Internal: redirect counter
 * @returns {Promise<object>} Response
 */
async function httpRequest(params, redirectCount = 0) {
  const {
    url: requestUrl,
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_HTTP_TIMEOUT,
    follow_redirects = true
  } = params;
  
  if (!requestUrl) {
    throw new Error('url is required');
  }
  
  let parsedUrl;
  try {
    parsedUrl = new URL(requestUrl);
  } catch (e) {
    throw new Error(`Invalid URL: ${requestUrl}`);
  }
  
  const isHttps = parsedUrl.protocol === 'https:';
  const httpModule = isHttps ? https : http;
  
  const requestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method: method.toUpperCase(),
    timeout,
    headers: {
      'User-Agent': 'TouwakaMate/2.0',
      ...headers,
    },
  };
  
  // Add content-type for POST/PUT requests with body
  if (body && !requestOptions.headers['Content-Type']) {
    requestOptions.headers['Content-Type'] = 'application/json';
  }
  
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timeout after ${timeout}ms`));
    }, timeout);
    
    const req = httpModule.request(requestOptions, (res) => {
      // Handle redirects
      if (follow_redirects && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        
        // Check redirect limit
        if (redirectCount >= MAX_REDIRECTS) {
          resolve({
            success: false,
            error: `Too many redirects (max: ${MAX_REDIRECTS})`,
            lastUrl: requestUrl,
          });
          return;
        }
        
        httpRequest({ ...params, url: res.headers.location }, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }
      
      let data = [];
      let dataSize = 0;
      
      res.on('data', (chunk) => {
        dataSize += chunk.length;
        if (dataSize <= MAX_RESPONSE_SIZE) {
          data.push(chunk);
        }
      });
      
      res.on('end', () => {
        clearTimeout(timer);
        const rawData = Buffer.concat(data);
        const contentType = res.headers['content-type'] || '';
        
        let responseBody;
        if (contentType.includes('application/json')) {
          try {
            responseBody = JSON.parse(rawData.toString('utf-8'));
          } catch (e) {
            responseBody = rawData.toString('utf-8');
          }
        } else {
          responseBody = rawData.toString('utf-8');
        }
        
        resolve({
          success: res.statusCode >= 200 && res.statusCode < 300,
          statusCode: res.statusCode,
          statusMessage: res.statusMessage,
          headers: res.headers,
          body: responseBody,
          size: dataSize,
        });
      });
    });
    
    req.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        success: false,
        error: e.message,
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      clearTimeout(timer);
      resolve({
        success: false,
        error: `Request timeout after ${timeout}ms`,
      });
    });
    
    // Send body for POST/PUT/PATCH requests
    if (body && ['POST', 'PUT', 'PATCH'].includes(requestOptions.method)) {
      const bodyData = typeof body === 'string' ? body : JSON.stringify(body);
      req.write(bodyData);
    }
    
    req.end();
  });
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
    case 'net_dns':
    case 'dns_lookup':
      return await dnsLookup(params);
    
    case 'net_ping':
    case 'ping':
      return await pingHost(params);
    
    case 'net_port':
    case 'port_check':
      return await checkPort(params);
    
    case 'net_request':
    case 'http_request':
      return await httpRequest(params);
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { execute };