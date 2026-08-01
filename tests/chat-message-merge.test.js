import assert from 'node:assert/strict';
import {
  compareMessages,
  mergeMessagesById,
} from '../frontend/src/stores/chat-message-merge.js';

const message = (overrides) => ({
  id: 'msg-1',
  expert_id: 'expert-1',
  user_id: 'user-1',
  role: 'assistant',
  content: '',
  status: 'completed',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

const run = () => {
  console.log('\n场景 1：按 created_at + id 稳定排序');
  const sorted = [
    message({ id: 'msg-3', created_at: '2026-08-01T00:00:02.000Z' }),
    message({ id: 'msg-1', created_at: '2026-08-01T00:00:01.000Z' }),
    message({ id: 'msg-2', created_at: '2026-08-01T00:00:01.000Z' }),
  ].sort(compareMessages);
  assert.deepEqual(sorted.map(m => m.id), ['msg-1', 'msg-2', 'msg-3']);

  console.log('场景 2：历史页前插时按 id 去重并保持老到新');
  const mergedHistory = mergeMessagesById(
    [
      message({ id: 'msg-3', created_at: '2026-08-01T00:00:03.000Z', content: 'three' }),
      message({ id: 'msg-4', created_at: '2026-08-01T00:00:04.000Z', content: 'four' }),
    ],
    [
      message({ id: 'msg-1', created_at: '2026-08-01T00:00:01.000Z', content: 'one' }),
      message({ id: 'msg-3', created_at: '2026-08-01T00:00:03.000Z', content: 'three updated' }),
    ]
  );
  assert.deepEqual(mergedHistory.map(m => m.id), ['msg-1', 'msg-3', 'msg-4']);
  assert.equal(mergedHistory.find(m => m.id === 'msg-3')?.content, 'three updated');

  console.log('场景 3：since 重复返回同一服务端消息时只保留一份');
  const mergedSince = mergeMessagesById(
    [
      message({ id: 'msg-1', created_at: '2026-08-01T00:00:01.000Z' }),
      message({ id: 'msg-2', created_at: '2026-08-01T00:00:02.000Z' }),
    ],
    [
      message({ id: 'msg-2', created_at: '2026-08-01T00:00:02.000Z', content: 'second reconcile' }),
      message({ id: 'msg-3', created_at: '2026-08-01T00:00:03.000Z' }),
    ]
  );
  assert.deepEqual(mergedSince.map(m => m.id), ['msg-1', 'msg-2', 'msg-3']);
  assert.equal(mergedSince.filter(m => m.id === 'msg-2').length, 1);
  assert.equal(mergedSince.find(m => m.id === 'msg-2')?.content, 'second reconcile');

  console.log('场景 4：缺少 status 的服务端消息归一化为 completed');
  const normalized = mergeMessagesById([], [
    message({ id: 'msg-1', status: undefined }),
  ]);
  assert.equal(normalized[0]?.status, 'completed');
};

run();
console.log('\nchat-message-merge tests passed');

