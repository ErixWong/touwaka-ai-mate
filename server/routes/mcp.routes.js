/**
 * MCP Routes - MCP 服务管理 API 路由
 *
 * 提供前端管理界面所需的 API
 *
 * API 设计：
 * - GET /api/mcp/servers - 获取 MCP Server 列表
 * - GET /api/mcp/servers/:id - 获取单个 MCP Server 详情
 * - GET /api/mcp/servers/:id/tools - 获取 MCP Server 工具列表
 * - POST /api/mcp/servers - 创建 MCP Server（管理员）
 * - PUT /api/mcp/servers/:id - 更新 MCP Server（管理员）
 * - DELETE /api/mcp/servers/:id - 删除 MCP Server（管理员）
 * - POST /api/mcp/servers/:id/test - 测试 MCP Server 连接
 * - POST /api/mcp/servers/:id/connect - 连接 MCP Server
 * - POST /api/mcp/servers/:id/disconnect - 断开 MCP Server
 *
 * - GET /api/mcp/credentials - 获取用户凭证列表
 * - POST /api/mcp/credentials - 配置用户凭证
 * - PUT /api/mcp/credentials/:id - 更新用户凭证
 * - DELETE /api/mcp/credentials/:id - 删除用户凭证
 *
 * - GET /api/mcp/default-credentials - 获取系统默认凭证列表（管理员）
 * - POST /api/mcp/default-credentials - 配置系统默认凭证（管理员）
 * - PUT /api/mcp/default-credentials/:id - 更新系统默认凭证（管理员）
 * - DELETE /api/mcp/default-credentials/:id - 删除系统默认凭证（管理员）
 *
 * Issue #601: MCP Client 驻留技能实现
 */

import Router from '@koa/router';
import logger from '../../lib/logger.js';
import Utils from '../../lib/utils.js';

/**
 * 创建 MCP 路由
 * @param {Object} db - 数据库实例
 * @param {Object} authMiddleware - 认证中间件
 * @param {Object} residentSkillManager - 驻留技能管理器
 * @returns {Router}
 */
