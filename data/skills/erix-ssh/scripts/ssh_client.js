#!/usr/bin/env node
/**
 * SSH Client - Client for the session manager
 *
 * Communicates with the background Session Manager.
 * Uses SQLite for persistent storage.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('./db');

// Data directory paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const COMMANDS_DIR = path.join(DATA_DIR, 'commands');
const MANAGER_SCRIPT = path.join(__dirname, 'session_manager.js');

/**
 * Output JSON
 */
function output(result) {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Parse arguments
 */
function parseArgs(args) {
  const result = {};
  let i = 0;
  
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.substring(2).replace(/-/g, '_');
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        result[key] = value;
        i += 2;
      } else {
        result[key] = true;
        i++;
      }
    } else {
      i++;
    }
  }
  
  return result;
}

/**
 * Send command to manager
 * Sets file permissions to 0600 for security
 */
function sendCommand(cmd) {
  const dir = path.dirname(COMMANDS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(COMMANDS_DIR)) {
    fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  }
  
  const cmdId = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const cmdFile = path.join(COMMANDS_DIR, `${cmdId}.json`);
  
  // Write with restrictive permissions (0600 = owner read/write only)
  fs.writeFileSync(cmdFile, JSON.stringify(cmd), { mode: 0o600 });
  
  return cmdId;
}

/**
 * Start the manager
 */
function startManager() {
  const { spawn } = require('child_process');
  
  const pidFile = path.join(DATA_DIR, 'manager.pid');
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
    try {
      process.kill(pid, 0);
      output({ success: true, message: 'Manager is already running', pid });
      return;
    } catch {
      fs.unlinkSync(pidFile);
    }
  }
  
  const child = spawn('node', [MANAGER_SCRIPT, 'start'], {
    detached: true,
    stdio: 'ignore'
  });
  
  child.unref();
  
  setTimeout(() => {
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf-8'));
      output({ success: true, message: 'Manager started', pid });
    } else {
      output({ success: false, error: 'Failed to start manager' });
    }
  }, 500);
}

/**
 * Stop the manager
 */
function stopManager() {
  sendCommand({ action: 'shutdown' });
  setTimeout(() => output({ success: true, message: 'Manager stopped' }), 500);
}

/**
 * Validate host format
 */
function validateHost(host) {
  if (!host || typeof host !== 'string') {
    return { valid: false, error: 'host is required' };
  }
  // Basic validation: hostname or IP
  const hostnameRegex = /^[a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9]$/;
  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  
  if (!hostnameRegex.test(host) && !ipRegex.test(host)) {
    return { valid: false, error: 'Invalid host format' };
  }
  return { valid: true };
}

/**
 * Validate port number
 */
function validatePort(port) {
  if (port === undefined || port === null) return { valid: true };
  const num = parseInt(port);
  if (isNaN(num) || num < 1 || num > 65535) {
    return { valid: false, error: 'Port must be between 1 and 65535' };
  }
  return { valid: true };
}

/**
 * Connect to a server
 */
function connect(params) {
  // Validate required parameters
  if (!params.host) {
    return output({ success: false, error: 'host is required' });
  }
  if (!params.username) {
    return output({ success: false, error: 'username is required' });
  }
  
  // Validate format
  const hostValidation = validateHost(params.host);
  if (!hostValidation.valid) {
    return output({ success: false, error: hostValidation.error });
  }
  
  const portValidation = validatePort(params.port);
  if (!portValidation.valid) {
    return output({ success: false, error: portValidation.error });
  }
  
  const sessionId = params.session_id || db.generateId('sess');
  
  const config = {
    host: params.host,
    port: parseInt(params.port) || 22,
    username: params.username,
    password: params.password,
    private_key: params.private_key,
    passphrase: params.passphrase
  };
  
  db.createSession(sessionId, config);
  
  sendCommand({
    action: 'connect',
    session_id: sessionId,
    config
  });
  
  output({
    success: true,
    session_id: sessionId,
    message: `Connection request sent for ${config.host}`
  });
}

/**
 * Execute a command
 */
