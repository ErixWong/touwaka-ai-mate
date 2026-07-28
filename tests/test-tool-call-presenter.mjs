/**
 * Tests for tool call presentation helpers.
 *
 * Usage:
 *   node tests/test-tool-call-presenter.mjs
 */

import assert from 'node:assert/strict';
import {
  formatToolCallDisplayName,
  getToolCallDisplayNames,
  getToolCallId,
  presentToolCalls,
  toToolCallArray,
} from '../lib/tool-call-presenter.js';

const toolManager = {
  formatToolDisplay(toolId) {
    return `display/${toolId}`;
  },
};

function testNormalizeToolCalls() {
  assert.deepEqual(toToolCallArray(null), []);
  assert.deepEqual(toToolCallArray(undefined), []);

  const call = { function: { name: 'demo_tool' } };
  assert.deepEqual(toToolCallArray(call), [call]);
  assert.deepEqual(toToolCallArray([call]), [call]);
}

function testToolCallId() {
  assert.equal(getToolCallId({ function: { name: 'fn_name' } }), 'fn_name');
  assert.equal(getToolCallId({ name: 'plain_name' }), 'plain_name');
  assert.equal(getToolCallId({}), null);
}

function testDisplayNameFormatting() {
  assert.equal(
    formatToolCallDisplayName({ function: { name: 'skill__search' } }, toolManager),
    'display/skill__search'
  );
  assert.equal(
    formatToolCallDisplayName({ name: 'plain_tool' }, null),
    'plain_tool'
  );
  assert.equal(formatToolCallDisplayName({}, toolManager), '');
}

function testPresentToolCalls() {
  const original = {
    id: 'call_1',
    function: {
      name: 'demo_tool',
      arguments: '{"q":"hello"}',
    },
  };

  const presented = presentToolCalls(original, toolManager);

  assert.equal(presented.length, 1);
  assert.equal(presented[0].id, 'call_1');
  assert.equal(presented[0].function.name, 'demo_tool');
  assert.equal(presented[0].displayName, 'display/demo_tool');
  assert.equal(original.displayName, undefined, 'presenter must not mutate original tool call');
}

function testDisplayNames() {
  const names = getToolCallDisplayNames([
    { function: { name: 'first' } },
    { name: 'second' },
  ], toolManager);

  assert.deepEqual(names, ['display/first', 'display/second']);
}

function main() {
  testNormalizeToolCalls();
  testToolCallId();
  testDisplayNameFormatting();
  testPresentToolCalls();
  testDisplayNames();

  console.log('Tool call presenter tests passed.');
}

main();
