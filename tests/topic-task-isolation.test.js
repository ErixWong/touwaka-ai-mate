/**
 * #1141: topic 生命周期 task 维度隔离
 *
 * 覆盖：
 * 1. 压缩锁（B1）：不同 task 不互相阻塞、同一 task 仍串行、无 task 上下文行为明确；
 * 2. legacy 通道：跨 task 仍按 expert+user 串行（不会并发绑定同一批未绑定消息）；
 * 3. 归档器分组（B2）：按 (expert_id, user_id, task_id) 分组，不因其他 task 的 topic 数量误归档；
 * 4. 单 task 既有行为不变。
 *
 * 运行：node --test tests/topic-task-isolation.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import MemorySystem from '../lib/memory-system.js';
import {
  createTopicArchiverTask,
  groupActiveTopicsForArchiving,
  NO_TASK_TOPIC_GROUP,
} from '../lib/topic-archiver.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const SUMMARY_JSON = JSON.stringify({
  topicName: 'task 隔离测试话题',
  topicDescription: '用于验证压缩锁与归档器 task 维度隔离',
  keywords: ['task', '隔离'],
  category: '技术',
  userInfo: null,
});

/**
 * 构造压缩链路用的 db stub（真实走 _shouldCompressActiveTopic / _compressActiveTopic）
 */
function createCompressionDb({ topics, messagesByTopic = {}, legacyMessages = [], events = [] }) {
  const calls = { createdTopics: [], updatedTopics: [], messageTopicMoves: [] };
  return {
    calls,
    sequelize: {
      transaction: async () => ({ commit: async () => {}, rollback: async () => {} }),
    },
    getTopicById: async (topicId) => topics[topicId] || null,
    getMessagesByTopicId: async (expertId, userId, topicId) => messagesByTopic[topicId] || [],
    getUnarchivedMessages: async () => {
      events.push('legacy:start');
      await sleep(50);
      events.push('legacy:end');
      return legacyMessages;
    },
    updateTopic: async (topicId, data) => { calls.updatedTopics.push({ topicId, data }); },
    createTopic: async (topicData) => { calls.createdTopics.push(topicData); },
    updateMessageTopicId: async (messageIds, topicId) => { calls.messageTopicMoves.push({ messageIds, topicId }); },
    updateTopicMessageCount: async () => {},
    updateUserInfo: async () => {},
  };
}

function createCompressionMemorySystem({ topics, messagesByTopic = {}, legacyMessages = [], events = [], options = {} }) {
  const db = createCompressionDb({ topics, messagesByTopic, legacyMessages, events });
  const llmClient = {
    callExpressive: async () => {
      events.push('llm:start');
      await sleep(50);
      events.push('llm:end');
      return { content: SUMMARY_JSON };
    },
  };
  const memorySystem = new MemorySystem(db, 'expert_1', llmClient, options);
  return { memorySystem, db, events };
}

function topic({ id, taskId = null, status = 'active' }) {
  return {
    id,
    status,
    title: `topic ${id}`,
    description: 'description',
    category: 'general',
    task_id: taskId,
  };
}

function message(id) {
  return { id, role: 'user', content: `content ${id}`, created_at: new Date('2026-10-01T00:00:00Z') };
}

// ---------------------------------------------------------------------------
// 1. 压缩锁（B1）
// ---------------------------------------------------------------------------

test('B1: 不同 task 的 active topic 压缩不互相阻塞', async () => {
  const events = [];
  const { memorySystem, db } = createCompressionMemorySystem({
    topics: { topic_a: topic({ id: 'topic_a', taskId: 'task_a' }), topic_b: topic({ id: 'topic_b', taskId: 'task_b' }) },
    messagesByTopic: { topic_a: [message('ma')], topic_b: [message('mb')] },
    events,
  });

  await Promise.all([
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_a', force: true, minMessages: 1 }),
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_b', force: true, minMessages: 1 }),
  ]);

  // 两个 task 的摘要调用交错执行（旧实现按 expert:user 加锁会得到 start/end/start/end）
  assert.deepEqual(events, ['llm:start', 'llm:start', 'llm:end', 'llm:end']);
  // 分裂出的新 topic 继承各自 task 维度
  assert.deepEqual(db.calls.createdTopics.map(t => t.taskId).sort(), ['task_a', 'task_b']);
});

test('B1: 同一 task 的压缩仍然串行（锁内互斥语义不变）', async () => {
  const events = [];
  const { memorySystem } = createCompressionMemorySystem({
    topics: { topic_a1: topic({ id: 'topic_a1', taskId: 'task_a' }), topic_a2: topic({ id: 'topic_a2', taskId: 'task_a' }) },
    messagesByTopic: { topic_a1: [message('m1')], topic_a2: [message('m2')] },
    events,
  });

  await Promise.all([
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_a1', force: true, minMessages: 1 }),
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_a2', force: true, minMessages: 1 }),
  ]);

  assert.deepEqual(events, ['llm:start', 'llm:end', 'llm:start', 'llm:end']);
});