function exec(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  if (!params.command) return output({ success: false, error: 'command is required' });
  
  const session = db.getSession(sessionId);
  if (!session) return output({ success: false, error: 'Session not found' });
  
  const taskId = db.generateId('task');
  db.createTask(taskId, sessionId, params.command);
  
  sendCommand({
    action: 'exec',
    session_id: sessionId,
    task_id: taskId,
    command: params.command
  });
  
  output({ success: true, task_id: taskId, message: 'Command submitted' });
}

/**
 * Read password from file
 * Checks file permissions for security
 */
function readPasswordFile(filePath) {
  try {
    const absolutePath = filePath.replace('~', require('os').homedir());
    if (!fs.existsSync(absolutePath)) {
      return null;
    }
    
    // Check file permissions (warn if too open)
    const stat = fs.statSync(absolutePath);
    const mode = stat.mode & 0o777;
    if (mode & 0o077) { // Others or group can read
      console.error(`WARNING: Password file ${absolutePath} has overly permissive permissions (${mode.toString(8)})`);
      console.error('Recommended: chmod 600', absolutePath);
    }
    
    const content = fs.readFileSync(absolutePath, 'utf-8').trim();
    return content || null;
  } catch (err) {
    return null;
  }
}

/**
 * Prompt for password interactively (hidden input)
 * Uses try-finally to ensure terminal state is restored
 */
async function promptPassword(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    let rawModeEnabled = false;
    
    const cleanup = () => {
      if (rawModeEnabled) {
        try {
          process.stdin.setRawMode(false);
        } catch (e) { /* ignore */ }
      }
      process.stdin.pause();
      rl.close();
    };
    
    try {
      // Hide input
      process.stdout.write(promptText);
      process.stdin.setRawMode(true);
      rawModeEnabled = true;
      process.stdin.resume();
      
      let password = '';
      
      const onData = (char) => {
        const c = char.toString('utf-8');
        switch (c) {
          case '\n':
          case '\r':
          case '\u0004': // Ctrl-D
            cleanup();
            process.stdout.write('\n');
            resolve(password);
            break;
          case '\u0003': // Ctrl-C
            cleanup();
            process.stdout.write('\n');
            process.exit(130); // 128 + SIGINT
            break;
          case '\u007F': // Backspace
            if (password.length > 0) {
              password = password.slice(0, -1);
            }
            break;
          default:
            password += c;
            break;
        }
      };
      
      process.stdin.on('data', onData);
      
    } catch (err) {
      cleanup();
      resolve('');
    }
  });
}

/**
 * Get password from various sources (priority: file > env > interactive)
 */
async function getPassword(params) {
  // 1. From password file (highest priority for scripting)
  if (params.password_file) {
    const pw = readPasswordFile(params.password_file);
    if (pw) return { password: pw, source: 'file' };
    return { error: `Password file not found or empty: ${params.password_file}` };
  }
  
  // 2. From environment variable
  if (process.env.SUDO_PASSWORD) {
    return { password: process.env.SUDO_PASSWORD, source: 'env' };
  }
  
  // 3. Interactive prompt (if tty)
  if (process.stdin.isTTY) {
    const password = await promptPassword('[sudo] Password: ');
    if (!password) {
      return { error: 'Password is required for sudo' };
    }
    return { password, source: 'interactive' };
  }
  
  // 4. No password available
  return { error: 'Password required. Use one of: --password-file, SUDO_PASSWORD env, or interactive mode' };
}

/**
 * Execute a sudo command with password
 *
 * Password sources (in order of priority):
 * 1. --password-file FILE   Read from file (most secure for scripting)
 * 2. SUDO_PASSWORD env      Environment variable
 * 3. Interactive prompt     Hidden input from terminal
 *
 * NOTE: --password CLI arg is DEPRECATED and ignored for security reasons
 */
async function sudo(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  if (!params.command) return output({ success: false, error: 'command is required' });
  
  // Warn if using deprecated --password parameter
  if (params.password) {
    console.error('WARNING: --password CLI argument is deprecated and ignored for security reasons.');
    console.error('Use one of: --password-file, SUDO_PASSWORD env, or interactive mode.');
  }
  
  const session = db.getSession(sessionId);
  if (!session) return output({ success: false, error: 'Session not found' });
  
  // Get password from secure sources
  const pwResult = await getPassword(params);
  if (pwResult.error) {
    return output({ success: false, error: pwResult.error });
  }
  
  const taskId = db.generateId('task');
  db.createTask(taskId, sessionId, `sudo ${params.command}`);
  
  sendCommand({
    action: 'sudo',
    session_id: sessionId,
    task_id: taskId,
    command: params.command,
    password: pwResult.password
  });
  
  output({ success: true, task_id: taskId, message: 'Sudo command submitted' });
}

