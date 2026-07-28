/**
 * Tests for assistant execution context builder.
 *
 * Usage:
 *   node tests/test-assistant-execution-context.mjs
 */

import assert from 'node:assert/strict';
import { buildAssistantExecutionContext } from '../server/services/assistant/execution-context.js';

function testBuildsContextFromPersistedRequest() {
  const messageService = { append: () => {} };
  const context = buildAssistantExecutionContext({
    request_id: 'req_1',
    user_id: 'user_1',
    contact_id: 'contact_1',
    expert_id: 'expert_1',
    topic_id: 'topic_1',
    input: {
      workspace: {
        expert_id: 'body_expert',
        topic_id: 'body_topic',
        workdir: 'D:/workspace/task',
      },
    },
  }, { messageService });

  assert.deepEqual(context, {
    requestId: 'req_1',
    workdir: 'D:/workspace/task',
    topicId: 'topic_1',
    expertId: 'expert_1',
    userId: 'user_1',
    contactId: 'contact_1',
    messageService,
  });
}

function testFallsBackToWorkspaceForScopeOnly() {
  const context = buildAssistantExecutionContext({
    request_id: 'req_2',
    user_id: null,
    contact_id: null,
    expert_id: null,
    topic_id: null,
    input: {
      workspace: {
        expert_id: 'workspace_expert',
        topic_id: 'workspace_topic',
        workdir: 'D:/workspace/fallback',
      },
    },
  });

  assert.equal(context.expertId, 'workspace_expert');
  assert.equal(context.topicId, 'workspace_topic');
  assert.equal(context.workdir, 'D:/workspace/fallback');
  assert.equal(context.userId, null);
  assert.equal(context.contactId, null);
}

function testHandlesMissingInput() {
  const context = buildAssistantExecutionContext({
    request_id: 'req_3',
    user_id: 'user_3',
    contact_id: 'contact_3',
  }, { requestId: 'override_req' });

  assert.equal(context.requestId, 'override_req');
  assert.equal(context.workdir, undefined);
  assert.equal(context.topicId, undefined);
  assert.equal(context.expertId, undefined);
  assert.equal(context.userId, 'user_3');
  assert.equal(context.contactId, 'contact_3');
}

function main() {
  testBuildsContextFromPersistedRequest();
  testFallsBackToWorkspaceForScopeOnly();
  testHandlesMissingInput();

  console.log('Assistant execution context tests passed.');
}

main();
