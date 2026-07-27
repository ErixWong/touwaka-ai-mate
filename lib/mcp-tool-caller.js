import jwt from 'jsonwebtoken';
import logger from './logger.js';

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_RESULT_PREVIEW_LENGTH = 500;
const MAX_RESULT_PREVIEW_ARRAY_ITEMS = 10;
const MAX_RESULT_PREVIEW_OBJECT_KEYS = 20;
const MAX_RESULT_PREVIEW_DEPTH = 4;

function truncateString(value, maxLength = MAX_RESULT_PREVIEW_LENGTH) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function looksLikeDataUrl(value) {
  return typeof value === 'string' && /^data:[^;]+;base64,/i.test(value);
}

function looksLikeLargeBase64(value) {
  return typeof value === 'string' && value.length > 1024 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function summarizeForLog(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;

  if (typeof value === 'string') {
    if (looksLikeDataUrl(value)) return `[data-url omitted length=${value.length}]`;
    if (looksLikeLargeBase64(value)) return `[base64 omitted length=${value.length}]`;
    return truncateString(value);
  }

  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';

  if (depth >= MAX_RESULT_PREVIEW_DEPTH) {
    if (Array.isArray(value)) return `[array(${value.length}) truncated]`;
    return '[object truncated]';
  }

  seen.add(value);

  if (Buffer.isBuffer(value)) {
    return `[buffer length=${value.length}]`;
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_RESULT_PREVIEW_ARRAY_ITEMS)
      .map(item => summarizeForLog(item, depth + 1, seen));
    if (value.length > MAX_RESULT_PREVIEW_ARRAY_ITEMS) {
      items.push(`[+${value.length - MAX_RESULT_PREVIEW_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  const summary = {};
  const keys = Object.keys(value);
  for (const key of keys.slice(0, MAX_RESULT_PREVIEW_OBJECT_KEYS)) {
    summary[key] = summarizeForLog(value[key], depth + 1, seen);
  }
  if (keys.length > MAX_RESULT_PREVIEW_OBJECT_KEYS) {
    summary.__truncated_keys__ = keys.length - MAX_RESULT_PREVIEW_OBJECT_KEYS;
  }
  return summary;
}

function summarizeResult(result) {
  if (result == null) return result;

  try {
    return truncateString(JSON.stringify(summarizeForLog(result)));
  } catch (error) {
    return `[unserializable result: ${error.message}]`;
  }
}

/**
 * Platform-level MCP tool caller.
 *
 * This keeps MCP invocation independent from AppClock so internal platform jobs
 * such as the document pipeline can call MCP tools without depending on the app
 * tick runtime.
 */
class McpToolCaller {
  constructor(db, options = {}) {
    this.db = db;
    this.residentSkillManager = options.residentSkillManager || null;
  }

  setResidentSkillManager(residentSkillManager) {
    this.residentSkillManager = residentSkillManager || null;
  }

  async generateAdminToken() {
    const User = this.db.getModel('user');
    const UserRole = this.db.getModel('user_role');
    const Role = this.db.getModel('role');

    const adminRole = await Role.findOne({
      where: { mark: 'admin' },
      raw: true,
    });

    if (!adminRole) {
      throw new Error('Admin role not found');
    }

    const adminUserRole = await UserRole.findOne({
      where: { role_id: adminRole.id },
      raw: true,
    });

    if (!adminUserRole) {
      throw new Error('No admin user found');
    }

    const adminUser = await User.findOne({
      where: { id: adminUserRole.user_id, status: 'active' },
      raw: true,
    });

    if (!adminUser) {
      throw new Error('Admin user not found or inactive');
    }

    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
    return jwt.sign(
      {
        id: adminUser.id,
        userId: adminUser.id,
        role: 'admin',
        roles: ['admin'],
        isAdmin: true,
      },
      jwtSecret,
      { expiresIn: '1h' },
    );
  }

  async callMcp(server, tool, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return await this.callTool(server, tool, params, timeoutMs);
  }

  async callTool(server, tool, params, timeoutMs = DEFAULT_TIMEOUT_MS) {
    logger.info(`[McpToolCaller] callTool: ${server}.${tool}`);
    logger.debug(`[McpToolCaller] params keys: ${Object.keys(params || {}).join(', ')}`);

    if (!this.residentSkillManager) {
      throw new Error(`MCP service "${server}" not available: residentSkillManager not configured`);
    }

    const adminToken = await this.generateAdminToken();
    const invokeParams = {
      action: 'call_tool',
      server_name: server,
      tool_name: tool,
      arguments: params,
    };

    try {
      const result = await this.residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        invokeParams,
        {
          accessToken: adminToken,
          isAdmin: true,
        },
        timeoutMs,
      );

      logger.info(`[McpToolCaller] result type: ${typeof result}`);
      logger.debug('[McpToolCaller] result preview:', summarizeResult(result));
      return result;
    } catch (error) {
      logger.error(`[McpToolCaller] failed: ${server}.${tool} - ${error.message}`);
      logger.error(`[McpToolCaller] error stack: ${error.stack}`);
      throw error;
    }
  }
}

export { McpToolCaller };
export default McpToolCaller;
