import Database from '../lib/db.js';

const ids = [
  'mq7iv9zszqidyyl0r5fv',
  'mq8ufwjpzkxsclnn1lenu8jvsyfaslse',
  'mq8umd9v20c6ex12khhljei6zasow75w',
  'mq8usyj37pa5q6wr8jzg3v20gd6h1hb2',
];

async function main() {
  const db = new Database({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME || 'touwaka_mate',
    user: process.env.DB_USER || 'touwaka',
    password: process.env.DB_PASSWORD || '123456',
    connectionLimit: 5,
  });

  await db.connect();

  for (const id of ids) {
    await db.sequelize.query(
      `UPDATE documents
       SET processing_status = 'error',
           processing_error_code = 'manual_isolation',
           processing_error_message = 'isolated during mineru integration retest',
           processing_updated_at = NOW()
       WHERE id = ?`,
      { replacements: [id] }
    );
  }

  console.log(`isolated ${ids.length} documents`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
