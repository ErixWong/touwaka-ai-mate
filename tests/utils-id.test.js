import test from 'node:test';
import assert from 'node:assert/strict';

import Utils from '../lib/utils.js';

const SAFE_CHARS_PATTERN = /^[23456789abcdefghjkmnpqrstuvwxyz]+$/;

function assertStrictlyIncreasing(ids, description) {
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index - 1] >= ids[index]) {
      const firstAdjacentIndex = Math.min(
        Math.max(index - 1, 0),
        Math.max(ids.length - 3, 0),
      );
      const adjacentIds = ids.slice(firstAdjacentIndex, firstAdjacentIndex + 3);
      assert.fail(
        `${description} failed at index ${index}; adjacent IDs: ${adjacentIds.join(', ')}`,
      );
    }
  }
}

test('IDs use only the safe character set', () => {
  const ids = [
    Utils.newID(),
    Utils.newID(16),
    Utils.newID(32),
    Utils.newID(10),
    Utils.newID(5),
  ];

  for (const id of ids) {
    assert.match(id, SAFE_CHARS_PATTERN);
    assert.doesNotMatch(id, /[0oi1l]/);
  }
});

test('newID preserves the supported length behavior', () => {
  assert.equal(Utils.newID().length, 20);
  assert.equal(Utils.newID(16).length, 16);
  assert.equal(Utils.newID(32).length, 32);
  assert.equal(Utils.newID(10).length, 10);
  assert.equal(Utils.newID(5).length, 10);
});

test('20,000 generated IDs are unique', () => {
  const ids = Array.from({ length: 20_000 }, () => Utils.newID());
  assert.equal(new Set(ids).size, ids.length);
});

test('at least 5,000 IDs generated in one millisecond are strictly increasing', () => {
  const originalDateNow = Date.now;
  const fixedMs = originalDateNow();

  try {
    Date.now = () => fixedMs;
    const ids = Array.from({ length: 5_000 }, () => Utils.newID(16));
    assertStrictlyIncreasing(ids, 'same-millisecond monotonicity');
  } finally {
    Date.now = originalDateNow;
  }
});

test('different lengths remain independently monotonic in one millisecond', () => {
  const originalDateNow = Date.now;
  const fixedMs = originalDateNow();
  const lengths = [16, 20, 32];
  const idsByLength = new Map(lengths.map(length => [length, []]));

  try {
    Date.now = () => fixedMs;
    for (let index = 0; index < 2_000; index += 1) {
      for (const length of lengths) {
        idsByLength.get(length).push(Utils.newID(length));
      }
    }

    for (const length of lengths) {
      assertStrictlyIncreasing(
        idsByLength.get(length),
        `same-millisecond monotonicity for length ${length}`,
      );
    }
  } finally {
    Date.now = originalDateNow;
  }
});

test('IDs remain strictly increasing across real millisecond boundaries', async () => {
  const ids = [];
  const observedMilliseconds = new Set();

  for (let index = 0; index < 20_000; index += 1) {
    observedMilliseconds.add(Date.now());
    ids.push(Utils.newID());
  }

  if (observedMilliseconds.size < 2) {
    await new Promise(resolve => setTimeout(resolve, 2));
    observedMilliseconds.add(Date.now());
    ids.push(Utils.newID());
  }

  assert.ok(observedMilliseconds.size >= 2, 'generation should span multiple real milliseconds');
  assertStrictlyIncreasing(ids, 'cross-millisecond monotonicity');
});

test('clock rollback does not make IDs decrease', () => {
  const originalDateNow = Date.now;
  const normalMs = originalDateNow();
  let clockMs = normalMs;

  try {
    Date.now = () => clockMs;
    const ids = [Utils.newID(20)];
    clockMs -= 5_000;
    for (let index = 0; index < 5_000; index += 1) {
      ids.push(Utils.newID(20));
    }
    assertStrictlyIncreasing(ids, 'clock rollback monotonicity');
  } finally {
    Date.now = originalDateNow;
  }
});

test('normal Date.now generation is strictly increasing', () => {
  const ids = Array.from({ length: 1_000 }, () => Utils.newID(20));
  assertStrictlyIncreasing(ids, 'normal clock monotonicity');
});
