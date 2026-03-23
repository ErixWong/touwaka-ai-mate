/**
 * SSH Skill - JSON File Storage
 *
 * Provides persistent storage for sessions, tasks, and messages using JSON files.
 * Each session is stored in a separate file for easy management.
 *
 * Storage structure:
 * data/
 * ├── sessions.json           # Session index
 * └── sessions/
 *     ├── sess_xxx.json       # Main file (recent 50 command rounds, self-cycling)
 *     ├── sess_xxx.1.json     # Archive #1 (~100KB, full)
 *     ├── sess_xxx.2.json     # Archive #2 (~100KB, full)
 *     └── sess_xxx.3.json     # Archive #3 (current, being written)
 *
 * Archive strategy:
 * - Every write to main file also appends to archive file
 * - Main file self-cycles: keeps last 50 command rounds
 * - Archive file: appends all messages, creates new file when > 100KB
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use project directory for data storage
const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const SESSIONS_INDEX_PATH = path.join(DATA_DIR, 'sessions.json');

// Archive configuration
const ARCHIVE_CONFIG = {
  keepRecentCommands: 50,        // Keep this many recent command rounds in main file
  archiveMaxSize: 100 * 1024     // Max archive file size: 100KB
};

// Ensure directories exist
function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

// Initialize storage
ensureDirectories();

/**
 * Generate unique ID
 */
function generateId(prefix = 'sess') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Read JSON file safely
 */
function readJsonFile(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return defaultValue;
  }
}

/**
 * Write JSON file safely
 */
