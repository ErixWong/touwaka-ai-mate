/**
 * Issue #1287 —— 内部 MCP 配置接口（POST /internal/mcp/config）启动期 401。
 *
 * 因果链（每一环都有代码位置）：
 *   1. `server/index.js:714` 把 `/internal/*` 挂在 `authMiddleware`（用户 JWT）下；
 *   2. 驻留技能 `data/skills/mcp-client` 除 shutdown/exit 外每个动作都先 `fetchConfig()`；
 *   3. token 取值顺序 `userContext.accessToken || INTERNAL_TOKEN || ''`；
 *   4. 宿主侧 `lib/tool-manager.js:getMcpToolDefinitions()` 原来只往下传 `{ userId }`，
 *      **把已经拿到的用户凭证丢了** ⇒ 空 Bearer ⇒ 401。
 *
 * 本文件钉住三件事：
 *   A. 有用户上下文（凭证在顶层或在 session 里）时，凭证必须原样传到驻留进程；
 *   B. 真没有凭证时不要发那一发注定 401 的请求（懒加载），但也不能静默（有可诊断日志）；
 *   C. 红线守卫：`/internal/*` 的鉴权不许为了「消掉 401」被摘掉。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import ToolManager from '../lib/tool-manager.js';
import CapabilityRegistry, { CAPABILITY_KINDS } from '../lib/capability-registry.js';
import { __testing as mcpClientTesting } from '../data/skills/mcp-client/index.js';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function createToolManager(residentSkillManager) {
  return {
    residentSkillManager,
    capabilityRegistry: new CapabilityRegistry(),
    mcpToolRegistry: new Map(),
    getMcpToolDefinitions: ToolManager.prototype.getMcpToolDefinitions,
    getToolInfo: ToolManager.prototype.getToolInfo,
    getCapabilityPermissionDenied: ToolManager.prototype.getCapabilityPermissionDenied,
    getUserRole: ToolManager.prototype.getUserRole,
    executeMcpTool: ToolManager.prototype.executeMcpTool,
  };
}

function captureResident() {
  const calls = [];
  return {
    calls,
    manager: {
      async invokeByName(skillId, toolName, params, userContext, timeoutMs) {
        calls.push({ skillId, toolName, params, userContext, timeoutMs });
        return { tools: [] };
      },
    },
  };
}

test('#1287：chat 路径的用户凭证只在 session 里，也必须透传到驻留进程', async () => {
  const { calls, manager } = captureResident();
  const toolManager = createToolManager(manager);

  // lib/chat/turn-context-builder.js 的 toolContext 形状：没有顶层 accessToken，凭证在 session 里
  await toolManager.getMcpToolDefinitions({
    user_id: 'user-1',
    expert_id: 'expert-1',
    session: { id: 'user-1', roles: ['user'], isAdmin: false, accessToken: 'jwt-from-session' },
  });

  assert.equal(calls.length, 1, '有用户上下文时必须真的去拉配置');
  assert.deepEqual(calls[0].userContext, { userId: 'user-1', accessToken: 'jwt-from-session' });
});

test('#1287：顶层 accessToken 形状（executeSkillTool）同样透传', async () => {
  const { calls, manager } = captureResident();
  const toolManager = createToolManager(manager);

  await toolManager.getMcpToolDefinitions({ userId: 'user-2', accessToken: 'jwt-top-level' });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].userContext, { userId: 'user-2', accessToken: 'jwt-top-level' });
});

test('#1287：真没有用户凭证时不发那一发注定 401 的请求（懒加载），且返回空列表', async () => {
  const { calls, manager } = captureResident();
  const toolManager = createToolManager(manager);

  const definitions = await toolManager.getMcpToolDefinitions({});

  assert.deepEqual(definitions, []);
  assert.equal(calls.length, 0, '无凭证时不应再向驻留进程发起 list_tools（否则空 Bearer ⇒ 401）');
});

test('#1287：真调 MCP 工具（call_tool）时同样要带凭证，否则工具列得出来却调不动', async () => {
  const { calls, manager } = captureResident();
  const toolManager = createToolManager(manager);
  toolManager.mcpToolRegistry.set('mcp_mineru_list_tasks', {
    serverName: 'mineru',
    toolName: 'list_tasks',
  });
  toolManager.capabilityRegistry.register({
    id: 'mcp_mineru_list_tasks',
    kind: CAPABILITY_KINDS.MCP,
    definition: { type: 'function', function: { name: 'mcp_mineru_list_tasks' } },
  });

  const result = await toolManager.executeMcpTool(
    'mcp_mineru_list_tasks',
    { limit: 1 },
    { user_id: 'user-1', session: { id: 'user-1', accessToken: 'jwt-from-session' } },
    'MCP/mineru/list_tasks',
  );

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.action, 'call_tool');
  assert.equal(calls[0].userContext.accessToken, 'jwt-from-session');
});

test('#1287：技能侧无凭证时不请求 /internal/mcp/config，而是抛可区分的 NO_CREDENTIAL', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not be called without a credential');
  };
  try {
    mcpClientTesting.resetState();
    await assert.rejects(
      () => mcpClientTesting.processAction('list_tools', {}, 'user-1', ''),
      (err) => {
        assert.equal(err.code, 'NO_CREDENTIAL', '无凭证必须是可区分的错误码，不能伪装成 401');
        return true;
      },
    );
    assert.equal(fetchCalls, 0, '无凭证时不得发出空 Bearer 请求');
  } finally {
    globalThis.fetch = originalFetch;
    mcpClientTesting.resetState();
  }
});

test('#1287：宿主 stop() 发的 exit 命令不拉配置（关闭链路本来就没有用户上下文）', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('shutdown path must not fetch config');
  };
  try {
    mcpClientTesting.resetState();
    const result = await mcpClientTesting.processAction('exit', {}, '', '');
    assert.deepEqual(result, { message: 'All connections closed' });
    assert.equal(fetchCalls, 0, 'exit 不该触发 /internal/mcp/config');
  } finally {
    globalThis.fetch = originalFetch;
    mcpClientTesting.resetState();
  }
});

test('#1287 红线：/internal/* 仍然挂在用户 JWT 中间件下（不许为了消 401 放宽鉴权）', () => {
  const routesSource = readFileSync(path.join(REPO_ROOT, 'server/routes/internal.routes.js'), 'utf-8');
  const serverSource = readFileSync(path.join(REPO_ROOT, 'server/index.js'), 'utf-8');

  assert.match(
    routesSource,
    /const requireAuth = authMiddleware\.authenticate\(\);/,
    'internal 路由必须继续用 authMiddleware.authenticate()',
  );
  assert.match(
    routesSource,
    /router\.post\('\/mcp\/config',\s*requireAuth,/,
    'POST /internal/mcp/config 必须继续要求认证',
  );
  assert.match(
    serverSource,
    /internalRoutes\(this\.controllers\.internal, this\.controllers\.internalDocs, authMiddleware\)/,
    'internalRoutes 必须继续注入 authMiddleware',
  );
});
