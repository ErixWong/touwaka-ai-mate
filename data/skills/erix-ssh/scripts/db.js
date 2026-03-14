/**
 * SSH Skill - SQLite Storage
 * 
 * Provides persistent storage for sessions, tasks, and messages using SQLite.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use project directory for data storage
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'ssh.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  -- Sessions table
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    status TEXT DEFAULT 'connecting',
    config TEXT,  -- JSON blob
    user_id TEXT,  -- 用户ID，用于session隔离
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_read_at TEXT
  );

  -- Tasks table
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    output TEXT DEFAULT '',
    stderr TEXT DEFAULT '',
    exit_code INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  -- Messages table
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    task_id TEXT,
    timestamp TEXT NOT NULL,
    type TEXT NOT NULL,  -- command, output, error, complete, system
    content TEXT,
    stream TEXT,  -- stdout, stderr
    read INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (task_id) REFERENCES tasks(id)
  );

  -- Indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);
  CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

/**
 * Generate unique ID
 */
function generateId(prefix = 'sess') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${prefix}_${timestamp}_${random}`;
}

// ============================================
// Session Operations
// ============================================

/**
 * Create a new session
 * @param {string} sessionId - Session ID
 * @param {object} config - Session config (host, port, username, etc.)
 * @param {string} userId - User ID for session isolation
 */
function createSession(sessionId, config, userId = null) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO sessions (id, host, port, username, status, config, user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    sessionId,
    config.host,
    config.port || 22,
    config.username,
    'connecting',
    JSON.stringify(config),
    userId,
    now,
    now
  );
  
  return getSession(sessionId);
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  const row = stmt.get(sessionId);
  
  if (!row) return null;
  
  return {
    ...row,
    config: row.config ? JSON.parse(row.config) : null,
    unread_count: getUnreadCount(sessionId),
    message_count: getMessageCount(sessionId)
  };
}

/**
 * Update session status
 */
function updateSessionStatus(sessionId, status) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(status, now, sessionId);
  return getSession(sessionId);
}

/**
 * Update session config
 */
function updateSessionConfig(sessionId, config) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE sessions SET config = ?, updated_at = ? WHERE id = ?
  `);
  stmt.run(JSON.stringify(config), now, sessionId);
  return getSession(sessionId);
}

/**
 * Update last read timestamp
 */
function updateLastRead(sessionId) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE sessions SET last_read_at = ? WHERE id = ?
  `);
  stmt.run(now, sessionId);
}

/**
 * Get session summary
 */
function getSessionSummary(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  
  return {
    id: session.id,
    host: session.host,
    port: session.port,
    username: session.username,
    status: session.status,
    created_at: session.created_at,
    updated_at: session.updated_at,
    last_read_at: session.last_read_at,
    unread_count: session.unread_count,
    message_count: session.message_count
  };
}

/**
 * List all sessions (optionally filtered by user)
 * @param {string} userId - Optional user ID to filter sessions
 */
function listSessions(userId = null) {
  let stmt;
  if (userId) {
    stmt = db.prepare('SELECT id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC');
    const rows = stmt.all(userId);
    return rows.map(row => getSessionSummary(row.id)).filter(s => s !== null);
  } else {
    stmt = db.prepare('SELECT id FROM sessions ORDER BY updated_at DESC');
    const rows = stmt.all();
    return rows.map(row => getSessionSummary(row.id)).filter(s => s !== null);
  }
}

/**
 * Check if session belongs to user
 * @param {string} sessionId - Session ID
 * @param {string} userId - User ID
 * @returns {boolean} True if session belongs to user
 */
function isSessionOwnedByUser(sessionId, userId) {
  const stmt = db.prepare('SELECT user_id FROM sessions WHERE id = ?');
  const row = stmt.get(sessionId);
  
  if (!row) return false;
  
  // If session has no user_id, it's accessible by anyone (backward compatibility)
  // If session has user_id, it must match
  if (row.user_id === null) return true;
  return row.user_id === userId;
}

/**
 * Delete session and its messages (with transaction)
 */
function deleteSession(sessionId) {
  const deleteTx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM tasks WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  });
  
  deleteTx();
}

// ============================================
// Task Operations
// ============================================

/**
 * Create a new task
 */
function createTask(taskId, sessionId, command) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO tasks (id, session_id, command, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(taskId, sessionId, command, 'pending', now, now);
  return getTask(taskId);
}

/**
 * Get task by ID
 */
function getTask(taskId) {
  const stmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  return stmt.get(taskId) || null;
}

/**
 * Update task
 */
function updateTask(task) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE tasks SET 
      status = ?, 
      output = ?, 
      stderr = ?, 
      exit_code = ?, 
      updated_at = ?,
      completed_at = ?
    WHERE id = ?
  `);
  
  stmt.run(
    task.status,
    task.output || '',
    task.stderr || '',
    task.exit_code,
    now,
    task.completed_at || null,
    task.id
  );
  
  return getTask(task.id);
}

