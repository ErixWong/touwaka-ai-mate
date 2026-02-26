/**
 * Touwaka Mate API Server (Koa 版)
 * RESTful API 服务器，支持前端调用
 */

import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import Database from '../lib/db.js';
import ChatService from '../lib/chat-service.js';
import logger from '../lib/logger.js';

// 中间件
import { responseMiddleware } from './middlewares/index.js';

// 控制器
import AuthController from './controllers/auth.controller.js';
import UserController from './controllers/user.controller.js';
import TopicController from './controllers/topic.controller.js';
import MessageController from './controllers/message.controller.js';
import ExpertController from './controllers/expert.controller.js';
import ModelController from './controllers/model.controller.js';
import StreamController from './controllers/stream.controller.js';
import SkillController from './controllers/skill.controller.js';
import DebugController from './controllers/debug.controller.js';
import RoleController from './controllers/role.controller.js';

// 路由
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import topicRoutes from './routes/topic.routes.js';
import messageRoutes from './routes/message.routes.js';
import expertRoutes from './routes/expert.routes.js';
import modelRoutes from './routes/model.routes.js';
import streamRoutes from './routes/stream.routes.js';
import providerRoutes from './routes/provider.routes.js';
import chatRoutes from './routes/chat.routes.js';
import skillRoutes from './routes/skill.routes.js';
import debugRoutes from './routes/debug.routes.js';
import roleRoutes from './routes/role.routes.js';

class ApiServer {
  constructor() {
    this.app = new Koa();
    this.db = null;
    this.chatService = null;
    this.controllers = {};
  }

  /**
   * 检查关键表是否存在
   */
  async checkTablesExist() {
    try {
      const result = await this.db.query(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'experts'"
      );
      // Sequelize query 返回的是数组，直接取第一行
      const count = result[0]?.count || result?.count || 0;
      return count > 0;
    } catch (error) {
      logger.error('Failed to check tables existence:', error.message);
      return false;
    }
  }

  /**
   * 初始化数据库
   */
  async initializeDatabase() {
    const dbConfig = this.loadDatabaseConfig();
    this.db = new Database(dbConfig);
    await this.db.connect();

    // 检查表是否存在，不存在则运行初始化脚本
    const tablesExist = await this.checkTablesExist();
    if (!tablesExist) {
      logger.info('Database tables not found, running init script...');
      const initScriptPath = path.join(__dirname, '..', 'scripts', 'init-database.js');
      try {
        execSync(`node "${initScriptPath}"`, { stdio: 'inherit' });
        logger.info('Database initialized successfully');
      } catch (error) {
        logger.error('Failed to initialize database:', error.message);
        throw error;
      }
    } else {
      logger.info('Database tables already exist, skipping initialization');
    }

    // 初始化 ChatService
    this.chatService = new ChatService(this.db);
    logger.info('ChatService initialized');
  }

  /**
   * 初始化控制器
   */
  initializeControllers() {
    this.controllers = {
      auth: new AuthController(this.db),
      user: new UserController(this.db),
      topic: new TopicController(this.db),
      message: new MessageController(this.db),
      expert: new ExpertController(this.db, this.chatService),
      model: new ModelController(this.db),
      stream: new StreamController(this.db, this.chatService),
      skill: new SkillController(this.db),
      debug: new DebugController(this.db, this.chatService),
    };
  }

  /**
   * 设置中间件
   */
  setupMiddlewares() {
    // CORS 配置
    this.app.use(cors({
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      credentials: true,
    }));

    // 请求日志
    this.app.use(async (ctx, next) => {
      logger.info(`${ctx.method} ${ctx.path} - ${ctx.ip}`);
      await next();
    });

    // 错误处理
    this.app.use(async (ctx, next) => {
      try {
        await next();
      } catch (err) {
        logger.error('Server error:', err.message);
        ctx.status = err.status || 500;
        ctx.body = {
          code: ctx.status,
          message: err.message || '服务器内部错误',
          data: null,
          timestamp: Date.now(),
        };
      }
    });

    // Body 解析
    this.app.use(bodyParser());

    // 统一响应格式
    this.app.use(responseMiddleware());
  }

