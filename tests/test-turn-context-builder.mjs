/**
 * Tests for stream turn context builder helpers.
 *
 * Usage:
 *   node tests/test-turn-context-builder.mjs
 */

import assert from 'node:assert/strict';
import {
  buildStreamLlmPayload,
  buildStreamTurnContext,
  buildToolContext,
} from '../lib/chat/turn-context-builder.js';

function createFixture() {
  const session = { userId: 'user_1', roles: ['creator'] };
  const modelConfig = {
    model_name: 'test-model',
    provider_name: 'test-provider',
    base_url: 'https://example.test/v1',
    max_tokens: 4096,
    max_output_tokens: 2048,
  };
  const thinkingConfig = {
    thinking: false,
    reasoning: null,
  };
  const messages = [{ role: 'user', content: 'hello' }];
  const tools = [{ type: 'function', function: { name: 'demo_tool' } }];
  const taskContext = {
    workspace_mode: 'task',
    absolute_workspace_path: 'D:/workspace/task',
  };

  return { session, modelConfig, thinkingConfig, messages, tools, taskContext };
}

function testBuildToolContext() {
  const { session } = createFixture();

  assert.deepEqual(buildToolContext({
    user_id: 'user_1',
    expert_id: 'expert_1',
    session,
  }), {
    user_id: 'user_1',
    expert_id: 'expert_1',
    session,
  });
}

function testBuildStreamLlmPayload() {
  const { modelConfig, messages, tools } = createFixture();
  const payload = buildStreamLlmPayload({ modelConfig, messages, tools });

  assert.deepEqual(payload, {
    model: 'test-model',
    messages,
    stream: true,
    stream_options: { include_usage: true },
    _debug: {
      model_config: {
        provider_name: 'test-provider',
        base_url: 'https://example.test/v1',
        max_tokens: 4096,
        max_output_tokens: 2048,
      },
      context_messages_count: 1,
      tools_count: 1,
    },
  });
}

function testBuildStreamTurnContext() {
  const { session, modelConfig, thinkingConfig, messages, tools, taskContext } = createFixture();
  const turnContext = buildStreamTurnContext({
    user_id: 'user_1',
    expert_id: 'expert_1',
    topic_id: 'topic_1',
    task_id: 'task_1',
    taskContext,
    session,
    request_id: 'request_1',
    modelConfig,
    thinkingConfig,
    messages,
    tools,
  });

  assert.deepEqual(turnContext.caller, {
    user_id: 'user_1',
    session,
  });
  assert.deepEqual(turnContext.expert, {
    expert_id: 'expert_1',
  });
  assert.deepEqual(turnContext.scope, {
    topic_id: 'topic_1',
    task_id: 'task_1',
    taskContext,
    request_id: 'request_1',
  });
  assert.deepEqual(turnContext.toolContext, {
    user_id: 'user_1',
    expert_id: 'expert_1',
    session,
  });
  assert.equal(turnContext.roundInput.modelConfig, modelConfig);
  assert.equal(turnContext.roundInput.thinkingConfig, thinkingConfig);
  assert.equal(turnContext.roundInput.tools, tools);
  assert.equal(turnContext.roundInput.currentMessages, messages);
  assert.equal(turnContext.roundInput.llmPayload, turnContext.llmPayload);
  assert.equal(turnContext.roundInput.user_id, 'user_1');
  assert.equal(turnContext.roundInput.expert_id, 'expert_1');
  assert.equal(turnContext.roundInput.taskContext, taskContext);
  assert.equal(turnContext.roundInput.topic_id, 'topic_1');
  assert.equal(turnContext.roundInput.task_id, 'task_1');
  assert.equal(turnContext.roundInput.session, session);
  assert.equal(turnContext.roundInput.request_id, 'request_1');
}

function main() {
  testBuildToolContext();
  testBuildStreamLlmPayload();
  testBuildStreamTurnContext();

  console.log('Turn context builder tests passed.');
}

main();
