/**
 * Agent attachment resolver.
 *
 * Resolves delegated attachment references into provider-ready multimodal
 * content parts. Paths are treated as untrusted input and must stay inside the
 * delegated task workspace.
 */

import fs from 'fs/promises';
import path from 'path';

export const DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const IMAGE_MIME_BY_EXT = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
});

const ALLOWED_IMAGE_SOURCES = new Set(['workspace_path', 'workspace']);

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAttachmentPath(attachment) {
  return normalizeString(attachment.path)
    || normalizeString(attachment.full_path)
    || normalizeString(attachment.fullpath);
}

function assertInsideWorkspace(targetPath, workspacePath) {
  const relative = path.relative(workspacePath, targetPath);
  if (relative === '') return;
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Attachment path is outside delegated workspace: ${targetPath}`);
  }
}

function getImageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_MIME_BY_EXT[ext] || null;
}

export function extractDelegationAttachments(delegation = {}) {
  const input = normalizeObject(delegation.input);
  if (input.attachments === undefined || input.attachments === null) {
    return [];
  }
  if (!Array.isArray(input.attachments)) {
    throw new Error('delegation.input.attachments must be an array');
  }
  return input.attachments;
}

export function hasDelegationAttachments(delegation = {}) {
  return extractDelegationAttachments(delegation).length > 0;
}

async function resolveWorkspaceRoot(taskContext) {
  const workdir = normalizeString(taskContext?.absolute_workspace_path);
  if (!workdir) {
    throw new Error('taskContext.absolute_workspace_path is required for attachment resolution');
  }
  return await fs.realpath(path.resolve(workdir));
}

async function resolveAttachmentPath(attachment, workspaceRoot) {
  const rawPath = getAttachmentPath(attachment);
  if (!rawPath) {
    throw new Error('attachment.path is required');
  }

  const candidate = path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workspaceRoot, rawPath);
  const realTarget = await fs.realpath(candidate);
  assertInsideWorkspace(realTarget, workspaceRoot);

  return realTarget;
}

async function resolveImageAttachment(attachment, workspaceRoot, options = {}) {
  const source = normalizeString(attachment.source || 'workspace_path');
  if (!ALLOWED_IMAGE_SOURCES.has(source)) {
    throw new Error(`Unsupported image attachment source: ${source}`);
  }

  const realPath = await resolveAttachmentPath(attachment, workspaceRoot);
  const stats = await fs.stat(realPath);
  if (!stats.isFile()) {
    throw new Error(`Attachment is not a file: ${realPath}`);
  }

  const maxBytes = options.max_image_bytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES;
  if (stats.size > maxBytes) {
    throw new Error(`Image attachment is too large: ${stats.size} bytes (max: ${maxBytes})`);
  }

  const mimeType = getImageMimeType(realPath);
  if (!mimeType) {
    throw new Error(`Unsupported image attachment type: ${path.extname(realPath) || '(none)'}`);
  }

  const buffer = await fs.readFile(realPath);
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

  return Object.freeze({
    type: 'image',
    source,
    purpose: normalizeString(attachment.purpose) || null,
    path: realPath,
    filename: path.basename(realPath),
    mime_type: mimeType,
    size_bytes: stats.size,
    data_url: dataUrl,
    content_part: Object.freeze({
      type: 'image_url',
      image_url: Object.freeze({ url: dataUrl }),
    }),
  });
}

export async function resolveAgentAttachments({
  delegation,
  taskContext,
  options = {},
} = {}) {
  const attachments = extractDelegationAttachments(delegation);
  if (attachments.length === 0) {
    return Object.freeze({
      attachments: Object.freeze([]),
      content_parts: Object.freeze([]),
    });
  }

  const workspaceRoot = await resolveWorkspaceRoot(taskContext);
  const resolved = [];

  for (const attachment of attachments) {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) {
      throw new Error('attachment must be an object');
    }
    const type = normalizeString(attachment.type || 'image');
    if (type !== 'image') {
      throw new Error(`Unsupported attachment type: ${type}`);
    }
    resolved.push(await resolveImageAttachment(attachment, workspaceRoot, options));
  }

  return Object.freeze({
    attachments: Object.freeze(resolved),
    content_parts: Object.freeze(resolved.map(item => item.content_part)),
  });
}

export function buildMultimodalMessagesWithAttachments(messages, attachmentResolution) {
  const contentParts = attachmentResolution?.content_parts || [];
  if (!Array.isArray(contentParts) || contentParts.length === 0) {
    return messages;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages are required to build multimodal attachment prompt');
  }

  const lastUserIndex = messages.map(message => message.role).lastIndexOf('user');
  if (lastUserIndex < 0) {
    throw new Error('a user message is required to attach multimodal content');
  }

  return messages.map((message, index) => {
    if (index !== lastUserIndex) return message;

    const text = Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      : String(message.content || '');

    return {
      ...message,
      content: [
        { type: 'text', text },
        ...contentParts,
      ],
    };
  });
}

export default {
  DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES,
  extractDelegationAttachments,
  hasDelegationAttachments,
  resolveAgentAttachments,
  buildMultimodalMessagesWithAttachments,
};
