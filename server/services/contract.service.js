import { Sequelize } from 'sequelize';
import logger from '../../lib/logger.js';

class ContractService {
  constructor(db) {
    this.db = db;
    this.sequelize = db.sequelize;
  }

  async list({ page = 1, size = 20, status, search, sort = 'created_at', order = 'desc', userId, isAdmin }) {
    const conditions = ["m.app_id = 'contract-mgr'"];
    const replacements = [];

    if (!isAdmin && userId) {
      conditions.push('m.user_id = ?');
      replacements.push(userId);
    }
    if (status) {
      conditions.push('m.status = ?');
      replacements.push(status);
    }
    if (search) {
      conditions.push('(r.contract_number LIKE ? OR r.party_a LIKE ? OR r.party_b LIKE ?)');
      const s = `%${search}%`;
      replacements.push(s, s, s);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    const sortMap = {
      created_at: 'm.created_at',
      contract_amount: 'r.contract_amount',
      contract_date: 'r.contract_date',
      contract_number: 'r.contract_number',
    };
    const sortField = sortMap[sort] || 'm.created_at';
    const offset = (page - 1) * size;

    const [rows, countResult] = await Promise.all([
      this.sequelize.query(
        `SELECT m.id, m.status, m.created_at, m.updated_at,
                r.contract_number, r.party_a, r.party_b, r.parent_company,
                r.contract_amount, r.contract_date
         FROM app_contract_mgr_records m
         LEFT JOIN app_contract_mgr_rows r ON r.row_id = m.id
         ${where}
          ORDER BY ${sortField} ${sortOrder}
         LIMIT ? OFFSET ?`,
        { replacements: [...replacements, size, offset], type: Sequelize.QueryTypes.SELECT }
      ),
      this.sequelize.query(
        `SELECT COUNT(*) as total
         FROM app_contract_mgr_records m
         LEFT JOIN app_contract_mgr_rows r ON r.row_id = m.id
         ${where}`,
        { replacements, type: Sequelize.QueryTypes.SELECT }
      ),
    ]);

    return {
      list: rows,
      total: countResult[0]?.total || 0,
      page,
      size,
    };
  }

  async detail(rowId, { userId, isAdmin } = {}) {
    const conditions = ['m.id = ?', "m.app_id = 'contract-mgr'"];
    const replacements = [rowId];

    if (!isAdmin && userId) {
      conditions.push('m.user_id = ?');
      replacements.push(userId);
    }

    const rows = await this.sequelize.query(
      `SELECT m.id, m.status, m.data, m.created_at, m.updated_at,
              r.contract_number, r.party_a, r.party_b, r.parent_company,
              r.contract_amount, r.contract_date,
              c.ocr_text, c.filtered_text, c.sections, c.extract_json,
              c.process_step, c.classification_json
       FROM app_contract_mgr_records m
       LEFT JOIN app_contract_mgr_rows r ON r.row_id = m.id
       LEFT JOIN app_contract_mgr_content c ON c.row_id = m.id
       WHERE ${conditions.join(' AND ')}`,
      { replacements, type: Sequelize.QueryTypes.SELECT }
    );

    if (!rows[0]) return null;

    const row = rows[0];
    if (typeof row.data === 'string') {
      try { row.data = JSON.parse(row.data); } catch {}
    }
    if (typeof row.sections === 'string') {
      try { row.sections = JSON.parse(row.sections); } catch {}
    }
    if (typeof row.extract_json === 'string') {
      try { row.extract_json = JSON.parse(row.extract_json); } catch {}
    }
    if (typeof row.classification_json === 'string') {
      try { row.classification_json = JSON.parse(row.classification_json); } catch {}
    }

    return row;
  }

  async statusSummary({ userId, isAdmin } = {}) {
    const conditions = ["app_id = 'contract-mgr'"];
    const replacements = [];

    if (!isAdmin && userId) {
      conditions.push('user_id = ?');
      replacements.push(userId);
    }

    const rows = await this.sequelize.query(
      `SELECT status, COUNT(*) as count
       FROM app_contract_mgr_records
       WHERE ${conditions.join(' AND ')}
       GROUP BY status
       ORDER BY status`,
      { replacements, type: Sequelize.QueryTypes.SELECT }
    );

    const summary = {};
    for (const r of rows) {
      summary[r.status] = r.count;
    }
    return { summary, total: rows.reduce((sum, r) => sum + r.count, 0) };
  }

  async confirm(rowId) {
    const [result] = await this.sequelize.query(
      `UPDATE app_contract_mgr_records
       SET status = 'confirmed', updated_at = NOW()
       WHERE id = ? AND app_id = 'contract-mgr' AND status = 'pending_review'`,
      { replacements: [rowId], type: Sequelize.QueryTypes.UPDATE }
    );
    if (result === 0) {
      throw new Error('Record not found or not in pending_review status');
    }
    logger.info(`[ContractService] Record ${rowId} confirmed`);
    return true;
  }

  async retry(rowId) {
    const rows = await this.sequelize.query(
      `SELECT status FROM app_contract_mgr_records WHERE id = ? AND app_id = 'contract-mgr'`,
      { replacements: [rowId], type: Sequelize.QueryTypes.SELECT }
    );
    const record = rows[0];
    if (!record) throw new Error('Record not found');

    const failedStates = ['ocr_failed', 'clean_failed', 'extract_failed', 'section_failed'];
    if (!failedStates.includes(record.status)) {
      throw new Error(`Record status is ${record.status}, not a failed state`);
    }

    const retryMap = {
      ocr_failed: 'pending_ocr',
      clean_failed: 'pending_clean',
      extract_failed: 'pending_extract',
      section_failed: 'pending_section',
    };
    const newStatus = retryMap[record.status];

    await this.sequelize.query(
      `UPDATE app_contract_mgr_records SET status = ?, updated_at = NOW() WHERE id = ?`,
      { replacements: [newStatus, rowId], type: Sequelize.QueryTypes.UPDATE }
    );
    logger.info(`[ContractService] Record ${rowId} retried: ${record.status} → ${newStatus}`);
    return { previous: record.status, current: newStatus };
  }
}

export default ContractService;
