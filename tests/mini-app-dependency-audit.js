/**
 * Mini-app 依赖审计脚本
 * 
 * 用于评估 Mini-app 退役前置条件的满足情况
 * 按路由、表、任务三维度进行审计
 * 
 * 使用方法：
 * node tests/mini-app-dependency-audit.js
 * 
 * 输出：JSON 格式的审计报告
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'touwaka_mate',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const APPS_DIR = path.join(process.cwd(), 'apps');

async function main() {
  console.log('🔍 Mini-app 依赖审计');
  console.log('='.repeat(60));
  console.log(`📌 数据库: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}`);
  console.log('='.repeat(60));

  let connection;
  const report = {
    timestamp: new Date().toISOString(),
    summary: {},
    routes: {},
    tables: {},
    tasks: {},
    handlers: {},
    recommendations: [],
  };

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\n');

    await auditRoutes(connection, report);
    await auditTables(connection, report);
    await auditTasks(connection, report);
    await auditHandlers(report);
    generateRecommendations(report);

    console.log('\n' + '='.repeat(60));
    console.log('📊 审计报告摘要');
    console.log('='.repeat(60));
    console.log(JSON.stringify(report.summary, null, 2));

    const outputPath = path.join(process.cwd(), 'temp', 'mini-app-audit-report.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 完整报告已保存到: ${outputPath}`);

  } catch (error) {
    console.error('\n❌ 审计失败:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

async function auditRoutes(connection, report) {
  console.log('\n📍 1. 路由依赖审计');

  const miniAppRoutes = [
    '/api/mini-apps',
    '/api/mini-apps/:appId',
    '/api/mini-apps/:appId/rows',
    '/api/mini-apps/:appId/rows/:rowId',
    '/api/mini-apps/:appId/files',
    '/api/mini-apps/:appId/actions',
  ];

  const kbRoutes = [
    '/api/kb',
    '/api/kb/:kb_id',
    '/api/kb/:kb_id/articles',
  ];

  report.routes = {
    mini_app_routes: miniAppRoutes,
    kb_routes: kbRoutes,
    note: '路由依赖需从 server/routes/*.routes.js 中进一步分析',
  };

  const [miniApps] = await connection.query('SELECT id, name, component FROM mini_apps');
  console.log(`  - 已注册 Mini-app 数量: ${miniApps.length}`);

  report.routes.registered_apps = miniApps.map(app => ({
    id: app.id,
    name: app.name,
    component: app.component || 'unknown',
  }));

  report.summary.mini_app_count = miniApps.length;
}

async function auditTables(connection, report) {
  console.log('\n📊 2. 表依赖审计');

  const miniAppTables = [
    'mini_apps',
    'mini_app_rows',
    'mini_app_files',
    'mini_app_role_access',
    'app_row_handlers',
    'app_state',
    'app_action_logs',
    'app_clock_registry',
    'app_tick_log',
    'app_contract_mgr_rows',
    'app_contract_mgr_content',
    'app_contract_mgr_compares',
    'app_contract_mgr_v2_rows',
    'app_contract_mgr_v2_content',
    'contract_v2_versions',
    'contract_v2_main_records',
    'contract_v2_org_nodes',
    'app_invoice_mgr_rows',
    'app_invoice_mgr_items',
  ];

  const kbTables = [
    'knowledge_bases',
    'kb_articles',
    'kb_sections',
    'kb_paragraphs',
    'kb_tags',
    'kb_article_tags',
  ];

  report.tables.mini_app_tables = {};
  report.tables.kb_tables = {};

  for (const table of miniAppTables) {
    try {
      const [rows] = await connection.query(`
        SELECT TABLE_ROWS, DATA_LENGTH, CREATE_TIME, UPDATE_TIME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [dbConfig.database, table]);

      if (rows.length > 0) {
        const info = rows[0];
        report.tables.mini_app_tables[table] = {
          row_count: info.TABLE_ROWS || 0,
          data_size: info.DATA_LENGTH || 0,
          created_at: info.CREATE_TIME,
          last_updated: info.UPDATE_TIME,
        };
        console.log(`  - ${table}: ${info.TABLE_ROWS || 0} 行`);
      } else {
        report.tables.mini_app_tables[table] = { status: 'not_found' };
        console.log(`  - ${table}: 不存在`);
      }
    } catch (e) {
      report.tables.mini_app_tables[table] = { error: e.message };
    }
  }

  for (const table of kbTables) {
    try {
      const [rows] = await connection.query(`
        SELECT TABLE_ROWS, DATA_LENGTH, CREATE_TIME, UPDATE_TIME
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      `, [dbConfig.database, table]);

      if (rows.length > 0) {
        const info = rows[0];
        report.tables.kb_tables[table] = {
          row_count: info.TABLE_ROWS || 0,
          data_size: info.DATA_LENGTH || 0,
          created_at: info.CREATE_TIME,
          last_updated: info.UPDATE_TIME,
        };
        console.log(`  - ${table}: ${info.TABLE_ROWS || 0} 行`);
      }
    } catch (e) {
      report.tables.kb_tables[table] = { error: e.message };
    }
  }

  const totalMiniAppRows = Object.values(report.tables.mini_app_tables)
    .filter(t => t.row_count)
    .reduce((sum, t) => sum + t.row_count, 0);

  report.summary.mini_app_table_rows = totalMiniAppRows;
}

async function auditTasks(connection, report) {
  console.log('\n⏰ 3. 定时任务审计');

  const [clockRegistry] = await connection.query(`
    SELECT app_id, tick_script, is_active, created_at
    FROM app_clock_registry
    ORDER BY app_id
  `);

  report.tasks.clock_registry = clockRegistry.map(task => ({
    app_id: task.app_id,
    tick_script: task.tick_script,
    is_active: task.is_active,
    created_at: task.created_at,
  }));

  console.log(`  - 已注册定时任务数量: ${clockRegistry.length}`);

  const [tickLogs] = await connection.query(`
    SELECT COUNT(*) as total, MAX(created_at) as last_execution
    FROM app_tick_log
  `);

  report.tasks.tick_log_stats = {
    total_executions: tickLogs[0].total,
    last_execution: tickLogs[0].last_execution,
  };

  console.log(`  - 任务执行记录数: ${tickLogs[0].total}`);
  console.log(`  - 最近执行时间: ${tickLogs[0].last_execution || '无'}`);

  report.summary.clock_task_count = clockRegistry.length;
  report.summary.tick_log_count = tickLogs[0].total;
}

async function auditHandlers(report) {
  console.log('\n🔧 4. 自定义 Handler 审计');

  if (!fs.existsSync(APPS_DIR)) {
    console.log('  - apps 目录不存在');
    report.handlers = { status: 'apps_dir_not_found' };
    return;
  }

  const appDirs = fs.readdirSync(APPS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  report.handlers.apps = {};

  for (const appId of appDirs) {
    const manifestPath = path.join(APPS_DIR, appId, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const customHandlers = manifest.custom_handlers || {};

      if (Object.keys(customHandlers).length > 0) {
        report.handlers.apps[appId] = {
          name: manifest.name || appId,
          custom_handlers: customHandlers,
        };
        console.log(`  - ${appId}: ${Object.keys(customHandlers).join(', ')}`);
      }
    } catch (e) {
      console.log(`  - ${appId}: 解析失败 (${e.message})`);
    }
  }

  const totalHandlers = Object.values(report.handlers.apps || {})
    .reduce((sum, app) => sum + Object.keys(app.custom_handlers || {}).length, 0);

  report.summary.custom_handler_count = totalHandlers;
}

function generateRecommendations(report) {
  console.log('\n💡 5. 建议与评估');

  const recommendations = [];

  if (report.summary.mini_app_count > 0) {
    recommendations.push({
      type: 'migration',
      priority: 'high',
      description: `存在 ${report.summary.mini_app_count} 个 Mini-app，需逐个评估迁移方案`,
    });
  }

  if (report.summary.mini_app_table_rows > 0) {
    recommendations.push({
      type: 'data',
      priority: 'high',
      description: `Mini-app 相关表共有 ${report.summary.mini_app_table_rows} 行数据，需制定数据迁移计划`,
    });
  }

  if (report.summary.clock_task_count > 0) {
    recommendations.push({
      type: 'task',
      priority: 'medium',
      description: `存在 ${report.summary.clock_task_count} 个定时任务，需评估是否迁移到新架构`,
    });
  }

  if (report.summary.custom_handler_count > 0) {
    recommendations.push({
      type: 'handler',
      priority: 'medium',
      description: `存在 ${report.summary.custom_handler_count} 个自定义 Handler，需逐个迁移`,
    });
  }

  const kbTables = report.tables.kb_tables || {};
  const kbHasData = Object.values(kbTables).some(t => t.row_count > 0);
  
  if (kbHasData) {
    recommendations.push({
      type: 'kb_migration',
      priority: 'high',
      description: 'KB 表已有数据，可优先迁移到统一文档平台',
    });
  }

  report.recommendations = recommendations;

  for (const rec of recommendations) {
    console.log(`  - [${rec.priority}] ${rec.description}`);
  }
}

main();