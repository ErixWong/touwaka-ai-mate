export async function exportBackup(context, options = {}) {
  const { appId, services } = context;
  const { query } = services;

  const tables = [];

  try {
    const rows = await query('SELECT * FROM app_contract_mgr_v2_rows');
    tables.push({ name: 'app_contract_mgr_v2_rows', rows });
  } catch {
    tables.push({ name: 'app_contract_mgr_v2_rows', rows: [], error: 'table not found' });
  }

  try {
    const content = await query('SELECT row_id, content_id, process_step, document_id, ocr_text, filtered_text, sections, extract_json, extract_model, extract_at, classification_json FROM app_contract_mgr_v2_content');
    tables.push({ name: 'app_contract_mgr_v2_content', rows: content });
  } catch {
    tables.push({ name: 'app_contract_mgr_v2_content', rows: [], error: 'table not found' });
  }

  const OrgNode = context.db.getModel('contract_v2_org_node');
  if (OrgNode) {
    const nodes = await OrgNode.findAll({ raw: true });
    tables.push({ name: 'contract_v2_org_nodes', rows: nodes });
  } else {
    tables.push({ name: 'contract_v2_org_nodes', rows: [], error: 'model not available' });
  }

  const MainRecord = context.db.getModel('contract_v2_main_record');
  if (MainRecord) {
    const records = await MainRecord.findAll({ raw: true });
    tables.push({ name: 'contract_v2_main_records', rows: records });
  } else {
    tables.push({ name: 'contract_v2_main_records', rows: [], error: 'model not available' });
  }

  const Version = context.db.getModel('contract_v2_version');
  if (Version) {
    const versions = await Version.findAll({ raw: true });
    tables.push({ name: 'contract_v2_versions', rows: versions });
  } else {
    tables.push({ name: 'contract_v2_versions', rows: [], error: 'model not available' });
  }

  return {
    meta: {
      app_id: appId,
      exported_at: new Date().toISOString(),
      table_count: tables.length,
    },
    tables,
    attachments: [],
  };
}