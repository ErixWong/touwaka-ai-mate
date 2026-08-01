import { expect } from 'chai';
import ChatService from '../../lib/chat-service.js';
import { ConversationOrchestrator } from '../../lib/chat/conversation-orchestrator.js';
import RecallStrategy from '../../lib/recall-strategy.js';

function evidencePacket(overrides = {}) {
  const packet = {
    trace_id: 'trace_1',
    decision: 'force',
    items: [],
    meta: {
      calls: 2,
      timeout: false,
      degraded: false,
      query_keyword: '',
      messageStageAttempted: true,
      messageStageFailed: false,
    },
    hasMessages() {
      return this.items.some(item => item.source === 'message');
    },
    ...overrides,
  };
  return packet;
}

describe('recall post-check alignment', () => {
  it('does not retry natural certainty phrasing when message evidence exists', () => {
    const strategy = new RecallStrategy();
    const result = strategy.postCheck(
      '是的，根据刚才讨论的内容，可以继续这个方向。',
      evidencePacket({
        items: [{ source: 'message', snippet: 'old evidence' }],
      })
    );

    expect(result.need_retry).to.equal(false);
  });

  it('retries only force decisions with failed message stage and specific historical assertions', () => {
    const strategy = new RecallStrategy();
    const result = strategy.postCheck(
      '之前的 OAuth 配置方案 20260801 已经设置过。',
      evidencePacket({
        meta: {
          calls: 2,
          timeout: false,
          degraded: false,
          messageStageAttempted: true,
          messageStageFailed: true,
        },
      })
    );

    expect(result.need_retry).to.equal(true);
    expect(result.reason).to.equal('missing_evidence');
  });

  it('records retry keyword and message-stage failure in executePolicy metadata', async () => {
    const strategy = new RecallStrategy();
    const calls = [];
    const toolManager = {
      executeTool: async (_name, params) => {
        calls.push(params);
        if (params.mode === 'topic' && params.action === 'search') {
          return { success: true, topics: [{ id: 'topic_1', title: 'OAuth config' }] };
        }
        return { success: true, messages: [] };
      },
    };

    const packet = await strategy.executePolicy(
      { decision: 'force', trace_id: 'trace_2', query_keyword: 'OAuth config' },
      toolManager,
      'user_1',
      'expert_1'
    );

    expect(calls[0].keyword).to.equal('OAuth config');
    expect(packet.meta.query_keyword).to.equal('OAuth config');
    expect(packet.meta.messageStageAttempted).to.equal(true);
    expect(packet.meta.messageStageFailed).to.equal(true);
  });

  it('keeps original answer when recall degradation is disabled', async () => {
    const chatService = new ChatService({ getModel: () => ({}) });
    const answer = 'original answer';
    const retryResult = { items: [], meta: { calls: 1 } };
    const expertService = {
      toolManager: {},
      recallStrategy: {
        config: { degradeOnNoEvidence: false },
        flags: { recallDegradeEnabled: true },
        executePolicy: async () => retryResult,
        getDegradeResponse: () => 'degraded answer',
      },
    };
    chatService.orchestrator = {
      handlePostCheck: () => ({ need_retry: true, trace_id: 'trace_1' }),
      applyEvidence: () => {},
    };

    const result = await chatService._handleRecallPostCheck({
      expertService,
      answer,
      recallResult: {
        meta: { query_keyword: 'OAuth', calls: 1 },
        items: [],
      },
      userMessage: 'OAuth config',
      messages: [],
      userId: 'user_1',
      expertId: 'expert_1',
    });

    expect(result.answer).to.equal(answer);
  });

  it('non-stream chat creates a topic fallback and runs recall pre-check with explicit topic_id', async () => {
    const savedTopics = [];
    let recallCalls = 0;
    const db = {
      getModel: () => ({}),
      updateMessageTopicId: async () => {},
      updateTopicMessageCount: async () => {},
    };
    const chatService = new ChatService(db);
    chatService.checkAndHandleTopicShift = async () => ({ topic_id: 'topic_fallback' });
    chatService.saveUserMessageAndBindRequest = async (topicId) => {
      savedTopics.push(topicId);
      return 'message_user';
    };
    chatService.saveAssistantMessageAndCompleteRequest = async (topicId) => {
      savedTopics.push(topicId);
      return 'message_assistant';
    };
    chatService.updateTopicTimestamp = async () => {};
    chatService.getExpertService = async () => ({
      expertConfig: { expert: { context_threshold: 0.7 } },
      getDefaultModelConfig: () => ({ max_tokens: 128000, model_name: 'model', provider_name: 'provider' }),
      memorySystem: { compressContext: async () => ({ success: false }) },
      buildContext: async (_userId, _content, topicId) => ({
        messages: [{ role: 'user', content: `topic=${topicId}` }],
      }),
      recallStrategy: {
        preCheck: () => {
          recallCalls++;
          return { decision: 'none', trace_id: 'trace_3', query_keyword: '' };
        },
      },
      toolManager: { getToolDefinitions: async () => [] },
      llmClient: { call: async () => ({ content: 'ok' }) },
      performReflection: async () => {},
    });

    await chatService.chat({
      user_id: 'user_1',
      expert_id: 'expert_1',
      content: 'hello',
    });
    await chatService.chat({
      topic_id: 'topic_explicit',
      user_id: 'user_1',
      expert_id: 'expert_1',
      content: '继续上次那个方案',
    });

    expect(savedTopics[0]).to.equal('topic_fallback');
    expect(savedTopics[1]).to.equal('topic_fallback');
    expect(savedTopics[2]).to.equal('topic_explicit');
    expect(recallCalls).to.equal(2);
  });

  it('orchestrator skips maybe recall without returning an empty evidence packet', async () => {
    let executed = false;
    const orchestrator = new ConversationOrchestrator();
    const result = await orchestrator.handleRecall({
      recallStrategy: {
        preCheck: () => ({ decision: 'maybe', trace_id: 'trace_maybe' }),
        executePolicy: async () => {
          executed = true;
          return { items: [] };
        },
      },
      toolManager: {},
    }, '上次那个方案', 'user_1', 'expert_1');

    expect(result).to.equal(null);
    expect(executed).to.equal(false);
  });
});
