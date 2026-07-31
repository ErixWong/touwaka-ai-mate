/**
 * Contract E2E for the chat API delegation conversation path.
 *
 * It opens a real HTTP Koa server with the production /api/chat routes and
 * StreamController. The LLM turn is scripted, but child delegation is executed
 * through AgentDelegateControlFacade so the test covers:
 *
 *   GET /api/chat/stream -> POST /api/chat -> SSE tool_call/tool_result/complete
 *   parent expert -> agent_delegate_start/status/result -> child run result
 *
 * Usage:
 *   node tests/test-api-agent-delegation-chat-contract.mjs
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import responseMiddleware from '../server/middlewares/response.js';
import chatRoutes from '../server/routes/chat.routes.js';
import StreamController from '../server/controllers/stream.controller.js';
import { generateTokens } from '../server/middlewares/auth.js';
import { AgentDelegationService } from '../lib/agent/agent-delegation-service.js';
import { AgentDelegateControlFacade } from '../lib/agent/agent-delegate-control-facade.js';
import { buildRootAgentInvocationContext } from '../lib/agent/agent-invocation-context.js';

const USER_ID = 'user_api_delegate_contract';
const PARENT_EXPERT_ID = 'expert_parent_contract';
const CHILD_EXPERT_ID = 'expert_child_contract';
const MARKER = 'SUB_AGENT_CONTRACT_CHILD_OK';

function createModelStub(defaultValue = null) {
  return {
    create: async () => ({}),
    update: async () => [1],
    findOne: async () => defaultValue,
    findAll: async () => [],
  };
}

function createFakeDb() {
  const models = {
    user: {
      findOne: async ({ where }) => where?.id === USER_ID
        ? { id: USER_ID, status: 'active' }
        : null,
    },
    user_role: {
      findAll: async () => [{ role: { mark: 'admin' } }],
    },
    role: createModelStub(),
    chat_request: {
      records: new Map(),
      async create(record) {
        this.records.set(record.request_id, { ...record });
        return record;
      },
      async update(updates, { where }) {
        const request = this.records.get(where.request_id);
        if (request) {
          Object.assign(request, updates);
        }
        return [request ? 1 : 0];
      },
      async findOne({ where }) {
        return this.records.get(where.request_id) || null;
      },
    },
    topic: {
      async findOne() {
        return { id: 'topic_delegate_contract' };
      },
      async create(record) {
        return record;
      },
    },
    expert: {
      async findOne({ where }) {
        if ([PARENT_EXPERT_ID, CHILD_EXPERT_ID].includes(where?.id)) {
          return { id: where.id, is_active: true };
        }
        return null;
      },
    },
    message: {
      async findOne() {
        return null;
      },
    },
    system_setting: {
      async findOne() {
        return null;
      },
    },
  };

  return {
    Op: { lte: Symbol('lte'), or: Symbol('or'), in: Symbol('in') },
    getModel(name) {
      return models[name] || createModelStub();
    },
    query: async () => [],
    sequelize: {
      transaction: async () => ({
        commit: async () => {},
        rollback: async () => {},
      }),
    },
    _models: models,
  };
}

class ScriptedChildRunScheduler {
  constructor() {
    this.runs = new Map();
  }

  async start(delegation) {
    const child_run_id = delegation.child_invocation.run_id;
    const record = {
      child_run_id,
      status: 'completed',
      result: {
        fullContent: `${MARKER}`,
        child_invocation: delegation.child_invocation,
      },
      events: [
        { type: 'delta', content: MARKER },
      ],
    };
    this.runs.set(child_run_id, record);
    return {
      child_run_id,
      status: 'queued',
      has_result: false,
      event_count: 0,
    };
  }

  async getStatus(child_run_id) {
    const record = this.runs.get(child_run_id);
    if (!record) {
      throw new Error(`child run not found: ${child_run_id}`);
    }
    return {
      child_run_id,
      status: record.status,
      has_result: true,
      event_count: record.events.length,
    };
  }

  async getResult(child_run_id) {
    const record = this.runs.get(child_run_id);
    if (!record) {
      throw new Error(`child run not found: ${child_run_id}`);
    }
    return record;
  }

  async cancel(child_run_id) {
    return {
      child_run_id,
      status: 'cancelled',
    };
  }
}

function createControlFacade() {
  const definition_resolver = {
    async resolve({ source_type, agent_id }) {
      if (source_type !== 'expert' || agent_id !== CHILD_EXPERT_ID) {
        return null;
      }
      return {
        source_type: 'expert',
        agent_id: CHILD_EXPERT_ID,
        is_active: true,
        display_name: 'Contract Child Expert',
        capabilities: { tools: [] },
        execution_policy: { mode: 'llm' },
      };
    },
  };

  const delegation_service = new AgentDelegationService({
    definition_resolver,
  });
  const child_run_scheduler = new ScriptedChildRunScheduler();
  return new AgentDelegateControlFacade({
    delegation_service,
    child_run_scheduler,
  });
}

function createScriptedChatService(controlFacade) {
  return {
    async streamChat(input, onDelta, onComplete) {
      const parent_invocation = buildRootAgentInvocationContext({
        run_id: input.request_id,
        principal_user_id: input.user_id,
        agent_id: input.expert_id,
        topic_id: input.topic_id,
        request_id: input.request_id,
        capability_scope: {
          tools: ['agent_delegate_start', 'agent_delegate_status', 'agent_delegate_result'],
        },
      });
      const context = {
        parent_invocation,
        session: input.session,
        caller_scope: { tools: ['agent_delegate_start', 'agent_delegate_status', 'agent_delegate_result'] },
        principal_scope: { tools: ['agent_delegate_start', 'agent_delegate_status', 'agent_delegate_result'] },
        workspace_scope: {},
      };

      onDelta({ type: 'start', topic_id: input.topic_id });

      onDelta({
        type: 'tool_call',
        tool_name: 'agent_delegate_start',
        arguments: {
          source_type: 'expert',
          agent_id: CHILD_EXPERT_ID,
          task: `Return ${MARKER}`,
        },
      });
      const started = await controlFacade.handleToolCall('agent_delegate_start', {
        source_type: 'expert',
        agent_id: CHILD_EXPERT_ID,
        task: `Return ${MARKER}`,
        input: { marker: MARKER },
        requested_scope: { tools: [] },
      }, context);
      assert.equal(started.success, true);
      onDelta({ type: 'tool_result', result: started });

      const child_run_id = started.data.child_run_id;
      onDelta({ type: 'tool_call', tool_name: 'agent_delegate_status', arguments: { child_run_id } });
      const status = await controlFacade.handleToolCall('agent_delegate_status', { child_run_id }, context);
      assert.equal(status.success, true);
      onDelta({ type: 'tool_result', result: status });

      onDelta({ type: 'tool_call', tool_name: 'agent_delegate_result', arguments: { child_run_id } });
      const result = await controlFacade.handleToolCall('agent_delegate_result', { child_run_id }, context);
      assert.equal(result.success, true);
      onDelta({ type: 'tool_result', result });

      onComplete({
        fullContent: `SUB_AGENT_RESULT: ${result.data.result.fullContent}`,
        message: {
          id: 'message_delegate_contract',
          topic_id: input.topic_id,
          content: `SUB_AGENT_RESULT: ${result.data.result.fullContent}`,
        },
        user_message_id: 'user_message_delegate_contract',
      });
    },
    abortRequest: async () => true,
  };
}

function requestJson(baseUrl, path, {
  method = 'GET',
  token = null,
  body = null,
} = {}) {
  const url = new URL(path, baseUrl);
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        text += chunk;
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function parseSse(buffer, onEvent) {
  let remaining = buffer;
  let index = remaining.indexOf('\n\n');
  while (index !== -1) {
    const raw = remaining.slice(0, index);
    remaining = remaining.slice(index + 2);
    index = remaining.indexOf('\n\n');
    const event = { event: 'message', data: '' };
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) {
        event.event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        event.data += line.slice('data:'.length).trim();
      }
    }
    if (event.data) {
      event.data = JSON.parse(event.data);
    }
    onEvent(event);
  }
  return remaining;
}

function openSse(baseUrl, token, events) {
  const url = new URL('/api/chat/stream', baseUrl);
  url.searchParams.set('expert_id', PARENT_EXPERT_ID);
  url.searchParams.set('token', token);

  let buffer = '';
  let req;
  const connected = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for SSE connected event'));
    }, 5000);
    req = http.get(url, { headers: { Accept: 'text/event-stream' } }, res => {
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer = parseSse(buffer + chunk, event => {
          events.push(event);
          if (event.event === 'connected') {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      res.on('end', () => {
        if (!events.some(event => event.event === 'connected')) {
          reject(new Error(`SSE ended before connected event with status ${res.statusCode}`));
        }
      });
      res.on('error', error => {
        clearTimeout(timer);
        reject(error);
      });
    });
    req.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });

  return {
    connected,
    close() {
      req?.destroy();
    },
  };
}

async function waitForEvent(events, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.find(predicate);
    if (found) {
      return found;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for SSE event');
}

async function startServer() {
  const db = createFakeDb();
  const controlFacade = createControlFacade();
  const controller = new StreamController(db, createScriptedChatService(controlFacade));
  controller._ensureRequestMaintenanceReady = async () => {};
  controller.checkExpertAccess = async () => ({ allowed: true, reason: null });

  const app = new Koa();
  app.context.db = db;
  app.use(responseMiddleware());
  app.use(bodyParser());
  app.use(chatRoutes(controller, {
    permissionService: {
      async getAccessibleExperts() {
        return [
          { id: PARENT_EXPERT_ID, name: 'Contract Parent Expert' },
          { id: CHILD_EXPERT_ID, name: 'Contract Child Expert' },
        ];
      },
    },
  }).routes());

  const server = http.createServer(app.callback());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function main() {
  const { server, baseUrl } = await startServer();
  const { access_token } = generateTokens(USER_ID, 'admin', {
    accessExpiry: '1h',
    refreshExpiry: '1h',
  });
  const events = [];
  const sse = openSse(baseUrl, access_token, events);

  try {
    await sse.connected;
    const response = await requestJson(baseUrl, '/api/chat', {
      method: 'POST',
      token: access_token,
      body: {
        expert_id: PARENT_EXPERT_ID,
        content: '请调用子专家并返回结果',
      },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data?.code, 200);
    const request_id = response.data.data.request_id;

    const complete = await waitForEvent(events, event =>
      event.event === 'complete' && event.data?.request_id === request_id
    );
    assert.match(complete.data.fullContent, new RegExp(`SUB_AGENT_RESULT: ${MARKER}`));

    const relevant = events.filter(event => event.data?.request_id === request_id);
    const serialized = JSON.stringify(relevant);
    assert.match(serialized, /agent_delegate_start/);
    assert.match(serialized, /agent_delegate_status/);
    assert.match(serialized, /agent_delegate_result/);
    assert.match(serialized, new RegExp(MARKER));

    console.log('API agent delegation chat contract test passed.');
    console.log(JSON.stringify({
      request_id,
      events: relevant.map(event => ({
        event: event.event,
        tool_name: event.data?.tool_name || null,
        has_result: Boolean(event.data?.result),
      })),
    }, null, 2));
  } finally {
    sse.close();
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
