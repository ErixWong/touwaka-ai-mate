import logger from './logger.js';
import Utils from './utils.js';
import { sortRevisionList, validateRevisionLabelUniqueness, generateDefaultRevisionLabel } from './doc-version-utils.js';

/**
 * DocumentRevisionService — 文档版本生命周期管理
 *
 * ## 状态一致性约定（P0 收敛）
 *
 * **"当前版本"的事实主源：`documents.current_revision_id`**
 *
 * `document_revisions.is_current` 是派生冗余字段，仅用于查询优化。
 * 所有写入 `current_revision_id` 的路径必须同步维护 `is_current`，
 * 统一通过 `_syncIsCurrentFlags()` 方法完成。
 *
 * 禁止在业务代码中分别更新这两个字段，避免双状态不一致。
 */
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

  /**
   * 同步 is_current 标志位（派生字段，唯一写入入口）
   *
   * 以 documents.current_revision_id 为唯一事实来源：
   * - 清除该文档下所有 revision 的 is_current
   * - 将 current_revision_id 对应的 revision 设为 is_current=1
   *
   * @param {string} documentId
   * @param {string} currentRevisionId
   * @param {Object} [transaction] - Sequelize transaction
   */
  async _syncIsCurrentFlags(documentId, currentRevisionId, transaction) {
    this.ensureModels();

    const tOpts = transaction ? { transaction } : {};

    // 清除该文档下所有 revision 的 is_current
    await this.models.DocVersion.update(
      { is_current: 0 },
      { where: { document_id: documentId }, ...tOpts }
    );

    // 将目标 revision 设为 is_current=1
    await this.models.DocVersion.update(
      { is_current: 1 },
      { where: { id: currentRevisionId }, ...tOpts }
    );

    logger.info(`[DocumentRevisionService] Synced is_current flags: doc=${documentId}, current_revision=${currentRevisionId}`);
  }

  async createRevision(documentId, userId, options = {}) {
    this.ensureModels();

    const { revision_label, change_summary, chunks, transaction: outerTransaction } = options;

    // 查询已有版本用于校验唯一性和生成默认编号
    const existingRevisions = await this.models.DocVersion.findAll({
      where: { document_id: documentId },
      attributes: ['id', 'revision_label', 'revision_no'],
      raw: true,
      transaction: outerTransaction,
    });

    const maxRevisionNo = existingRevisions.length > 0
      ? Math.max(...existingRevisions.map(r => r.revision_no))
      : 0;
    const revisionNo = maxRevisionNo + 1;

    // 确定 revision_label：用户输入 > 自动生成
    let finalLabel;
    if (revision_label) {
      finalLabel = revision_label;
    } else {
      finalLabel = generateDefaultRevisionLabel(existingRevisions);
      if (!finalLabel) {
        // 年份体系文档：自动生成返回 null，要求用户手动提供年份版本号
        throw new Error(
          '该文档已有版本采用年份体系（如 2012、2018、2021），请手动填写版本号（如 2024），避免自动补 vN 导致命名混杂'
        );
      }
    }

    // 校验 label 唯一性
    const uniquenessCheck = validateRevisionLabelUniqueness(existingRevisions, finalLabel);
    if (!uniquenessCheck.valid) {
      throw new Error(uniquenessCheck.message);
    }

    const versionId = Utils.newID();

    try {
      // 支持外部事务复用：若调用方传入 transaction，则在其事务内创建，保证与调用方状态同步原子化
      const run = async (t) => {
        await this.models.DocVersion.create({
          id: versionId,
          document_id: documentId,
          revision_no: revisionNo,
          revision_label: finalLabel,
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
      };

      if (outerTransaction) {
        await run(outerTransaction);
      } else {
        await this.db.sequelize.transaction(run);
      }
    } catch (error) {
      // 并发下 check-then-insert 竞争：DB 唯一索引 uk_document_revision_label 兜底抛错，
      // 这里把原始 constraint 报文映射为友好提示
      if (
        error?.name === 'SequelizeUniqueConstraintError'
        || error?.original?.errno === 1062
        || (typeof error?.message === 'string' && error.message.includes('Duplicate entry'))
      ) {
        throw new Error(
          `版本号 "${finalLabel}" 在同一文档下已存在（并发冲突），请刷新后重试或换一个版本号`
        );
      }
      throw error;
    }

    // 注意：外部事务复用场景下，findByPk 必须携带同一事务，
    // 否则在独立连接上读不到事务内未提交的新版本，返回 null（round02 验证暴露）。
    const version = await this.models.DocVersion.findByPk(
      versionId,
      outerTransaction ? { transaction: outerTransaction } : undefined
    );
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

    // 临时方案（审批流落地前）：放行 draft → effective，此阶段 effective 语义为"当前在用"。
    // 审批流上线时移除 draft → effective，恢复 draft → review → approved → effective 主线，
    // 并一并设计旧版本失效（expired）语义。
    const VALID_TRANSITIONS = {
      'draft': ['effective', 'review', 'archived'],
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

      // 两态语义：同一文档同一时间只允许一个 effective（当前在用）版本，
      // 先将其他 effective 版本归回 draft，再将目标版本置为 effective
      await this.models.DocVersion.update(
        { revision_status: 'draft' },
        { where: { document_id: documentId, revision_status: 'effective' }, transaction: t }
      );

      version.revision_status = 'effective';
      await version.save({ transaction: t });

      // 先更新主源 documents.current_revision_id，再同步派生 is_current
      await this.db.getModel('document').update(
        { current_revision_id: revisionId },
        { where: { id: documentId }, transaction: t }
      );

      // 统一通过 _syncIsCurrentFlags 维护 is_current 派生字段（基于已更新的主源）
      await this._syncIsCurrentFlags(documentId, revisionId, t);
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
      attributes: [
        'id', 'document_id', 'revision_no', 'revision_label',
        'revision_status', 'is_current', 'effective_from', 'effective_to',
        'change_summary', 'created_by', 'created_at', 'updated_at', 'diff_status',
      ],
      raw: true,
    });

    // 使用统一排序：年份优先 → 版号次之 → 创建时间兜底
    return sortRevisionList(versions);
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