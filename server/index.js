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
import { createDocumentEmbeddingTask } from '../lib/document-embedding-worker.js';
import { createTopicArchiverTask } from '../lib/topic-archiver.js';
import { createAutonomousTaskExecutor } from '../lib/autonomous-task-executor.js';
import ResidentSkillManager from '../lib/resident-skill-manager.js';
import InternalLLMService from '../lib/internal-llm-service.js';
import SkillLoader from '../lib/skill-loader.js';
import AppClock from '../lib/app-clock.js';
import McpToolCaller from '../lib/mcp-tool-caller.js';
import ClockCore from '../lib/clock/clock-core.js';
import { buildDocPipelineContext } from '../lib/clock/job-context-builder.js';
import { run as docPipelineWorkerRun } from '../lib/doc-pipeline-worker.js';
import { createAppWildcardRouter } from './middlewares/app-wildcard-router.js';
import logger from '../lib/logger.js';
import Utils from '../lib/utils.js';
import Router from '@koa/router';

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
import DocController from './controllers/doc.controller.js';
import DocCollectionController from './controllers/doc-collection.controller.js';
import SolutionController from './controllers/solution.controller.js';
import InternalController from './controllers/internal.controller.js';
import InternalDocsController from './controllers/internal-docs.controller.js';
import AssistantController from './controllers/assistant.controller.js';
import AttachmentController from './controllers/attachment.controller.js';
import MiniAppController from './controllers/mini-app.controller.js';
import AppMarketController from './controllers/app-market.controller.js';
import AppRegistryController from './controllers/app-registry.controller.js';
import AppBackupController from './controllers/app-backup.controller.js';
import InvoiceController from './controllers/invoice.controller.js';
import ELSController from './controllers/els.controller.js';
import { getAssistantManager } from './services/assistant/index.js';
import AppRegistryService from './services/app-registry.service.js';

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
import docRoutes from './routes/doc.routes.js';
import docCollectionRoutes from './routes/doc-collection.routes.js';
import solutionRoutes from './routes/solution.routes.js';
import departmentRoutes from './routes/department.routes.js';
import positionRoutes from './routes/position.routes.js';
import systemSettingRoutes, { createBrandingRoutes } from './routes/system-setting.routes.js';
import { getSystemSettingService } from './services/system-setting.service.js';
import { getPermissionService } from './services/permission.service.js';
import packageRoutes from './routes/package.routes.js';
import assistantRoutes from './routes/assistant.routes.js';
import internalRoutes from './routes/internal.routes.js';
import taskStaticRoutes from './routes/task-static.routes.js';
import attachmentRoutes from './routes/attachment.routes.js';
import attachmentStaticRoutes from './routes/attachment-static.routes.js';
import miniAppRoutes from './routes/mini-app.routes.js';
import appMarketRoutes from './routes/app-market.routes.js';
import appRegistryRoutes from './routes/app-registry.routes.js';
import appBackupRoutes from './routes/app-backup.routes.js';
import { createInvitationRoutes } from './routes/invitation.routes.js';
import createMcpRoutes from './routes/mcp.routes.js';
import invoiceRoutes from './routes/invoice.routes.js';
import elsRoutes from './routes/els.routes.js';
import appClockRoutes from './routes/app-clock.routes.js';
import { registerRouter } from './routes/route-registration.js';
import TokenCleanupJob from './jobs/token-cleanup.js';

const PROCESS_ERROR_STRING_LIMIT = 4000;
const PROCESS_ERROR_OBJECT_KEYS_LIMIT = 20;
const PROCESS_ERROR_ARRAY_LIMIT = 20;

function truncateProcessText(value, limit = PROCESS_ERROR_STRING_LIMIT) {
  if (typeof value !== 'string') return value;
  return value.length > limit ? `${value.slice(0, limit)}… [truncated ${value.length - limit} chars]` : value;
}

