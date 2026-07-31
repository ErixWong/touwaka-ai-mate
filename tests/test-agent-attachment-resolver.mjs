/**
 * Tests for Agent attachment resolver.
 *
 * Usage:
 *   node tests/test-agent-attachment-resolver.mjs
 */

import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import {
  buildMultimodalMessagesWithAttachments,
  extractDelegationAttachments,
  resolveAgentAttachments,
} from '../lib/agent/agent-attachment-resolver.js';

const PNG_1X1_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function createFixture() {
  const root = path.join(process.cwd(), 'temp', 'agent-attachment-resolver-test');
  const workspace = path.join(root, 'workspace');
  const outside = path.join(root, 'outside');

  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(outside, { recursive: true });

  const imagePath = path.join(workspace, 'sample.png');
  const outsideImagePath = path.join(outside, 'outside.png');
  await fs.writeFile(imagePath, Buffer.from(PNG_1X1_BASE64, 'base64'));
  await fs.writeFile(outsideImagePath, Buffer.from(PNG_1X1_BASE64, 'base64'));

  return { root, workspace, imagePath, outsideImagePath };
}

async function testResolvesRelativeWorkspaceImageToDataUrl() {
  const fixture = await createFixture();
  const result = await resolveAgentAttachments({
    delegation: {
      input: {
        attachments: [
          {
            type: 'image',
            source: 'workspace_path',
            path: 'sample.png',
            purpose: 'ocr',
          },
        ],
      },
    },
    taskContext: {
      absolute_workspace_path: fixture.workspace,
    },
  });

  assert.equal(result.attachments.length, 1);
  assert.equal(result.content_parts.length, 1);
  assert.equal(result.attachments[0].filename, 'sample.png');
  assert.equal(result.attachments[0].mime_type, 'image/png');
  assert.equal(result.attachments[0].purpose, 'ocr');
  assert.match(result.attachments[0].data_url, /^data:image\/png;base64,/);
  assert.deepEqual(result.content_parts[0], {
    type: 'image_url',
    image_url: { url: result.attachments[0].data_url },
  });
}

async function testResolvesFullPathInsideWorkspace() {
  const fixture = await createFixture();
  const result = await resolveAgentAttachments({
    delegation: {
      input: {
        attachments: [
          {
            type: 'image',
            source: 'workspace_path',
            path: fixture.imagePath,
          },
        ],
      },
    },
    taskContext: {
      absolute_workspace_path: fixture.workspace,
    },
  });

  assert.equal(result.attachments.length, 1);
  assert.equal(result.attachments[0].path, await fs.realpath(fixture.imagePath));
}

async function testRejectsPathOutsideWorkspace() {
  const fixture = await createFixture();

  await assert.rejects(() => resolveAgentAttachments({
    delegation: {
      input: {
        attachments: [
          {
            type: 'image',
            source: 'workspace_path',
            path: fixture.outsideImagePath,
          },
        ],
      },
    },
    taskContext: {
      absolute_workspace_path: fixture.workspace,
    },
  }), /outside delegated workspace/);
}

function testRejectsInvalidAttachmentsShape() {
  assert.throws(() => extractDelegationAttachments({
    input: {
      attachments: {
        path: 'sample.png',
      },
    },
  }), /must be an array/);
}

function testBuildsMultimodalMessageOnLastUserMessage() {
  const messages = [
    { role: 'system', content: 'system' },
    { role: 'user', content: '{"task":"ocr"}' },
  ];
  const result = buildMultimodalMessagesWithAttachments(messages, {
    content_parts: [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ],
  });

  assert.equal(result.length, 2);
  assert.equal(result[0], messages[0]);
  assert.equal(Array.isArray(result[1].content), true);
  assert.deepEqual(result[1].content, [
    { type: 'text', text: '{"task":"ocr"}' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
  ]);
}

async function main() {
  await testResolvesRelativeWorkspaceImageToDataUrl();
  await testResolvesFullPathInsideWorkspace();
  await testRejectsPathOutsideWorkspace();
  testRejectsInvalidAttachmentsShape();
  testBuildsMultimodalMessageOnLastUserMessage();

  console.log('Agent attachment resolver tests passed.');
}

main();
