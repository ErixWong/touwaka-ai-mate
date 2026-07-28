/**
 * Tests for internal child Agent run execution endpoint handler.
 *
 * Usage:
 *   node tests/test-internal-child-agent-run-controller.mjs
 */

import assert from 'node:assert/strict';
import InternalController from '../server/controllers/internal.controller.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDbStub() {
  return {
    getModel() {
      return {};
    },
  };
}

function createDelegation() {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_internal_parent',
    principal_user_id: 'user_internal',
    agent_id: 'expert_parent',
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_internal_1',
    callee_agent_id: 'expert_child',
    capability_scope: { tools: ['search'] },
  });

  return {
    status: 'accepted',
    parent_invocation: parent,
    child_invocation: child,
    callee_definition: {
      agent_id: 'expert_child',
      source_type: 'expert',
      display_name: 'Child Expert',
      execution_policy: { mode: 'llm' },
    },
    task: 'Search project',
    requested_scope: { tools: ['search'] },
    effective_scope: { tools: ['search'] },
  };
}

function createCtx(body = {}) {
  return {
    ip: '127.0.0.1',
    request: {
      body,
      headers: {},
      ip: '127.0.0.1',
    },
    state: {
      session: {
        id: 'user_internal',
        userId: 'user_internal',
      },
    },
    success(data) {
      this.body = { code: 200, message: 'success', data };
    },
    error(message, status = 500, extra = null) {
      this.status = status;
      this.body = { code: status, message, data: extra };
    },
  };
}

async function testExecuteChildAgentRunUsesChatService() {
  const calls = [];
  const controller = new InternalController(createDbStub(), {
    chatService: {
      async executeChildDelegation(delegation, options) {
        calls.push({ delegation, options });
        return { fullContent: 'done' };
      },
    },
  });
  const session = { id: 'user_internal', accessToken: 'token_1' };
  const ctx = createCtx({
    delegation: createDelegation(),
    session,
  });

  await controller.executeChildAgentRun(ctx);

  assert.equal(ctx.body.code, 200);
  assert.equal(ctx.body.data.fullContent, 'done');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delegation.child_invocation.run_id, 'child_run_internal_1');
  assert.equal(calls[0].options.session, session);
}

async function testRejectsMissingDelegation() {
  const controller = new InternalController(createDbStub(), {
    chatService: {
      async executeChildDelegation() {
        throw new Error('unexpected');
      },
    },
  });
  const ctx = createCtx({});

  await controller.executeChildAgentRun(ctx);

  assert.equal(ctx.status, 400);
  assert.match(ctx.body.message, /delegation\.child_invocation\.run_id is required/);
}

async function main() {
  await testExecuteChildAgentRunUsesChatService();
  await testRejectsMissingDelegation();

  console.log('Internal child Agent run controller tests passed.');
}

main();
