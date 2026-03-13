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
 */

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');

// Active SSH connections (sessionId -> Client)
const connections = new Map();

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
 */
async function processCommandLine(line) {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch (err) {
    sendResponse({
      id: null,
      error: `Invalid JSON: ${err.message}`,
      success: false
    });
    return;
  }

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
 * Process an action and return result
 */
async function processAction(action, params) {
  switch (action) {
    case 'ping':
      return { type: 'pong', timestamp: Date.now() };

    case 'connect':
      return await handleConnect(params);

    case 'disconnect':
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

    case 'exit':
      // Graceful shutdown
      await shutdown();
      return { message: 'Shutting down' };

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

// ============== Action Handlers ==============

/**
 * Connect to SSH server
 */
async function handleConnect(params) {
  const { host, username, port = 22, password, private_key, passphrase } = params;

  if (!host || !username) {
    throw new Error('host and username are required');
  }

  const sessionId = 'sess_' + require('crypto').randomBytes(32).toString('hex');

  // Create session record
  db.createSession(sessionId, {
    host,
    username,
    port,
    created_at: new Date().toISOString()
  });

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

  // Delete from database
  db.deleteSession(session_id);

  return { message: 'Session deleted' };
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
 */
async function restoreSessions() {
  const sessions = db.listSessions();

  for (const sessionInfo of sessions) {
    if (sessionInfo.status === 'connected') {
      const session = db.getSession(sessionInfo.id);
      if (session && session.config) {
        try {
          log(`Restoring session ${sessionInfo.id}...`);
          await setupConnection(sessionInfo.id, session.config);
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
