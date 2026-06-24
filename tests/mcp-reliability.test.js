import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import ToolManager from '../lib/tool-manager.js';
import StatelessHTTPTransport from '../lib/mcp-stateless-http.js';
import { __testing as mcpClientTesting } from '../data/skills/mcp-client/index.js';

function createToolManager() {
  return {
    mcpToolRegistry: new Map(),
    getMcpToolDefinitions: ToolManager.prototype.getMcpToolDefinitions,
    getToolInfo: ToolManager.prototype.getToolInfo,
    executeMcpTool: ToolManager.prototype.executeMcpTool,
  };
}

test('ToolManager maps MCP tool definitions using resident payload contract', async () => {
  const originalResidentSkillManager = global.residentSkillManager;
  global.residentSkillManager = {
    async invokeByName() {
      return {
        tools: [
          {
            name: 'mcp_github_search_repositories',
            server_name: 'github',
            original_name: 'search_repositories',
            description: 'Search repositories',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
            },
          },
        ],
      };
    },
  };

  try {
    const toolManager = createToolManager();
    const definitions = await toolManager.getMcpToolDefinitions({ userId: 'user-1' });

    assert.equal(definitions.length, 1);
    assert.equal(definitions[0].function.name, 'mcp_github_search_repositories');
    assert.equal(definitions[0].function.description, '[MCP/github] Search repositories');

    const info = toolManager.getToolInfo('mcp_github_search_repositories');
    assert.equal(info.serverName, 'github');
    assert.equal(info.toolName, 'search_repositories');
  } finally {
    global.residentSkillManager = originalResidentSkillManager;
  }
});

test('ToolManager sends snake_case params when invoking MCP tools', async () => {
  const originalResidentSkillManager = global.residentSkillManager;
  let capturedPayload = null;

  global.residentSkillManager = {
    async invokeByName(skillName, toolName, payload, userContext) {
      capturedPayload = { skillName, toolName, payload, userContext };
      return { ok: true };
    },
  };

  try {
    const toolManager = createToolManager();
    toolManager.mcpToolRegistry.set('mcp_alpha_echo', {
      serverName: 'alpha',
      toolName: 'echo',
    });

    const result = await toolManager.executeMcpTool(
      'mcp_alpha_echo',
      { text: 'hello' },
      { userId: 'user-1', taskContext: { absolute_workspace_path: '/data/work/user-1/task-1' } },
      'MCP/alpha/echo'
    );

    assert.equal(result.success, true);
    assert.deepEqual(capturedPayload, {
      skillName: 'mcp-client',
      toolName: 'invoke',
      payload: {
        action: 'call_tool',
        server_name: 'alpha',
        tool_name: 'echo',
        arguments: { text: 'hello' },
      },
      userContext: {
        userId: 'user-1',
        workingDirectory: '/data/work/user-1/task-1',
      },
    });
  } finally {
    global.residentSkillManager = originalResidentSkillManager;
  }
});

test('connectServer rolls back state when tool caching fails after connect', async () => {
  mcpClientTesting.resetState();

  let closeCount = 0;
  mcpClientTesting.setClientFactory(() => ({
    async connect() {
      return undefined;
    },
    async listTools() {
      throw new Error('listTools failed');
    },
    async close() {
      closeCount += 1;
    },
  }));
  mcpClientTesting.setTransportFactory(async () => ({ kind: 'fake-transport' }));

  await assert.rejects(
    () => mcpClientTesting.connectServer({ name: 'alpha', transport_type: 'http', url: 'http://example.test/mcp' }),
    /listTools failed/
  );

  assert.deepEqual(mcpClientTesting.getConnectionKeys(), []);
  assert.deepEqual(mcpClientTesting.getToolsCacheKeys(), []);
  assert.equal(closeCount, 1);

  mcpClientTesting.resetState();
});

