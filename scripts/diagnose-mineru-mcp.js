import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import Database from '../lib/db.js';
import ResidentSkillManager from '../lib/resident-skill-manager.js';
import McpToolCaller from '../lib/mcp-tool-caller.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseArgs(argv) {
  const options = {
    server_name: 'mineru',
    task_id: '',
    timeout_ms: Number(process.env.TEST_TIMEOUT_MS || 30000),
    skip_deliverables: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--server') {
      options.server_name = argv[++index];
    } else if (arg === '--task-id') {
      options.task_id = argv[++index];
    } else if (arg === '--timeout-ms') {
      options.timeout_ms = Number(argv[++index]);
    } else if (arg === '--skip-deliverables') {
      options.skip_deliverables = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/diagnose-mineru-mcp.js [options]

Options:
  --server <name>         MCP server name, default: mineru
  --task-id <id>          Existing OCR task_id to inspect
  --timeout-ms <ms>       MCP call timeout in ms, default: 30000
  --skip-deliverables     Skip deliverable-related tool calls
`);
}

function simplifyResult(result) {
  if (result == null) return result;
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.slice(0, 5).map(item => simplifyResult(item));
  if (typeof result !== 'object') return result;

  const summary = {};
  const keys = Object.keys(result).slice(0, 12);
  for (const key of keys) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 500) {
      summary[key] = `${value.slice(0, 500)}...[truncated ${value.length - 500} chars]`;
    } else if (Array.isArray(value)) {
      summary[key] = value.slice(0, 5).map(item => simplifyResult(item));
    } else if (value && typeof value === 'object') {
      summary[key] = simplifyResult(value);
    } else {
      summary[key] = value;
    }
  }
  return summary;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const db = new Database({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionLimit: 5,
  });

  await db.connect();
  const residentSkillManager = new ResidentSkillManager(db);

  try {
    await residentSkillManager.initialize();

    const mcpToolCaller = new McpToolCaller(db, { residentSkillManager });

    const admin_token = await mcpToolCaller.generateAdminToken();

    const report = {
      started_at: new Date().toISOString(),
      server_name: options.server_name,
      timeout_ms: options.timeout_ms,
      steps: [],
    };

    async function runStep(name, fn) {
      const started_at = new Date().toISOString();
      try {
        const result = await fn();
        report.steps.push({
          name,
          ok: true,
          started_at,
          finished_at: new Date().toISOString(),
          result: simplifyResult(result),
        });
        return result;
      } catch (error) {
        report.steps.push({
          name,
          ok: false,
          started_at,
          finished_at: new Date().toISOString(),
          error: error.message,
        });
        throw error;
      }
    }

    const servers = await runStep('list_servers', async () => {
      return await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        { action: 'list_servers' },
        { accessToken: admin_token, isAdmin: true },
        options.timeout_ms,
      );
    });

    const targetServer = (servers?.servers || []).find(item => item?.name === options.server_name);
    if (!targetServer) {
      throw new Error(`MCP server not found in list_servers: ${options.server_name}`);
    }

    await runStep('refresh_tools', async () => {
      return await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        { action: 'refresh_tools', server_name: options.server_name },
        { accessToken: admin_token, isAdmin: true },
        options.timeout_ms,
      );
    });

    await runStep('list_tools_after_refresh', async () => {
      return await residentSkillManager.invokeByName(
        'mcp-client',
        'invoke',
        { action: 'list_tools' },
        { accessToken: admin_token, isAdmin: true },
        options.timeout_ms,
      );
    });

    if (options.task_id) {
      await runStep('get_task_status', async () => {
        return await mcpToolCaller.callMcp(
          options.server_name,
          'get_task_status',
          { task_id: options.task_id },
          options.timeout_ms,
        );
      });

      if (!options.skip_deliverables) {
        await runStep('list_deliverables', async () => {
          return await mcpToolCaller.callMcp(
            options.server_name,
            'list_deliverables',
            { task_id: options.task_id },
            options.timeout_ms,
          );
        });

        await runStep('get_default_deliverable', async () => {
          return await mcpToolCaller.callMcp(
            options.server_name,
            'get_default_deliverable',
            { task_id: options.task_id },
            options.timeout_ms,
          );
        });
      }
    }

    report.finished_at = new Date().toISOString();
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await residentSkillManager.shutdown().catch(() => {});
    await db.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[diagnose-mineru-mcp] failed:', error.message);
  process.exitCode = 1;
});
