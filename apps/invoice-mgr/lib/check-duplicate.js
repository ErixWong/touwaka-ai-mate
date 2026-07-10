/**
 * 发票去重检查（按 user_id 语义）
 *
 * 统一 duplicate 判断逻辑，避免 invoice-extract 与 invoice-vl-extract 分叉演化。
 *
 * 去重语义：
 *   - 同一用户内，相同发票号视为重复
 *   - 不同用户间，相同发票号互不影响
 *
 * @param {object} services - handler context 中的 services
 * @param {object} params
 * @param {string} params.invoice_number - 发票号码
 * @param {string} params.user_id - 当前用户 ID（来自 record.user_id）
 * @param {string} [params.current_row_id] - 当前记录 row_id，用于排除自身
 * @returns {Promise<object|null>} null 表示未重复，否则返回 { row_id, invoice_number }
 */
async function checkDuplicate(services, { invoice_number, user_id, current_row_id }) {
  if (!invoice_number || !user_id) return null;

  const rows = await services.query(
    `SELECT r.row_id, r.invoice_number
     FROM app_invoice_mgr_rows r
     JOIN app_invoice_mgr_records m ON m.id = r.row_id
     WHERE r.invoice_number = ?
       AND m.user_id = ?
     LIMIT 1`,
    [invoice_number, user_id]
  );

  if (rows && rows.length > 0 && rows[0].row_id !== current_row_id) {
    return rows[0];
  }
  return null;
}

/**
 * 构建统一的 duplicate 响应 payload
 *
 * @param {object} params
 * @param {string} params.invoice_number - 发票号码
 * @param {string} params.existing_row_id - 已有记录的 row_id
 * @param {string} params.ocr_method - 识别方法（'fapiao' | 'vl'）
 * @returns {object} 统一 duplicate 响应结构
 */
function buildDuplicateResponse({ invoice_number, existing_row_id, ocr_method }) {
  return {
    success: true,
    data: {
      invoice_number,
      duplicate: true,
      existing_row_id,
      extraction_status: 'duplicate',
      ocr_method,
    },
    target_state: 'extract_failed',
  };
}

export { checkDuplicate, buildDuplicateResponse };
