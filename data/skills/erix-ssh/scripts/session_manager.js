#!/usr/bin/env node
/**
 * Session Manager - Resident Process
 *
 * SSH session management daemon that communicates via stdin/stdout.
 * - stdin: receives JSON commands (JSON Lines format)
 * - stdout: sends JSON responses
 * - stderr: logs and debug output
 *
 * This process is automatically started by the main program and
 * binds its stdio to an internal API endpoint.
 *
 * 注意：此文件作为独立子进程运行，使用 ES Module 格式（继承项目 "type": "module"）
 */

import { Client } from 'ssh2';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import * as db from './db-json.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Active SSH connections (sessionId -> Client)
const connections = new Map();

// SFTP connections cache (sessionId -> SFTP instance)
const sftpConnections = new Map();

// ============== SFTP Functions ==============

/**
 * Get or create SFTP connection for a session
 * @param {string} sessionId - Session ID
 * @returns {Promise<SFTP>} SFTP instance
 */
async function getSftp(sessionId) {
  // Check cache
  if (sftpConnections.has(sessionId)) {
    return sftpConnections.get(sessionId);
  }
  
  // Get SSH connection
  const conn = connections.get(sessionId);
  if (!conn) {
    throw new Error('Session not connected');
  }
  
  // Create SFTP
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) reject(err);
      else {
        sftpConnections.set(sessionId, sftp);
        log(`SFTP connection created for ${sessionId}`);
        resolve(sftp);
      }
    });
  });
}

// ============== Protocol Functions ==============

let buffer = '';

/**
 * Send JSON response to stdout (for main program to consume)
 */
function sendResponse(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
}

/**
 * Log to stderr (does not interfere with stdout communication)
 */
