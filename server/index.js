/**
 * Touwaka Mate API Server (Koa 版)
 * RESTful API 服务器，支持前端调用
 */

import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import cors from '@koa/cors';
import serve from 'koa-static';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// 加载 .env 文件（如果存在）
// 优先级：环境变量 > .env 文件
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// 调试：打印数据库配置来源
console.log('=== Database Configuration Debug ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DB_HOST:', process.env.DB_HOST || '(not set)');
console.log('DB_PORT:', process.env.DB_PORT || '(not set)');
console.log('DB_NAME:', process.env.DB_NAME || '(not set)');
console.log('DB_USER:', process.env.DB_USER || '(not set)');
console.log('DB_PASSWORD:', process.env.DB_PASSWORD ? '******' : '(not set)');
console.log('===================================');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import Database from '../lib/db.js';
import ChatService from '../lib/chat-service.js';
import BackgroundTaskScheduler from '../lib/background-scheduler.js';
import { createEmbeddingTask } from '../lib/embedding-worker.js';
import { createTopicArchiverTask } from '../lib/topic-archiver.js';
import { createAutonomousTaskExecutor } from '../lib/autonomous-task-executor.js';
import ResidentSkillManager from '../lib/resident-skill-manager.js';
import InternalLLMService from '../lib/internal-llm-service.js';
import SkillLoader from '../lib/skill-loader.js';
import AppClock from '../lib/app-clock.js';
import logger from '../lib/logger.js';

// 中间件
import { responseMiddleware } from './middlewares/index.js';
import * as authMiddleware from './middlewares/auth.js';

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
import TaskController from './controllers/task.controller.js';
import KbController from './controllers/kb.controller.js';
import SolutionController from './controllers/solution.controller.js';
import InternalController from './controllers/internal.controller.js';
import AssistantController from './controllers/assistant.controller.js';
import AttachmentController from './controllers/attachment.controller.js';
import MiniAppController from './controllers/mini-app.controller.js';
import AppMarketController from './controllers/app-market.controller.js';
import { getAssistantManager } from './services/assistant/index.js';

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
import taskRoutes from './routes/task.routes.js';
import kbRoutes from './routes/kb.routes.js';
import solutionRoutes from './routes/solution.routes.js';
import departmentRoutes from './routes/department.routes.js';
import positionRoutes from './routes/position.routes.js';
import systemSettingRoutes from './routes/system-setting.routes.js';
import packageRoutes from './routes/package.routes.js';
import assistantRoutes from './routes/assistant.routes.js';
import internalRoutes from './routes/internal.routes.js';
import taskStaticRoutes from './routes/task-static.routes.js';
import attachmentRoutes from './routes/attachment.routes.js';
import attachmentStaticRoutes from './routes/attachment-static.routes.js';
import miniAppRoutes from './routes/mini-app.routes.js';
import appMarketRoutes from './routes/app-market.routes.js';
import { createInvitationRoutes } from './routes/invitation.routes.js';
import createMcpRoutes from './routes/mcp.routes.js';
import TokenCleanupJob from './jobs/token-cleanup.js';

class ApiServer {
  constructor() {
    this.app = new Koa();
    this.db = null;
    this.chatService = null;
    this.scheduler = null;
    this.residentSkillManager = null;
    this.tokenCleanupJob = null;
    this.appClock = null;
    this.controllers = {};
  }

