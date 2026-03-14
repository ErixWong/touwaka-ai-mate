/**
 * SSH Client - Expert entry point
 *
 * This script is called by experts and forwards requests to the
 * resident SSH session manager via internal API.
 *
 * Architecture:
 * Expert -> ssh_client.js -> Internal API -> session_manager.js (resident)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Configuration
const CONFIG = {
  internalApiBase: process.env.API_BASE || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_KEY || '',
  defaultTimeout: 30000,
};

/**
 * HTTP request wrapper
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
 * Invoke SSH resident tool via internal API
 */
async function invokeSSHTOol(action, params, timeout) {
  const url = `${CONFIG.internalApiBase}/internal/resident/invoke`;

  const headers = {};
  if (CONFIG.internalApiKey) {
    headers['X-Internal-Key'] = CONFIG.internalApiKey;
  }

  const response = await httpRequest(url, {
    method: 'POST',
    headers,
    timeout: timeout || CONFIG.defaultTimeout,
  }, {
    skill_id: 'ssh',
    tool_name: 'ssh_manager',
    params: {
      action,
      ...params
    }
  });

  // API returns: { code: 200, message: 'success', data: {...} }
  if (response.code !== 200) {
    throw new Error(response.message || 'Failed to invoke SSH tool');
  }

  return response.data;
}

// ==================== Actions ====================

/**
 * Connect to SSH server
 */
async function connect(params) {
  const { host, username, port = 22, password, private_key, passphrase } = params;

  if (!host || !username) {
    return {
      success: false,
      error: 'host and username are required'
    };
  }

  try {
    const result = await invokeSSHTOol('connect', {
      host,
      username,
      port,
      password,
      private_key,
      passphrase
    });

    return {
      success: true,
      session_id: result.session_id,
      message: `Connected to ${host}:${port}`
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Disconnect from SSH server
 */
async function disconnect(params) {
  const { session_id } = params;

  if (!session_id) {
    return {
      success: false,
      error: 'session_id is required'
    };
  }

  try {
    await invokeSSHTOol('disconnect', { session_id });
    return {
      success: true,
      message: 'Disconnected'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Execute command (synchronous - waits for completion)
 */
async function exec(params) {
  const { session_id, command, timeout } = params;

  if (!session_id || !command) {
    return {
      success: false,
      error: 'session_id and command are required'
    };
  }

  try {
    const result = await invokeSSHTOol('exec', {
      session_id,
      command
    }, timeout || 60000);

    return {
      success: true,
      task_id: result.task_id,
      exit_code: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Execute sudo command
 */
async function sudo(params) {
  const { session_id, command, password, timeout } = params;

  if (!session_id || !command || !password) {
    return {
      success: false,
      error: 'session_id, command and password are required'
    };
  }

  try {
    const result = await invokeSSHTOol('sudo', {
      session_id,
      command,
      password
    }, timeout || 120000);

    return {
      success: true,
      task_id: result.task_id,
      exit_code: result.exit_code,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Get output for a task
 */
async function output(params) {
  const { task_id } = params;

  if (!task_id) {
    return {
      success: false,
      error: 'task_id is required'
    };
  }

  try {
    const result = await invokeSSHTOol('output', { task_id });
    return {
      success: true,
      ...result
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Get command history
 */
async function history(params) {
  const { session_id, limit } = params;

  if (!session_id) {
    return {
      success: false,
      error: 'session_id is required'
    };
  }

  try {
    const result = await invokeSSHTOol('history', {
      session_id,
      limit
    });
    return {
      success: true,
      ...result
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Delete session
 */
async function deleteSession(params) {
  const { session_id } = params;

  if (!session_id) {
    return {
      success: false,
      error: 'session_id is required'
    };
  }

  try {
    await invokeSSHTOol('delete', { session_id });
    return {
      success: true,
      message: 'Session deleted'
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

// ==================== SFTP Actions ====================

/**
 * List remote directory
 */
async function sftpList(params) {
  const { session_id, path } = params;

  if (!session_id || !path) {
    return {
      success: false,
      error: 'session_id and path are required'
    };
  }

  try {
    const result = await invokeSSHTOol('sftp_list', {
      session_id,
      path
    }, 30000);

    return {
      success: true,
      ...result
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Download file from remote server
 */
async function sftpDownload(params) {
  const { session_id, remote_path, local_path } = params;

  if (!session_id || !remote_path || !local_path) {
    return {
      success: false,
      error: 'session_id, remote_path and local_path are required'
    };
  }

  try {
    const result = await invokeSSHTOol('sftp_download', {
      session_id,
      remote_path,
      local_path
    }, 120000); // 2 minutes timeout for file transfers

    return {
      success: true,
      ...result
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Upload file to remote server
 */
async function sftpUpload(params) {
  const { session_id, local_path, remote_path } = params;

  if (!session_id || !local_path || !remote_path) {
    return {
      success: false,
      error: 'session_id, local_path and remote_path are required'
    };
  }

  try {
    const result = await invokeSSHTOol('sftp_upload', {
      session_id,
      local_path,
      remote_path
    }, 120000); // 2 minutes timeout for file transfers

    return {
      success: true,
      ...result
    };
  } catch (err) {
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Skill entry point
 * @param {string} toolName - Tool name (ssh_connect, ssh_exec, sftp_list, etc.)
 * @param {Object} params - Tool parameters
 * @param {Object} context - Execution context
 */
async function execute(toolName, params, context = {}) {
  // Extract action from tool name (ssh_connect -> connect, sftp_list -> sftp_list, etc.)
  let action = toolName.replace(/^ssh_/, '').replace(/-/g, '_');

  // SSH actions
  switch (action) {
    case 'connect':
      return connect(params);

    case 'disconnect':
      return disconnect(params);

    case 'exec':
      return exec(params);

    case 'sudo':
      return sudo(params);

    case 'output':
      return output(params);

    case 'history':
      return history(params);

    case 'delete':
      return deleteSession(params);

    // SFTP actions
    case 'sftp_list':
      return sftpList(params);

    case 'sftp_download':
      return sftpDownload(params);

    case 'sftp_upload':
      return sftpUpload(params);

    default:
      console.error(`[ssh-client] Unknown action: ${action}`);
      return {
        success: false,
        error: `Unknown tool: ${toolName}`
      };
  }
}

module.exports = { execute };
