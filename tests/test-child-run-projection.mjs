/**
 * Tests for child Agent run projection.
 *
 * Usage:
 *   node tests/test-child-run-projection.mjs
 */

import assert from 'node:assert/strict';
import { buildChildAgentRunProjection } from '../lib/agent/child-run-projection.js';
import {
  buildRootAgentInvocationContext,
  deriveChildAgentInvocationContext,
} from '../lib/agent/agent-invocation-context.js';

function createDelegation(overrides = {}) {
  const parent = buildRootAgentInvocationContext({
    run_id: 'root_run_projection_parent',
    principal_user_id: 'user_projection',
    agent_id: 'expert_parent',
    topic_id: 'topic_1',
    workspace_scope: {
      workdir: 'D:/repo/docs/tasks/active/current-task',
      logical_workdir: 'docs/tasks/active/current-task',
      workspace_mode: 'repo_task',
      current_path: '',
    },
  });
  const child = deriveChildAgentInvocationContext(parent, {
    run_id: 'child_run_projection_1',
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
      display_name: 'Research Child',
      description: 'Research support.',
      system_prompt: 'Be precise.',
      model_config: {
        primary_model: {
          model_name: 'test-model',
          api_key: 'secret_key_should_not_project',
        },
      },
      execution_policy: { mode: 'llm' },
    },
    task: 'Search the project',
    input: { query: 'agent runtime' },
    expected_output: 'Short summary',
    requested_scope: { tools: ['search'] },
    effective_scope: { tools: ['search'] },
    ...overrides,
  };
}

function testBuildsChildMessages() {
  const projection = buildChildAgentRunProjection(createDelegation());

  assert.equal(projection.invocation_context.callee_agent_id, 'expert_child');
  assert.equal(projection.messages.length, 2);
  assert.equal(projection.messages[0].role, 'system');
  assert.match(projection.messages[0].content, /Research Child/);
  assert.match(projection.messages[0].content, /Be precise/);
  assert.equal(projection.messages[1].role, 'user');

  const taskPackage = JSON.parse(projection.messages[1].content);
  assert.equal(taskPackage.type, 'agent_delegation_task');
  assert.equal(taskPackage.task, 'Search the project');
  assert.deepEqual(taskPackage.input, { query: 'agent runtime' });
  assert.equal(taskPackage.expected_output, 'Short summary');
  assert.equal(taskPackage.caller_agent_id, 'expert_parent');
  assert.equal(taskPackage.callee_agent_id, 'expert_child');
  assert.equal(taskPackage.parent_run_id, 'root_run_projection_parent');
  assert.equal(taskPackage.run_id, 'child_run_projection_1');
  assert.deepEqual(taskPackage.capability_scope, { tools: ['search'] });
  assert.deepEqual(taskPackage.workspace, {
    workspace_mode: 'repo_task',
    current_workdir: 'docs/tasks/active/current-task',
    current_path: '',
    relative_paths_are_resolved_from_current_workdir: true,
  });
}

function testKeepsPrincipalInMetadataNotPrompt() {
  const projection = buildChildAgentRunProjection(createDelegation());
  const promptText = projection.messages.map(message => message.content).join('\n');

  assert.equal(projection.metadata.principal_user_id, 'user_projection');
  assert.equal(projection.metadata.caller_agent_id, 'expert_parent');
  assert.equal(projection.metadata.callee_agent_id, 'expert_child');
  assert.equal(promptText.includes('user_projection'), false);
}

function testDoesNotProjectSensitiveModelConfig() {
  const projection = buildChildAgentRunProjection(createDelegation());
  const promptText = projection.messages.map(message => message.content).join('\n');

  assert.equal(promptText.includes('secret_key_should_not_project'), false);
  assert.equal(promptText.includes('model_config'), false);
}

function testRejectsMissingTask() {
  assert.throws(() => buildChildAgentRunProjection(createDelegation({
    task: '',
  })), /delegation.task is required/);
}

function main() {
  testBuildsChildMessages();
  testKeepsPrincipalInMetadataNotPrompt();
  testDoesNotProjectSensitiveModelConfig();
  testRejectsMissingTask();

  console.log('Child run projection tests passed.');
}

main();
