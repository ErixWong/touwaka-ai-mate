import Database from '../lib/db.js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkKb() {
  // Read config from config/database.json
  const configPath = path.join(__dirname, '..', 'config', 'database.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const configTemplate = JSON.parse(configContent);
  
  // Resolve environment variables
  const dbConfig = {
    database: process.env.DB_NAME || 'touwaka_mate',
    username: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    host: process.env.DB_HOST || 'localhost',
    dialect: 'mysql',
  };
  
  console.log('Connecting to database:', dbConfig.database, 'on', dbConfig.host);
  
  const db = new Database(dbConfig);
  await db.connect();
  
  const result = await db.query(
    'SELECT id, name, owner_id, created_at FROM knowledge_basis ORDER BY created_at DESC'
  );
  
  console.log('Knowledge bases in database:');
  console.log(JSON.stringify(result, null, 2));
  
  process.exit(0);
}

checkKb().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});