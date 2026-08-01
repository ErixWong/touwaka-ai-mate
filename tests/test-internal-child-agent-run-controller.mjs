/**
 * Tests for internal child Agent run execution endpoint handler.
 *
 * Usage:
 *   node tests/test-internal-child-agent-run-controller.mjs
 */

import assert from 'node:assert/strict';
import InternalController from '../server/controllers/internal.controller.js';
import { sealAgentDelegation } from '../lib/agent/agent-delegation-integrity.js';
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

  return sealAgentDelegation({
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
  });
}

function createUnsignedDelegation() {
  const sealed = createDelegation();
  const { integrity, ...delegation } = sealed;
  return delegation;
}

function createPermissionService(allowed = true) {
  return {
    calls: [],
    async canAccessExpert(userId, expertId) {
      this.calls.push({ userId, expertId });
      return allowed;
    },
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
  const permissionService = createPermissionService(true);
  const controller = new InternalController(createDbStub(), {
    permissionService,
    chatService: {
      async executeChildDelegation(delegation, options) {
        calls.push({ delegation, options });
        options.onDelta({ type: 'delta', content: 'child event' });
        return { fullContent: 'done' };
      },
    },
  });
  const spoofedSession = { id: 'attacker', accessToken: 'token_spoof' };
  const ctx = createCtx({
    delegation: createDelegation(),
    session: spoofedSession,
  });

  await controller.executeChildAgentRun(ctx);

  assert.equal(ctx.body.code, 200);
  assert.equal(ctx.body.data.result.fullContent, 'done');
  assert.deepEqual(ctx.body.data.events, [{ type: 'delta', content: 'child event' }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delegation.child_invocation.run_id, 'child_run_internal_1');
  assert.equal(calls[0].options.session, ctx.state.session);
  assert.notEqual(calls[0].options.session, spoofedSession);
  assert.deepEqual(permissionService.calls, [{
    userId: 'user_internal',
    expertId: 'expert_child',
  }]);
}

async function testRejectsPrincipalMismatch() {
  const controller = new InternalController(createDbStub(), {
    permissionService: createPermissionService(true),
    chatService: {
      async executeChildDelegation() {
        throw new Error('unexpected');
      },
    },
  });
  const delegation = createDelegation();
  const ctx = createCtx({
    delegation: {
      ...delegation,
      child_invocation: {
        ...delegation.child_invocation,
        principal_user_id: 'attacker',
      },
    },
  });

  await controller.executeChildAgentRun(ctx);

  assert.equal(ctx.status, 403);
  assert.match(ctx.body.message, /integrity verification failed/);
}

async function testRejectsUnsignedDelegation() {
  const controller = new InternalController(createDbStub(), {
    permissionService: createPermissionService(true),
    chatService: {
      async executeChildDelegation() {
        throw new Error('unexpected');
      },
    },
  });
  const ctx = createCtx({ delegation: createUnsignedDelegation() });

  await controller.executeChildAgentRun(ctx);

  assert.equal(ctx.status, 403);
  assert.match(ctx.body.message, /integrity verification failed/);
}

async function testRejectsUnauthorizedChildExpert() {
  const controller = new InternalController(createDbStub(), {
    permissionService: createPermissionService(false),
    chatService: {
      async executeChildDelegation() {
        throw new Error('unexpected');
      },
    },
  });
  const ctx = createCtx({ delegation: createDelegation() });

  await controller.executeChildAgentRun(ctx);

  assert.equal(ctx.status, 403);
  assert.match(ctx.body.message, /no permission/);
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

async function testInvokeResidentToolPassesUserContextAndTimeout() {
  const calls = [];
  const controller = new InternalController(createDbStub());
  controller.setResidentSkillManager({
    async invokeByName(skillId, toolName, params, userContext, timeout) {
      calls.push({ skillId, toolName, params, userContext, timeout });
      return { ok: true };
    },
  });
  const ctx = createCtx({
    skill_id: 'agent-child-runner',
    tool_name: 'invoke',
    params: { action: 'status', child_run_id: 'child_1' },
    timeout: 1234,
  });
  ctx.state.session = {
    id: 'user_internal',
    accessToken: 'token_internal',
    expertId: 'expert_internal',
    isAdmin: true,
    workingDirectory: 'D:/work/task',
  };

  await controller.invokeResidentTool(ctx);

  assert.equal(ctx.body.code, 200);
  assert.equal(ctx.body.data.ok, true);
  assert.deepEqual(calls, [{
    skillId: 'agent-child-runner',
    toolName: 'invoke',
    params: { action: 'status', child_run_id: 'child_1' },
    userContext: {
      userId: 'user_internal',
      accessToken: 'token_internal',
      expertId: 'expert_internal',
      isAdmin: true,
      workingDirectory: 'D:/work/task',
    },
    timeout: 1234,
  }]);
}

async function main() {
  await testExecuteChildAgentRunUsesChatService();
  await testRejectsPrincipalMismatch();
  await testRejectsUnsignedDelegation();
  await testRejectsUnauthorizedChildExpert();
  await testRejectsMissingDelegation();
  await testInvokeResidentToolPassesUserContextAndTimeout();

  console.log('Internal child Agent run controller tests passed.');
}

main();
