/**
 * Tests for tool call snapshot builder helpers.
 *
 * Usage:
 *   node tests/test-tool-call-snapshot-builder.mjs
 */

import assert from 'node:assert/strict';
import {
  buildResultPreview,
  buildToolCallSnapshot,
} from '../lib/tool-call-snapshot-builder.js';

function testEmptyInputs() {
  assert.deepEqual(buildToolCallSnapshot(), []);
  assert.deepEqual(buildToolCallSnapshot(null), []);
  assert.deepEqual(buildToolCallSnapshot({}), []);
  assert.deepEqual(buildToolCallSnapshot([]), []);
}

function testStringPreview() {
  const text = 'x'.repeat(250);
  assert.equal(buildResultPreview({ data: text }), 'x'.repeat(200));
}

function testObjectPreview() {
  assert.equal(
    buildResultPreview({ data: { answer: 42 } }),
    '{"answer":42}'
  );
}

function testUnserializablePreview() {
  const circular = {};
  circular.self = circular;

  assert.equal(
    buildResultPreview({ data: circular }),
    '[unserializable result]'
  );
}

function testErrorPreviewFallback() {
  assert.equal(buildResultPreview({ error: 'failed' }), 'failed');
  assert.equal(buildResultPreview(null), null);
}

function testSnapshotShape() {
  const snapshot = buildToolCallSnapshot([{
    id: 'call_1',
    function: {
      name: 'skill__search',
      arguments: '{"q":"hello"}',
    },
    displayName: '搜索',
    result: {
      success: true,
      data: { ok: true },
    },
    duration: 123,
    tool_message_id: 'msg_tool_1',
    timestamp: '2026-07-28T03:00:00.000Z',
  }]);

  assert.deepEqual(snapshot, [{
    tool_call_id: 'call_1',
    name: 'skill__search',
    display_name: '搜索',
    arguments: '{"q":"hello"}',
    success: true,
    duration: 123,
    result_preview: '{"ok":true}',
    tool_message_id: 'msg_tool_1',
    timestamp: '2026-07-28T03:00:00.000Z',
  }]);
}

function testSnapshotDefaults() {
  const [snapshot] = buildToolCallSnapshot([{
    name: 'plain_tool',
    result: { success: false, error: 'boom' },
  }]);

  assert.equal(snapshot.tool_call_id, null);
  assert.equal(snapshot.name, 'plain_tool');
  assert.equal(snapshot.display_name, 'plain_tool');
  assert.equal(snapshot.arguments, null);
  assert.equal(snapshot.success, false);
  assert.equal(snapshot.duration, 0);
  assert.equal(snapshot.result_preview, 'boom');
  assert.equal(snapshot.tool_message_id, null);
  assert.ok(!Number.isNaN(Date.parse(snapshot.timestamp)));
}

function main() {
  testEmptyInputs();
  testStringPreview();
  testObjectPreview();
  testUnserializablePreview();
  testErrorPreviewFallback();
  testSnapshotShape();
  testSnapshotDefaults();

  console.log('Tool call snapshot builder tests passed.');
}

main();