test('B1: 无 task 上下文（task_id=null）自成一桶——内部串行、不与 task 桶互相阻塞', async () => {
  const events = [];
  const { memorySystem } = createCompressionMemorySystem({
    topics: {
      topic_null_1: topic({ id: 'topic_null_1' }),
      topic_null_2: topic({ id: 'topic_null_2' }),
      topic_a: topic({ id: 'topic_a', taskId: 'task_a' }),
    },
    messagesByTopic: {
      topic_null_1: [message('n1')],
      topic_null_2: [message('n2')],
      topic_a: [message('a1')],
    },
    events,
  });

  // 两个 null topic 同桶 → 串行
  await Promise.all([
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_null_1', force: true, minMessages: 1 }),
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_null_2', force: true, minMessages: 1 }),
  ]);
  assert.deepEqual(events, ['llm:start', 'llm:end', 'llm:start', 'llm:end']);

  // null topic 与 task topic 不同桶 → 并发
  events.length = 0;
  await Promise.all([
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_null_1', force: true, minMessages: 1 }),
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_a', force: true, minMessages: 1 }),
  ]);
  assert.deepEqual(events, ['llm:start', 'llm:start', 'llm:end', 'llm:end']);
});

test('B1: 锁 key 由 active topic 的 task_id 决定，无 topic 时用显式 taskId 兜底', async () => {
  const { memorySystem } = createCompressionMemorySystem({
    topics: {
      topic_a: topic({ id: 'topic_a', taskId: 'task_a' }),
      topic_null: topic({ id: 'topic_null' }),
    },
  });

  const keyFromTopic = await memorySystem._resolveCompressionLockKey('user_1', { activeTopicId: 'topic_a' });
  const keyFromOption = await memorySystem._resolveCompressionLockKey('user_1', { taskId: 'task_a' });
  const keyNullTopic = await memorySystem._resolveCompressionLockKey('user_1', { activeTopicId: 'topic_null' });
  const keyNoContext = await memorySystem._resolveCompressionLockKey('user_1', {});

  // topic 自带 task_id 与显式 taskId 兜底指向同一把锁
  assert.equal(keyFromTopic, keyFromOption);
  // 无 task 桶显式命名，且与 task 桶、与另一个 null 场景一致
  assert.match(keyNullTopic, /__no_task__$/);
  assert.equal(keyNullTopic, keyNoContext);
  assert.notEqual(keyNullTopic, keyFromTopic);
});

test('B1: legacy 通道跨 task 仍按 expert+user 串行（闸门间隔置 0，强制两次都真扫）', async () => {
  const events = [];
  const { memorySystem } = createCompressionMemorySystem({
    topics: {
      topic_a: topic({ id: 'topic_a', taskId: 'task_a' }),
      topic_b: topic({ id: 'topic_b', taskId: 'task_b' }),
    },
    messagesByTopic: { topic_a: [], topic_b: [] }, // 无消息 → active 压缩不触发 → 走 legacy
    legacyMessages: [],
    events,
    options: { legacyCheckIntervalMs: 0 },
  });

  await Promise.all([
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_a', minMessages: 5 }),
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_b', minMessages: 5 }),
  ]);

  assert.deepEqual(events, ['legacy:start', 'legacy:end', 'legacy:start', 'legacy:end']);
});

test('B1: legacy 低频闸门在锁内复检——并发请求不会重复扫描未绑定消息', async () => {
  const events = [];
  const { memorySystem } = createCompressionMemorySystem({
    topics: {
      topic_a: topic({ id: 'topic_a', taskId: 'task_a' }),
      topic_b: topic({ id: 'topic_b', taskId: 'task_b' }),
    },
    messagesByTopic: { topic_a: [], topic_b: [] },
    legacyMessages: [],
    events,
  });

  const results = await Promise.all([
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_a', minMessages: 5 }),
    memorySystem.compressContext('user_1', { activeTopicId: 'topic_b', minMessages: 5 }),
  ]);

  // 只发生一次 legacy 扫描（另一请求在锁内复检后被闸门拦下）
  assert.deepEqual(events, ['legacy:start', 'legacy:end']);
  assert.equal(results.filter(r => r.reason === 'legacy 检查已由并发请求完成').length, 1);
});

// ---------------------------------------------------------------------------
// 2. 归档器分组（B2）
// ---------------------------------------------------------------------------

function archiverTopic(id, taskId, updatedAt) {
  return {
    id,
    expert_id: 'expert_1',
    user_id: 'user_1',
    task_id: taskId,
    title: `topic ${id}`,
    description: null,
    message_count: 0,
    updated_at: new Date(updatedAt),
    created_at: new Date(updatedAt),
  };
}

