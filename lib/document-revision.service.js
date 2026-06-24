import logger from '../logger.js';
import Utils from '../utils.js';

class DocumentRevisionService {
  constructor(db) {
    this.db = db;
    this.models = {};
  }

  ensureModels() {
    if (!this.models.DocVersion) {
      this.models.DocVersion = this.db.getModel('document_revision');
      this.models.DocChunk = this.db.getModel('document_chunk');
    }
  }

  async createRevision(documentId, userId, options = {}) {
    this.ensureModels();

    const { revision_label, change_summary, chunks } = options;

    const maxVersion = await this.models.DocVersion.findOne({
      where: { document_id: documentId },
      order: [['revision_no', 'DESC']],
    });
    const revisionNo = maxVersion ? maxVersion.revision_no + 1 : 1;
    const versionId = Utils.newID();

    await this.db.sequelize.transaction(async (t) => {
      await this.models.DocVersion.create({
        id: versionId,
        document_id: documentId,
        revision_no: revisionNo,
        revision_label: revision_label || `v${revisionNo}`,
        revision_status: 'draft',
        is_current: 0,
        change_summary: change_summary || null,
        created_by: userId,
      }, { transaction: t });

      if (chunks && Array.isArray(chunks) && chunks.length > 0) {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          await this.models.DocChunk.create({
            id: Utils.newID(),
            revision_id: versionId,
            outline_id: chunk.outline_id || null,
            title: chunk.title || null,
            content: chunk.content || null,
            seq: chunk.seq ?? i,
            from_line: chunk.from_line ?? null,
            to_line: chunk.to_line ?? null,
            text_hash: chunk.text_hash || null,
            byte_count: chunk.byte_count ?? null,
            token_count: chunk.token_count || null,
          }, { transaction: t });
        }
      }
    });

    const version = await this.models.DocVersion.findByPk(versionId);
    logger.info(`[DocumentRevisionService] Created revision: ${versionId} for ${documentId}, ${chunks?.length || 0} chunks`);

    return version;
  }

  async setCurrentRevision(documentId, revisionId, userId) {
    this.ensureModels();

    const version = await this.models.DocVersion.findOne({
      where: { id: revisionId },
    });
    if (!version) {
      throw new Error('Revision not found');
    }

    const document = await this.db.getModel('document').findOne({ where: { id: documentId } });
    if (!document) {
      throw new Error('Document not found');
    }

    const VALID_TRANSITIONS = {
      'draft': ['review', 'archived'],
      'review': ['approved', 'draft', 'archived'],
      'approved': ['effective', 'draft', 'archived'],
      'effective': ['expired', 'archived'],
      'expired': ['draft', 'archived'],
      'archived': [],
    };

    const valid = VALID_TRANSITIONS[version.revision_status];
    if (!valid || !valid.includes('effective')) {
      throw new Error(`Invalid status transition: ${version.revision_status} → effective`);
    }

    await this.db.sequelize.transaction(async (t) => {
      const rows = await this.db.sequelize.query(
        'SELECT id, current_revision_id FROM documents WHERE id = ? FOR UPDATE',
        { replacements: [documentId], type: this.db.sequelize.QueryTypes.SELECT, transaction: t }
      );
      if (!rows || rows.length === 0) {
        throw new Error('Document not found');
      }

      await this.models.DocVersion.update(
        { is_current: 0 },
        { where: { document_id: documentId }, transaction: t }
      );

      version.is_current = 1;
      version.revision_status = 'effective';
      await version.save({ transaction: t });

      await this.db.getModel('document').update(
        { current_revision_id: revisionId },
        { where: { id: documentId }, transaction: t }
      );
    });

    await document.reload();
    logger.info(`[DocumentRevisionService] Set current revision: ${revisionId} for ${documentId}`);

    return {
      document_id: documentId,
      current_revision_id: revisionId,
    };
  }

  async getRevisionList(documentId) {
    this.ensureModels();

    const versions = await this.models.DocVersion.findAll({
      where: { document_id: documentId },
      order: [['revision_no', 'DESC']],
    });

    return versions;
  }

  async getContentTree(revisionId) {
    this.ensureModels();

    const chunks = await this.models.DocChunk.findAll({
      where: { revision_id: revisionId },
      order: [['seq', 'ASC']],
      attributes: ['id', 'outline_id', 'title', 'content', 'seq', 'from_line', 'to_line', 'text_hash', 'byte_count', 'token_count', 'embedding_status'],
    });

    return chunks;
  }
}

export default DocumentRevisionService;