function writeJsonFile(filePath, data) {
  ensureDirectories();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Get session file path
 */
function getSessionFilePath(sessionId) {
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

/**
 * Get archive file path
 */
function getArchiveFilePath(sessionId, archiveNum) {
  return path.join(SESSIONS_DIR, `${sessionId}.${archiveNum}.json`);
}

/**
 * Load session data from file
 */
function loadSessionData(sessionId) {
  const filePath = getSessionFilePath(sessionId);
  return readJsonFile(filePath, null);
}

/**
 * Save session data to file
 */
function saveSessionData(sessionId, data) {
  const filePath = getSessionFilePath(sessionId);
  writeJsonFile(filePath, data);
}

/**
 * Load sessions index
 */
function loadSessionsIndex() {
  return readJsonFile(SESSIONS_INDEX_PATH, { sessions: [] });
}

/**
 * Save sessions index
 */
function saveSessionsIndex(index) {
  writeJsonFile(SESSIONS_INDEX_PATH, index);
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
  
  // Create a safe config without sensitive data for disk storage
  const safeConfig = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    private_key: config.private_key,
    passphrase: config.passphrase ? '***REDACTED***' : undefined
    // password is intentionally NOT saved to disk
  };
  
  const sessionData = {
    session: {
      id: sessionId,
      host: config.host,
      port: config.port || 22,
      username: config.username,
      status: 'connecting',
      config: safeConfig,
      user_id: userId,
      created_at: now,
      updated_at: now,
      last_read_at: null
    },
    tasks: [],
    messages: []
  };
  
  saveSessionData(sessionId, sessionData);
  
  // Update index
  const index = loadSessionsIndex();
  if (!index.sessions.includes(sessionId)) {
    index.sessions.unshift(sessionId); // Add to front
    saveSessionsIndex(index);
  }
  
  return getSession(sessionId);
}

/**
 * Get session by ID
 * Note: Does NOT return config (contains sensitive data like password)
 */
function getSession(sessionId) {
  const data = loadSessionData(sessionId);
  if (!data) return null;
  
  const session = data.session;
  const { config, ...safeSession } = session;  // Exclude config with sensitive data
  
  return {
    ...safeSession,
    unread_count: getUnreadCount(sessionId),
    message_count: data.messages.length
  };
}

/**
 * Update session status
 */
function updateSessionStatus(sessionId, status) {
  const data = loadSessionData(sessionId);
  if (!data) return null;
  
  data.session.status = status;
  data.session.updated_at = new Date().toISOString();
  saveSessionData(sessionId, data);
  
  return getSession(sessionId);
}

/**
 * Update session config
 */
function updateSessionConfig(sessionId, config) {
  const data = loadSessionData(sessionId);
  if (!data) return null;
  
  // Create safe config without password
  const safeConfig = {
    host: config.host,
    port: config.port || 22,
    username: config.username,
    private_key: config.private_key,
    passphrase: config.passphrase ? '***REDACTED***' : undefined
  };
  
  data.session.config = safeConfig;
  data.session.updated_at = new Date().toISOString();
  saveSessionData(sessionId, data);
  
  return getSession(sessionId);
}

/**
 * Update last read timestamp
 */
function updateLastRead(sessionId) {
  const data = loadSessionData(sessionId);
  if (!data) return;
  
  data.session.last_read_at = new Date().toISOString();
  data.session.updated_at = new Date().toISOString();
  saveSessionData(sessionId, data);
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
    user_id: session.user_id,
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
  const index = loadSessionsIndex();
  
  let sessions = index.sessions
    .map(sessionId => getSessionSummary(sessionId))
    .filter(s => s !== null);
  
  // Filter by user if specified
  if (userId) {
    sessions = sessions.filter(s => s.user_id === userId);
  }
  
  return sessions;
}

/**
 * Check if session belongs to user
 * @param {string} sessionId - Session ID
 * @param {string} userId - User ID
 * @returns {boolean} True if session belongs to user
 */
function isSessionOwnedByUser(sessionId, userId) {
  const data = loadSessionData(sessionId);
  if (!data) return false;
  
  const sessionUserId = data.session.user_id;
  
  // If session has no user_id, it's accessible by anyone (backward compatibility)
  // If session has user_id, it must match
  if (sessionUserId === null || sessionUserId === undefined) return true;
  return sessionUserId === userId;
}

/**
 * Escape special regex characters in a string
 * @param {string} str - String to escape
 * @returns {string} Escaped string safe for use in regex
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Delete session and its data (including all archives)
 */
function deleteSession(sessionId) {
  // Remove main data file
  const filePath = getSessionFilePath(sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  // Remove all archive files using readdir (handles gaps in numbering)
  const files = fs.readdirSync(SESSIONS_DIR);
  // Escape sessionId to prevent regex injection
  const escapedSessionId = escapeRegExp(sessionId);
  const archivePattern = new RegExp(`^${escapedSessionId}\\.(\\d+)\\.json$`);
  for (const file of files) {
    if (archivePattern.test(file)) {
      fs.unlinkSync(path.join(SESSIONS_DIR, file));
    }
  }
  
  // Update index
  const index = loadSessionsIndex();
  index.sessions = index.sessions.filter(id => id !== sessionId);
  saveSessionsIndex(index);
}

// ============================================
// Task Operations
// ============================================

/**
 * Create a new task
 */
function createTask(taskId, sessionId, command) {
  const data = loadSessionData(sessionId);
  if (!data) return null;
  
  const now = new Date().toISOString();
  const task = {
    id: taskId,
    session_id: sessionId,
    command: command,
    status: 'pending',
    output: '',
    stderr: '',
    exit_code: null,
    created_at: now,
    updated_at: now,
    completed_at: null
  };
  
  data.tasks.push(task);
  data.session.updated_at = now;
  saveSessionData(sessionId, data);
  
  return task;
}

/**
 * Get task by ID
 */
function getTask(taskId) {
  const index = loadSessionsIndex();
  
  for (const sessionId of index.sessions) {
    const data = loadSessionData(sessionId);
    if (data) {
      const task = data.tasks.find(t => t.id === taskId);
      if (task) return task;
    }
  }
  
  return null;
}

/**
 * Update task
 */
function updateTask(task) {
  const data = loadSessionData(task.session_id);
  if (!data) return null;
  
  const index = data.tasks.findIndex(t => t.id === task.id);
  if (index === -1) return null;
  
  task.updated_at = new Date().toISOString();
  data.tasks[index] = task;
  data.session.updated_at = task.updated_at;
  saveSessionData(task.session_id, data);
  
  return task;
}

/**
 * List tasks
 */
function listTasks(sessionId) {
  if (sessionId) {
    const data = loadSessionData(sessionId);
    if (!data) return [];
    
    return data.tasks.map(t => ({
      id: t.id,
      session_id: t.session_id,
      command: t.command,
      status: t.status,
      created_at: t.created_at,
      exit_code: t.exit_code
    }));
  } else {
    // List all tasks
    const index = loadSessionsIndex();
    let allTasks = [];
    
    for (const sid of index.sessions) {
      const data = loadSessionData(sid);
      if (data) {
        allTasks = allTasks.concat(data.tasks.map(t => ({
          id: t.id,
          session_id: t.session_id,
          command: t.command,
          status: t.status,
          created_at: t.created_at,
          exit_code: t.exit_code
        })));
      }
    }
    
    return allTasks.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
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
 * Delete task and its messages
 */
function deleteTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  
  const data = loadSessionData(task.session_id);
  if (!data) return;
  
  data.tasks = data.tasks.filter(t => t.id !== taskId);
  data.messages = data.messages.filter(m => m.task_id !== taskId);
  data.session.updated_at = new Date().toISOString();
  saveSessionData(task.session_id, data);
}

// ============================================
// Message Operations
// ============================================

/**
 * Get file size in bytes
 */
function getFileSize(filePath) {
  try {
    if (!fs.existsSync(filePath)) return 0;
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

/**
 * Get current archive number (find the latest archive file)
 */
function getCurrentArchiveNum(sessionId) {
  let num = 1;
  while (fs.existsSync(getArchiveFilePath(sessionId, num))) {
    num++;
  }
  return num > 1 ? num - 1 : 1;
}

/**
 * Append message to archive file
 * Creates new archive file when current one exceeds max size
 */
function appendToArchive(sessionId, message) {
  let archiveNum = getCurrentArchiveNum(sessionId);
  let archivePath = getArchiveFilePath(sessionId, archiveNum);
  
  // Check if current archive is full, create new one
  if (fs.existsSync(archivePath) && getFileSize(archivePath) > ARCHIVE_CONFIG.archiveMaxSize) {
    archiveNum++;
    archivePath = getArchiveFilePath(sessionId, archiveNum);
  }
  
  // Read existing archive or create new
  let archiveData;
  if (fs.existsSync(archivePath)) {
    archiveData = readJsonFile(archivePath, { messages: [] });
  } else {
    archiveData = {
      session_id: sessionId,
      archive_num: archiveNum,
      created_at: new Date().toISOString(),
      messages: []
    };
  }
  
  // Append message
  archiveData.messages.push(message);
  archiveData.message_count = archiveData.messages.length;
  archiveData.updated_at = new Date().toISOString();
  
  writeJsonFile(archivePath, archiveData);
}

/**
 * Prune old messages from main file (keep recent N command rounds)
 */
function pruneOldMessages(data) {
  const keepCount = ARCHIVE_CONFIG.keepRecentCommands;
  
  // Get all command messages sorted by time
  const commandMessages = data.messages
    .filter(m => m.type === 'command')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  if (commandMessages.length <= keepCount) {
    return data;
  }
  
  // Find cutoff timestamp (keep the last N commands)
  const cutoffIndex = commandMessages.length - keepCount - 1;
  const cutoffCommand = commandMessages[cutoffIndex];
  const cutoffTimestamp = cutoffCommand.timestamp;
  
  // Keep only messages after cutoff
  data.messages = data.messages.filter(m => m.timestamp > cutoffTimestamp);
  
  return data;
}

/**
 * Add a message
 */
function addMessage(sessionId, message) {
  const data = loadSessionData(sessionId);
  if (!data) return null;
  
  const msgId = generateId('msg');
  const timestamp = new Date().toISOString();
  
  const msg = {
    id: msgId,
    session_id: sessionId,
    task_id: message.task_id || null,
    timestamp: timestamp,
    type: message.type,
    content: message.content || '',
    stream: message.stream || null,
    read: false
  };
  
  // 1. Add to main file
  data.messages.push(msg);
  data.session.updated_at = timestamp;
  
  // 2. Prune old messages (self-cycling)
  const prunedData = pruneOldMessages(data);
  data.messages = prunedData.messages;
  
  // 3. Save main file
  saveSessionData(sessionId, data);
  
  // 4. Append to archive file
  appendToArchive(sessionId, msg);
  
  return getMessage(msgId);
}

/**
 * Get message by ID
 */
function getMessage(msgId) {
  const index = loadSessionsIndex();
  
  for (const sessionId of index.sessions) {
    const data = loadSessionData(sessionId);
    if (data) {
      const msg = data.messages.find(m => m.id === msgId);
      if (msg) return msg;
    }
  }
  
  return null;
}

/**
 * Get unread count for a session
 */
function getUnreadCount(sessionId) {
  const data = loadSessionData(sessionId);
  if (!data) return 0;
  
  return data.messages.filter(m => !m.read).length;
}

/**
 * Get message count for a session
 */
function getMessageCount(sessionId) {
  const data = loadSessionData(sessionId);
  if (!data) return 0;
  
  return data.messages.length;
}

/**
 * Query messages with filters
 */
function queryMessages(sessionId, options = {}) {
  const data = loadSessionData(sessionId);
  if (!data) return [];
  
  let messages = [...data.messages];
  
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
  
  // Apply filters
  if (since) {
    messages = messages.filter(m => m.timestamp > since);
  }
  
  if (until) {
    messages = messages.filter(m => m.timestamp < until);
  }
  
  if (type) {
    messages = messages.filter(m => m.type === type);
  }
  
  if (taskId) {
    messages = messages.filter(m => m.task_id === taskId);
  }
  
  if (unreadOnly) {
    messages = messages.filter(m => !m.read);
  }
  
  if (read !== undefined) {
    messages = messages.filter(m => m.read === read);
  }
  
  if (search) {
    const searchLower = search.toLowerCase();
    messages = messages.filter(m => 
      m.content && m.content.toLowerCase().includes(searchLower)
    );
  }
  
  // Sort
  messages.sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    return reverse ? timeA - timeB : timeB - timeA;
  });
  
  // Apply pagination
  if (offset) {
    messages = messages.slice(offset);
  }
  
  if (limit) {
    messages = messages.slice(0, limit);
  }
  
  return messages;
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
  // Need to search across all sessions
  const index = loadSessionsIndex();
  
  for (const sessionId of index.sessions) {
    const data = loadSessionData(sessionId);
    if (data) {
      const messages = data.messages.filter(m => m.task_id === taskId);
      if (messages.length > 0) {
        return messages;
      }
    }
  }
  
  return [];
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
  const data = loadSessionData(sessionId);
  if (!data) return { marked_count: 0, unread_count: 0 };
  
  const { messageIds, all = false, beforeTimestamp } = options;
  
  let markedCount = 0;
  
  // Validate messageIds array
  if (messageIds !== undefined && messageIds !== null) {
    if (!Array.isArray(messageIds)) {
      throw new Error('messageIds must be an array');
    }
    if (messageIds.length === 0) {
      return { marked_count: 0, unread_count: getUnreadCount(sessionId) };
    }
    
    // Mark specified messages as read
    data.messages.forEach(msg => {
      if (messageIds.includes(msg.id) && !msg.read) {
        msg.read = true;
        markedCount++;
      }
    });
  } else if (all) {
    // Mark all as read
    data.messages.forEach(msg => {
      if (!msg.read) {
        msg.read = true;
        markedCount++;
      }
    });
  } else if (beforeTimestamp) {
    // Mark messages before timestamp as read
    data.messages.forEach(msg => {
      if (msg.timestamp <= beforeTimestamp && !msg.read) {
        msg.read = true;
        markedCount++;
      }
    });
  }
  
  if (markedCount > 0) {
    data.session.updated_at = new Date().toISOString();
    saveSessionData(sessionId, data);
    updateLastRead(sessionId);
  }
  
  return {
    marked_count: markedCount,
    unread_count: getUnreadCount(sessionId)
  };
}

/**
 * Get command history
 */
function getCommandHistory(sessionId, limit = 50) {
  const data = loadSessionData(sessionId);
  if (!data) return [];
  
  const commands = data.messages
    .filter(m => m.type === 'command')
    .map(m => {
      const task = data.tasks.find(t => t.id === m.task_id);
      return {
        id: m.id,
        task_id: m.task_id,
        command: m.content,
        timestamp: m.timestamp,
        status: task ? task.status : null,
        exit_code: task ? task.exit_code : null,
        has_output: task && task.output && task.output.length > 0,
        has_error: task && task.stderr && task.stderr.length > 0
      };
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
  
  return commands;
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
  
  const data = loadSessionData(sessionId);
  if (!data) return null;
  
  const messages = data.messages;
  const timestamps = messages.map(m => m.timestamp).sort();
  
  return {
    session_id: sessionId,
    status: session.status,
    total_messages: messages.length,
    unread_count: session.unread_count,
    command_count: messages.filter(m => m.type === 'command').length,
    output_count: messages.filter(m => m.type === 'output').length,
    error_count: messages.filter(m => m.type === 'error').length,
    first_message: timestamps[0] || null,
    last_message: timestamps[timestamps.length - 1] || null,
    created_at: session.created_at,
    updated_at: session.updated_at
  };
}

/**
 * Clean up old messages (keep last N per session)
 */
function pruneMessages(sessionId, keepCount = 1000) {
  const data = loadSessionData(sessionId);
  if (!data) return { pruned: 0 };
  
  const count = data.messages.length;
  
  if (count <= keepCount) {
    return { pruned: 0 };
  }
  
  // Sort by timestamp and keep most recent
  data.messages.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  
  const removed = count - keepCount;
  data.messages = data.messages.slice(0, keepCount);
  data.session.updated_at = new Date().toISOString();
  saveSessionData(sessionId, data);
  
  return { pruned: removed };
}

// ============================================
// Archive Operations
// ============================================

/**
 * List archive files for a session
 */
function listArchives(sessionId) {
  const archives = [];
  const files = fs.readdirSync(SESSIONS_DIR);
  // Escape sessionId to prevent regex injection
  const escapedSessionId = escapeRegExp(sessionId);
  const archivePattern = new RegExp(`^${escapedSessionId}\\.(\\d+)\\.json$`);
  
  for (const file of files) {
    const match = file.match(archivePattern);
    if (!match) continue;
    
    const num = parseInt(match[1]);
    const filePath = path.join(SESSIONS_DIR, file);
    const stats = fs.statSync(filePath);
    let messageCount = 0;
    
    try {
      const archiveData = readJsonFile(filePath, { messages: [] });
      messageCount = archiveData.messages ? archiveData.messages.length : 0;
    } catch {
      // Ignore parse errors
    }
    
    archives.push({
      num,
      file,
      path: filePath,
      size: stats.size,
      messageCount,
      modified: stats.mtime
    });
  }
  
  // Sort by archive number
  return archives.sort((a, b) => a.num - b.num);
}

/**
 * Read archived messages from a specific archive number
 */
function readArchive(sessionId, archiveNum) {
  const archivePath = getArchiveFilePath(sessionId, archiveNum);
  
  if (!fs.existsSync(archivePath)) {
    return null;
  }
  
  try {
    return readJsonFile(archivePath, null);
  } catch {
    return null;
  }
}

/**
 * Search across all archives
 */
function searchArchives(sessionId, query, options = {}) {
  const results = [];
  const searchLower = query.toLowerCase();
  
  // Get all archive files using listArchives (handles gaps in numbering)
  const archives = listArchives(sessionId);
  
  for (const archive of archives) {
    const archiveData = readArchive(sessionId, archive.num);
    if (!archiveData || !archiveData.messages) {
      continue;
    }
    
    const matches = archiveData.messages
      .filter(m => m.content && m.content.toLowerCase().includes(searchLower))
      .map(m => ({
        ...m,
        archive_num: archive.num
      }));
    
    if (matches.length > 0) {
      results.push(...matches);
    }
    
    // Respect limit
    if (options.limit && results.length >= options.limit) {
      return results.slice(0, options.limit);
    }
  }
  
  return results;
}

/**
 * Get session info including archive status
 */
function getSessionInfo(sessionId) {
  const session = getSession(sessionId);
  if (!session) return null;
  
  const filePath = getSessionFilePath(sessionId);
  const fileSize = getFileSize(filePath);
  const archives = listArchives(sessionId);
  const totalArchiveSize = archives.reduce((sum, a) => sum + a.size, 0);
  const totalArchiveMessages = archives.reduce((sum, a) => sum + a.messageCount, 0);
  
  return {
    ...session,
    file_size: fileSize,
    file_size_formatted: formatBytes(fileSize),
    archive_count: archives.length,
    archive_size: totalArchiveSize,
    archive_size_formatted: formatBytes(totalArchiveSize),
    archive_messages: totalArchiveMessages,
    archives: archives.slice(0, 5) // Show last 5 archives
  };
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Close (no-op for JSON storage)
 */
function close() {
  // No connection to close for JSON files
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
  loadSessionData,
  
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
  
  // Archive operations
  listArchives,
  readArchive,
  searchArchives,
  getSessionInfo,
  ARCHIVE_CONFIG,
  
  // Database
  close
};