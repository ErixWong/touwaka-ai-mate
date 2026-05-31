/**
 * 合同数据回填脚本
 * 将 app_contract_mgr_* 和 contract_v2_* 数据迁移到统一文档平台
 * 
 * 映射策略：
 * - v1: app_contract_mgr_rows → doc_documents (每个 row 一文档)
 * - v2: contract_v2_versions.contract_id → doc_documents (每个 contract 一文档)
 * - 合同内容 sections → doc_content_units
 * - app_contract_mgr_compares → doc_compare_runs + doc_compare_items
 * 
 * 使用方法：
 * node scripts/migrate-contract-to-doc-platform.js
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'touwaka_mate',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};

const report = {
  timestamp: new Date().toISOString(),
  v1_documents: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  v1_versions: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  v1_content_units: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  v2_documents: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  v2_versions: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  v2_content_units: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  compare_runs: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  compare_items: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  errors: [],
};

async function main() {
  console.log('🔄 合同数据回填脚本');
  console.log('='.repeat(60));
  console.log(`📌 数据库: ${dbConfig.database}@${dbConfig.host}:${dbConfig.port}`);
  console.log('='.repeat(60));

  let connection;

  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ 数据库连接成功\n');

    await migrateContractV1(connection);
    await migrateContractV2(connection);
    await migrateCompares(connection);

    console.log('\n' + '='.repeat(60));
    console.log('📊 回填统计');
    console.log('='.repeat(60));
    console.log(`  v1 文档: ${report.v1_documents.migrated}/${report.v1_documents.total}`);
    console.log(`  v1 内容: ${report.v1_content_units.migrated}/${report.v1_content_units.total}`);
    console.log(`  v2 文档: ${report.v2_documents.migrated}/${report.v2_documents.total}`);
    console.log(`  v2 版本: ${report.v2_versions.migrated}/${report.v2_versions.total}`);
    console.log(`  v2 内容: ${report.v2_content_units.migrated}/${report.v2_content_units.total}`);
    console.log(`  比对任务: ${report.compare_runs.migrated}/${report.compare_runs.total}`);

    if (report.errors.length > 0) {
      console.log('\n❌ 错误详情:');
      report.errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
      if (report.errors.length > 10) {
        console.log(`  ... 还有 ${report.errors.length - 10} 个错误`);
      }
    }

    const outputPath = path.join(process.cwd(), 'temp', 'contract-migration-report.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n📁 详细报告: ${outputPath}`);

  } catch (error) {
    console.error('\n❌ 回填失败:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

async function migrateContractV1(connection) {
  console.log('\n📝 1. 迁移合同 v1 数据');

  const [rows] = await connection.query(`
    SELECT r.row_id, r.contract_number, r.party_a, r.party_b, r.parent_company,
           r.contract_amount, r.contract_date, r.created_at, r.updated_at,
           c.sections, c.filtered_text, c.extract_json,
           mr.user_id as owner_id
    FROM app_contract_mgr_rows r
    LEFT JOIN app_contract_mgr_content c ON r.row_id = c.row_id
    LEFT JOIN mini_app_rows mr ON r.row_id = mr.id
    WHERE r.contract_number IS NOT NULL OR c.filtered_text IS NOT NULL
  `);

  report.v1_documents.total = rows.length;

  for (const row of rows) {
    try {
      const docId = `ct1_${shortHash(row.row_id)}`;
      const existing = await checkExisting(connection, 'doc_documents', docId);
      if (existing) {
        report.v1_documents.skipped++;
        continue;
      }

      const ownerId = row.owner_id || '0';
      const extractData = row.extract_json ? JSON.parse(row.extract_json) : {};

      await connection.execute(`
        INSERT INTO doc_documents (
          id, doc_type, source_system, source_ref_id, title,
          owner_id, org_id, visibility, lifecycle_status, metadata,
          created_at, updated_at
        ) VALUES (?, 'contract', 'contract_mgr', ?, ?, ?, ?, 'private', 'active', ?, ?, ?)
      `, [
        docId,
        row.row_id,
        row.contract_number || extractData.contract_number || '未命名合同',
        ownerId,
        ownerId,
        JSON.stringify({
          contract_number: row.contract_number,
          party_a: row.party_a || extractData.party_a,
          party_b: row.party_b || extractData.party_b,
          parent_company: row.parent_company,
          contract_amount: row.contract_amount,
          contract_date: row.contract_date,
        }),
        row.created_at,
        row.updated_at,
      ]);

      report.v1_documents.migrated++;

      const versionId = `${docId}_v1`;
      await connection.execute(`
        INSERT INTO doc_versions (
          id, document_id, version_no, version_label, version_status,
          is_current, created_by, metadata, created_at, updated_at
        ) VALUES (?, ?, 1, 'v1', 'effective', 1, ?, ?, ?, ?)
      `, [
        versionId,
        docId,
        ownerId,
        JSON.stringify({ original_row_id: row.row_id }),
        row.created_at,
        row.updated_at,
      ]);

      report.v1_versions.migrated++;

      if (row.sections) {
        const sections = JSON.parse(row.sections);
        await migrateSections(connection, versionId, sections, 'v1', row.row_id);
      }

      console.log(`  ✓ v1合同 ${docId}: ${row.contract_number || '未命名'}`);

    } catch (e) {
      report.v1_documents.failed++;
      report.errors.push(`v1合同 ${row.row_id}: ${e.message}`);
    }
  }
}

async function migrateContractV2(connection) {
  console.log('\n📝 2. 迁移合同 v2 数据');

  const [contracts] = await connection.query(`
    SELECT DISTINCT cv.contract_id, cv.created_by, cv.created_at
    FROM contract_v2_versions cv
    WHERE cv.contract_id IS NOT NULL
  `);

  report.v2_documents.total = contracts.length;

  for (const contract of contracts) {
    try {
      const docId = `ct2_${shortHash(contract.contract_id)}`;
      const existing = await checkExisting(connection, 'doc_documents', docId);
      if (existing) {
        report.v2_documents.skipped++;
        continue;
      }

      const [versions] = await connection.query(`
        SELECT cv.id, cv.row_id, cv.version_number, cv.version_name, cv.version_status,
               cv.is_current, cv.effective_date, cv.expiry_date, cv.created_by,
               cv.created_at, cv.updated_at, c.sections, c.filtered_text, c.extract_json
        FROM contract_v2_versions cv
        LEFT JOIN app_contract_mgr_v2_content c ON cv.row_id = c.row_id
        WHERE cv.contract_id = ?
        ORDER BY cv.version_number
      `, [contract.contract_id]);

      const latestVersion = versions.find(v => v.is_current && v.is_current.data && v.is_current.data[0] === 1) || versions[versions.length - 1];
      const title = latestVersion?.version_name || '未命名合同';

      await connection.execute(`
        INSERT INTO doc_documents (
          id, doc_type, source_system, source_ref_id, title,
          owner_id, org_id, visibility, lifecycle_status, metadata,
          created_at, updated_at
        ) VALUES (?, 'contract', 'contract_mgr_v2', ?, ?, ?, ?, 'private', 'active', ?, ?, ?)
      `, [
        docId,
        contract.contract_id,
        title,
        contract.created_by,
        contract.created_by,
        JSON.stringify({ original_contract_id: contract.contract_id, version_count: versions.length }),
        contract.created_at,
        contract.created_at,
      ]);

      report.v2_documents.migrated++;

      for (const version of versions) {
        const versionId = `cv_${version.id}`;
        const isCurrent = version.is_current && version.is_current.data ? version.is_current.data[0] : 0;
        const versionStatus = mapVersionStatus(version.version_status);

        await connection.execute(`
          INSERT INTO doc_versions (
            id, document_id, version_no, version_label, version_status,
            is_current, effective_from, effective_to, created_by, metadata,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          versionId,
          docId,
          version.version_number,
          version.version_name?.substring(0, 20) || `v${version.version_number}`,
          versionStatus,
          isCurrent,
          version.effective_date,
          version.expiry_date,
          version.created_by,
          JSON.stringify({ original_version_id: version.id, original_row_id: version.row_id }),
          version.created_at,
          version.updated_at,
        ]);

        report.v2_versions.migrated++;

        if (version.sections) {
          const sections = JSON.parse(version.sections);
          await migrateSections(connection, versionId, sections, 'v2', version.row_id);
        }
      }

      console.log(`  ✓ v2合同 ${docId}: ${title} (${versions.length}版本)`);

    } catch (e) {
      report.v2_documents.failed++;
      report.errors.push(`v2合同 ${contract.contract_id}: ${e.message}`);
    }
  }
}

function mapVersionStatus(status) {
  const map = {
    'draft': 'draft',
    'approved': 'approved',
    'effective': 'effective',
    'expired': 'expired',
  };
  return map[status] || 'draft';
}

async function migrateSections(connection, versionId, sections, source, rowId) {
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    try {
      const unitId = crypto.randomUUID().replace(/-/g, '').substring(0, 32);

      await connection.execute(`
        INSERT INTO doc_content_units (
          id, version_id, parent_id, unit_type, title,
          content, position, level, metadata, created_at, updated_at
        ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `, [
        unitId,
        versionId,
        section.level === 1 ? 'chapter' : 'section',
        section.title || '',
        null,
        i,
        section.level || 1,
        JSON.stringify({ source, row_id: rowId, original_section: section }),
      ]);

      if (source === 'v1') {
        report.v1_content_units.migrated++;
      } else {
        report.v2_content_units.migrated++;
      }

    } catch (e) {
      report.errors.push(`内容单元 ${source}/${rowId}/${i}: ${e.message}`);
    }
  }
}

async function migrateCompares(connection) {
  console.log('\n📝 3. 迁移比对结果');

  const [compares] = await connection.query(`
    SELECT c.*, r1.contract_number as base_contract, r2.contract_number as target_contract
    FROM app_contract_mgr_compares c
    LEFT JOIN app_contract_mgr_rows r1 ON c.row_id = r1.row_id
    LEFT JOIN app_contract_mgr_rows r2 ON c.target_row_id = r2.row_id
  `);

  report.compare_runs.total = compares.length;

  for (const compare of compares) {
    try {
      const runId = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
      const docId = `ct1_${shortHash(compare.row_id)}`;
      const targetDocId = `ct1_${shortHash(compare.target_row_id)}`;

      let compareResult = null;
      if (compare.compare_result) {
        try {
          compareResult = JSON.parse(compare.compare_result);
        } catch (e) {
          compareResult = null;
        }
      }

      await connection.execute(`
        INSERT INTO doc_compare_runs (
          id, document_id, base_version_id, target_version_id,
          status, summary_json, model_info, duration_ms, created_by, created_at
        ) VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)
      `, [
        runId,
        docId,
        `${docId}_v1`,
        `${targetDocId}_v1`,
        JSON.stringify({
          identical: compare.summary_identical,
          modified: compare.summary_modified,
          added: compare.summary_added,
          removed: compare.summary_removed,
        }),
        JSON.stringify({ model_name: compare.model_name }),
        compare.duration_ms,
        '0',
        compare.created_at,
      ]);

      report.compare_runs.migrated++;

      if (compareResult && Array.isArray(compareResult)) {
        for (const item of compareResult) {
          try {
            const itemId = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
            const changeType = mapChangeType(item.change_type);

            await connection.execute(`
              INSERT INTO doc_compare_items (
                id, run_id, change_type, summary, key_changes_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)
            `, [
              itemId,
              runId,
              changeType,
              item.title || '',
              JSON.stringify(item),
              compare.created_at,
            ]);

            report.compare_items.migrated++;
          } catch (e) {
            report.errors.push(`比对明细 ${runId}/${item.title}: ${e.message}`);
          }
        }
      }

      console.log(`  ✓ 比对任务 ${runId}: ${compare.base_contract || '未知'} vs ${compare.target_contract || '未知'}`);

    } catch (e) {
      report.compare_runs.failed++;
      report.errors.push(`比对任务 ${compare.row_id}: ${e.message}`);
    }
  }
}

function mapChangeType(type) {
    const map = {
      'matched': 'identical',
      'modified': 'modified',
      'added': 'added',
      'removed': 'removed',
    };
    return map[type] || 'identical';
  }

  function shortHash(str) {
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 12);
  }

async function checkExisting(connection, table, id) {
  const [rows] = await connection.query(
    `SELECT id FROM ${table} WHERE id = ?`,
    [id]
  );
  return rows.length > 0;
}

main();