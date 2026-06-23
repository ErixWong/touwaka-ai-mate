import mysql from 'mysql2/promise';

function looksLikeMojibake(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  return /[ÃÂÅÄÖØæçéèêëîïôöûüñ]/.test(value);
}

function normalizeUploadedFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') {
    return fileName || null;
  }

  let normalized = fileName.trim();
  if (!normalized) {
    return null;
  }

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // ignore malformed URI content and keep original string
  }

  if (!looksLikeMojibake(normalized)) {
    return normalized;
  }

  try {
    const repaired = Buffer.from(normalized, 'latin1').toString('utf8').trim();
    if (repaired) {
      return repaired;
    }
  } catch {
    // keep original name
  }

  return normalized;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'touwaka',
    password: process.env.DB_PASSWORD || '123456',
    database: process.env.DB_NAME || 'touwaka_mate',
    charset: 'utf8mb4',
  });

  const [rows] = await conn.execute(`
    SELECT id, file_name
    FROM attachments
    WHERE source_tag = 'doc-platform'
      AND file_name IS NOT NULL
      AND file_name != ''
    ORDER BY created_at DESC
  `);

  let updated = 0;
  for (const row of rows) {
    const repaired = normalizeUploadedFileName(row.file_name);
    if (!repaired || repaired === row.file_name) {
      continue;
    }

    await conn.execute(
      'UPDATE attachments SET file_name = ? WHERE id = ?',
      [repaired, row.id],
    );
    updated += 1;
    console.log(`updated ${row.id}: ${row.file_name} -> ${repaired}`);
  }

  console.log(`done, updated ${updated} rows`);
  await conn.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});