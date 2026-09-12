import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeToolContext } from '../lib/tool-context.js';

test('preserves string tool contexts', () => {
  assert.equal(normalizeToolContext('display context'), 'display context');
  assert.equal(normalizeToolContext(''), '');
});

test('normalizes non-string tool contexts to null', () => {
  assert.equal(normalizeToolContext(null), null);
  assert.equal(normalizeToolContext(undefined), null);
  assert.equal(normalizeToolContext({ phase: 'execute' }), null);
  assert.equal(normalizeToolContext(['context']), null);
  assert.equal(normalizeToolContext(42), null);
});