function summarizeProcessValue(value, depth = 0) {
  if (value == null) return value;
  if (typeof value === 'string') return truncateProcessText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateProcessText(value.message || String(value)),
      stack: truncateProcessText(value.stack || ''),
      code: value.code || null,
      status: value.status || null,
    };
  }

  if (depth >= 3) {
    if (Array.isArray(value)) return `[Array(${value.length})]`;
    try {
      return `[Object keys=${Object.keys(value).length}]`;
    } catch (error) {
      return `[Object enumeration failed: ${truncateProcessText(error.message || String(error), 500)}]`;
    }
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, PROCESS_ERROR_ARRAY_LIMIT).map(item => summarizeProcessValue(item, depth + 1));
    if (value.length > PROCESS_ERROR_ARRAY_LIMIT) {
      items.push(`… ${value.length - PROCESS_ERROR_ARRAY_LIMIT} more items`);
    }
    return items;
  }

  if (typeof value === 'object') {
    const output = {};
    let entries = [];
    let totalKeys = 0;

    try {
      const allEntries = Object.entries(value);
      totalKeys = allEntries.length;
      entries = allEntries.slice(0, PROCESS_ERROR_OBJECT_KEYS_LIMIT);
    } catch (error) {
      return {
        __enumeration_failed__: true,
        message: truncateProcessText(error.message || String(error), 500),
      };
    }

    for (const [key, item] of entries) {
      output[key] = summarizeProcessValue(item, depth + 1);
    }
    if (totalKeys > PROCESS_ERROR_OBJECT_KEYS_LIMIT) {
      output.__truncated_keys__ = totalKeys - PROCESS_ERROR_OBJECT_KEYS_LIMIT;
    }
    return output;
  }

  return truncateProcessText(String(value));
}

function formatProcessError(error) {
  if (!error) return '(empty error)';
  if (error instanceof Error) {
    return truncateProcessText(error.stack || `${error.name}: ${error.message}`);
  }
  if (typeof error === 'object') {
    try {
      return JSON.stringify(summarizeProcessValue(error));
    } catch {
      return String(error);
    }
  }
  return truncateProcessText(String(error));
}

function registerProcessDiagnostics() {
  process.on('uncaughtException', (error, origin) => {
    logger.error(`[Process] uncaughtException origin=${origin || 'unknown'} ${formatProcessError(error)}`);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('[Process] unhandledRejection', formatProcessError(reason));
    if (promise) {
      logger.error('[Process] unhandledRejection promise', summarizeProcessValue(promise));
    }
  });

  process.on('warning', (warning) => {
    logger.warn(`[Process] warning ${formatProcessError(warning)}`);
  });

  process.on('beforeExit', (code) => {
    logger.warn(`[Process] beforeExit code=${code}`);
  });

  process.on('exit', (code) => {
    logger.warn(`[Process] exit code=${code}`);
  });

  ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].forEach((signal) => {
    process.on(signal, () => {
      logger.warn(`[Process] received signal ${signal}`);
    });
  });
}

registerProcessDiagnostics();

const isFeatureEnabled = (envName) => {
  const value = process.env[envName];
  if (value == null) return true;
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
};

const isFeatureEnabledOptIn = (envName) => {
  const value = process.env[envName];
  if (value == null) return false;
  return !['0', 'false', 'off', 'no'].includes(String(value).trim().toLowerCase());
};

class ApiServer {
  constructor() {
    this.app = new Koa();
    this.db = null;
    this.chatService = null;
    this.scheduler = null;
    this.residentSkillManager = null;
    this.mcpToolCaller = null;
    this.tokenCleanupJob = null;
    this.appClock = null;
    this.clockCore = null;
    this.appRouterLoader = null;
    this.wildcardCacheManager = null;
    this.sharedRegistryService = null;
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

      // 启动期 schema 健康检查：验证关键 app 扩展表列完整性
      // 防止因哨兵列迁移检查不完整导致的 schema 漂移在生产环境引发 SELECT 报错
      try {
        await this.runSchemaHealthCheck();
      } catch (error) {
        logger.error('Schema health check failed:', error.message);
        logger.warn('Server will continue, but some features may be unavailable');
      }
    }

    // 初始化 ChatService
    this.chatService = new ChatService(this.db);
    logger.info('ChatService initialized');