/**
 * List tasks
 */
function listTasks(sessionId) {
  let stmt;
  if (sessionId) {
    stmt = db.prepare(`
      SELECT id, session_id, command, status, created_at, exit_code 
      FROM tasks 
      WHERE session_id = ? 
      ORDER BY created_at DESC
    `);
    return stmt.all(sessionId);
  } else {
    stmt = db.prepare(`
      SELECT id, session_id, command, status, created_at, exit_code 
      FROM tasks 
      ORDER BY created_at DESC
    `);
    return stmt.all();
  }
}

/**
 * Get task output
 */
function getTaskOutput(taskId) {
  const task = getTask(taskId);
  if (!task) return null;
  
  return {
    task_id: task.id,
    session_id: task.session_id,
    command: task.command,
    status: task.status,
    exit_code: task.exit_code,
    created_at: task.created_at,
    completed_at: task.completed_at || task.updated_at,
    output: task.output || '',
    stderr: task.stderr || ''
  };
}

/**
 * Delete task and its messages (with transaction)
 */
function deleteTask(taskId) {
  const deleteTx = db.transaction(() => {
    db.prepare('DELETE FROM messages WHERE task_id = ?').run(taskId);
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  });
  
  deleteTx();
}

// ============================================
// Message Operations
// ============================================

/**
 * Add a message
 */
function addMessage(sessionId, message) {
  const msgId = generateId('msg');
  const timestamp = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, task_id, timestamp, type, content, stream, read)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  
  stmt.run(
    msgId,
    sessionId,
    message.task_id || null,
    timestamp,
    message.type,
    message.content || '',
    message.stream || null
  );
  
  return getMessage(msgId);
}

/**
 * Get message by ID
 */
function getMessage(msgId) {
  const stmt = db.prepare('SELECT * FROM messages WHERE id = ?');
  const row = stmt.get(msgId);
  
  if (!row) return null;
  
  return {
    ...row,
    read: row.read === 1
  };
}

/**
 * Get unread count for a session
 */
function getUnreadCount(sessionId) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND read = 0');
  return stmt.get(sessionId).count;
}

/**
 * Get message count for a session
 */
function getMessageCount(sessionId) {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?');
  return stmt.get(sessionId).count;
}

/**
 * Query messages with filters
 */
function queryMessages(sessionId, options = {}) {
  let sql = 'SELECT * FROM messages WHERE session_id = ?';
  const params = [sessionId];
  
  const {
    since,
    until,
    type,
    taskId,
    unreadOnly,
    read,
    search,
    limit,
    offset,
    reverse
  } = options;
  
  if (since) {
    sql += ' AND timestamp > ?';
    params.push(since);
  }
  
  if (until) {
    sql += ' AND timestamp < ?';
    params.push(until);
  }
  
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  
  if (taskId) {
    sql += ' AND task_id = ?';
    params.push(taskId);
  }
  
  if (unreadOnly) {
    sql += ' AND read = 0';
  }
  
  if (read !== undefined) {
    sql += ' AND read = ?';
    params.push(read ? 1 : 0);
  }
  
  if (search) {
    sql += ' AND content LIKE ?';
    params.push(`%${search}%`);
  }
  
  // Sort
  sql += reverse ? ' ORDER BY timestamp ASC' : ' ORDER BY timestamp DESC';
  
  // Limit and offset
  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  
  if (offset) {
    sql += ' OFFSET ?';
    params.push(offset);
  }
  
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  
  return rows.map(row => ({
    ...row,
    read: row.read === 1
  }));
}

/**
 * Get unread messages
 */
function getUnreadMessages(sessionId) {
  return queryMessages(sessionId, { unreadOnly: true });
}

/**
 * Get messages by task
 */
function getMessagesByTask(taskId) {
  const stmt = db.prepare('SELECT * FROM messages WHERE task_id = ?');
  const rows = stmt.all(taskId);
  
  return rows.map(row => ({
    ...row,
    read: row.read === 1
  }));
}

/**
 * Get messages for a session
 */
function getMessages(sessionId, options = {}) {
  return queryMessages(sessionId, options);
}

/**
 * Mark messages as read
 */
