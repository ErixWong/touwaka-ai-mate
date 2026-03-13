#!/usr/bin/env node
/**
 * Session Manager - Background process
 *
 * Manages SSH sessions and executes commands.
 * Uses SQLite for persistent storage.
 */

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./db');

// Data directory paths
const DATA_DIR = path.join(__dirname, '..', 'data');
const PID_FILE = path.join(DATA_DIR, 'manager.pid');
const COMMANDS_DIR = path.join(DATA_DIR, 'commands');

// Active SSH connections
const connections = new Map();

/**
 * Output JSON
 */
function output(result) {
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Check if manager is running
 */
function isRunning() {
  if (!fs.existsSync(PID_FILE)) {
    return false;
  }
  
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
  
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    fs.unlinkSync(PID_FILE);
    return false;
  }
}

/**
 * Write PID file
 */
function writePid() {
  const dir = path.dirname(PID_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(PID_FILE, process.pid.toString());
}

/**
 * Setup SSH connection
 */
async function setupConnection(sessionId, config) {
  const conn = new Client();
  
  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      connections.set(sessionId, conn);
      db.updateSessionStatus(sessionId, 'connected');
      db.addMessage(sessionId, {
        type: 'system',
        content: `Connected to ${config.host}:${config.port || 22}`
      });
      resolve(conn);
    });
    
    conn.on('error', (err) => {
      db.updateSessionStatus(sessionId, 'error');
      db.addMessage(sessionId, {
        type: 'error',
        content: err.message
      });
      reject(err);
    });
    
    conn.on('close', () => {
      connections.delete(sessionId);
      db.updateSessionStatus(sessionId, 'disconnected');
      db.addMessage(sessionId, {
        type: 'system',
        content: 'Connection closed'
      });
    });
    
    // Prepare connection config
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

/**
 * Execute command on session
 */
async function executeCommand(sessionId, taskId, command, options = {}) {
  const conn = connections.get(sessionId);
  const task = db.getTask(taskId);
  
  if (!conn) {
    task.status = 'error';
    task.output = 'Not connected';
    db.updateTask(task);
    
    db.addMessage(sessionId, {
      type: 'error',
      task_id: taskId,
      content: 'Not connected'
    });
    return;
  }
  
  task.status = 'running';
  db.updateTask(task);
  
  db.addMessage(sessionId, {
    type: 'command',
    task_id: taskId,
    content: command
  });
  
  // Build exec options (PTY for sudo commands)
  const execOptions = {};
  if (options.pty || options.sudo) {
    execOptions.pty = {
      cols: 120,
      rows: 24,
      term: 'xterm-256color'
    };
  }
  
  conn.exec(command, execOptions, (err, stream) => {
    if (err) {
      task.status = 'error';
      task.output = err.message;
      db.updateTask(task);
      
      db.addMessage(sessionId, {
        type: 'error',
        task_id: taskId,
        content: err.message
      });
      return;
    }
    
    let stdout = '';
    let stderr = '';
    
    stream.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      
      // Update task with partial output
      task.output = stdout;
      db.updateTask(task);
      
      // Add output message
      db.addMessage(sessionId, {
        type: 'output',
        task_id: taskId,
        content: chunk,
        stream: 'stdout'
      });
    });
    
    stream.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      task.stderr = stderr;
      db.updateTask(task);
      
      db.addMessage(sessionId, {
        type: 'output',
        task_id: taskId,
        content: chunk,
        stream: 'stderr'
      });
    });
    
    stream.on('close', (code, signal) => {
      task.status = 'completed';
      task.output = stdout;
      task.stderr = stderr;
      task.exit_code = code;
      task.completed_at = new Date().toISOString();
      db.updateTask(task);
      
      db.addMessage(sessionId, {
        type: 'complete',
        task_id: taskId,
        content: signal || undefined
      });
    });
  });
}

/**
 * Execute sudo command with password
 */
