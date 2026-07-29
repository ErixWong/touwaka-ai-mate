/**
 * Tests for round state snapshot helpers.
 *
 * Usage:
 *   node tests/test-round-state-snapshot.mjs
 */

import assert from 'node:assert/strict';
import {
  cloneRoundStateValue,
  createRoundStateSnapshot,
  restoreRoundStateSnapshot,
} from '../lib/chat/round-state-snapshot.js';

function testCloneUsesStructuredCloneWhenProvided() {
  let called = false;
  const value = [{ role: 'user', content: 'hello' }];

  const cloned = cloneRoundStateValue(value, (input) => {
    called = true;
    return input.map(item => ({ ...item, cloned: true }));
  });

  assert.equal(called, true);
  assert.deepEqual(cloned, [{ role: 'user', content: 'hello', cloned: true }]);
}

function testCloneFallsBackToJsonClone() {
  const value = [{ role: 'user', content: 'hello', nested: { ok: true } }];
  const cloned = cloneRoundStateValue(value, null);

  assert.deepEqual(cloned, value);
  assert.notEqual(cloned, value);
  assert.notEqual(cloned[0].nested, value[0].nested);
}

function testCreateSnapshotCopiesRollbackState() {
  const messages = [{ role: 'user', content: 'hello' }];
  const tokenUsage = {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  };

  const snapshot = createRoundStateSnapshot({
    round: 2,
    messages,
    fullContent: 'partial answer',
    fullReasoningContent: 'partial reasoning',
    tokenUsage,
  }, { structuredClone: null });

  assert.deepEqual(snapshot, {
    round: 2,
    messages,
    fullContent: 'partial answer',
    fullReasoningContent: 'partial reasoning',
    tokenUsage,
  });
  assert.notEqual(snapshot.messages, messages);
  assert.notEqual(snapshot.tokenUsage, tokenUsage);
}

function testCreateSnapshotPreservesNullTokenUsage() {
  const snapshot = createRoundStateSnapshot({
    round: 0,
    messages: [],
    tokenUsage: null,
  }, { structuredClone: null });

  assert.equal(snapshot.tokenUsage, null);
}

function testRestoreSnapshotCopiesState() {
  const snapshot = {
    round: 1,
    messages: [{ role: 'assistant', content: 'partial' }],
    fullContent: 'partial',
    fullReasoningContent: 'thinking',
    tokenUsage: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    },
  };

  const restored = restoreRoundStateSnapshot(snapshot, { structuredClone: null });

  assert.deepEqual(restored, snapshot);
  assert.notEqual(restored.messages, snapshot.messages);
  assert.notEqual(restored.tokenUsage, snapshot.tokenUsage);
}

function testRestoreMissingSnapshotUsesSafeDefaults() {
  const restored = restoreRoundStateSnapshot(null, { structuredClone: null });

  assert.deepEqual(restored, {
    round: undefined,
    messages: [],
    fullContent: '',
    fullReasoningContent: '',
    tokenUsage: null,
  });
}

function main() {
  testCloneUsesStructuredCloneWhenProvided();
  testCloneFallsBackToJsonClone();
  testCreateSnapshotCopiesRollbackState();
  testCreateSnapshotPreservesNullTokenUsage();
  testRestoreSnapshotCopiesState();
  testRestoreMissingSnapshotUsesSafeDefaults();

  console.log('Round state snapshot tests passed.');
}

main();
