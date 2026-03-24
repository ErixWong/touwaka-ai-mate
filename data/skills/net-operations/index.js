/**
 * Network Operations Skill - Node.js Implementation
 * 
 * Network utilities including DNS lookup, connectivity testing, port scanning, and HTTP requests.
 * All operations are designed to be LLM-friendly with clear error messages.
 * 
 * Tools:
 * - net_check: DNS lookup and SSL certificate analysis
 * - net_connect: TCP connectivity testing
 * - port_scan: Port scanning
 * - http_request: HTTP/HTTPS requests
 * - http_headers: HTTP headers analysis
 * 
 * @module net-operations-skill
 */

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const tls = require('tls');
const { URL } = require('url');

// Default timeouts
const DEFAULT_DNS_TIMEOUT = 5000;
const DEFAULT_CONNECT_TIMEOUT = 5000;
const DEFAULT_PORT_TIMEOUT = 3000;
const DEFAULT_HTTP_TIMEOUT = 10000;

// Maximum response size (1MB)
const MAX_RESPONSE_SIZE = 1024 * 1024;

// Maximum redirects
const MAX_REDIRECTS = 5;

// Host format validation regex
const HOST_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IP_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

/**
 * DNS lookup - resolve hostname to IP addresses
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
 * SSL certificate analysis
 */
async function analyzeSSL(params) {
  const { hostname, port = 443, timeout = DEFAULT_CONNECT_TIMEOUT } = params;
  
  if (!hostname) {
    throw new Error('hostname is required');
  }
  
  const portNum = parseInt(port);
  
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        success: false,
        hostname,
        port: portNum,
        error: `SSL connection timeout after ${timeout}ms`,
      });
    }, timeout);
    
    const socket = tls.connect(portNum, hostname, {
      servername: hostname,
      rejectUnauthorized: false, // Allow self-signed certs for analysis
    }, () => {
      clearTimeout(timer);
      
      const cert = socket.getPeerCertificate();
      
      if (!cert || Object.keys(cert).length === 0) {
        socket.destroy();
        resolve({
          success: false,
          hostname,
          port: portNum,
          error: 'No SSL certificate found',
        });
        return;
      }
      
      const now = new Date();
      const validFrom = new Date(cert.valid_from);
      const validTo = new Date(cert.valid_to);
      const daysUntilExpiry = Math.floor((validTo - now) / (1000 * 60 * 60 * 24));
      const isExpired = now > validTo;
      const isNotYetValid = now < validFrom;
      
      const result = {
        success: true,
        hostname,
        port: portNum,
        ssl: {
          valid: !isExpired && !isNotYetValid,
          subject: cert.subject,
          issuer: cert.issuer,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          daysUntilExpiry,
          isExpired,
          isNotYetValid,
          fingerprint: cert.fingerprint,
          serialNumber: cert.serialNumber,
          version: cert.version,
          bits: cert.bits,
        },
      };
      
      // Add warnings
      if (daysUntilExpiry < 30 && !isExpired) {
        result.ssl.warning = `Certificate expires in ${daysUntilExpiry} days`;
      }
      if (isExpired) {
        result.ssl.warning = 'Certificate has expired';
      }
      
      socket.destroy();
      resolve(result);
    });
    
    socket.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        hostname,
        port: portNum,
        error: err.message,
      });
    });
  });
}

/**
 * net_check - Unified DNS and SSL check tool
 * 
 * @param {object} params - Parameters
 * @param {string} params.hostname - Hostname to check
 * @param {string} params.type - Check type: "dns" (default) or "ssl"
 * @param {string} params.record_type - DNS record type (for type="dns"): "A", "AAAA", "MX", "TXT", "CNAME", "NS"
 * @param {number} params.port - Port for SSL check (default: 443)
 * @param {number} params.timeout - Timeout in ms
 */