async function executeSudoCommand(sessionId, taskId, command, password) {
  const conn = connections.get(sessionId);
  const task = db.getTask(taskId);
  
  if (!conn) {
    task.status = 'error';
    task.output = 'Not connected';
    db.updateTask(task);
    
    db.addMessage(sessionId, {
      type: 'error',
      task_id: taskId,
      content: 'Not connected'
    });
    return;
  }
  
  task.status = 'running';
  db.updateTask(task);
  
  db.addMessage(sessionId, {
    type: 'command',
    task_id: taskId,
    content: `sudo ${command}`
  });
  
  const ptyConfig = {
    cols: 120,
    rows: 24,
    term: 'xterm-256color'
  };
  
  const sudoCommand = `sudo -S ${command}`;
  
  conn.exec(sudoCommand, { pty: ptyConfig }, (err, stream) => {
    if (err) {
      task.status = 'error';
      task.output = err.message;
      db.updateTask(task);
      
      db.addMessage(sessionId, {
        type: 'error',
        task_id: taskId,
        content: err.message
      });
      return;
    }
    
    let stdout = '';
    let stderr = '';
    let passwordSent = false;
    let passwordAttempts = 0;
    const maxPasswordAttempts = 3;
    
    // Escape regex special characters for safe password matching
    const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Sudo password prompt patterns
    const passwordPromptPatterns = [
      /\[sudo\].*password/i,
      /password\s*(for|:)/i,
      /^Password:/im
    ];
    
    stream.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      
      // Check for password prompt (fixed: && instead of ||)
      if (!passwordSent && passwordAttempts < maxPasswordAttempts) {
        const isPasswordPrompt = passwordPromptPatterns.some(pattern => pattern.test(chunk));
        
        if (isPasswordPrompt) {
          stream.write(password + '\n');
          passwordSent = true;
          passwordAttempts++;
          
          // Add a message about password prompt detected
          db.addMessage(sessionId, {
            type: 'system',
            task_id: taskId,
            content: '[sudo] Password prompt detected, sending password...'
          });
          
          // Clear password from the output to avoid logging it (fixed: escape special chars)
          stdout = stdout.replace(new RegExp(`^${escapeRegExp(password)}$`, 'gm'), '********');
        }
      }
      
      // Update task with partial output
      task.output = stdout;
      db.updateTask(task);
      
      // Sanitize output before storing (mask password if present)
      const sanitizedChunk = chunk.replace(new RegExp(escapeRegExp(password), 'g'), '********');
      
      // Add output message
      db.addMessage(sessionId, {
        type: 'output',
        task_id: taskId,
        content: sanitizedChunk,
        stream: 'stdout'
      });
    });
    
    stream.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      task.stderr = stderr;
      db.updateTask(task);
      
      db.addMessage(sessionId, {
        type: 'output',
        task_id: taskId,
        content: chunk,
        stream: 'stderr'
      });
    });
    
    stream.on('close', (code, signal) => {
      task.status = 'completed';
      task.output = stdout;
      task.stderr = stderr;
      task.exit_code = code;
      task.completed_at = new Date().toISOString();
      db.updateTask(task);
      
      db.addMessage(sessionId, {
        type: 'complete',
        task_id: taskId,
        content: signal || undefined
      });
      
      // Clear password from memory for security
      password = null;
    });
  });
}

/**
 * Read file with retry (handles Windows fs.watch race condition)
 */
function readFileWithRetry(filePath, maxRetries = 5, delay = 50) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    
    function tryRead() {
      attempts++;
      try {
        if (!fs.existsSync(filePath)) {
          if (attempts < maxRetries) {
            setTimeout(tryRead, delay);
            return;
          }
          reject(new Error(`ENOENT: no such file or directory, open '${filePath}'`));
          return;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        resolve(JSON.parse(content));
      } catch (err) {
        if (attempts < maxRetries && (err.code === 'ENOENT' || err.message.includes('ENOENT'))) {
          setTimeout(tryRead, delay);
        } else {
          reject(err);
        }
      }
    }
    
    tryRead();
  });
}

/**
 * Watch for new commands
 */