  /**
   * 设置路由
   */
  setupRoutes() {
    // 健康检查
    this.app.use(async (ctx, next) => {
      if (ctx.path === '/api/health') {
        ctx.success({ status: 'ok', version: '2.0.0-koa' });
        return;
      }
      await next();
    });

    // 注册路由
    this.app.use(authRoutes(this.controllers.auth).routes());
    this.app.use(authRoutes(this.controllers.auth).allowedMethods());
    
    this.app.use(userRoutes(this.controllers.user).routes());
    this.app.use(userRoutes(this.controllers.user).allowedMethods());
    
    this.app.use(topicRoutes(this.controllers.topic, this.controllers.message).routes());
    this.app.use(topicRoutes(this.controllers.topic, this.controllers.message).allowedMethods());
    
    this.app.use(messageRoutes(this.controllers.message).routes());
    this.app.use(messageRoutes(this.controllers.message).allowedMethods());
    
    this.app.use(expertRoutes(this.controllers.expert).routes());
    this.app.use(expertRoutes(this.controllers.expert).allowedMethods());
    
    this.app.use(modelRoutes(this.controllers.model).routes());
    this.app.use(modelRoutes(this.controllers.model).allowedMethods());
    
    this.app.use(streamRoutes(this.controllers.stream).routes());
    this.app.use(streamRoutes(this.controllers.stream).allowedMethods());
    
    // Chat 路由（前端兼容）
    this.app.use(chatRoutes(this.controllers.stream).routes());
    this.app.use(chatRoutes(this.controllers.stream).allowedMethods());
    
    // Provider 路由（需要数据库实例）
    try {
      const providerRouter = providerRoutes(this.db);
      this.app.use(providerRouter.routes());
      this.app.use(providerRouter.allowedMethods());
      logger.info('Provider routes registered successfully');
    } catch (err) {
      logger.error('Failed to register provider routes:', err.message);
    }

    // Skill 路由
    this.app.use(skillRoutes(this.controllers.skill).routes());
    this.app.use(skillRoutes(this.controllers.skill).allowedMethods());

    // Debug 路由
    this.app.use(debugRoutes(this.controllers.debug).routes());
    this.app.use(debugRoutes(this.controllers.debug).allowedMethods());

    // Role 路由
    this.app.use(roleRoutes(RoleController).routes());
    this.app.use(roleRoutes(RoleController).allowedMethods());

    // 404 处理
    this.app.use(async (ctx) => {
      ctx.status = 404;
      ctx.body = {
        code: 404,
        message: '接口不存在',
        data: null,
        timestamp: Date.now(),
      };
    });
  }

  /**
   * 读取数据库配置
   * 从 config/database.json 读取配置模板，然后解析环境变量占位符
   * 配置文件使用环境变量占位符（如 ${DB_HOST}），实际值从环境变量读取
   */
  loadDatabaseConfig() {
    const configPath = path.join(__dirname, '..', 'config', 'database.json');

    if (!fs.existsSync(configPath)) {
      throw new Error(
        `数据库配置文件不存在: ${configPath}\n` +
        `请创建该文件并配置数据库连接信息（使用环境变量占位符，如 \${DB_HOST}）`
      );
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);

    // 解析环境变量占位符，实际值从环境变量读取
    return this.resolveEnvVars(config);
  }

  /**
   * 解析环境变量占位符
   */
  resolveEnvVars(obj) {
    if (typeof obj === 'string') {
      return obj.replace(/\$\{(\w+)\}/g, (match, varName) => {
        return process.env[varName] || match;
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveEnvVars(item));
    }

    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.resolveEnvVars(value);
      }
      return result;
    }

    return obj;
  }

  /**
   * 启动服务器
   */
  async start(port = 3000) {
    try {
      await this.initializeDatabase();
      logger.info('Database connected');

      this.initializeControllers();
      this.setupMiddlewares();
      this.setupRoutes();

      this.app.listen(port, () => {
        logger.info(`API Server (Koa) started on http://localhost:${port}`);
        logger.info('Available endpoints:');
        logger.info('  POST /api/auth/login');
        logger.info('  POST /api/auth/refresh');
        logger.info('  GET  /api/auth/me');
        logger.info('  GET  /api/users/:id');
        logger.info('  GET  /api/topics');
        logger.info('  POST /api/topics');
        logger.info('  GET  /api/messages?topic_id=');
        logger.info('  GET  /api/experts');
        logger.info('  GET  /api/models');
        logger.info('  GET  /api/providers');
        logger.info('  POST /api/chat (非流式)');
        logger.info('  GET  /api/chat/stream (SSE 流式)');
        logger.info('  GET  /api/roles (角色管理)');
        logger.info('  GET  /api/roles/:id');
        logger.info('  PUT  /api/roles/:id');
        logger.info('  GET  /api/roles/:id/permissions');
        logger.info('  PUT  /api/roles/:id/permissions');
        logger.info('  GET  /api/roles/:id/experts');
        logger.info('  PUT  /api/roles/:id/experts');

        // 异步处理未回复的消息（不阻塞服务器启动）
        this.chatService.processUnrepliedMessages().catch(err => {
          logger.error('[Startup] Failed to process unreplied messages:', err.message);
        });
      });
    } catch (error) {
      logger.error('Failed to start server:', error.message);
      process.exit(1);
    }
  }
}

// 启动服务器
const server = new ApiServer();
server.start(process.env.API_PORT || 3000);

// 优雅关闭
process.on('SIGINT', async () => {
  logger.info('Shutting down API server...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down API server...');
  process.exit(0);
});
