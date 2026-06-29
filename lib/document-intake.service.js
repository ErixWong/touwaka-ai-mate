import logger from './logger.js';
import Utils from './utils.js';
import DocumentRevisionService from './document-revision.service.js';

class DocumentIntakeService {
  constructor(db) {
    this.db = db;
    this.models = {};
  }

  ensureModels() {
    if (!this.models.DocDocument) {
      this.models.DocDocument = this.db.getModel('document');
      this.models.DocVersion = this.db.getModel('document_revision');
    }
  }

  async validateIntakeRequest({ appId, collectionId, attachmentIds, userId, collectionAccessService }) {
    this.ensureModels();

    if (!appId) {
      throw new Error('app_id is required');
    }
    if (!collectionId) {
      throw new Error('collection_id is required');
    }

    const DocumentCollection = this.db.getModel('document_collection');
    const collection = await DocumentCollection.findByPk(collectionId);
    if (!collection) {
      throw new Error('Collection not found');
    }

    const canWrite = await collectionAccessService.canWrite(collectionId, userId);
    if (!canWrite) {
      throw new Error('Only the collection owner can create intake documents');
    }

    if (attachmentIds && attachmentIds.length > 0) {
      const Attachment = this.db.getModel('attachment');
      const attachmentRows = await Attachment.findAll({
        where: { id: attachmentIds },
        attributes: ['id', 'created_by'],
        raw: true,
      });

      if (attachmentRows.length !== attachmentIds.length) {
        throw new Error('One or more attachments not found');
      }

      const deniedAttachment = attachmentRows.find(item => item.created_by !== userId);
      if (deniedAttachment) {
        throw new Error('Attachment access denied');
      }
    }

    return { collection, valid: true };
  }

  async createIntakeDocument({ appId, collectionId, schemaId, attachments, userId }) {
    this.ensureModels();

    const sourceRefId = Utils.newID();
    const firstAttachment = attachments && attachments.length > 0 ? attachments[0] : null;
    const intakeMetadata = JSON.stringify({
      app_id: appId,
      schema_id: schemaId || null,
      attachments: attachments || [],
    });

    const documentId = Utils.newID();
    const revisionId = Utils.newID();

    const document = await this.db.sequelize.transaction(async (t) => {
      const createdDocument = await this.models.DocDocument.create({
        id: documentId,
        collection_id: collectionId,
        doc_type: appId.startsWith('contract') ? 'contract' : 'knowledge',
        source_system: appId,
        source_ref_id: sourceRefId,
        title: firstAttachment ? `Intake ${sourceRefId}` : `Document ${sourceRefId}`,
        processing_status: 'pending_ocr',
        current_revision_id: null,
        metadata: intakeMetadata,
      }, { transaction: t });

      await this.models.DocVersion.create({
        id: revisionId,
        document_id: documentId,
        revision_no: 1,
        revision_label: 'v1',
        revision_status: 'draft',
        is_current: 1,
        change_summary: 'Initial intake revision',
        created_by: userId,
      }, { transaction: t });

      await createdDocument.update({
        current_revision_id: revisionId,
      }, { transaction: t });

      if (attachments && attachments.length > 0) {
        const Attachment = this.db.getModel('attachment');
        for (const item of attachments) {
          if (!item?.id) continue;
          await Attachment.update({
            source_tag: 'doc-platform',
            source_id: revisionId,
          }, {
            where: { id: item.id },
            transaction: t,
          });
        }
      }

      return createdDocument;
    });

    logger.info(`[DocumentIntakeService] Created intake: ${document.id} for app ${appId}, collection ${collectionId}`);

    return {
      document_id: document.id,
      revision_id: revisionId,
      processing_status: document.processing_status,
      source_ref_id: sourceRefId,
      attachment_count: attachments?.length || 0,
    };
  }

  async createIntakeRevision({ documentId, attachments, userId, revisionLabel, changeSummary }) {
    this.ensureModels();

    const document = await this.models.DocDocument.findByPk(documentId, {
      attributes: ['id', 'collection_id', 'current_revision_id', 'metadata'],
      raw: true,
    });
    if (!document) {
      throw new Error('Document not found');
    }

    const revisionService = new DocumentRevisionService(this.db);
    const revision = await revisionService.createRevision(documentId, userId, {
      revision_label: revisionLabel || undefined,
      change_summary: changeSummary || 'Contract version upload',
    });

    await this.db.sequelize.transaction(async (t) => {
      await this.models.DocVersion.update(
        { is_current: 0 },
        { where: { document_id: documentId }, transaction: t }
      );

      await this.models.DocVersion.update(
        { is_current: 1 },
        { where: { id: revision.id }, transaction: t }
      );

      const mergedMetadata = JSON.stringify({
        ...JSON.parse(document.metadata || '{}'),
        attachments: attachments || [],
      });

      await this.models.DocDocument.update({
        current_revision_id: revision.id,
        processing_status: 'pending_ocr',
        processing_error_code: null,
        processing_error_message: null,
        metadata: mergedMetadata,
      }, {
        where: { id: documentId },
        transaction: t,
      });

      if (attachments && attachments.length > 0) {
        const Attachment = this.db.getModel('attachment');
        for (const item of attachments) {
          if (!item?.id) continue;
          await Attachment.update({
            source_tag: 'doc-platform',
            source_id: revision.id,
          }, {
            where: { id: item.id },
            transaction: t,
          });
        }
      }
    });

    logger.info(`[DocumentIntakeService] Created intake revision: ${revision.id} for document ${documentId}`);

    return {
      document_id: documentId,
      revision_id: revision.id,
      processing_status: 'pending_ocr',
      attachment_count: attachments?.length || 0,
    };
  }
}

export default DocumentIntakeService;
