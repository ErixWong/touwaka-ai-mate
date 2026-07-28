/**
 * Tests for token usage accumulator helpers.
 *
 * Usage:
 *   node tests/test-token-usage-accumulator.mjs
 */

import assert from 'node:assert/strict';
import {
  addTokenUsage,
  createEmptyTokenUsage,
  normalizeTokenUsage,
  snapshotTokenUsage,
} from '../lib/token-usage-accumulator.js';

function testCreateEmptyTokenUsage() {
  const first = createEmptyTokenUsage();
  const second = createEmptyTokenUsage();

  assert.deepEqual(first, {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  });
  assert.notEqual(first, second, 'empty usage factory must return a fresh object');
}

function testNormalizeTokenUsage() {
  assert.equal(normalizeTokenUsage(null), null);
  assert.equal(normalizeTokenUsage(undefined), null);

  assert.deepEqual(normalizeTokenUsage({ prompt_tokens: 3 }), {
    prompt_tokens: 3,
    completion_tokens: 0,
    total_tokens: 0,
  });

  assert.deepEqual(normalizeTokenUsage({
    prompt_tokens: '4',
    completion_tokens: '5',
    total_tokens: '9',
  }), {
    prompt_tokens: 4,
    completion_tokens: 5,
    total_tokens: 9,
  });
}

function testSnapshotTokenUsage() {
  const usage = {
    prompt_tokens: 1,
    completion_tokens: 2,
    total_tokens: 3,
  };
  const snapshot = snapshotTokenUsage(usage);

  assert.deepEqual(snapshot, usage);
  assert.notEqual(snapshot, usage, 'snapshot must not reuse the original object');
  assert.equal(snapshotTokenUsage(null), null);
}

function testAddTokenUsage() {
  assert.equal(addTokenUsage(null, null), null);

  assert.deepEqual(addTokenUsage(null, {}), {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  });

  assert.deepEqual(addTokenUsage(null, {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
  }), {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
  });

  assert.deepEqual(addTokenUsage({
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
  }, {
    prompt_tokens: 3,
    completion_tokens: 7,
    total_tokens: 10,
  }), {
    prompt_tokens: 13,
    completion_tokens: 11,
    total_tokens: 24,
  });
}

function testAddTokenUsageDoesNotMutateInputs() {
  const current = {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
  };
  const incoming = {
    prompt_tokens: 3,
    completion_tokens: 7,
    total_tokens: 10,
  };

  const result = addTokenUsage(current, incoming);

  assert.notEqual(result, current);
  assert.deepEqual(current, {
    prompt_tokens: 10,
    completion_tokens: 4,
    total_tokens: 14,
  });
  assert.deepEqual(incoming, {
    prompt_tokens: 3,
    completion_tokens: 7,
    total_tokens: 10,
  });
}

function main() {
  testCreateEmptyTokenUsage();
  testNormalizeTokenUsage();
  testSnapshotTokenUsage();
  testAddTokenUsage();
  testAddTokenUsageDoesNotMutateInputs();

  console.log('Token usage accumulator tests passed.');
}

main();
