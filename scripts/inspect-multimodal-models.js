import dotenv from 'dotenv';
dotenv.config();

import Database from '../lib/db.js';

const db = new Database({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

try {
  await db.connect();
  const rows = await db.query(
    `SELECT m.id, m.name, m.model_name, m.model_type, m.is_active, p.name AS provider_name, p.base_url
     FROM ai_models m
     LEFT JOIN providers p ON p.id = m.provider_id
     WHERE m.model_type = 'multimodal'
     ORDER BY m.is_active DESC, m.created_at DESC
     LIMIT 10`
  );
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await db.close();
}