function createArchiverHarness(activeTopics, options = {}) {
  const archivedTopicIds = [];
  const findAllCalls = [];
  const topicModel = {
    findAll: async (queryOptions) => {
      findAllCalls.push(queryOptions);
      return activeTopics;
    },
    update: async (values, updateOptions) => {
      if (values.status === 'archived') {
        archivedTopicIds.push(updateOptions.where.id);
      }
      return [1];
    },
  };
  const messageModel = { findAll: async () => [] }; // 空 topic → 直接归档，不触发 LLM
  const db = {
    getModel: (name) => ({ topic: topicModel, message: messageModel, expert: {} }[name]),
  };
  const handler = createTopicArchiverTask({ batchSize: 20, keepActivePerUser: 2, ...options });
  return { handler, db, archivedTopicIds, findAllCalls };
}

test('B2: 归档查询必须取回 task_id（分组依赖该字段）', async () => {
  const { handler, db, findAllCalls } = createArchiverHarness([
    archiverTopic('t1', 'task_a', '2026-10-01T03:00:00Z'),
  ]);

  await handler(db);

  assert.equal(findAllCalls.length, 1);
  assert.ok(findAllCalls[0].attributes.includes('task_id'), 'findAll attributes 需包含 task_id');
});

test('B2: 不因另一个 task 的 topic 数量而归档当前 task 的 topic', async () => {
  // task_a 有 3 个（旧逻辑会归档 1 个），task_b 只有 1 个（旧逻辑按 user 保留 2 个会误归档它）
  const { handler, db, archivedTopicIds } = createArchiverHarness([
    archiverTopic('t_a1', 'task_a', '2026-10-01T04:00:00Z'),
    archiverTopic('t_a2', 'task_a', '2026-10-01T03:00:00Z'),
    archiverTopic('t_a3', 'task_a', '2026-10-01T02:00:00Z'),
    archiverTopic('t_b1', 'task_b', '2026-10-01T01:00:00Z'),
  ]);

  await handler(db);

  assert.deepEqual(archivedTopicIds, ['t_a3']);
});

test('B2: task_id 为 null 的 topic 独立分组，不与 task 合并计数', async () => {
  const { handler, db, archivedTopicIds } = createArchiverHarness([
    archiverTopic('n1', null, '2026-10-01T04:00:00Z'),
    archiverTopic('n2', null, '2026-10-01T03:00:00Z'),
    archiverTopic('n3', null, '2026-10-01T02:00:00Z'),
    archiverTopic('t_a1', 'task_a', '2026-10-01T01:00:00Z'),
  ]);

  await handler(db);

  // null 桶保留 n1/n2 → 归档 n3；task_a 桶只有 1 个 → 不动
  assert.deepEqual(archivedTopicIds, ['n3']);
});

test('B2: 单 task 场景行为不变（同一 task 内保留最新 2 个）', async () => {
  const { handler, db, archivedTopicIds } = createArchiverHarness([
    archiverTopic('t1', 'task_a', '2026-10-01T05:00:00Z'),
    archiverTopic('t2', 'task_a', '2026-10-01T04:00:00Z'),
    archiverTopic('t3', 'task_a', '2026-10-01T03:00:00Z'),
    archiverTopic('t4', 'task_a', '2026-10-01T02:00:00Z'),
    archiverTopic('t5', 'task_a', '2026-10-01T01:00:00Z'),
  ]);

  await handler(db);

  assert.deepEqual(archivedTopicIds, ['t3', 't4', 't5']);
});

test('B2: groupActiveTopicsForArchiving 按 (expert,user,task) 分组且 null 用独立 key', () => {
  const plan = groupActiveTopicsForArchiving([
    archiverTopic('t_a1', 'task_a', '2026-10-01T04:00:00Z'),
    archiverTopic('t_a2', 'task_a', '2026-10-01T03:00:00Z'),
    archiverTopic('t_a3', 'task_a', '2026-10-01T02:00:00Z'),
    archiverTopic('n1', null, '2026-10-01T01:30:00Z'),
    archiverTopic('n2', null, '2026-10-01T01:00:00Z'),
  ], 2);

  assert.equal(plan.size, 2);
  assert.deepEqual([...plan.keys()].sort(), [
    `expert_1:user_1:task:${NO_TASK_TOPIC_GROUP}`,
    'expert_1:user_1:task:task_a',
  ]);
  assert.deepEqual(plan.get('expert_1:user_1:task:task_a').map(t => t.id), ['t_a3']);
  assert.deepEqual(plan.get(`expert_1:user_1:task:${NO_TASK_TOPIC_GROUP}`), []);
});
