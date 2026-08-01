import { expect } from 'chai';
import { FullContextOrganizer } from '../../lib/context-organizer/full-organizer.js';
import { MinimalContextOrganizer } from '../../lib/context-organizer/minimal-organizer.js';

function createMemorySystemStub({ messages = [], topics = [], innerVoices = [] } = {}) {
  return {
    getOrCreateUserProfile: async () => ({
      user_id: 'user_1',
      preferred_name: 'Eric',
    }),
    getRecentMessages: async () => messages,
    getRecentInnerVoices: async () => innerVoices,
    getTopics: async () => topics,
  };
}

describe('context organizer budget control', () => {
  it('trims expandable system sections and old messages while keeping current user message', async () => {
    const organizer = new FullContextOrganizer({
      expert: {
        id: 'expert_1',
        prompt_template: '你是测试专家。',
        context_threshold: 0.5,
      },
      expressiveModel: {
        max_tokens: 1000,
      },
    }, {
      messageCount: 12,
      topicCount: 5,
      innerVoiceCount: 2,
    });

    const longText = '这是一段很长的中文内容。'.repeat(180);
    const memorySystem = createMemorySystemStub({
      messages: Array.from({ length: 12 }, (_, index) => ({
        id: `msg_${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `${longText}${index}`,
        timestamp: Date.now() - index,
      })),
      topics: Array.from({ length: 5 }, (_, index) => ({
        id: `topic_${index}`,
        title: `话题 ${index}`,
        description: longText,
      })),
      innerVoices: [
        { monologue: longText },
        { monologue: longText },
      ],
    });

    const result = await organizer.organize(memorySystem, 'user_1', {
      currentMessage: '当前问题必须保留',
      maxTokens: 1000,
      contextThreshold: 0.5,
    });

    const rolesAndContent = result.messages.map(msg => `${msg.role}:${typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}`);
    expect(rolesAndContent.some(text => text.includes('当前问题必须保留'))).to.equal(true);
    expect(result.metadata.budget.systemPrompt.removed).to.include('topic_summaries');
    expect(result.metadata.budget.messages.removed).to.be.greaterThan(0);
    expect(result.metadata.budget.messages.afterTokens).to.be.at.most(result.metadata.budget.messages.totalBudget);
  });

  it('injects shared recall guidance into minimal system prompt', () => {
    const organizer = new MinimalContextOrganizer({
      expert: {
        id: 'expert_1',
        prompt_template: 'base prompt',
      },
    });

    const prompt = organizer._buildSystemPrompt('base prompt', 'psyche text');

    expect(prompt).to.include('recall({ mode:');
    expect(prompt).to.include("action: 'messages'");
  });

  it('truncates priority-zero system prompt content when core sections exceed budget', () => {
    const organizer = new FullContextOrganizer({
      expert: {
        id: 'expert_1',
        prompt_template: 'core prompt '.repeat(2000),
        context_threshold: 0.2,
      },
      expressiveModel: {
        max_tokens: 1000,
      },
    });

    organizer.buildBaseSystemPrompt([], null, null, [], null, {
      maxTokens: 1000,
      contextThreshold: 0.2,
    });

    expect(organizer.lastSystemPromptBudgetStats.afterTokens)
      .to.be.at.most(organizer.lastSystemPromptBudgetStats.systemBudget);
    expect(organizer.lastSystemPromptBudgetStats.removed.some(item => item.includes('truncated'))).to.equal(true);
  });
});
