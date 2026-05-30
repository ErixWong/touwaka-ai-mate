/**
 * HTTP Agent - 全局共享 keepAlive Agent
 * 
 * 避免 each request 创建新 Agent
 * - 复用 TCP 连接
 * - 减少握手开销
 */

import https from 'https';
import http from 'http';

const DEFAULT_TIMEOUT = 120000;
const KEEPALIVE_MSECS = 30000;

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: KEEPALIVE_MSECS,
  timeout: DEFAULT_TIMEOUT,
  maxSockets: 50,
  maxFreeSockets: 10,
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: KEEPALIVE_MSECS,
  timeout: DEFAULT_TIMEOUT,
  maxSockets: 50,
  maxFreeSockets: 10,
});

/**
 * 获取对应协议的 Agent
 */
function getAgent(url) {
  const protocol = typeof url === 'string' ? url : url.protocol;
  return protocol === 'https:' || protocol.startsWith('https') ? httpsAgent : httpAgent;
}

export default {
  httpsAgent,
  httpAgent,
  getAgent,
};