function log(message, ...args) {
  process.stderr.write(`[ssh-manager] ${new Date().toISOString()} ${message}`);
  if (args.length > 0) {
    process.stderr.write(' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' '));
  }
  process.stderr.write('\n');
}

/**
 * Process a single JSON command line
 * Supports both old format (action-based) and new format (command-based)
 */
async function processCommandLine(line) {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch (err) {
    sendResponse({
      task_id: null,
      error: `Invalid JSON: ${err.message}`,
      success: false
    });
    return;
  }

  // New format: { command, task_id, params, user }
  if (cmd.command) {
    const { command, task_id, params, user } = cmd;
    
    try {
      const result = await processCommand(command, params || {}, user || {});
      sendResponse({
        task_id: task_id,
        result: result,
        success: true
      });
    } catch (err) {
      sendResponse({
        task_id: task_id,
        error: err.message,
        success: false
      });
    }
    return;
  }

  // Old format: { id, action, ...params } - for backward compatibility
  const { id, action, ...params } = cmd;

  try {
    const result = await processAction(action, params);
    sendResponse({
      id: id,
      success: true,
      ...result
    });
  } catch (err) {
    sendResponse({
      id: id,
      success: false,
      error: err.message
    });
  }
}

/**
 * Process a command (new format with user context)
 * @param {string} command - Command name
 * @param {object} params - Command parameters
 * @param {object} user - User context { userId, accessToken, expertId, isAdmin }
 */
async function processCommand(command, params, user) {
  const userId = user.userId || null;
  const isAdmin = user.isAdmin || false;
  
  switch (command) {
    case 'invoke':
      // Invoke is a wrapper for various actions
      const action = params.action || params.command || 'connect';
      return await processActionWithUser(action, params, userId, isAdmin);

    case 'ping':
      return { type: 'pong', timestamp: Date.now() };

    default:
      return await processActionWithUser(command, params, userId, isAdmin);
  }
}

/**
 * Process an action with user context for permission checking
 */
async function processActionWithUser(action, params, userId, isAdmin) {
  // Actions that require session ownership check
  const sessionActions = ['disconnect', 'exec', 'sudo', 'output', 'history', 'delete',
                          'sftp_list', 'sftp_download', 'sftp_upload'];
  
  if (sessionActions.includes(action) && params.session_id) {
    // Check session ownership (skip for admin)
    if (!isAdmin && userId) {
      if (!db.isSessionOwnedByUser(params.session_id, userId)) {
        throw new Error('Session not found or access denied');
      }
    }
  }

  switch (action) {
    case 'session':
      // Unified session management (connect/disconnect)
      return await handleSession(params, userId, isAdmin);

    case 'connect':
      // Legacy: direct connect (for backward compatibility)
      return await handleConnectWithUser(params, userId);

    case 'disconnect':
      // Legacy: direct disconnect (for backward compatibility)
      return await handleDisconnect(params);

    case 'exec':
      return await handleExec(params);

    case 'sudo':
      return await handleSudo(params);

    case 'output':
      return handleOutput(params);

    case 'history':
      return handleHistory(params);

    case 'delete':
      return handleDelete(params);

    case 'list_sessions':
      return handleListSessions(userId);

    // SFTP actions
    case 'sftp_list':
      return await handleSftpList(params);

    case 'sftp_download':
      return await handleSftpDownload(params);

    case 'sftp_upload':
      return await handleSftpUpload(params);

    case 'exit':
      await shutdown();
      return { message: 'Shutting down' };

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Process an action and return result (legacy format)
 */
async function processAction(action, params) {
  return processActionWithUser(action, params, null, false);
}

// ============== Action Handlers ==============

/**
 * Unified session management (connect/disconnect)
 * @param {object} params - Parameters
 * @param {string} userId - User ID
 * @param {boolean} isAdmin - Is admin user
 */
async function handleSession(params, userId, isAdmin) {
  const operation = params.operation;
  
  if (!operation) {
    throw new Error('operation is required (connect|disconnect)');
  }
  
  switch (operation) {
    case 'connect':
      return await handleConnectWithUser(params, userId);
    
    case 'disconnect':
      // For disconnect, we need to check ownership
      if (!isAdmin && userId && params.session_id) {
        if (!db.isSessionOwnedByUser(params.session_id, userId)) {
          throw new Error('Session not found or access denied');
        }
      }
      return await handleDisconnect(params);
    
    default:
      throw new Error(`Unknown session operation: ${operation}`);
  }
}

/**
 * Connect to SSH server (with user isolation)
 * @param {object} params - Connection parameters
 * @param {string} userId - User ID for session isolation
 */
async function handleConnectWithUser(params, userId = null) {
  const { host, username, port = 22, password, private_key, passphrase } = params;

  if (!host || !username) {
    throw new Error('host and username are required');
  }

  const sessionId = 'sess_' + crypto.randomBytes(32).toString('hex');

  // Create session record with user_id
  db.createSession(sessionId, {
    host,
    username,
    port,
    created_at: new Date().toISOString()
  }, userId);

  // Setup connection
  await setupConnection(sessionId, {
    host,
    port,
    username,
    password,
    private_key,
    passphrase
  });

  return { session_id: sessionId };
}

/**
 * Connect to SSH server (legacy, without user isolation)
 */
async function handleConnect(params) {
  return handleConnectWithUser(params, null);
}

/**
 * List sessions for a user
 * @param {string} userId - User ID (null for all sessions)
 */
function handleListSessions(userId = null) {
  const sessions = db.listSessions(userId);
  return { sessions };
}

/**
 * Disconnect from SSH server
 */
async function handleDisconnect(params) {
  const { session_id } = params;

  if (!session_id) {
    throw new Error('session_id is required');
  }

  const conn = connections.get(session_id);
  if (conn) {
    conn.end();
    connections.delete(session_id);
  }

  // Clear SFTP connection cache
  sftpConnections.delete(session_id);

  db.updateSessionStatus(session_id, 'disconnected');
  db.addMessage(session_id, {
    type: 'system',
    content: 'Disconnected by user'
  });

  return { message: 'Disconnected' };
}

/**
 * Execute command on remote server (synchronous - waits for completion)
 */
async function handleExec(params) {
  const { session_id, command, timeout = 60000 } = params;

  if (!session_id || !command) {
    throw new Error('session_id and command are required');
  }

  const conn = connections.get(session_id);
  if (!conn) {
    throw new Error('Session not connected');
  }

  const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Command timeout'));
    }, timeout);

    let stdout = '';
    let stderr = '';

    db.addMessage(session_id, {
      type: 'command',
      task_id: taskId,
      content: command
    });

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timeoutId);
        db.addMessage(session_id, {
          type: 'error',
          task_id: taskId,
          content: err.message
        });
        reject(err);
        return;
      }

      stream.on('data', (data) => {
        stdout += data.toString();
      });

      stream.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      stream.on('close', (code, signal) => {
        clearTimeout(timeoutId);

        // Store messages
        if (stdout) {
          db.addMessage(session_id, {
            type: 'output',
            task_id: taskId,
            content: stdout,
            stream: 'stdout'
          });
        }
        if (stderr) {
          db.addMessage(session_id, {
            type: 'output',
            task_id: taskId,
            content: stderr,
            stream: 'stderr'
          });
        }
        db.addMessage(session_id, {
          type: 'complete',
          task_id: taskId,
          exit_code: code,
          signal: signal
        });

        resolve({
          task_id: taskId,
          exit_code: code,
          signal: signal,
          stdout: stdout,
          stderr: stderr
        });
      });
    });
  });
}