function watchCommands() {
  const dir = path.dirname(COMMANDS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(COMMANDS_DIR)) {
    fs.mkdirSync(COMMANDS_DIR, { recursive: true });
  }
  
  fs.watch(COMMANDS_DIR, (eventType, filename) => {
    if (eventType === 'rename' && filename && filename.endsWith('.json') && !filename.endsWith('.error')) {
      const filePath = path.join(COMMANDS_DIR, filename);
      
      setTimeout(async () => {
        try {
          const cmd = await readFileWithRetry(filePath);
          await processCommand(cmd);
          fs.unlinkSync(filePath);
        } catch (err) {
          console.error(`Failed to process command: ${err.message}`);
          
          // Try to report error back to caller
          try {
            const errorResponse = {
              success: false,
              error: err.message,
              command_id: filename.replace('.json', '')
            };
            // Write error to a response file
            const responseFile = path.join(COMMANDS_DIR, `${filename}.error`);
            fs.writeFileSync(responseFile, JSON.stringify(errorResponse));
          } catch (writeErr) {
            console.error(`Failed to write error response: ${writeErr.message}`);
          }
          
          // Clean up command file
          try {
            fs.unlinkSync(filePath);
          } catch {}
        }
      }, 100);
    }
  });
}

/**
 * Process incoming command
 */
async function processCommand(cmd) {
  switch (cmd.action) {
    case 'connect': {
      try {
        await setupConnection(cmd.session_id, cmd.config);
      } catch (err) {
        console.error(`Connect failed: ${err.message}`);
      }
      break;
    }
    
    case 'exec': {
      await executeCommand(cmd.session_id, cmd.task_id, cmd.command);
      break;
    }
    
    case 'sudo': {
      await executeSudoCommand(cmd.session_id, cmd.task_id, cmd.command, cmd.password);
      break;
    }
    
    case 'disconnect': {
      const conn = connections.get(cmd.session_id);
      if (conn) {
        conn.end();
      }
      break;
    }
    
    case 'shutdown': {
      for (const [sessionId, conn] of connections) {
        try {
          conn.end();
        } catch (err) {}
      }
      
      if (fs.existsSync(PID_FILE)) {
        fs.unlinkSync(PID_FILE);
      }
      
      db.close();
      process.exit(0);
    }
  }
}

/**
 * Restore sessions on startup
 */
async function restoreSessions() {
  const sessions = db.listSessions();
  
  for (const sessionInfo of sessions) {
    if (sessionInfo.status === 'connected') {
      const session = db.getSession(sessionInfo.id);
      if (session && session.config) {
        try {
          console.log(`Restoring session ${sessionInfo.id}...`);
          await setupConnection(sessionInfo.id, session.config);
        } catch (err) {
          console.error(`Failed to restore session ${sessionInfo.id}: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Start the manager
 */
async function start() {
  if (isRunning()) {
    output({ success: false, error: 'Manager is already running' });
    return;
  }
  
  console.log('Starting Session Manager...');
  
  writePid();
  
  await restoreSessions();
  
  watchCommands();
  
  console.log(`Session Manager started (PID: ${process.pid})`);
  console.log('Watching for commands...');
  
  process.stdin.resume();
}

/**
 * Get manager status
 */
function status() {
  output({
    running: isRunning(),
    pid: isRunning() ? parseInt(fs.readFileSync(PID_FILE, 'utf-8')) : null,
    sessions: db.listSessions()
  });
}

/**
 * Stop the manager
 */
function stop() {
  if (!isRunning()) {
    output({ success: false, error: 'Manager is not running' });
    return;
  }
  
  const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8'));
  
  try {
    process.kill(pid, 'SIGTERM');
    fs.unlinkSync(PID_FILE);
    output({ success: true, message: 'Manager stopped' });
  } catch (err) {
    output({ success: false, error: err.message });
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  
  switch (command) {
    case 'start':
      await start();
      break;
    case 'status':
      status();
      break;
    case 'stop':
      stop();
      break;
    default:
      console.log('Usage: node session_manager.js [start|status|stop]');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});