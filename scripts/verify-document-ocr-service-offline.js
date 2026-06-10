import assert from 'assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import DocumentOcrService from '../lib/document-ocr-service.js';

function createDbMock() {
  const attachments = [];
  const docOcrImages = [];

  class AttachmentModel {
    static async create(data) {
      attachments.push({ ...data });
      return { ...data };
    }

    static async findByPk(id) {
      return attachments.find(item => item.id === id) || null;
    }

    static async findAll({ where }) {
      return attachments.filter(item => {
        if (where.source_tag !== undefined && item.source_tag !== where.source_tag) return false;
        if (where.source_id !== undefined && item.source_id !== where.source_id) return false;
        return true;
      });
    }
  }

  class DocOcrImageModel {
    static async create(data) {
      docOcrImages.push({ ...data });
      return { ...data };
    }
  }

  return {
    attachments,
    docOcrImages,
    getModel(name) {
      if (name === 'attachment') return AttachmentModel;
      if (name === 'doc_ocr_image') return DocOcrImageModel;
      throw new Error(`Unsupported model: ${name}`);
    },
  };
}

function createService(db, tempDir, callMcpImpl) {
  process.env.ATTACHMENT_BASE_PATH = tempDir;
  const service = new DocumentOcrService(db, {
    callMcp: callMcpImpl,
  });
  service.advancer = {
    advance: async () => {},
    fail: async () => {},
  };
  return service;
}

async function testHelpers(service) {
  assert.equal(service.normalizeStatus('pending'), 'pending');
  assert.equal(service.normalizeStatus('processing'), 'processing');
  assert.equal(service.normalizeStatus('completed'), 'completed');
  assert.equal(service.normalizeStatus('error'), 'failed');
  assert.equal(service.normalizeStatus('unknown-status'), 'failed');

  assert.equal(service.extractDefaultMarkdown({ result: 'plain markdown' }), 'plain markdown');
  assert.equal(service.extractDefaultMarkdown({ result: { markdown: '# title' } }), '# title');
  assert.equal(service.extractDefaultMarkdown({ result: { content: 'abc' } }), 'abc');
  assert.equal(service.extractDefaultMarkdown({ result: { other: true } }), '');

  const rewritten = service.rewriteMarkdownImageLinks(
    '![img](images/a.png)\n![img2](./images/b.png)',
    {
      'images/a.png': '/api/attachments/1',
      'images/b.png': '/api/attachments/2',
    }
  );
  assert.ok(rewritten.includes('(/api/attachments/1)'));
  assert.ok(rewritten.includes('(/api/attachments/2)'));

  assert.equal(service.countLines(''), 0);
  assert.equal(service.countLines('a'), 1);
  assert.equal(service.countLines('a\nb\n'), 3);
}

async function testResolveSourceAttachment(service, db) {
  db.attachments.push(
    {
      id: 'att-rev',
      source_tag: 'doc-platform',
      source_id: 'rev-1',
      file_name: 'rev.pdf',
      created_at: '2026-01-01 00:00:00',
    },
    {
      id: 'att-doc',
      source_tag: 'doc-platform',
      source_id: 'doc-1',
      file_name: 'doc.pdf',
      created_at: '2026-01-02 00:00:00',
    }
  );

  const byExplicit = await service.resolveSourceAttachment({ id: 'doc-1' }, { id: 'rev-1' }, 'att-doc');
  assert.equal(byExplicit.id, 'att-doc');

  db.attachments.push({
    id: 'att-user',
    source_tag: 'mini_app_file',
    source_id: 'row-1',
    file_name: 'user.pdf',
    created_by: 'user-1',
    created_at: '2026-01-03 00:00:00',
  });
  const byUserOwnedExplicit = await service.resolveSourceAttachment({ id: 'doc-1' }, { id: 'rev-1' }, 'att-user', 'user-1');
  assert.equal(byUserOwnedExplicit.id, 'att-user');

  db.attachments.push({
    id: 'att-foreign',
    source_tag: 'mini_app_file',
    source_id: 'row-2',
    file_name: 'foreign.pdf',
    created_by: 'user-2',
    created_at: '2026-01-04 00:00:00',
  });
  const deniedExplicit = await service.resolveSourceAttachment({ id: 'doc-1' }, { id: 'rev-1' }, 'att-foreign', 'user-1');
  assert.equal(deniedExplicit, null);

  const byRevision = await service.resolveSourceAttachment({ id: 'doc-1' }, { id: 'rev-1' });
  assert.equal(byRevision.id, 'att-rev');

  db.attachments.splice(0, 1);
  const byDocumentFallback = await service.resolveSourceAttachment({ id: 'doc-1' }, { id: 'rev-1' });
  assert.equal(byDocumentFallback.id, 'att-doc');
}