/**
 * Execute sudo command with password
 */
async function handleSudo(params) {
  const { session_id, command, password, timeout = 120000 } = params;

  if (!session_id || !command || !password) {
    throw new Error('session_id, command and password are required');
  }

  const conn = connections.get(session_id);
  if (!conn) {
    throw new Error('Session not connected');
  }

  const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  const sudoCommand = `sudo -S ${command}`;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Sudo command timeout'));
    }, timeout);

    let stdout = '';
    let stderr = '';
    let passwordSent = false;

    db.addMessage(session_id, {
      type: 'command',
      task_id: taskId,
      content: `sudo ${command}`
    });

    const ptyConfig = {
      cols: 120,
      rows: 24,
      term: 'xterm-256color'
    };

    conn.exec(sudoCommand, { pty: ptyConfig }, (err, stream) => {
      if (err) {
        clearTimeout(timeoutId);
        reject(err);
        return;
      }

      stream.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;

        // Detect password prompt and send password
        if (!passwordSent && (
          /\[sudo\].*password/i.test(chunk) ||
          /password\s*(for|:)/i.test(chunk) ||
          /^Password:/im.test(chunk)
        )) {
          stream.write(password + '\n');
          passwordSent = true;
          log('Password prompt detected, sent password');
        }
      });

      stream.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      stream.on('close', (code, signal) => {
        clearTimeout(timeoutId);

        // Sanitize output (mask password)
        const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const sanitizedStdout = stdout.replace(new RegExp(escapeRegExp(password), 'g'), '********');
        const sanitizedStderr = stderr.replace(new RegExp(escapeRegExp(password), 'g'), '********');

        // Store messages
        if (sanitizedStdout) {
          db.addMessage(session_id, {
            type: 'output',
            task_id: taskId,
            content: sanitizedStdout,
            stream: 'stdout'
          });
        }
        if (sanitizedStderr) {
          db.addMessage(session_id, {
            type: 'output',
            task_id: taskId,
            content: sanitizedStderr,
            stream: 'stderr'
          });
        }

        resolve({
          task_id: taskId,
          exit_code: code,
          signal: signal,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr
        });
      });
    });
  });
}

/**
 * Get output for a specific task
 */
function handleOutput(params) {
  const { task_id } = params;

  if (!task_id) {
    throw new Error('task_id is required');
  }

  // Find messages for this task
  const messages = db.getMessagesByTask ? db.getMessagesByTask(task_id) : [];

  // Also check tasks table if it exists
  const task = db.getTask ? db.getTask(task_id) : null;

  if (task) {
    return {
      task_id: task_id,
      command: task.command,
      status: task.status,
      exit_code: task.exit_code,
      stdout: task.output || '',
      stderr: task.stderr || ''
    };
  }

  // Build from messages
  const outputMsg = messages.find(m => m.type === 'output' && m.stream === 'stdout');
  const errorMsg = messages.filter(m => m.type === 'output' && m.stream === 'stderr');
  const completeMsg = messages.find(m => m.type === 'complete');

  return {
    task_id: task_id,
    status: completeMsg ? 'completed' : 'running',
    exit_code: completeMsg?.exit_code,
    stdout: outputMsg?.content || '',
    stderr: errorMsg.map(m => m.content).join('')
  };
}

