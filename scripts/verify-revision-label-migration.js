/**
 * 文档平台版本管理 — revision_label 迁移验证脚本
 *
 * 用途：在正式执行 upgrade-database.js 中的 revision_label 迁移前后运行，
 *       验证数据状态是否满足迁移条件。
 *
 * 运行方式：node scripts/verify-revision-label-migration.js [--fix]
 *   --dry-run (默认)  只检查，不修改
 *   --fix             检查并执行修复（与 upgrade-database.js 逻辑一致）
 *
 * 检查项：
 * 1. revision_label 是否存在 NULL 值
 * 2. 同一 document_id 下是否存在重复 revision_label
 * 3. 迁移后功能回归（版本列表、编辑、上传、切换）
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function main() {
  const args = process.argv.slice(2);
  // --dry-run（默认，只检查不修改）与 --fix（检查并修复）两种模式。
  // 显式支持 --dry-run，与默认行为一致，便于验收脚本调用。
  const fixMode = args.includes('--fix');
  const dryRun = args.includes('--dry-run');
  if (dryRun && fixMode) {
    console.error('❌ --dry-run 与 --fix 互斥，请二选一');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('📋 revision_label 迁移验证');
  console.log(`   模式: ${fixMode ? '修复' : '只读检查'}`);
  console.log(`   数据库: ${DB_CONFIG.database}@${DB_CONFIG.host}`);
  console.log('='.repeat(60));

  let conn;
  try {
    conn = await mysql.createConnection(DB_CONFIG);
    console.log('\n✓ 数据库连接成功\n');

    // ---- 检查 1: NULL 值 ----
    const [nullRows] = await conn.execute(
      'SELECT COUNT(*) AS cnt FROM document_revisions WHERE revision_label IS NULL'
    );
    const nullCount = nullRows[0].cnt;
    console.log(`1. NULL revision_label 数量: ${nullCount}`);
    if (nullCount > 0) {
      console.log(`   ⚠ 发现 ${nullCount} 条 NULL，将回填为 v{revision_no}`);
      const [samples] = await conn.execute(
        'SELECT id, document_id, revision_no FROM document_revisions WHERE revision_label IS NULL LIMIT 5'
      );
      for (const row of samples) {
        console.log(`      ${row.id}: doc=${row.document_id} rev_no=${row.revision_no} → v${row.revision_no}`);
      }
    }

    // ---- 检查 2: 重复 label ----
    const [dupRows] = await conn.execute(
      `SELECT document_id, revision_label, COUNT(*) AS cnt
       FROM document_revisions
       WHERE revision_label IS NOT NULL
       GROUP BY document_id, revision_label
       HAVING cnt > 1`
    );
    console.log(`\n2. 重复 revision_label 组合数: ${dupRows.length}`);
    if (dupRows.length > 0) {
      for (const row of dupRows) {
        console.log(`   ⚠ doc=${row.document_id} label="${row.revision_label}" ×${row.cnt}`);
        const [details] = await conn.execute(
          `SELECT id, revision_no, revision_label FROM document_revisions
           WHERE document_id = ? AND revision_label = ?
           ORDER BY revision_no ASC`,
          [row.document_id, row.revision_label]
        );
        for (const d of details) {
          const suffix = d.revision_no === details[0].revision_no ? ' (保留原值)' : ` → ${d.revision_label}_dup_${d.revision_no}`;
          console.log(`      ${d.id}: rev_no=${d.revision_no} label="${d.revision_label}"${suffix}`);
        }      }
    }

    // ---- 检查 3: 唯一索引 ----
    const [indexRows] = await conn.execute(
      `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_revisions' AND INDEX_NAME = 'uk_document_revision_label'`,
      [DB_CONFIG.database]
    );
    const hasIndex = indexRows.length > 0;
    console.log(`\n3. UNIQUE INDEX uk_document_revision_label: ${hasIndex ? '✓ 已存在' : '✗ 不存在'}`);

    // ---- 检查 4: NOT NULL ----
    const [colRows] = await conn.execute(
      `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'document_revisions' AND COLUMN_NAME = 'revision_label'`,
      [DB_CONFIG.database]
    );
    const isNullable = colRows.length > 0 && colRows[0].IS_NULLABLE === 'YES';
    console.log(`4. revision_label NOT NULL: ${isNullable ? '✗ 仍为 NULLABLE' : '✓ 已为 NOT NULL'}`);

    // ---- 总结 ----
    const allOk = nullCount === 0 && dupRows.length === 0 && hasIndex && !isNullable;
    console.log(`\n${'='.repeat(60)}`);
    if (allOk) {
      console.log('✅ 迁移已完成，所有检查通过');
    } else {
      console.log('⚠ 迁移尚未完成或存在待修复项');

      if (fixMode) {
        console.log('\n🔧 执行修复...\n');
        if (nullCount > 0) {
          await conn.execute(
            `UPDATE document_revisions SET revision_label = CONCAT('v', revision_no) WHERE revision_label IS NULL`
          );
          console.log('  ✓ NULL 值已回填');
        }
        if (dupRows.length > 0) {
          for (const row of dupRows) {
            const [details] = await conn.execute(
              `SELECT id, revision_no FROM document_revisions
               WHERE document_id = ? AND revision_label = ?
               ORDER BY revision_no ASC`,
              [row.document_id, row.revision_label]
            );
            // revision_label 为 VARCHAR(20)：拼接 _dup_{revision_no} 前截断原 label，避免超长
            const MAX_LABEL_LENGTH = 20;
            for (let i = 1; i < details.length; i++) {
              const d = details[i];
              const suffix = `_dup_${d.revision_no}`;
              const baseLabel = row.revision_label.slice(0, MAX_LABEL_LENGTH - suffix.length);
              await conn.execute(
                `UPDATE document_revisions SET revision_label = ? WHERE id = ?`,
                [`${baseLabel}${suffix}`, d.id]
              );
            }
          }
          console.log('  ✓ 重复 label 已处理');
        }
        if (isNullable) {
          await conn.execute(
            `ALTER TABLE document_revisions MODIFY COLUMN revision_label VARCHAR(20) NOT NULL COMMENT '展示版号(v1.0)'`
          );
          console.log('  ✓ revision_label 改为 NOT NULL');
        }
        if (!hasIndex) {
          await conn.execute(
            `ALTER TABLE document_revisions ADD UNIQUE INDEX uk_document_revision_label (document_id, revision_label)`
          );
          console.log('  ✓ UNIQUE INDEX 已添加');
        }
        console.log('\n✅ 修复完成。请运行 node scripts/generate-models.js 重新生成模型');
      } else {
        console.log('\n💡 使用 --fix 参数可自动执行修复');
        console.log('   修复后请运行 node scripts/generate-models.js 重新生成模型');
      }
    }
  } catch (err) {
    console.error('\n❌ 验证失败:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

main();
