/**
 * Tests for AgentDelegationService contract.
 *
 * Usage:
 *   node tests/test-agent-delegation-service.mjs
 */

import assert from 'node:assert/strict';
import { AgentDelegationService } from '../lib/agent/agent-delegation-service.js';
import { buildRootAgentInvocationContext } from '../lib/agent/agent-invocation-context.js';

function createParentInvocation() {
  return buildRootAgentInvocationContext({
    run_id: 'root_run_1',
    principal_user_id: 'user_1',
    agent_id: 'expert_parent',
    topic_id: 'topic_1',
  });
}

function createDefinition(overrides = {}) {
  return {
    agent_id: 'expert_child',
    source_type: 'expert',
    display_name: 'Child Expert',
    execution_policy: {
      mode: 'llm',
      supports_delegation: true,
    },
    capability_declarations: {
      skills: [{ skill_id: 'skill_search', mark: 'search' }],
      document_retrieval: { enabled: true },
    },
    is_active: true,
    ...overrides,
  };
}

async function testDelegationBuildsChildRun() {
  const events = [];
  const service = new AgentDelegationService({
    definition_resolver: {
      async resolve({ source_type, agent_id }) {
        assert.equal(source_type, 'expert');
        assert.equal(agent_id, 'expert_child');
        return createDefinition();
      },
    },
    event_sink: event => events.push(event),
  });

  const delegation = await service.delegate({
    parent_invocation: createParentInvocation(),
    target: { source_type: 'expert', agent_id: 'expert_child' },
    task: 'Search the project',
    input: { query: 'agent' },
    caller_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    principal_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    workspace_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    requested_scope: {
      tools: ['search'],
      skills: ['search'],
    },
  });

  assert.equal(delegation.status, 'accepted');
  assert.equal(delegation.child_invocation.parent_run_id, 'root_run_1');
  assert.equal(delegation.child_invocation.principal_user_id, 'user_1');
  assert.equal(delegation.child_invocation.caller_agent_id, 'expert_parent');
  assert.equal(delegation.child_invocation.callee_agent_id, 'expert_child');
  assert.equal(delegation.child_invocation.delegation_depth, 1);
  assert.deepEqual(delegation.effective_scope.tools, ['search']);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'delegation_created');
  assert.equal(events[0].callee_agent_id, 'expert_child');
}

async function testRejectsDeniedCapability() {
  const service = new AgentDelegationService({
    definition_resolver: {
      async resolve() {
        return createDefinition();
      },
    },
  });

  await assert.rejects(() => service.delegate({
    parent_invocation: createParentInvocation(),
    target: { source_type: 'expert', agent_id: 'expert_child' },
    task: 'Write a file',
    caller_scope: { tools: ['search'], skills: ['search'] },
    principal_scope: { tools: ['search'], skills: ['search'] },
    workspace_scope: { tools: ['search'], skills: ['search'] },
    requested_scope: { tools: ['write_file'] },
  }), /Requested capability denied/);
}

async function testRejectsInactiveTarget() {
  const service = new AgentDelegationService({
    definition_resolver: {
      async resolve() {
        return createDefinition({ is_active: false });
      },
    },
  });

  await assert.rejects(() => service.delegate({
    parent_invocation: createParentInvocation(),
    target: { source_type: 'expert', agent_id: 'expert_child' },
    task: 'Run inactive target',
  }), /Agent target inactive/);
}

async function testRejectsDelegationCycle() {
  const service = new AgentDelegationService({
    definition_resolver: {
      async resolve() {
        return createDefinition({ agent_id: 'expert_parent' });
      },
    },
  });

  await assert.rejects(() => service.delegate({
    parent_invocation: createParentInvocation(),
    target: { source_type: 'expert', agent_id: 'expert_parent' },
    task: 'Call self',
  }), /delegation cycle detected/);
}

async function testDelegateAndExecuteUsesExplicitExecutor() {
  const service = new AgentDelegationService({
    definition_resolver: {
      async resolve() {
        return createDefinition();
      },
    },
  });
  const executorCalls = [];

  const result = await service.delegateAndExecute({
    parent_invocation: createParentInvocation(),
    target: { source_type: 'expert', agent_id: 'expert_child' },
    task: 'Search the project',
    caller_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    principal_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    workspace_scope: {
      tools: ['search'],
      skills: ['search'],
      document_retrieval: true,
      can_use_skills: true,
    },
    requested_scope: { tools: ['search'] },
  }, {
    async execute(delegation) {
      executorCalls.push(delegation);
      return {
        fullContent: 'Child result',
        agent_invocation_context: delegation.child_invocation,
      };
    },
  });

  assert.equal(result.status, 'accepted');
  assert.equal(result.execution_result.fullContent, 'Child result');
  assert.equal(executorCalls.length, 1);
  assert.equal(executorCalls[0].child_invocation.callee_agent_id, 'expert_child');
  assert.deepEqual(executorCalls[0].effective_scope.tools, ['search']);
}

async function testDelegateAndExecuteRequiresExplicitExecutor() {
  const service = new AgentDelegationService({
    definition_resolver: {
      async resolve() {
        return createDefinition();
      },
    },
  });

  await assert.rejects(() => service.delegateAndExecute({
    parent_invocation: createParentInvocation(),
    target: { source_type: 'expert', agent_id: 'expert_child' },
    task: 'Search the project',
  }), /child_executor.execute is required/);
}

async function main() {
  await testDelegationBuildsChildRun();
  await testRejectsDeniedCapability();
  await testRejectsInactiveTarget();
  await testRejectsDelegationCycle();
  await testDelegateAndExecuteUsesExplicitExecutor();
  await testDelegateAndExecuteRequiresExplicitExecutor();

  console.log('Agent delegation service tests passed.');
}

main();