/**
 * Read session messages
 */
function read(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  
  const session = db.getSession(sessionId);
  if (!session) return output({ success: false, error: 'Session not found' });
  
  const messages = db.queryMessages(sessionId, {
    since: params.since,
    until: params.until,
    type: params.type,
    taskId: params.task,
    unreadOnly: params.unread_only,
    limit: params.limit ? parseInt(params.limit) : undefined,
    offset: params.offset ? parseInt(params.offset) : undefined,
    reverse: params.reverse
  });
  
  if (params.mark_read && messages.length > 0) {
    db.markAsRead(sessionId, { messageIds: messages.map(m => m.id) });
  }
  
  output({
    success: true,
    session_id: sessionId,
    status: session.status,
    unread_count: session.unread_count,
    message_count: messages.length,
    messages
  });
}

/**
 * Get command history
 */
function history(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  
  const session = db.getSession(sessionId);
  if (!session) return output({ success: false, error: 'Session not found' });
  
  const limit = params.limit ? parseInt(params.limit) : 50;
  const commands = db.getCommandHistory(sessionId, limit);
  
  output({
    success: true,
    session_id: sessionId,
    count: commands.length,
    commands
  });
}

/**
 * Search messages
 */
function search(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  if (!params.query) return output({ success: false, error: 'query is required' });
  
  const session = db.getSession(sessionId);
  if (!session) return output({ success: false, error: 'Session not found' });
  
  const messages = db.searchMessages(sessionId, params.query, {
    type: params.type,
    limit: params.limit ? parseInt(params.limit) : 50
  });
  
  output({
    success: true,
    session_id: sessionId,
    query: params.query,
    count: messages.length,
    messages
  });
}

/**
 * Get session statistics
 */
function stats(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  
  const stats = db.getSessionStats(sessionId);
  if (!stats) return output({ success: false, error: 'Session not found' });
  
  output({ success: true, stats });
}

/**
 * Mark messages as read
 */
function markRead(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  
  const session = db.getSession(sessionId);
  if (!session) return output({ success: false, error: 'Session not found' });
  
  let result;
  if (params.all) {
    result = db.markAsRead(sessionId, { all: true });
  } else if (params.before) {
    result = db.markAsRead(sessionId, { beforeTimestamp: params.before });
  } else {
    result = db.markAsRead(sessionId, { all: true });
  }
  
  output({
    success: true,
    session_id: sessionId,
    marked_count: result.marked_count,
    unread_count: result.unread_count
  });
}

/**
 * Get task output (detailed)
 */
function taskOutput(params) {
  const taskId = params.task;
  
  if (!taskId) return output({ success: false, error: 'task is required' });
  
  const taskOutput = db.getTaskOutput(taskId);
  if (!taskOutput) return output({ success: false, error: 'Task not found' });
  
  output({ success: true, ...taskOutput });
}

/**
 * Get task status (summary)
 */
function taskStatus(params) {
  const taskId = params.task;
  
  if (!taskId) return output({ success: false, error: 'task is required' });
  
  const task = db.getTask(taskId);
  if (!task) return output({ success: false, error: 'Task not found' });
  
  output({ 
    success: true,
    task_id: task.id,
    session_id: task.session_id,
    command: task.command,
    status: task.status,
    exit_code: task.exit_code,
    created_at: task.created_at,
    has_output: task.output && task.output.length > 0,
    has_error: task.stderr && task.stderr.length > 0
  });
}

/**
 * List tasks
 */
function listTasks(params) {
  const tasks = db.listTasks(params.session);
  output({ success: true, count: tasks.length, tasks });
}

/**
 * Reconnect to a disconnected session
 */
