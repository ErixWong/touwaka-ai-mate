/**
 * Tests that streamChat enters the root AgentRuntime facade.
 *
 * Usage:
 *   node tests/test-chat-service-agent-runtime-facade.mjs
 */

import assert from 'node:assert/strict';
import ChatService from '../lib/chat-service.js';

function createDbStub() {
  return {
    getModel() {
      return {};
    },
  };
}

function createExpertServiceStub(toolContextCalls = []) {
  const modelConfig = {
    model_name: 'test-model',
    provider_name: 'test-provider',
    base_url: 'https://example.test/v1',
    max_tokens: 4096,
    max_output_tokens: 2048,
  };

  return {
    recallStrategy: null,
    memorySystem: {
      async shouldCompressContext() {
        return { needCompress: false };
      },
    },
    getDefaultModelConfig() {
      return modelConfig;
    },
    getThinkingConfig() {
      return {
        thinking: false,
        reasoning: null,
        reasoning_effort: null,
        enable_thinking: false,
        chat_template_kwargs: null,
      };
    },
    async buildContext() {
      return {
        messages: [{ role: 'user', content: 'hello' }],
      };
    },
    toolManager: {
      async getToolDefinitions(context) {
        toolContextCalls.push(context);
        return [{ type: 'function', function: { name: 'demo_tool' } }];
      },
    },
    performReflection() {
      return Promise.resolve();
    },
    processHistoryIfNeeded() {
      return Promise.resolve();
    },
  };
}

function createRuntimeStub(calls) {
  return {
    async runRoot(input, executor) {
      calls.push(input);
      return executor({ invocation_context: input.invocation_context });
    },
  };
}

async function testStreamChatUsesRootAgentRuntime() {
  const runtimeCalls = [];
  const loopCalls = [];
  const toolContextCalls = [];
  const service = new ChatService(createDbStub(), {
    agentRuntime: createRuntimeStub(runtimeCalls),
    agentLoop: {
      async run(expertService, roundInput) {
        loopCalls.push({ expertService, roundInput });
        return {
          fullContent: 'runtime result',
          fullReasoningContent: '',
          tokenUsage: {
            prompt_tokens: 3,
            completion_tokens: 4,
            total_tokens: 7,
          },
          allToolCalls: [],
          finalMessages: [],
          llmCallsCount: 1,
        };
      },
    },
  });
  const expertService = createExpertServiceStub(toolContextCalls);

  service.getExpertService = async () => expertService;
  service._prepareTaskContext = async () => ({
    workspace_mode: 'task',
    absolute_workspace_path: 'D:/workspace/task',
  });
  service.checkAndHandleTopicShift = async () => ({
    topic_id: 'topic_1',
    isNewTopic: false,
  });
  service.saveUserMessageAndBindRequest = async () => 'user_msg_1';
  service.saveAssistantMessageAndCompleteRequest = async () => 'assistant_msg_1';
  service.updateTopicTimestamp = async () => {};

  let completePayload = null;
  await service.streamChat({
    user_id: 'user_1',
    expert_id: 'expert_1',
    content: 'hello',
    task_id: 'task_1',
    request_id: 'request_1',
    session: { userId: 'user_1', roles: [] },
  }, null, result => {
    completePayload = result;
  }, error => {
    throw error;
  });

  assert.equal(runtimeCalls.length, 1);
  assert.equal(toolContextCalls.length, 1);
  assert.equal(toolContextCalls[0].agent_invocation.delegation_depth, 0);
  const invocation = runtimeCalls[0].invocation_context;
  assert.equal(invocation.principal_user_id, 'user_1');
  assert.equal(invocation.caller_agent_id, null);
  assert.equal(invocation.callee_agent_id, 'expert_1');
  assert.equal(invocation.topic_id, 'topic_1');
  assert.equal(invocation.task_id, 'task_1');
  assert.equal(invocation.request_id, 'request_1');
  assert.deepEqual(invocation.workspace_scope, {
    workdir: 'D:/workspace/task',
    workspace_mode: 'task',
  });
  assert.deepEqual(invocation.capability_scope, {
    tools: ['demo_tool'],
  });
  assert.equal(loopCalls.length, 1);
  assert.equal(loopCalls[0].expertService, expertService);
  assert.equal(loopCalls[0].roundInput.agent_invocation_context, invocation);
  assert.equal(completePayload.message.content, 'runtime result');
  assert.deepEqual(completePayload.message.metadata.tokens, {
    prompt_tokens: 3,
    completion_tokens: 4,
    total_tokens: 7,
  });
}

function testChatServiceCanUseResidentDelegateRuntime() {
  const residentSkillManager = {
    async invokeByName() {
      return {};
    },
  };
  const service = new ChatService(createDbStub(), {
    residentSkillManager,
  });

  const runtime = service.getAgentDelegateControlRuntime();

  assert.equal(runtime.child_run_scheduler.resident_skill_manager, residentSkillManager);
}

async function main() {
  await testStreamChatUsesRootAgentRuntime();
  testChatServiceCanUseResidentDelegateRuntime();

  console.log('ChatService AgentRuntime facade tests passed.');
}

main();