    // 初始化后台任务调度器
    this.scheduler = new BackgroundTaskScheduler(this.db);

    // 注册文档平台向量化任务
    this.scheduler.register({
      name: 'document-embedding-worker',
      interval: 30000, // 30秒
      handler: createDocumentEmbeddingTask({ batchSize: 3 }),
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

    logger.info('BackgroundTaskScheduler initialized with document-embedding-worker, topic-archiver, and autonomous-task-executor tasks');

    // 初始化驻留式技能管理器
    this.residentSkillManager = new ResidentSkillManager(this.db);
    await this.residentSkillManager.initialize();
    this.mcpToolCaller = new McpToolCaller(this.db, {
      residentSkillManager: this.residentSkillManager,
    });

    // 初始化 Token 清理任务（Issue #140）
    this.tokenCleanupJob = new TokenCleanupJob(this.db);

    const systemSettingService = getSystemSettingService(this.db);
    const appConfig = await systemSettingService.getAppConfig();

    const { setBaseLlmDb } = await import('../lib/chat/base-llm.js');
    setBaseLlmDb(this.db);
    
    process.env.ATTACHMENT_BASE_PATH = appConfig.attachment_base_path || './data/attachments';
    process.env.TEXT_FILTER_MAX_LENGTH = String(appConfig.text_filter_max_length || 50000);

    this.appClock = new AppClock(this.db, {
      intervalMs: appConfig.clock_interval * 1000,
      maxConsecutiveFailures: parseInt(process.env.APP_CLOCK_MAX_FAILURES, 10) || 3,
      failureCooldownMs: parseInt(process.env.APP_CLOCK_FAILURE_COOLDOWN_MS, 10) || 120000,
      residentSkillManager: this.residentSkillManager,
      mcpToolCaller: this.mcpToolCaller,
      skillLoader: new SkillLoader(this.db),
    });
    // 不在这里启动，等 server listen 后统一启动
    logger.info('AppClock initialized');

    // 初始化 ClockCore（Unified Clock Phase 1）
    // 注册 doc-pipeline-worker 为第一个 internal job
    this.clockCore = new ClockCore(this.db, {
      maxConsecutiveFailures: parseInt(process.env.CLOCK_MAX_FAILURES, 10) || 3,
      failureCooldownMs: parseInt(process.env.CLOCK_FAILURE_COOLDOWN_MS, 10) || 120000,
    });

    this.clockCore.register('doc-pipeline-worker', {
      interval: appConfig.clock_interval * 1000,
      preventOverlap: true,
      handler: async (clockContext) => {
        const services = buildDocPipelineContext(this.db, {
          callMcp: this.mcpToolCaller?.callMcp?.bind(this.mcpToolCaller) ?? null,
          callLlm: null,
          getDocPipelineConfig: async () => {
            try {
              const systemSettingService = getSystemSettingService(this.db);
              return await systemSettingService.getDocPipelineConfig?.() || null;
            } catch {
              return null;
            }
          },
        });
        return await docPipelineWorkerRun({ services });
      },
    });

    logger.info('ClockCore initialized with doc-pipeline-worker internal job');
  }

  /**
   * 启动期 schema 健康检查
   * 验证关键 app 扩展表的关键列是否存在，防止 schema 漂移导致 SELECT 报错
   * 不阻止启动，仅输出警告
   */
  async runSchemaHealthCheck() {
    const checks = [
      // invoice-mgr: 列表/详情/导出依赖这些列
      { table: 'app_invoice_mgr_rows', col: 'text_items_count', usedBy: 'invoice.service.js (list/detail/export)' },
      { table: 'app_invoice_mgr_rows', col: 'keyword_count', usedBy: 'invoice.service.js (list/detail/export)' },
      { table: 'app_invoice_mgr_rows', col: 'issuer', usedBy: 'invoice.service.js (list/detail/export)' },
      { table: 'app_invoice_mgr_rows', col: 'ocr_method', usedBy: 'invoice.service.js (list/detail/export)' },
      { table: 'app_invoice_mgr_rows', col: 'extraction_status', usedBy: 'invoice.service.js (list/detail/export)' },
    ];

    let hasMissing = false;
    for (const { table, col, usedBy } of checks) {
      const rows = await this.db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [this.db.config.database, table, col]
      );
      if (!rows || rows.length === 0) {
        hasMissing = true;
        logger.error(`[SchemaHealthCheck] MISSING: ${table}.${col} (used by ${usedBy}) — 请执行 scripts/upgrade-database.js`);
      }
    }

    if (hasMissing) {
      logger.error('[SchemaHealthCheck] ⚠️ 存在缺失列，发票管理等模块可能无法正常工作');
    } else {
      logger.info('[SchemaHealthCheck] ✓ 关键列检查通过');
    }
  }