/**
 * Get command history for a session
 */
function handleHistory(params) {
  const { session_id, limit = 20 } = params;

  if (!session_id) {
    throw new Error('session_id is required');
  }

  const messages = db.getMessages(session_id, { type: 'command', limit });

  return {
    commands: messages.map(msg => ({
      id: msg.id,
      task_id: msg.task_id,
      command: msg.content,
      timestamp: msg.timestamp,
      type: msg.type
    }))
  };
}

/**
 * Delete a session and its history
 */
function handleDelete(params) {
  const { session_id } = params;

  if (!session_id) {
    throw new Error('session_id is required');
  }

  // Disconnect if connected
  const conn = connections.get(session_id);
  if (conn) {
    conn.end();
    connections.delete(session_id);
  }

  // Clear SFTP connection cache
  sftpConnections.delete(session_id);

  // Delete from database
  db.deleteSession(session_id);

  return { message: 'Session deleted' };
}

// ============== SFTP Action Handlers ==============

/**
 * List remote directory contents
 */
async function handleSftpList(params) {
  const { session_id, path: remotePath } = params;

  if (!session_id || !remotePath) {
    throw new Error('session_id and path are required');
  }

  const sftp = await getSftp(session_id);

  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err, list) => {
      if (err) {
        reject(new Error(`SFTP list failed: ${err.message}`));
        return;
      }

      const entries = list.map(entry => ({
        filename: entry.filename,
        type: entry.longname[0] === 'd' ? 'directory' : 
              entry.longname[0] === 'l' ? 'symlink' : 'file',
        size: entry.attrs.size,
        mode: (entry.attrs.mode & 0o7777).toString(8).padStart(4, '0'),
        mtime: new Date(entry.attrs.mtime * 1000).toISOString(),
        longname: entry.longname
      }));

      resolve({
        path: remotePath,
        entries: entries
      });
    });
  });
}

/**
 * Download file from remote server
 */
async function handleSftpDownload(params) {
  const { session_id, remote_path, local_path } = params;

  if (!session_id || !remote_path || !local_path) {
    throw new Error('session_id, remote_path and local_path are required');
  }

  const sftp = await getSftp(session_id);
  const expandedLocalPath = local_path.replace('~', os.homedir());

  return new Promise((resolve, reject) => {
    sftp.fastGet(remote_path, expandedLocalPath, (err) => {
      if (err) {
        reject(new Error(`SFTP download failed: ${err.message}`));
        return;
      }

      // Get file stats for response
      const stats = fs.statSync(expandedLocalPath);

      resolve({
        remote_path: remote_path,
        local_path: expandedLocalPath,
        bytes_transferred: stats.size
      });
    });
  });
}

/**
 * Upload file to remote server
 */
async function handleSftpUpload(params) {
  const { session_id, local_path, remote_path } = params;

  if (!session_id || !local_path || !remote_path) {
    throw new Error('session_id, local_path and remote_path are required');
  }

  const sftp = await getSftp(session_id);
  const expandedLocalPath = local_path.replace('~', os.homedir());

  // Check if local file exists
  if (!fs.existsSync(expandedLocalPath)) {
    throw new Error(`Local file not found: ${expandedLocalPath}`);
  }

  const stats = fs.statSync(expandedLocalPath);

  return new Promise((resolve, reject) => {
    sftp.fastPut(expandedLocalPath, remote_path, (err) => {
      if (err) {
        reject(new Error(`SFTP upload failed: ${err.message}`));
        return;
      }

      resolve({
        local_path: expandedLocalPath,
        remote_path: remote_path,
        bytes_transferred: stats.size
      });
    });
  });
}

// ============== SSH Connection Management ==============

/**
 * Setup SSH connection
 */