async function testFinalizeCompletedTask(service, db) {
  const ctx = {
    document: { id: 'doc-100' },
    revision: { id: 'rev-100', created_by: 'user-ocr-1' },
  };

  const ocrResult = {
    id: 'ocr-1',
    task_id: 'task-1',
    metadata: null,
    async update(payload) {
      Object.assign(this, payload);
      return this;
    },
  };

  const finalized = await service.finalizeCompletedTask(ctx, ocrResult, {});

  assert.equal(finalized.status, 'completed');
  assert.equal(finalized.progress, 100);
  assert.equal(finalized.image_count, 1);
  assert.ok(finalized.main_markdown_attachment_id);
  assert.ok(finalized.raw_result_attachment_id);
  assert.ok(finalized.deliverables_manifest_attachment_id);
  assert.ok(finalized.image_manifest_attachment_id);
  assert.equal(finalized.line_count, 2);

  const markdownAttachment = db.attachments.find(item => item.id === finalized.main_markdown_attachment_id);
  assert.ok(markdownAttachment, '应生成主 markdown 附件');
  assert.equal(markdownAttachment.created_by, 'user-ocr-1', 'OCR 输出附件应继承 revision.created_by');

  const markdownPath = path.join(process.env.ATTACHMENT_BASE_PATH, markdownAttachment.file_path);
  const markdownContent = await fs.readFile(markdownPath, 'utf8');
  assert.ok(markdownContent.includes('/api/attachments/'), 'markdown 图片链接应改写为附件 URL');

  assert.equal(db.docOcrImages.length, 1, '应写入一条 doc_ocr_images');
  assert.equal(db.docOcrImages[0].ocr_result_id, 'ocr-1');
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'document-ocr-service-test-'));
  const db = createDbMock();
  const callMcpImpl = async (_server, tool) => {
    if (tool === 'get_default_deliverable') {
      return {
        format: 'markdown',
        filename: 'result.md',
        result: '# OCR Result\n![img](images/test.png)',
      };
    }
    if (tool === 'list_deliverables') {
      return {
        items: [{ filename: 'result.md', format: 'markdown' }],
      };
    }
    if (tool === 'get_image_deliverables') {
      return {
        items: [
          {
            filename: 'test.png',
            relative_path: 'images/test.png',
            media_type: 'image/png',
            referenced_in_markdown: true,
            references: [
              {
                markdown_path: 'images/test.png',
                line_number: 2,
                start_offset: 0,
                end_offset: 10,
                alt_text: 'img',
              },
            ],
          },
        ],
        images: {
          'test.png': 'data:image/png;base64,aGVsbG8=',
        },
      };
    }
    throw new Error(`Unexpected MCP tool: ${tool}`);
  };

  const service = createService(db, tempDir, callMcpImpl);

  await testHelpers(service);
  await testResolveSourceAttachment(service, db);
  await testFinalizeCompletedTask(service, db);

  console.log('document-ocr-service offline tests passed');
}

main().catch((error) => {
  console.error('document-ocr-service offline tests failed:', error);
  process.exitCode = 1;
});