  /**
   * 检查数据库中是否有任何表
   */
  async checkTablesExist() {
    try {
      const result = await this.db.query(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = DATABASE()"
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
      logger.info('Database tables already exist, checking for upgrades...');
      
      // 自动检查并执行数据库升级
      try {
        const { upgrade, needsUpgrade } = await import('../scripts/upgrade-database.js');
        if (await needsUpgrade()) {
          logger.info('Database schema upgrade needed, running upgrade...');
          await upgrade();
          logger.info('Database upgraded successfully');
        } else {
          logger.info('Database schema is up to date');
        }
      } catch (error) {
        logger.error('Failed to upgrade database:', error.message);
        // 升级失败不阻止服务器启动，只记录警告
        logger.warn('Server will continue with current schema');
      }
    }

    // 初始化 ChatService
    this.chatService = new ChatService(this.db);
    logger.info('ChatService initialized');

    // 初始化后台任务调度器
    this.scheduler = new BackgroundTaskScheduler(this.db);

    // 注册向量化任务
    this.scheduler.register({
      name: 'embedding-worker',
      interval: 30000, // 30秒
      handler: createEmbeddingTask({ batchSize: 10 }),
    });

    // 注册 Topic 归档任务（Issue #174）
    // 策略：每个用户保留最新 2 个 Topic，其余归档
    this.scheduler.register({
      name: 'topic-archiver',
      interval: 5 * 60 * 1000, // 5分钟检查一次
      handler: createTopicArchiverTask({
        batchSize: 20,          // 每次最多归档 20 个 Topic
        keepActivePerUser: 2,   // 每个用户保留 2 个活跃 Topic
      }),
    });

    // 注册自主任务执行器
    // 每分钟检查一次，如果上一轮还没处理完，本轮顺延（preventOverlap: true）
    this.scheduler.register({
      name: 'autonomous-task-executor',
      interval: 60000, // 1分钟检查一次
      handler: createAutonomousTaskExecutor({
        chatService: this.chatService,
        batchSize: 5,              // 每批最多处理 5 个任务
        minIntervalMinutes: 15,    // 最后消息超过 15 分钟才 push
        maxNoResponseCount: 2,     // 连续 2 次无响应则停止
      }),
      preventOverlap: true,  // 如果上一轮还没处理完，本轮顺延
    });

    logger.info('BackgroundTaskScheduler initialized with embedding-worker, topic-archiver, and autonomous-task-executor tasks');

    // 初始化驻留式技能管理器
    this.residentSkillManager = new ResidentSkillManager(this.db);
    await this.residentSkillManager.initialize();

    // 初始化 Token 清理任务（Issue #140）
    this.tokenCleanupJob = new TokenCleanupJob(this.db);

    const appConfig = await this.systemSettingService.getAppConfig();
    
    process.env.ATTACHMENT_BASE_PATH = appConfig.attachment_base_path || './data/attachments';
    process.env.TEXT_FILTER_MAX_LENGTH = String(appConfig.text_filter_max_length || 50000);

    this.appClock = new AppClock(this.db, {
      intervalMs: appConfig.clock_interval * 1000,
      batchSize: appConfig.batch_size,
      globalConcurrency: appConfig.max_concurrency,
      residentSkillManager: this.residentSkillManager,
      llmService: new InternalLLMService(this.db),
      skillLoader: new SkillLoader(this.db),
    });
    await this.appClock.start();
  }

  /**
   * 初始化控制器
   */
  initializeControllers() {
    // 先创建 StreamController，获取 SSE 连接池
    const streamController = new StreamController(this.db, this.chatService);

    this.controllers = {
      auth: new AuthController(this.db),
      user: new UserController(this.db),
      topic: new TopicController(this.db, this.chatService),
      message: new MessageController(this.db),
      expert: new ExpertController(this.db, this.chatService),
      model: new ModelController(this.db),
      stream: streamController,
      skill: new SkillController(this.db),
      debug: new DebugController(this.db, this.chatService),
      task: new TaskController(this.db),
      kb: new KbController(this.db),
      solution: new SolutionController(this.db),
      internal: new InternalController(this.db, {
        expertConnections: streamController.expertConnections, // 传递 SSE 连接池
        chatService: this.chatService, // 传递 ChatService 用于触发专家响应
      }),
      assistant: new AssistantController(this.db),
      attachment: new AttachmentController(this.db),
      miniApp: new MiniAppController(this.db),
      appMarket: new AppMarketController(this.db),
    };
  }

  /**
   * 设置中间件
   */
  setupMiddlewares() {
    // 将数据库实例附加到 ctx 上，供中间件使用
    this.app.use(async (ctx, next) => {
      ctx.db = this.db;
      await next();
    });

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

    // Body 解析（增加限制以支持图片等多模态内容）
    this.app.use(bodyParser({
      jsonLimit: '50mb',  // 允许更大的 JSON 请求体
    }));

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

    // Task 路由
    this.app.use(taskRoutes(this.controllers.task).routes());
    this.app.use(taskRoutes(this.controllers.task).allowedMethods());

    // KB 知识库路由
    this.app.use(kbRoutes(this.controllers.kb).routes());
    this.app.use(kbRoutes(this.controllers.kb).allowedMethods());

    // Solution 解决方案路由
    this.app.use(solutionRoutes(this.controllers.solution).routes());
    this.app.use(solutionRoutes(this.controllers.solution).allowedMethods());

    // Department 路由
    const departmentRouter = departmentRoutes(this.db);
    this.app.use(departmentRouter.routes());
    this.app.use(departmentRouter.allowedMethods());

    // Position 路由
    const positionRouter = positionRoutes(this.db);
    this.app.use(positionRouter.routes());
    this.app.use(positionRouter.allowedMethods());

    // System Setting 路由
    const systemSettingRouter = systemSettingRoutes(this.db);
    this.app.use(systemSettingRouter.routes());
    this.app.use(systemSettingRouter.allowedMethods());

    // Package 白名单路由
    const packageRouter = packageRoutes(this.db);
    this.app.use(packageRouter.routes());
    this.app.use(packageRouter.allowedMethods());

// Assistant 助理路由
    const assistantRouter = assistantRoutes(this.controllers.assistant);
    this.app.use(assistantRouter.routes());
    this.app.use(assistantRouter.allowedMethods());

    // Internal 内部 API 路由（驻留进程调用）
    // 将 StreamController 的 SSE 连接池共享给 InternalController
    this.controllers.internal.setExpertConnections(this.controllers.stream.expertConnections);
    // 将 ResidentSkillManager 共享给 InternalController
    this.controllers.internal.setResidentSkillManager(this.residentSkillManager);
    // 将 ResidentSkillManager 共享给 DebugController
    this.controllers.debug.setResidentSkillManager(this.residentSkillManager);
    // 将 Scheduler 共享给 DebugController
    this.controllers.debug.setScheduler(this.scheduler);
    this.app.use(internalRoutes(this.controllers.internal, authMiddleware).routes());
    this.app.use(internalRoutes(this.controllers.internal, authMiddleware).allowedMethods());
    logger.info('Internal routes registered (POST /internal/messages/insert, GET /internal/models/:model_id, POST /internal/resident/invoke)');

    // Task Static 静态文件服务路由（Issue #140）
    const taskStaticRouter = taskStaticRoutes(this.db);
    this.app.use(taskStaticRouter.routes());
    this.app.use(taskStaticRouter.allowedMethods());
    logger.info('Task static routes registered (GET /task-static/t/:token/p/*)');

    // Attachment 附件服务路由（Issue #557）
    const attachmentRouter = attachmentRoutes(this.controllers.attachment);
    this.app.use(attachmentRouter.routes());
    this.app.use(attachmentRouter.allowedMethods());
    logger.info('Attachment routes registered (POST/GET/DELETE /api/attachments/*)');

    // Attachment Static 静态文件服务路由（Issue #557）
    const attachmentStaticRouter = attachmentStaticRoutes(this.db);
    this.app.use(attachmentStaticRouter.routes());
    this.app.use(attachmentStaticRouter.allowedMethods());
    logger.info('Attachment static routes registered (GET /attach/t/:token/:attachment_id)');

    // Mini App 平台路由（Issue #603）
    const miniAppRouter = miniAppRoutes(this.controllers.miniApp);
    this.app.use(miniAppRouter.routes());
    this.app.use(miniAppRouter.allowedMethods());
    logger.info('Mini App routes registered (/api/mini-apps/*, /api/handlers/*)');

    // App Market 路由
    const appMarketRouter = appMarketRoutes(this.controllers.appMarket);
    this.app.use(appMarketRouter.routes());
    this.app.use(appMarketRouter.allowedMethods());
    logger.info('App Market routes registered (/api/app-market/*)');

    // Invitation 邀请码路由（Issue #222）
    const invitationRouter = createInvitationRoutes(this.db);
    this.app.use(invitationRouter.routes());
    this.app.use(invitationRouter.allowedMethods());
    logger.info('Invitation routes registered (GET/POST /api/invitations)');

    // MCP 服务管理路由（Issue #601）
    const mcpRouter = createMcpRoutes(this.db, authMiddleware, this.residentSkillManager);
    this.app.use(mcpRouter.routes());
    this.app.use(mcpRouter.allowedMethods());
    logger.info('MCP routes registered (GET/POST /api/mcp/*)');

    // 前端静态文件服务（生产环境）
    // 检查前端构建目录是否存在
    const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist');
    if (fs.existsSync(frontendDistPath)) {
      // 托管静态资源文件 (JS, CSS, 图片等)
      this.app.use(serve(frontendDistPath, {
        maxage: 31536000000, // 1年缓存
        gzip: true,
      }));

      // SPA fallback: 所有非 API 请求返回 index.html
      // 这样前端路由 (如 /chat, /settings) 可以正常工作
      this.app.use(async (ctx, next) => {
        // 只处理非 API 请求
        if (!ctx.path.startsWith('/api') && !ctx.path.startsWith('/task-static') && !ctx.path.startsWith('/attach')) {
          const indexPath = path.join(frontendDistPath, 'index.html');
          if (fs.existsSync(indexPath)) {
            ctx.type = 'html';
            ctx.body = fs.createReadStream(indexPath);
            return;
          }
        }
        await next();
      });

      logger.info(`Frontend static files served from ${frontendDistPath}`);
    } else {
      logger.warn(`Frontend dist not found at ${frontendDistPath}, skipping static file serving`);
    }

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
   * 直接从环境变量读取配置
   * 优先级：环境变量 > .env 文件
   * 所有必填字段缺失时直接抛出错误
   */
  loadDatabaseConfig() {
    // 验证必填字段
    const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      throw new Error(
        `数据库配置缺失: ${missing.join(', ')}\n` +
        `请设置环境变量或在 .env 文件中配置`
      );
    }

    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      connectionLimit: 10,
    };
  }

