import { expect } from 'chai';
import Database from '../../lib/db.js';
import MemorySystem from '../../lib/memory-system.js';
import { TopicLifecycleManager } from '../../lib/topic/topic-lifecycle-manager.js';

describe('round01 context compression foundations', () => {
  it('MemorySystem identifyTopics parses fenced JSON via shared parser', async () => {
    const memorySystem = new MemorySystem({}, 'expert_1', {
      callExpressive: async () => ({
        content: '```json\n{"topics":[{"title":"测试话题","summary":"讨论了上下文压缩","startIndex":0,"endIndex":9,"keywords":["压缩"],"category":"技术"}],"userInfo":null}\n```',
      }),
    });

    const result = await memorySystem.identifyTopics([
      { role: 'user', content: '测试', timestamp: Date.now() },
    ]);

    expect(result.topics).to.have.length(1);
    expect(result.topics[0].keywords).to.deep.equal(['压缩']);
  });

  it('MemorySystem createTopic forwards keywords to db.createTopic', async () => {
    let capturedTopic = null;
    const memorySystem = new MemorySystem({
      createTopic: async (topicData) => {
        capturedTopic = topicData;
      },
    }, 'expert_1', {});

    const topicId = await memorySystem.createTopic('user_1', {
      name: '上下文压缩',
      description: '讨论压缩触发口径',
      keywords: ['上下文', '压缩'],
    });

    expect(topicId).to.be.a('string');
    expect(capturedTopic.status).to.equal('active');
    expect(capturedTopic.endTime).to.equal(undefined);
    expect(capturedTopic.keywords).to.deep.equal(['上下文', '压缩']);
  });

  it('TopicLifecycleManager createTopic supports shared topic payload fields', async () => {
    let capturedRow = null;
    const manager = new TopicLifecycleManager({
      getModel: () => ({
        create: async (row) => {
          capturedRow = row;
        },
      }),
    }, 'expert_1');

    await manager.createTopic({
      id: 'topic_1',
      userId: 'user_1',
      title: '归档话题',
      description: '旧活跃话题摘要',
      keywords: ['归档', '摘要'],
      status: 'archived',
      messageCount: 12,
    });

    expect(capturedRow.status).to.equal('archived');
    expect(capturedRow.message_count).to.equal(12);
    expect(JSON.parse(capturedRow.keywords)).to.deep.equal(['归档', '摘要']);
  });
  it('Database createTopic preserves null end_time for active topics', async () => {
    let capturedRow = null;
    const database = new Database({});
    database.models = {
      topic: {
        create: async (row) => {
          capturedRow = row;
          return row;
        },
      },
    };

    await database.createTopic({
      id: 'topic_active',
      expertId: 'expert_1',
      userId: 'user_1',
      name: 'Active topic',
      status: 'active',
      endTime: null,
      taskId: 'task_1',
    });

    expect(capturedRow.status).to.equal('active');
    expect(capturedRow.end_time).to.equal(null);
    expect(capturedRow.task_id).to.equal('task_1');
  });

  it('MemorySystem compressContext splits active topic and excludes current user message', async () => {
    const calls = [];
    const db = {
      sequelize: {
        transaction: async () => ({
          commit: async () => calls.push(['commit']),
          rollback: async () => calls.push(['rollback']),
        }),
      },
      getTopicById: async () => ({
        id: 'topic_old',
        status: 'active',
        title: 'Old topic',
        description: 'Old description',
        category: 'general',
        task_id: 'task_1',
      }),
      getMessagesByTopicId: async () => [
        { id: 'm1', role: 'user', content: 'old context '.repeat(40), created_at: new Date('2026-08-01T00:00:00Z') },
        { id: 'm2', role: 'assistant', content: 'old answer '.repeat(40), created_at: new Date('2026-08-01T00:01:00Z') },
        { id: 'm_current', role: 'user', content: 'new turn', created_at: new Date('2026-08-01T00:02:00Z') },
      ],
      updateTopic: async (topicId, data, options) => {
        calls.push(['updateTopic', topicId, data, Boolean(options?.transaction)]);
      },
      createTopic: async (topicData, options) => {
        calls.push(['createTopic', topicData, Boolean(options?.transaction)]);
      },
      updateMessageTopicId: async (messageIds, topicId, options) => {
        calls.push(['updateMessageTopicId', messageIds, topicId, Boolean(options?.transaction)]);
      },
      updateTopicMessageCount: async (topicId, options) => {
        calls.push(['updateTopicMessageCount', topicId, Boolean(options?.transaction)]);
      },
    };
    const memorySystem = new MemorySystem(db, 'expert_1', {
      callExpressive: async () => ({
        content: JSON.stringify({
          topicName: 'Archived topic',
          topicDescription: 'Summary of old messages',
          keywords: ['context', 'compression'],
          category: 'technical',
          userInfo: null,
        }),
      }),
    });
    memorySystem.generateTopicId = () => 'topic_new';

    const result = await memorySystem.compressContext('user_1', {
      activeTopicId: 'topic_old',
      excludeMessageIds: ['m_current'],
      carryMessageIds: ['m_current'],
      contextSize: 100,
      threshold: 0.5,
      minMessages: 2,
    });

    const updateCall = calls.find(call => call[0] === 'updateTopic');
    const createCall = calls.find(call => call[0] === 'createTopic');

    expect(result.success).to.equal(true);
    expect(result.archivedTopicId).to.equal('topic_old');
    expect(result.newTopicId).to.equal('topic_new');
    expect(result.messagesArchived).to.equal(2);
    expect(result.results[0].summaryQuality).to.include({ pass: true });
    expect(updateCall[2].status).to.equal('archived');
    expect(updateCall[2].message_count).to.equal(2);
    expect(updateCall[3]).to.equal(true);
    expect(createCall[1].id).to.equal('topic_new');
    expect(createCall[1].status).to.equal('active');
    expect(createCall[1].endTime).to.equal(null);
    expect(createCall[1].taskId).to.equal('task_1');
    expect(createCall[2]).to.equal(true);
    expect(calls.some(call => call[0] === 'updateMessageTopicId'
      && call[1][0] === 'm_current'
      && call[2] === 'topic_new'
      && call[3] === true)).to.equal(true);
    expect(calls.filter(call => call[0] === 'updateTopicMessageCount')).to.have.length(2);
    expect(calls.some(call => call[0] === 'commit')).to.equal(true);
  });
});