test('getUserTools reads private tool cache using connectionKey isolation', async () => {
  mcpClientTesting.resetState();

  mcpClientTesting.setConnection('alpha:user-1', { client: {} });
  mcpClientTesting.setToolsCache('alpha:user-1', [
    {
      name: 'private_tool',
      description: 'Private tool',
      inputSchema: { type: 'object', properties: {} },
    },
  ]);

  const tools = await mcpClientTesting.getUserTools('user-1', {
    servers: [
      {
        id: 'server-1',
        name: 'alpha',
        is_enabled: true,
        is_public: false,
        requires_credentials: true,
      },
    ],
    user_credentials: [
      {
        mcp_server_id: 'server-1',
        is_enabled: true,
        credentials: { token: 'secret' },
      },
    ],
    default_credentials: [],
  });

  assert.deepEqual(tools.map(tool => tool.name), ['mcp_alpha_private_tool']);

  mcpClientTesting.resetState();
});

test('StatelessHTTPTransport times out stalled SSE reads', async () => {
  const transport = new StatelessHTTPTransport(new URL('http://example.test/mcp'), {
    timeout: 20,
  });

  let aborted = 0;
  const controller = {
    abort() {
      aborted += 1;
    },
  };

  const response = {
    body: {
      getReader() {
        return {
          read() {
            return new Promise(() => {});
          },
          async cancel() {
            return undefined;
          },
        };
      },
    },
  };

  await assert.rejects(
    () => transport._handleSSE(response, controller),
    /SSE read timeout after 20ms/
  );
  assert.equal(aborted, 1);
});

test('MCP file_path resolves relative paths inside working directory', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-file-path-'));
  const originalDataBasePath = process.env.DATA_BASE_PATH;

  try {
    process.env.DATA_BASE_PATH = tempRoot;
    const workDir = path.join(tempRoot, 'work', 'user-1', 'task-1');
    await fs.mkdir(workDir, { recursive: true });
    const nestedFile = path.join(workDir, 'docs', 'report.txt');
    await fs.mkdir(path.dirname(nestedFile), { recursive: true });
    await fs.writeFile(nestedFile, 'hello world', 'utf8');

    const result = mcpClientTesting.resolveFilePathWithinWorkingDirectory('docs/report.txt', {
      userId: 'user-1',
      workingDirectory: 'work/user-1/task-1',
    });

    assert.equal(result.baseDir, path.resolve(workDir));
    assert.equal(result.absolutePath, path.resolve(nestedFile));
  } finally {
    if (originalDataBasePath === undefined) {
      delete process.env.DATA_BASE_PATH;
    } else {
      process.env.DATA_BASE_PATH = originalDataBasePath;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('MCP file_path rejects paths escaping working directory', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-file-path-'));
  const originalDataBasePath = process.env.DATA_BASE_PATH;

  try {
    process.env.DATA_BASE_PATH = tempRoot;
    const workDir = path.join(tempRoot, 'work', 'user-1', 'task-1');
    await fs.mkdir(workDir, { recursive: true });

    assert.throws(
      () => mcpClientTesting.resolveFilePathWithinWorkingDirectory('../secret.txt', {
        userId: 'user-1',
        workingDirectory: 'work/user-1/task-1',
      }),
      /Path not allowed in MCP file_path/
    );
  } finally {
    if (originalDataBasePath === undefined) {
      delete process.env.DATA_BASE_PATH;
    } else {
      process.env.DATA_BASE_PATH = originalDataBasePath;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('MCP file_path without working directory falls back to user temp workspace', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-file-path-'));
  const originalDataBasePath = process.env.DATA_BASE_PATH;

  try {
    process.env.DATA_BASE_PATH = tempRoot;
    const userTempDir = path.join(tempRoot, 'work', 'user-1', 'temp');
    await fs.mkdir(userTempDir, { recursive: true });
    const allowedFile = path.join(userTempDir, 'note.txt');
    await fs.writeFile(allowedFile, 'ok', 'utf8');

    const result = mcpClientTesting.resolveFilePathWithinWorkingDirectory('note.txt', {
      userId: 'user-1',
    });

    assert.equal(result.baseDir, path.resolve(userTempDir));
    assert.equal(result.absolutePath, path.resolve(allowedFile));
  } finally {
    if (originalDataBasePath === undefined) {
      delete process.env.DATA_BASE_PATH;
    } else {
      process.env.DATA_BASE_PATH = originalDataBasePath;
    }
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