  /**
   * 启动服务器
   */
  async start(port = 3000) {
    try {
      await this.initializeDatabase();
      logger.info('Database connected');

      this.initializeControllers();

      // Initialize Assistant Manager
      const assistantManager = getAssistantManager(this.db, { chatService: this.chatService });
      await assistantManager.initialize();
      logger.info('Assistant Manager initialized');

      // 将 AssistantManager 注入到 ChatService
      this.chatService.assistantManager = assistantManager;
      logger.info('AssistantManager injected into ChatService');

      this.setupMiddlewares();
      this.setupRoutes();

      // 将 SSE 连接池共享给 AssistantManager（在 setupRoutes 之后，因为 StreamController 已创建）
      assistantManager.setExpertConnections(this.controllers.stream.expertConnections);
      logger.info('AssistantManager: expertConnections set');

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
        logger.info('  GET  /api/kb/articles (知识库)');
        logger.info('  POST /api/kb/articles');
        logger.info('  GET  /api/kb/articles/:id');
        logger.info('  GET  /api/kb/articles/:id/sections');
        logger.info('  GET  /api/kb/sections/:id/paragraphs');

        // 异步处理未回复的消息（不阻塞服务器启动）
        this.chatService.processUnrepliedMessages().catch(err => {
          logger.error('[Startup] Failed to process unreplied messages:', err.message);
        });

        // 启动后台任务调度器
        if (this.scheduler) {
          this.scheduler.startAll();
        }

        // 启动 Token 清理任务（Issue #140）
        if (this.tokenCleanupJob) {
          this.tokenCleanupJob.start();
        }
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
  if (server.scheduler) {
    server.scheduler.stopAll();
  }
  if (server.residentSkillManager) {
    await server.residentSkillManager.shutdown();
  }
  if (server.tokenCleanupJob) {
    server.tokenCleanupJob.stop();
  }
  if (server.appClock) {
    server.appClock.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down API server...');
  if (server.scheduler) {
    server.scheduler.stopAll();
  }
  if (server.residentSkillManager) {
    await server.residentSkillManager.shutdown();
  }
  if (server.tokenCleanupJob) {
    server.tokenCleanupJob.stop();
  }
  if (server.appClock) {
    server.appClock.stop();
  }
  process.exit(0);
});
