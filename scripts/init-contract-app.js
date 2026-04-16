import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

const ADMIN_USER_ID = 'mn3l9nz0g3axvxwc12fp';

async function seed() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log('Connected to database:', DB_CONFIG.database);

  try {
    const [existing] = await conn.execute(
      `SELECT id FROM mini_apps WHERE id = 'contract-mgr'`
    );
    if (existing.length > 0) {
      console.log('Contract app already exists, skipping seed.');
      return;
    }

    await conn.execute(`
      INSERT INTO app_row_handlers (id, name, description, handler, handler_function, concurrency, timeout, max_retries, is_active)
      VALUES
        ('handler-ocr', 'OCR识别', '调用markitdown/mineru进行OCR识别', 'scripts/app-handlers/ocr-service', 'process', 3, 60, 2, 1),
        ('handler-extract', 'LLM提取', '调用LLM从OCR文本中提取结构化元数据', 'scripts/app-handlers/llm-extract', 'process', 2, 120, 2, 1)
    `);
    console.log('  ✓ Created handlers: handler-ocr, handler-extract');

    await conn.execute(`
      INSERT INTO mini_apps (id, name, description, icon, type, fields, views, config, visibility, owner_id, creator_id, sort_order, is_active, revision)
      VALUES (
        'contract-mgr',
        '销售合同管理',
        '上传合同文件，AI自动提取合同元数据，支持批量处理和确认入库',
        '📄',
        'document',
        ?,
        ?,
        ?,
        'all',
        ?,
        ?,
        1,
        1,
        1
      )
    `, [
      JSON.stringify([
        { name: 'contract_number', label: '合同编号', type: 'text', required: true, ai_extractable: true },
        { name: 'contract_date', label: '签订日期', type: 'date', required: true, ai_extractable: true },
        { name: 'party_a', label: '甲方', type: 'text', required: true, ai_extractable: true },
        { name: 'party_b', label: '乙方', type: 'text', required: true, ai_extractable: true },
        { name: 'contract_amount', label: '合同金额', type: 'number', required: true, ai_extractable: true },
        { name: 'start_date', label: '开始日期', type: 'date', ai_extractable: true },
        { name: 'end_date', label: '结束日期', type: 'date', ai_extractable: true },
        { name: 'payment_terms', label: '付款条款', type: 'textarea', ai_extractable: true },
        { name: 'status', label: '状态', type: 'select', options: ['待审批', '执行中', '已完成', '已终止'], default: '待审批' },
        { name: 'contract_file', label: '合同文件', type: 'file' },
      ]),
      JSON.stringify({
        list: {
          columns: ['contract_number', 'contract_date', 'party_a', 'party_b', 'contract_amount', 'status'],
          sort: { field: 'contract_date', order: 'desc' },
        },
      }),
      JSON.stringify({
        features: ['upload', 'list', 'detail'],
        supported_formats: ['.pdf', '.docx', '.doc', '.jpg', '.png'],
        max_file_size: 20971520,
        batch_enabled: true,
        batch_limit: 50,
      }),
      ADMIN_USER_ID,
      ADMIN_USER_ID,
    ]);
    console.log('  ✓ Created app: contract-mgr (销售合同管理)');

    await conn.execute(`
      INSERT INTO app_state (id, app_id, name, label, sort_order, is_initial, is_terminal, is_error, handler_id, success_next_state, failure_next_state)
      VALUES
        ('state-1', 'contract-mgr', 'pending_ocr', '待OCR', 1, 1, 0, 0, 'handler-ocr', 'pending_extract', 'ocr_failed'),
        ('state-2', 'contract-mgr', 'pending_extract', '待提取', 2, 0, 0, 0, 'handler-extract', 'pending_review', 'extract_failed'),
        ('state-3', 'contract-mgr', 'pending_review', '待确认', 3, 0, 0, 0, NULL, NULL, NULL),
        ('state-4', 'contract-mgr', 'confirmed', '已确认', 4, 0, 1, 0, NULL, NULL, NULL),
        ('state-5', 'contract-mgr', 'ocr_failed', 'OCR失败', 99, 0, 0, 1, NULL, NULL, NULL),
        ('state-6', 'contract-mgr', 'extract_failed', '提取失败', 99, 0, 0, 1, NULL, NULL, NULL)
    `);
    console.log('  ✓ Created 6 states for contract-mgr');

    console.log('\n✅ Seed completed successfully!');
  } catch (error) {
    console.error('Seed error:', error.message);
    throw error;
  } finally {
    await conn.end();
  }
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