function markAsRead(sessionId, options = {}) {
  const { messageIds, all = false, beforeTimestamp } = options;
  
  // Validate messageIds array
  if (messageIds !== undefined && messageIds !== null) {
    if (!Array.isArray(messageIds)) {
      throw new Error('messageIds must be an array');
    }
    if (messageIds.length === 0) {
      return { marked_count: 0, unread_count: getUnreadCount(sessionId) };
    }
    // Filter out invalid IDs
    const validIds = messageIds.filter(id => typeof id === 'string' && id.length > 0);
    if (validIds.length === 0) {
      return { marked_count: 0, unread_count: getUnreadCount(sessionId) };
    }
    
    const placeholders = validIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE messages SET read = 1
      WHERE session_id = ? AND id IN (${placeholders}) AND read = 0
    `);
    const result = stmt.run(sessionId, ...validIds);
    
    updateLastRead(sessionId);
    return {
      marked_count: result.changes,
      unread_count: getUnreadCount(sessionId)
    };
  }
  
  if (all) {
    const stmt = db.prepare('UPDATE messages SET read = 1 WHERE session_id = ? AND read = 0');
    const result = stmt.run(sessionId);
    
    updateLastRead(sessionId);
    return {
      marked_count: result.changes,
      unread_count: 0
    };
  }
  
  if (beforeTimestamp) {
    const stmt = db.prepare(`
      UPDATE messages SET read = 1
      WHERE session_id = ? AND timestamp <= ? AND read = 0
    `);
    const result = stmt.run(sessionId, beforeTimestamp);
    
    updateLastRead(sessionId);
    return {
      marked_count: result.changes,
      unread_count: getUnreadCount(sessionId)
    };
  }
  
  return { marked_count: 0, unread_count: getUnreadCount(sessionId) };
}

/**
 * Get command history
 */
function getCommandHistory(sessionId, limit = 50) {
  const sql = `
    SELECT m.id, m.task_id, m.content as command, m.timestamp,
           t.status, t.exit_code,
           CASE WHEN t.output IS NOT NULL AND t.output != '' THEN 1 ELSE 0 END as has_output,
           CASE WHEN t.stderr IS NOT NULL AND t.stderr != '' THEN 1 ELSE 0 END as has_error
    FROM messages m
    LEFT JOIN tasks t ON m.task_id = t.id
    WHERE m.session_id = ? AND m.type = 'command'
    ORDER BY m.timestamp DESC
    LIMIT ?
  `;
  
  const stmt = db.prepare(sql);
  return stmt.all(sessionId, limit);
}

/**
 * Search messages
 */
function searchMessages(sessionId, query, options = {}) {
  return queryMessages(sessionId, {
    search: query,
    ...options
  });
}

/**
 * Get session statistics
 */
function getSessionStats(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_messages,
      SUM(CASE WHEN type = 'command' THEN 1 ELSE 0 END) as command_count,
      SUM(CASE WHEN type = 'output' THEN 1 ELSE 0 END) as output_count,
      SUM(CASE WHEN type = 'error' THEN 1 ELSE 0 END) as error_count,
      MIN(timestamp) as first_message,
      MAX(timestamp) as last_message
    FROM messages
    WHERE session_id = ?
  `).get(sessionId);
  
  return {
    session_id: sessionId,
    status: session.status,
    total_messages: stats.total_messages || 0,
    unread_count: session.unread_count,
    command_count: stats.command_count || 0,
    output_count: stats.output_count || 0,
    error_count: stats.error_count || 0,
    first_message: stats.first_message,
    last_message: stats.last_message,
    created_at: session.created_at,
    updated_at: session.updated_at
  };
}

/**
 * Clean up old messages (keep last N per session)
 */
function pruneMessages(sessionId, keepCount = 1000) {
  const countStmt = db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?');
  const count = countStmt.get(sessionId).count;
  
  if (count <= keepCount) {
    return { pruned: 0 };
  }
  
  const deleteStmt = db.prepare(`
    DELETE FROM messages 
    WHERE session_id = ? AND id NOT IN (
      SELECT id FROM messages 
      WHERE session_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    )
  `);
  
  const result = deleteStmt.run(sessionId, sessionId, keepCount);
  return { pruned: result.changes };
}

/**
 * Close database connection
 */
function close() {
  db.close();
}

export {
  // Session operations
  generateId,
  createSession,
  getSession,
  updateSessionStatus,
  updateSessionConfig,
  getSessionSummary,
  listSessions,
  deleteSession,
  isSessionOwnedByUser,
  
  // Task operations
  createTask,
  getTask,
  updateTask,
  listTasks,
  getTaskOutput,
  deleteTask,
  
  // Message operations
  addMessage,
  getMessage,
  getUnreadCount,
  getMessageCount,
  queryMessages,
  getUnreadMessages,
  getMessagesByTask,
  getMessages,
  markAsRead,
  getCommandHistory,
  searchMessages,
  getSessionStats,
  pruneMessages,
  
  // Database
  close
};