export default function createMcpRoutes(db, authMiddleware, residentSkillManager) {
  const router = new Router({
    prefix: '/api/mcp'
  });

  // 获取模型
  const MCPServer = db.getModel('mcp_server');
  const MCPCredential = db.getModel('mcp_credential');
  const MCPUserCredential = db.getModel('mcp_user_credential');
  const MCPToolsCache = db.getModel('mcp_tools_cache');

  // 认证中间件
  const requireAuth = authMiddleware.authenticate();
  const requireAdmin = authMiddleware.requireAdmin();

  // ============== MCP Server 管理 ==============

  /**
   * 获取 MCP Server 列表
   * GET /api/mcp/servers
   */
  router.get('/servers', requireAuth, async (ctx) => {
    try {
      const userId = ctx.state.session.id;

      // 获取所有启用的 MCP Server
      const servers = await MCPServer.findAll({
        where: { is_enabled: true },
        raw: true,
      });

      // 获取用户凭证状态
      const userCredentials = await MCPUserCredential.findAll({
        where: { user_id: userId, is_enabled: true },
        raw: true,
      });

      // 获取系统默认凭证状态
      const defaultCredentials = await MCPCredential.findAll({
        where: { is_enabled: true },
        raw: true,
      });

      // 组装结果
      const result = servers.map(server => {
        const hasUserCredential = userCredentials.some(c => c.mcp_server_id === server.id);
        const hasDefaultCredential = defaultCredentials.some(c => c.mcp_server_id === server.id);

        return {
          id: server.id,
          name: server.name,
          display_name: server.display_name,
          description: server.description,
          transport_type: server.transport_type,
          command: server.command,
          args: server.args,
          env_template: server.env_template,
          url: server.url,
          headers: server.headers,
          icon: server.icon,
          category: server.category,
          is_public: server.is_public,
          is_enabled: server.is_enabled,
          requires_credentials: server.requires_credentials,
          credential_fields: server.credential_fields,
          // 凭证状态
          has_credential: hasUserCredential || hasDefaultCredential,
          credential_source: hasUserCredential ? 'user' : (hasDefaultCredential ? 'default' : null),
        };
      });

      ctx.success({ servers: result });

    } catch (error) {
      logger.error('Get MCP servers error:', error);
      ctx.error(error.message || '获取 MCP Server 列表失败', 500);
    }
  });

  /**
   * 获取单个 MCP Server 详情
   * GET /api/mcp/servers/:id
   */
  router.get('/servers/:id', requireAuth, async (ctx) => {
    try {
      const { id } = ctx.params;

      const server = await MCPServer.findOne({
        where: { id },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在');
        return;
      }

      ctx.success({ server });

    } catch (error) {
      logger.error('Get MCP server error:', error);
      ctx.error(error.message || '获取 MCP Server 详情失败', 500);
    }
  });

  /**
   * 获取 MCP Server 工具列表
   * GET /api/mcp/servers/:id/tools
   */
  router.get('/servers/:id/tools', requireAuth, async (ctx) => {
    try {
      const { id } = ctx.params;

      // 从缓存获取工具列表
      const tools = await MCPToolsCache.findAll({
        where: { mcp_server_id: id },
        raw: true,
      });

      ctx.success({
        tools: tools.map(t => ({
          id: t.id,
          name: t.tool_name,
          description: t.description,
          input_schema: t.input_schema,
          cached_at: t.cached_at,
        }))
      });

    } catch (error) {
      logger.error('Get MCP server tools error:', error);
      ctx.error(error.message || '获取 MCP Server 工具列表失败', 500);
    }
  });

  /**
   * 刷新 MCP Server 工具列表
   * POST /api/mcp/servers/:id/refresh-tools
   */
  router.post('/servers/:id/refresh-tools', requireAuth, async (ctx) => {
    try {
      const { id } = ctx.params;

      const server = await MCPServer.findOne({
        where: { id, is_enabled: true },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在或未启用');
        return;
      }

      const residentService = ctx.appContext?.services?.residentProcess;
      if (!residentService) {
        ctx.error('驻留进程服务不可用', 500);
        return;
      }

      const result = await residentService.invoke('mcp-client', {
        action: 'refresh_tools',
        server_name: server.name,
      });

      if (result && result.tools) {
        for (const tool of result.tools) {
          await MCPToolsCache.upsert({
            id: Utils.newID(16),
            mcp_server_id: id,
            tool_name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema ? JSON.stringify(tool.inputSchema) : null,
            cached_at: new Date(),
          });
        }

        const tools = await MCPToolsCache.findAll({
          where: { mcp_server_id: id },
          raw: true,
        });

        ctx.success({
          tools: tools.map(t => ({
            id: t.id,
            name: t.tool_name,
            description: t.description,
            input_schema: t.input_schema,
            cached_at: t.cached_at,
          })),
          message: `已刷新 ${tools.length} 个工具`,
        });
      } else {
        ctx.success({ tools: [], message: '未获取到工具，请检查 MCP 服务器连接' });
      }

    } catch (error) {
      logger.error('Refresh MCP tools error:', error);
      ctx.error(error.message || '刷新工具列表失败', 500);
    }
  });

  /**
   * 创建 MCP Server（管理员）
   * POST /api/mcp/servers
   */
  router.post('/servers', requireAuth, requireAdmin, async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const {
        name,
        display_name,
        description,
        transport_type = 'stdio',
        command,
        args,
        env_template,
        url,
        headers,
        is_public,
        requires_credentials,
        credential_fields,
        icon,
        category,
      } = ctx.request.body;

      // 验证必要字段
      if (!name) {
        ctx.error('缺少必要字段：name');
        return;
      }

      // 根据传输类型验证对应字段
      if (transport_type === 'stdio') {
        if (!command) {
          ctx.error('STDIO 模式缺少必要字段：command');
          return;
        }
      } else if (transport_type === 'http') {
        if (!url) {
          ctx.error('HTTP 模式缺少必要字段：url');
          return;
        }
      }

      // 检查名称是否已存在
      const existing = await MCPServer.findOne({
        where: { name },
        raw: true,
      });

      if (existing) {
        ctx.status = 400;
        ctx.error(`MCP Server 名称 "${name}" 已存在`);
        return;
      }

      // 创建 MCP Server
      const serverId = Utils.newID(16);
      await MCPServer.create({
        id: serverId,
        name,
        display_name,
        description,
        transport_type,
        command: command || '',
        args: args || null,
        env_template: env_template || null,
        url: url || null,
        headers: headers || null,
        is_public: is_public || false,
        is_enabled: true,
        requires_credentials: requires_credentials || false,
        credential_fields: credential_fields || null,
        icon,
        category,
        created_by: userId,
      });

      logger.info(`MCP Server created: ${name} (transport_type: ${transport_type}) by ${userId}`);

      ctx.success({
        message: 'MCP Server 创建成功',
        server_id: serverId,
      });

    } catch (error) {
      logger.error('Create MCP server error:', error);
      ctx.error(error.message || '创建 MCP Server 失败', 500);
    }
  });

  /**
   * 更新 MCP Server（管理员）
   * PUT /api/mcp/servers/:id
   */
  router.put('/servers/:id', requireAuth, requireAdmin, async (ctx) => {
    try {
      const { id } = ctx.params;
      const updateData = ctx.request.body;

      // 检查是否存在
      const server = await MCPServer.findOne({ where: { id } });
      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在');
        return;
      }

      // 更新字段
      const allowedFields = [
        'display_name', 'description', 'transport_type', 'command', 'args', 'env_template',
        'url', 'headers', 'is_public', 'is_enabled', 'requires_credentials', 'credential_fields',
        'icon', 'category'
      ];

      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          server[field] = updateData[field];
        }
      }

      await server.save();

      logger.info(`MCP Server updated: ${id}`);

      ctx.success({ message: 'MCP Server 更新成功' });

    } catch (error) {
      logger.error('Update MCP server error:', error);
      ctx.error(error.message || '更新 MCP Server 失败', 500);
    }
  });

  /**
   * 删除 MCP Server（管理员）
   * DELETE /api/mcp/servers/:id
   */
  router.delete('/servers/:id', requireAuth, requireAdmin, async (ctx) => {
    try {
      const { id } = ctx.params;

      // 检查是否存在
      const server = await MCPServer.findOne({ where: { id } });
      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在');
        return;
      }

      // 删除（级联删除凭证和缓存）
      await server.destroy();

      logger.info(`MCP Server deleted: ${id}`);

      ctx.success({ message: 'MCP Server 删除成功' });

    } catch (error) {
      logger.error('Delete MCP server error:', error);
      ctx.error(error.message || '删除 MCP Server 失败', 500);
    }
  });

  /**
   * 测试 MCP Server 连接
   * POST /api/mcp/servers/:id/test
   */
  router.post('/servers/:id/test', requireAuth, async (ctx) => {
    try {
      const { id } = ctx.params;
      const userId = ctx.state.session.id;
      const accessToken = ctx.state.token;

      // 获取 MCP Server 配置
      const server = await MCPServer.findOne({
        where: { id, is_enabled: true },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在或未启用');
        return;
      }

      // 调用驻留进程测试连接
      const result = await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        {
          action: 'connect_server',
          server_name: server.name,
        },
        {
          userId,
          accessToken,
        },
        30000 // 30秒超时
      );

      ctx.success({
        message: '连接测试成功',
        server_name: server.name,
        result,
      });

    } catch (error) {
      logger.error('Test MCP server error:', error);
      ctx.error(error.message || '连接测试失败', 500);
    }
  });

  /**
   * 连接 MCP Server
   * POST /api/mcp/servers/:id/connect
   */
  router.post('/servers/:id/connect', requireAuth, async (ctx) => {
    try {
      const { id } = ctx.params;
      const userId = ctx.state.session.id;
      const accessToken = ctx.state.token;

      // 获取 MCP Server 配置
      const server = await MCPServer.findOne({
        where: { id, is_enabled: true },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在或未启用');
        return;
      }

      // 调用驻留进程连接
      const result = await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        {
          action: 'connect_server',
          server_name: server.name,
        },
        {
          userId,
          accessToken,
        },
        30000
      );

      ctx.success({
        message: '连接成功',
        server_name: server.name,
      });

    } catch (error) {
      logger.error('Connect MCP server error:', error);
      ctx.error(error.message || '连接失败', 500);
    }
  });

  /**
   * 断开 MCP Server
   * POST /api/mcp/servers/:id/disconnect
   */
  router.post('/servers/:id/disconnect', requireAuth, async (ctx) => {
    try {
      const { id } = ctx.params;
      const userId = ctx.state.session.id;
      const accessToken = ctx.state.token;

      // 获取 MCP Server 配置
      const server = await MCPServer.findOne({
        where: { id },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在');
        return;
      }

      // 调用驻留进程断开
      const result = await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        {
          action: 'disconnect_server',
          server_name: server.name,
        },
        {
          userId,
          accessToken,
        },
        10000
      );

      ctx.success({
        message: '已断开连接',
        server_name: server.name,
      });

    } catch (error) {
      logger.error('Disconnect MCP server error:', error);
      ctx.error(error.message || '断开连接失败', 500);
    }
  });

  // ============== 用户凭证管理 ==============

  /**
   * 获取用户凭证列表
   * GET /api/mcp/credentials
   */
  router.get('/credentials', requireAuth, async (ctx) => {
    try {
      const userId = ctx.state.session.id;

      const credentials = await MCPUserCredential.findAll({
        where: { user_id: userId },
        raw: true,
      });

      const serverIds = credentials.map(c => c.mcp_server_id);
      const servers = await MCPServer.findAll({
        where: { id: serverIds },
        raw: true,
      });

      const serverMap = new Map(servers.map(s => [s.id, s]));

      const result = credentials.map(c => {
        const server = serverMap.get(c.mcp_server_id);
        return {
          id: c.id,
          mcp_server_id: c.mcp_server_id,
          server_name: server?.name,
          server_display_name: server?.display_name,
          is_enabled: c.is_enabled,
          created_at: c.created_at,
          updated_at: c.updated_at,
        };
      });

      ctx.success({ credentials: result });

    } catch (error) {
      logger.error('Get MCP credentials error:', error);
      ctx.error(error.message || '获取用户凭证列表失败', 500);
    }
  });

  /**
   * 获取当前用户对特定 Server 的凭证
   * GET /api/mcp/credentials/:serverId
   */
  router.get('/credentials/:serverId', requireAuth, async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const { serverId } = ctx.params;

      const credential = await MCPUserCredential.findOne({
        where: { user_id: userId, mcp_server_id: serverId },
        raw: true,
      });

      ctx.success(credential || null);

    } catch (error) {
      logger.error('Get MCP user credential error:', error);
      ctx.error(error.message || '获取用户凭证失败', 500);
    }
  });

  /**
   * 设置当前用户对特定 Server 的凭证
   * POST /api/mcp/credentials/:serverId
   */
  router.post('/credentials/:serverId', requireAuth, async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const { serverId } = ctx.params;
      const { env_overrides } = ctx.request.body;

      const server = await MCPServer.findOne({
        where: { id: serverId, is_enabled: true },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在或未启用');
        return;
      }

      let existing = await MCPUserCredential.findOne({
        where: { user_id: userId, mcp_server_id: serverId },
      });

      if (existing) {
        existing.credentials = { env_overrides };
        existing.is_enabled = true;
        await existing.save();
        logger.info(`MCP user credential updated: user=${userId}, server=${serverId}`);
        ctx.success(existing);
      } else {
        const credentialId = Utils.newID(16);
        const created = await MCPUserCredential.create({
          id: credentialId,
          user_id: userId,
          mcp_server_id: serverId,
          credentials: { env_overrides },
          is_enabled: true,
        });
        logger.info(`MCP user credential created: user=${userId}, server=${serverId}`);
        ctx.success(created);
      }

    } catch (error) {
      logger.error('Set MCP user credential error:', error);
      ctx.error(error.message || '设置用户凭证失败', 500);
    }
  });

  /**
   * 删除当前用户对特定 Server 的凭证
   * DELETE /api/mcp/credentials/:serverId
   */
  router.delete('/credentials/:serverId', requireAuth, async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const { serverId } = ctx.params;

      const credential = await MCPUserCredential.findOne({
        where: { user_id: userId, mcp_server_id: serverId },
      });

      if (!credential) {
        ctx.status = 404;
        ctx.error('凭证不存在');
        return;
      }

      await credential.destroy();
      logger.info(`MCP user credential deleted: user=${userId}, server=${serverId}`);
      ctx.success({ message: '凭证已删除' });

    } catch (error) {
      logger.error('Delete MCP user credential error:', error);
      ctx.error(error.message || '删除用户凭证失败', 500);
    }
  });

  // ============== 系统默认凭证管理（管理员） ==============

  /**
   * 获取系统默认凭证列表（管理员）
   * GET /api/mcp/default-credentials
   */
  router.get('/default-credentials', requireAuth, requireAdmin, async (ctx) => {
    try {
      const credentials = await MCPCredential.findAll({
        raw: true,
      });

      // 获取关联的 MCP Server 信息
      const serverIds = credentials.map(c => c.mcp_server_id);
      const servers = await MCPServer.findAll({
        where: { id: serverIds },
        raw: true,
      });

      const serverMap = new Map(servers.map(s => [s.id, s]));

      const result = credentials.map(c => {
        const server = serverMap.get(c.mcp_server_id);
        return {
          id: c.id,
          mcp_server_id: c.mcp_server_id,
          server_name: server?.name,
          server_display_name: server?.display_name,
          is_enabled: c.is_enabled,
          created_by: c.created_by,
          created_at: c.created_at,
          updated_at: c.updated_at,
          // 不返回凭证内容
        };
      });

      ctx.success({ credentials: result });

    } catch (error) {
      logger.error('Get MCP default credentials error:', error);
      ctx.error(error.message || '获取系统默认凭证列表失败', 500);
    }
  });

  /**
   * 配置系统默认凭证（管理员）
   * POST /api/mcp/default-credentials
   */
  router.post('/default-credentials', requireAuth, requireAdmin, async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const { mcp_server_id, credentials } = ctx.request.body;

      if (!mcp_server_id || !credentials) {
        ctx.error('缺少必要字段：mcp_server_id, credentials');
        return;
      }

      // 检查 MCP Server 是否存在
      const server = await MCPServer.findOne({
        where: { id: mcp_server_id, is_enabled: true },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在或未启用');
        return;
      }

      // 检查是否已存在凭证
      let existing = await MCPCredential.findOne({
        where: { mcp_server_id },
      });

      if (existing) {
        // 更新
        existing.credentials = credentials;
        existing.is_enabled = true;
        await existing.save();
        logger.info(`MCP default credential updated: server=${mcp_server_id}, by=${userId}`);
      } else {
        // 创建
        const credentialId = Utils.newID(16);
        await MCPCredential.create({
          id: credentialId,
          mcp_server_id,
          credentials,
          is_enabled: true,
          created_by: userId,
        });
        logger.info(`MCP default credential created: server=${mcp_server_id}, by=${userId}`);
      }

      ctx.success({ message: '系统默认凭证配置成功' });

    } catch (error) {
      logger.error('Create MCP default credential error:', error);
      ctx.error(error.message || '配置系统默认凭证失败', 500);
    }
  });

  /**
   * 获取特定 Server 的系统默认凭证（管理员）
   * GET /api/mcp/default-credentials/:serverId
   */
  router.get('/default-credentials/:serverId', requireAuth, requireAdmin, async (ctx) => {
    try {
      const { serverId } = ctx.params;

      const credential = await MCPCredential.findOne({
        where: { mcp_server_id: serverId },
        raw: true,
      });

      ctx.success(credential || null);

    } catch (error) {
      logger.error('Get MCP default credential error:', error);
      ctx.error(error.message || '获取系统默认凭证失败', 500);
    }
  });

  /**
   * 设置特定 Server 的系统默认凭证（管理员）
   * POST /api/mcp/default-credentials/:serverId
   */
  router.post('/default-credentials/:serverId', requireAuth, requireAdmin, async (ctx) => {
    try {
      const userId = ctx.state.session.id;
      const { serverId } = ctx.params;
      const { env_overrides } = ctx.request.body;

      const server = await MCPServer.findOne({
        where: { id: serverId, is_enabled: true },
        raw: true,
      });

      if (!server) {
        ctx.status = 404;
        ctx.error('MCP Server 不存在或未启用');
        return;
      }

      let existing = await MCPCredential.findOne({
        where: { mcp_server_id: serverId },
      });

      if (existing) {
        existing.credentials = { env_overrides };
        existing.is_enabled = true;
        await existing.save();
        logger.info(`MCP default credential updated: server=${serverId}, by=${userId}`);
        ctx.success(existing);
      } else {
        const credentialId = Utils.newID(16);
        const created = await MCPCredential.create({
          id: credentialId,
          mcp_server_id: serverId,
          credentials: { env_overrides },
          is_enabled: true,
          created_by: userId,
        });
        logger.info(`MCP default credential created: server=${serverId}, by=${userId}`);
        ctx.success(created);
      }

    } catch (error) {
      logger.error('Set MCP default credential error:', error);
      ctx.error(error.message || '设置系统默认凭证失败', 500);
    }
  });

  /**
   * 删除特定 Server 的系统默认凭证（管理员）
   * DELETE /api/mcp/default-credentials/:serverId
   */
  router.delete('/default-credentials/:serverId', requireAuth, requireAdmin, async (ctx) => {
    try {
      const { serverId } = ctx.params;

      const credential = await MCPCredential.findOne({
        where: { mcp_server_id: serverId },
      });

      if (!credential) {
        ctx.status = 404;
        ctx.error('凭证不存在');
        return;
      }

      await credential.destroy();
      logger.info(`MCP default credential deleted: server=${serverId}`);
      ctx.success({ message: '系统默认凭证已删除' });

    } catch (error) {
      logger.error('Delete MCP default credential error:', error);
      ctx.error(error.message || '删除系统默认凭证失败', 500);
    }
  });

  return router;
}