function reconnect(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  
  const session = db.getSession(sessionId);
  if (!session) return output({ success: false, error: 'Session not found' });
  
  if (session.status === 'connected') {
    return output({ success: false, error: 'Session is already connected' });
  }
  
  if (!session.config) {
    return output({ success: false, error: 'Session config not found, cannot reconnect' });
  }
  
  // Send connect command with existing config
  sendCommand({
    action: 'connect',
    session_id: sessionId,
    config: session.config
  });
  
  db.updateSessionStatus(sessionId, 'connecting');
  
  output({
    success: true,
    session_id: sessionId,
    message: `Reconnecting to ${session.host}`
  });
}

/**
 * Disconnect from a server
 */
function disconnect(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  
  sendCommand({ action: 'disconnect', session_id: sessionId });
  db.updateSessionStatus(sessionId, 'disconnected');
  
  output({ success: true, message: `Disconnect request sent for ${sessionId}` });
}

/**
 * Delete a session
 */
function deleteSession(params) {
  const sessionId = params.session;
  
  if (!sessionId) return output({ success: false, error: 'session is required' });
  
  db.deleteSession(sessionId);
  
  output({ success: true, message: `Session ${sessionId} deleted` });
}

/**
 * List all sessions
 */
function list() {
  const sessions = db.listSessions();
  output({ success: true, count: sessions.length, sessions });
}

/**
 * Show help
 */
function help() {
  console.log('SSH Client - Session-based SSH client (SQLite storage)');
  console.log('');
  console.log('Usage: node ssh_client.js <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  start-manager      Start the background session manager');
  console.log('  stop-manager       Stop the background session manager');
  console.log('  connect            Connect to a server');
  console.log('  exec               Execute a command');
  console.log('  sudo               Execute a sudo command with password');
  console.log('  read               Read messages');
  console.log('  history            Get command history (list with task_id)');
  console.log('  output             Get task output (detailed)');
  console.log('  search             Search messages');
  console.log('  stats              Get session statistics');
  console.log('  mark-read          Mark messages as read');
  console.log('  task-status        Get task status (summary)');
  console.log('  tasks              List tasks');
  console.log('  reconnect          Reconnect a disconnected session');
  console.log('  disconnect         Disconnect from server');
  console.log('  delete             Delete a session');
  console.log('  list               List all sessions');
  console.log('');
  console.log('Storage: ./data/ssh.db (SQLite)');
  console.log('');
  console.log('Sudo Password Options (secure):');
  console.log('  --password-file FILE   Read password from file');
  console.log('  SUDO_PASSWORD env      Set environment variable');
  console.log('  (interactive)          Will prompt if no password provided');
  console.log('');
  console.log('Examples:');
  console.log('  node ssh_client.js start-manager');
  console.log('  node ssh_client.js connect --host 192.168.1.100 --username admin');
  console.log('  node ssh_client.js exec --session sess_xxx --command "df -h"');
  console.log('  node ssh_client.js sudo --session sess_xxx --command "apt update"');
  console.log('  SUDO_PASSWORD="secret" node ssh_client.js sudo --session sess_xxx --command "apt update"');
  console.log('  node ssh_client.js sudo --session sess_xxx --command "apt update" --password-file ~/.sudo_pw');
  console.log('  node ssh_client.js history --session sess_xxx');
  console.log('  node ssh_client.js output --task task_xxx');
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    help();
    return;
  }
  
  const command = args[0];
  const params = parseArgs(args.slice(1));
  
  switch (command) {
    case 'start-manager': startManager(); break;
    case 'stop-manager': stopManager(); break;
    case 'connect': connect(params); break;
    case 'exec': exec(params); break;
    case 'sudo': await sudo(params); break;  // async
    case 'read': read(params); break;
    case 'history': history(params); break;
    case 'output': taskOutput(params); break;
    case 'search': search(params); break;
    case 'stats': stats(params); break;
    case 'mark-read': markRead(params); break;
    case 'task-status': taskStatus(params); break;
    case 'tasks': listTasks(params); break;
    case 'reconnect': reconnect(params); break;
    case 'disconnect': disconnect(params); break;
    case 'delete': deleteSession(params); break;
    case 'list': list(); break;
    case 'help':
    case '--help': help(); break;
    default: output({ success: false, error: `Unknown command: ${command}` });
  }
}

main().catch(err => output({ success: false, error: err.message }));