async function netCheck(params) {
  const { type = 'dns' } = params;
  
  switch (type.toLowerCase()) {
    case 'dns':
      return await dnsLookup(params);
    case 'ssl':
      return await analyzeSSL(params);
    default:
      throw new Error(`Invalid check type: ${type}. Valid types: dns, ssl`);
  }
}

/**
 * net_connect - TCP connectivity testing
 * 
 * @param {object} params - Parameters
 * @param {string} params.host - Hostname or IP address
 * @param {number} params.port - Port number (default: 80)
 * @param {number} params.timeout - Timeout in ms (default: 5000)
 */
async function netConnect(params) {
  const { host, port = 80, timeout = DEFAULT_CONNECT_TIMEOUT } = params;
  
  if (!host) {
    throw new Error('host is required');
  }
  
  // Validate host format
  if (!HOST_REGEX.test(host) && !IP_REGEX.test(host)) {
    throw new Error(`Invalid host format: ${host}`);
  }
  
  const portNum = parseInt(port);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    throw new Error('port must be a number between 1 and 65535');
  }
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({
        success: false,
        host,
        port: portNum,
        status: 'timeout',
        responseTime: timeout,
        message: `Connection timed out after ${timeout}ms`,
      });
    }, timeout);
    
    socket.connect(portNum, host, () => {
      clearTimeout(timer);
      const responseTime = Date.now() - startTime;
      socket.destroy();
      resolve({
        success: true,
        host,
        port: portNum,
        status: 'open',
        responseTime,
        message: `Port ${portNum} is open on ${host} (${responseTime}ms)`,
      });
    });
    
    socket.on('error', (err) => {
      clearTimeout(timer);
      const responseTime = Date.now() - startTime;
      resolve({
        success: false,
        host,
        port: portNum,
        status: 'closed',
        responseTime,
        message: err.code === 'ECONNREFUSED' 
          ? `Port ${portNum} is closed on ${host}`
          : `Connection failed: ${err.message}`,
      });
    });
  });
}

/**
 * port_scan - Scan multiple ports on a host
 * 
 * @param {object} params - Parameters
 * @param {string} params.host - Hostname or IP address
 * @param {number|array} params.ports - Port number, array of ports, or common port group name
 * @param {number} params.timeout - Timeout per port in ms (default: 3000)
 */
async function portScan(params) {
  const { host, ports = 'common', timeout = DEFAULT_PORT_TIMEOUT } = params;
  
  if (!host) {
    throw new Error('host is required');
  }
  
  // Validate host format
  if (!HOST_REGEX.test(host) && !IP_REGEX.test(host)) {
    throw new Error(`Invalid host format: ${host}`);
  }
  
  // Determine ports to scan
  let portList = [];
  
  if (typeof ports === 'string') {
    switch (ports.toLowerCase()) {
      case 'common':
        portList = [21, 22, 23, 25, 53, 80, 110, 143, 443, 465, 587, 993, 995, 3306, 3389, 5432, 6379, 8080, 8443];
        break;
      case 'web':
        portList = [80, 443, 8080, 8443];
        break;
      case 'mail':
        portList = [25, 110, 143, 465, 587, 993, 995];
        break;
      case 'db':
        portList = [1433, 1521, 3306, 5432, 6379, 27017];
        break;
      default:
        // Try to parse as single port
        const p = parseInt(ports);
        if (!isNaN(p)) {
          portList = [p];
        } else {
          throw new Error(`Unknown port group: ${ports}. Valid groups: common, web, mail, db`);
        }
    }
  } else if (typeof ports === 'number') {
    portList = [ports];
  } else if (Array.isArray(ports)) {
    portList = ports.map(p => parseInt(p)).filter(p => !isNaN(p) && p > 0 && p <= 65535);
  } else {
    throw new Error('ports must be a number, array of numbers, or port group name');
  }
  
  // Limit number of ports to scan
  if (portList.length > 20) {
    portList = portList.slice(0, 20);
  }
  
  // Scan ports
  const results = [];
  for (const port of portList) {
    const result = await new Promise((resolve) => {
      const socket = new net.Socket();
      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ port, status: 'filtered' });
      }, timeout);
      
      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ port, status: 'open' });
      });
      
      socket.on('error', () => {
        clearTimeout(timer);
        resolve({ port, status: 'closed' });
      });
    });
    
    results.push(result);
  }
  
  const openPorts = results.filter(r => r.status === 'open').map(r => r.port);
  const closedPorts = results.filter(r => r.status === 'closed').map(r => r.port);
  const filteredPorts = results.filter(r => r.status === 'filtered').map(r => r.port);
  
  return {
    success: true,
    host,
    scan: {
      total: results.length,
      open: openPorts,
      closed: closedPorts,
      filtered: filteredPorts,
      results,
    },
  };
}