  /**
   * 初始化控制器
   */
  initializeControllers() {
    // 先创建 StreamController，获取 SSE 连接池
    const streamController = new StreamController(this.db, this.chatService);

    this.sharedRegistryService = new AppRegistryService(this.db);

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
      doc: new DocController(this.db),
      docCollection: new DocCollectionController(this.db),
      solution: new SolutionController(this.db),
      internal: new InternalController(this.db, {
        expertConnections: streamController.expertConnections, // 传递 SSE 连接池
        chatService: this.chatService, // 传递 ChatService 用于触发专家响应
      }),
      internalDocs: new InternalDocsController(this.db),
      assistant: new AssistantController(this.db),
      attachment: new AttachmentController(this.db),
      miniApp: new MiniAppController(this.db, this.sharedRegistryService),
      appMarket: new AppMarketController(this.db, this.sharedRegistryService, null),
      appRegistry: new AppRegistryController(this.db, this.sharedRegistryService),
      appBackup: new AppBackupController(this.db),
      invoice: new InvoiceController(this.db),
      els: new ELSController(this.db),
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
      formLimit: '50mb',  // 允许更大的表单请求体
      textLimit: '50mb',  // 允许更大的文本请求体
    }));

    // 统一响应格式
    this.app.use(responseMiddleware());

    // 将控制器注入到 ctx.state 中，供路由使用
    this.app.use(async (ctx, next) => {
      ctx.state.controllers = this.controllers;
      await next();
    });
  }

  /**
   * 设置路由
   */
  async setupRoutes() {
    // 健康检查
    this.app.use(async (ctx, next) => {
      if (ctx.path === '/api/health') {
        ctx.success({ status: 'ok', version: '2.0.0-koa' });
        return;
      }
      await next();
    });

    // 注册路由
    registerRouter(this.app, authRoutes(this.controllers.auth));
    
    registerRouter(this.app, userRoutes(this.controllers.user));
    
    registerRouter(this.app, topicRoutes(this.controllers.topic, this.controllers.message));
    
    registerRouter(this.app, messageRoutes(this.controllers.message));
    
    registerRouter(this.app, expertRoutes(this.controllers.expert));
    
    registerRouter(this.app, modelRoutes(this.controllers.model));
    
    registerRouter(this.app, streamRoutes(this.controllers.stream));
    
    // Chat 路由（前端兼容）
    const permissionService = getPermissionService(this.db);
    registerRouter(this.app, chatRoutes(this.controllers.stream, { permissionService }));
    
    // Provider 路由（需要数据库实例）
    try {
      const providerRouter = providerRoutes(this.db);
      registerRouter(this.app, providerRouter);
      logger.info('Provider routes registered successfully');
    } catch (err) {
      logger.error('Failed to register provider routes:', err.message);
    }

    // Skill 路由
    registerRouter(this.app, skillRoutes(this.controllers.skill));

    // Debug 路由
    registerRouter(this.app, debugRoutes(this.controllers.debug));

    // Role 路由
    registerRouter(this.app, roleRoutes(RoleController));

    // Task 路由
    registerRouter(this.app, taskRoutes(this.controllers.task));

    // Doc Collection 文档集合路由（/api/docs/collections/* 必须在 Doc 路由之前，防止 /collections 被 /:documentId 捕获）
    registerRouter(this.app, docCollectionRoutes(this.controllers.docCollection));

    // Doc 统一文档平台路由（主入口 /api/docs/*）
    registerRouter(this.app, docRoutes(this.controllers.doc));

    // Solution 解决方案路由
    registerRouter(this.app, solutionRoutes(this.controllers.solution));

    // Department 路由
    const departmentRouter = departmentRoutes(this.db);
    registerRouter(this.app, departmentRouter);

    // Position 路由
    const positionRouter = positionRoutes(this.db);
    registerRouter(this.app, positionRouter);

    // System Setting 路由
    const systemSettingRouter = systemSettingRoutes(this.db);
    registerRouter(this.app, systemSettingRouter);

    // Branding 路由（公开，无需认证）
    const brandingRouter = createBrandingRoutes(this.db);
    registerRouter(this.app, brandingRouter);

    // Package 白名单路由
    const packageRouter = packageRoutes(this.db);
    registerRouter(this.app, packageRouter);

// Assistant 助理路由
    const assistantRouter = assistantRoutes(this.controllers.assistant);
    registerRouter(this.app, assistantRouter);

    // Internal 内部 API 路由（驻留进程调用）
    // 将 StreamController 的 SSE 连接池共享给 InternalController
    this.controllers.internal.setExpertConnections(this.controllers.stream.expertConnections);
    // 将 ResidentSkillManager 共享给 InternalController
    this.controllers.internal.setResidentSkillManager(this.residentSkillManager);
    // 将 ResidentSkillManager 共享给 DebugController
    this.controllers.debug.setResidentSkillManager(this.residentSkillManager);
    // 将 Scheduler 共享给 DebugController
    this.controllers.debug.setScheduler(this.scheduler);
    registerRouter(this.app, internalRoutes(this.controllers.internal, this.controllers.internalDocs, authMiddleware));
    logger.info('Internal routes registered (POST /internal/messages/insert, GET /internal/models/:model_id, POST /internal/resident/invoke, /internal/docs/*)');

    // Task Static 静态文件服务路由（Issue #140）
    const taskStaticRouter = taskStaticRoutes(this.db);
    registerRouter(this.app, taskStaticRouter);
    logger.info('Task static routes registered (GET /task-static/t/:token/p/*)');

    // Attachment 附件服务路由（Issue #557）
    const attachmentRouter = attachmentRoutes(this.controllers.attachment);
    registerRouter(this.app, attachmentRouter);
    logger.info('Attachment routes registered (POST/GET/DELETE /api/attachments/*)');

    // Attachment Static 静态文件服务路由（Issue #557）
    const attachmentStaticRouter = attachmentStaticRoutes(this.db);
    registerRouter(this.app, attachmentStaticRouter);
    logger.info('Attachment static routes registered (GET /attach/t/:token/:attachment_id)');

    // Utility 路由
    const utilityRouter = new Router();
    utilityRouter.get('/api/newid', authMiddleware.authenticate(), (ctx) => {
      const length = parseInt(ctx.query.length) || 20;
      ctx.success({ id: Utils.newID(length) });
    });
    registerRouter(this.app, utilityRouter);
    logger.info('Utility routes registered (GET /api/newid)');

    // App Registry 路由（新架构）
    const appRegistryRouter = appRegistryRoutes(this.controllers.appRegistry);
    registerRouter(this.app, appRegistryRouter);
    logger.info('App Registry routes registered (/api/app-registry/*)');

    // App Wildcard 路由（新架构）- 直接映射 handler 文件
    const wildcardRouter = createAppWildcardRouter(this.db, {
      authMiddleware: authMiddleware.authenticate(),
    });
    this.app.use(wildcardRouter);
    logger.info('App Wildcard router registered (/api/apps/:appId/*)');

    // App Backup 路由（保留独立路由，后续迁移到 wildcard）
    const appBackupRouter = appBackupRoutes(this.controllers.appBackup);
    registerRouter(this.app, appBackupRouter);
    logger.info('App Backup routes registered (/api/app-backup/*)');

    // Mini App 平台路由（Issue #603）
    const miniAppRouter = miniAppRoutes(this.controllers.miniApp);
    registerRouter(this.app, miniAppRouter);
    logger.info('Mini App routes registered (/api/mini-apps/*, /api/handlers/*)');

    // App Market 路由
    const appMarketRouter = appMarketRoutes(this.controllers.appMarket);
    registerRouter(this.app, appMarketRouter);
    logger.info('App Market routes registered (/api/app-market/*)');

    // Invitation 邀请码路由（Issue #222）
    const invitationRouter = createInvitationRoutes(this.db);
    registerRouter(this.app, invitationRouter);
    logger.info('Invitation routes registered (GET/POST /api/invitations)');

    // MCP 服务管理路由（Issue #601）
    const mcpRouter = createMcpRoutes(this.db, authMiddleware, this.residentSkillManager);
    registerRouter(this.app, mcpRouter);
    logger.info('MCP routes registered (GET/POST /api/mcp/*)');

    const invoiceRouter = invoiceRoutes(this.controllers.invoice);
    registerRouter(this.app, invoiceRouter);
    logger.info('Invoice routes registered (/api/invoice/*)');

    const elsRouter = elsRoutes(this.controllers.els);
    registerRouter(this.app, elsRouter);
    logger.info('ELS routes registered (/api/els/*)');

    const appClockRouter = appClockRoutes(this.db);
    registerRouter(this.app, appClockRouter);
    logger.info('AppClock status routes registered (GET /api/app-clock/status, POST /api/app-clock/clear/:appId, POST /api/app-clock/force-tick/:appId)');

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
  async start(port = 3017) {
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

      this.app.context.appClock = this.appClock;
      this.app.context.mcpToolCaller = this.mcpToolCaller;

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
        logger.info('  POST /api/docs/recall (统一召回)');
        logger.info('  GET  /api/docs (文档列表)');

        // 异步处理未回复的消息（不阻塞服务器启动）
        this.chatService.processUnrepliedMessages().catch(err => {
          logger.error('[Startup] Failed to process unreplied messages:', err.message);
        });

        // 启动后台任务调度器
        if (this.scheduler) {
          if (isFeatureEnabled('ENABLE_BACKGROUND_SCHEDULER')) {
            this.scheduler.startAll();
          } else {
            logger.warn('[Startup] BackgroundTaskScheduler disabled by ENABLE_BACKGROUND_SCHEDULER');
          }
        }

        // 启动 AppClock / ClockCore
        // AppClock 负责业务 app_tick；ClockCore 负责平台 internal_job。
        const enableAppClock = isFeatureEnabled('ENABLE_APP_CLOCK');
        // ClockCore 作为迁移期开关，必须显式开启，避免未配置环境被默认切流。
        const enableClockCore = isFeatureEnabledOptIn('ENABLE_CLOCK_CORE');

        // 启动 AppClock（Issue #654）
        if (this.appClock) {
          if (enableAppClock) {
            this.appClock.start().catch(err => {
              logger.error('[Startup] Failed to start AppClock:', err.message);
            });
          } else {
            logger.warn('[Startup] AppClock disabled by ENABLE_APP_CLOCK');
          }
        }

        // 启动 ClockCore（Unified Clock Phase 1）
        if (this.clockCore) {
          if (enableClockCore) {
            this.clockCore.startAll();
            logger.info('[Startup] ClockCore started with internal jobs');
          } else {
            logger.warn('[Startup] ClockCore disabled by ENABLE_CLOCK_CORE');
            logger.warn('[Startup] Document pipeline auto-processing is disabled; set ENABLE_CLOCK_CORE=1 to advance pending_ocr/ocr_processing documents');
          }
        }

        // 启动 Token 清理任务（Issue #140）
        if (this.tokenCleanupJob) {
          if (isFeatureEnabled('ENABLE_TOKEN_CLEANUP')) {
            this.tokenCleanupJob.start();
          } else {
            logger.warn('[Startup] TokenCleanupJob disabled by ENABLE_TOKEN_CLEANUP');
          }
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
server.start(process.env.API_PORT || 3017);

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
  if (server.clockCore) {
    server.clockCore.stopAll();
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
  if (server.clockCore) {
    server.clockCore.stopAll();
  }
  process.exit(0);
});