async function setupConnection(sessionId, config) {
  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      connections.set(sessionId, conn);
      db.updateSessionStatus(sessionId, 'connected');
      db.updateSessionConfig(sessionId, {
        host: config.host,
        port: config.port,
        username: config.username
      });
      db.addMessage(sessionId, {
        type: 'system',
        content: `Connected to ${config.host}:${config.port}`
      });
      log(`Connected: ${sessionId} -> ${config.host}:${config.port}`);
      resolve(conn);
    });

    conn.on('error', (err) => {
      db.updateSessionStatus(sessionId, 'error');
      db.addMessage(sessionId, {
        type: 'error',
        content: err.message
      });
      log(`Connection error for ${sessionId}:`, err.message);
      reject(err);
    });

    conn.on('close', () => {
      connections.delete(sessionId);
      sftpConnections.delete(sessionId);  // Clear SFTP cache on connection close
      db.updateSessionStatus(sessionId, 'disconnected');
      db.addMessage(sessionId, {
        type: 'system',
        content: 'Connection closed'
      });
      log(`Connection closed: ${sessionId}`);

      // Notify main program
      sendResponse({
        type: 'event',
        event: 'disconnect',
        session_id: sessionId
      });
    });

    // Build SSH config
    const sshConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      readyTimeout: 30000,
      keepaliveInterval: 10000
    };

    if (config.password) {
      sshConfig.password = config.password;
    } else if (config.private_key) {
      const keyPath = config.private_key.replace('~', os.homedir());
      try {
        sshConfig.privateKey = fs.readFileSync(keyPath, 'utf-8');
        if (config.passphrase) {
          sshConfig.passphrase = config.passphrase;
        }
      } catch (err) {
        reject(new Error(`Failed to read private key: ${err.message}`));
        return;
      }
    } else {
      // Try default key
      const defaultKey = path.join(os.homedir(), '.ssh', 'id_rsa');
      if (fs.existsSync(defaultKey)) {
        try {
          sshConfig.privateKey = fs.readFileSync(defaultKey, 'utf-8');
        } catch (err) {
          reject(new Error(`Failed to read default key: ${err.message}`));
          return;
        }
      }
    }

    conn.connect(sshConfig);
  });
}

// ============== Lifecycle ==============

/**
 * Restore sessions from database on startup
 * Note: JSON storage does NOT save passwords to disk for security.
 * Only sessions with private_key authentication can be restored.
 */
async function restoreSessions() {
  const sessions = db.listSessions();

  for (const sessionInfo of sessions) {
    if (sessionInfo.status === 'connected') {
      // Load full session data including config from JSON file
      const sessionData = db.loadSessionData(sessionInfo.id);
      if (sessionData && sessionData.session && sessionData.session.config) {
        const config = sessionData.session.config;
        
        // Check if session can be restored (requires private_key, password is not saved)
        if (!config.private_key) {
          log(`Session ${sessionInfo.id} cannot be restored (password-based auth, credentials not saved)`);
          db.updateSessionStatus(sessionInfo.id, 'disconnected');
          continue;
        }
        
        try {
          log(`Restoring session ${sessionInfo.id}...`);
          await setupConnection(sessionInfo.id, config);
        } catch (err) {
          log(`Failed to restore session ${sessionInfo.id}:`, err.message);
        }
      }
    }
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  log('Shutting down...');

  for (const [sessionId, conn] of connections) {
    try {
      conn.end();
    } catch (err) {}
  }
  connections.clear();
  sftpConnections.clear();

  if (db.close) {
    db.close();
  }

  process.exit(0);
}

/**
 * Main entry point - stdin event loop
 */
async function main() {
  log('Starting SSH Session Manager...');

  // Restore previous sessions
  await restoreSessions();

  // Setup stdin listener
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        processCommandLine(line).catch(err => {
          log('Error processing command:', err.message);
        });
      }
    }
  });

  process.stdin.on('end', () => {
    shutdown();
  });

  // Handle termination signals
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Notify main program that we're ready
  sendResponse({
    type: 'ready',
    name: 'ssh-session-manager',
    pid: process.pid,
    timestamp: Date.now()
  });

  log('Ready, waiting for commands on stdin');
}

// Start
main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