/**
 * HTTP request - make HTTP/HTTPS requests
 * 
 * @param {object} params - Parameters
 * @param {string} params.url - Request URL
 * @param {string} params.method - HTTP method (default: "GET")
 * @param {object} params.headers - Request headers
 * @param {string|object} params.body - Request body
 * @param {number} params.timeout - Timeout in ms (default: 10000)
 * @param {boolean} params.follow_redirects - Follow redirects (default: true)
 * @param {number} redirectCount - Internal: redirect counter
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
 * HTTP headers analysis - fetch and analyze HTTP response headers
 * 
 * @param {object} params - Parameters
 * @param {string} params.url - URL to analyze
 * @param {number} params.timeout - Timeout in ms (default: 10000)
 */
async function httpHeaders(params) {
  const { url, timeout = DEFAULT_HTTP_TIMEOUT } = params;
  
  if (!url) {
    throw new Error('url is required');
  }
  
  // Use HEAD request for headers only
  const result = await httpRequest({ url, method: 'HEAD', timeout, follow_redirects: false });
  
  if (!result.success) {
    return result;
  }
  
  // Analyze headers
  const headers = result.headers;
  const analysis = {
    success: true,
    url,
    statusCode: result.statusCode,
    headers,
    security: {},
    performance: {},
    recommendations: [],
  };
  
  // Security analysis
  if (headers['strict-transport-security']) {
    analysis.security.hsts = true;
  } else {
    analysis.security.hsts = false;
    analysis.recommendations.push('Consider adding Strict-Transport-Security header');
  }
  
  if (headers['x-content-type-options'] === 'nosniff') {
    analysis.security.noSniff = true;
  } else {
    analysis.security.noSniff = false;
    analysis.recommendations.push('Consider adding X-Content-Type-Options: nosniff header');
  }
  
  if (headers['x-frame-options']) {
    analysis.security.frameGuard = headers['x-frame-options'];
  } else {
    analysis.security.frameGuard = false;
    analysis.recommendations.push('Consider adding X-Frame-Options header');
  }
  
  if (headers['content-security-policy']) {
    analysis.security.csp = true;
  } else {
    analysis.security.csp = false;
    analysis.recommendations.push('Consider adding Content-Security-Policy header');
  }
  
  // Performance analysis
  if (headers['cache-control']) {
    analysis.performance.cacheControl = headers['cache-control'];
  }
  
  if (headers['content-encoding']) {
    analysis.performance.compression = headers['content-encoding'];
  } else {
    analysis.recommendations.push('Consider enabling compression (gzip/br)');
  }
  
  // Server info
  if (headers['server']) {
    analysis.server = headers['server'];
  }
  
  return analysis;
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
    case 'net_check':
      return await netCheck(params);
    
    case 'net_connect':
      return await netConnect(params);
    
    case 'port_scan':
      return await portScan(params);
    
    case 'http_request':
      return await httpRequest(params);
    
    case 'http_headers':
      return await httpHeaders(params);
    
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

module.exports = { execute };