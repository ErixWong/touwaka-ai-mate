import dotenv from 'dotenv';
dotenv.config();

import { Sequelize } from 'sequelize';
import MiniAppService from '../server/services/mini-app.service.js';

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: false,
  }
);

const db = {
  getModel: (name) => sequelize.models[name],
};

async function test() {
  const { default: initModels } = await import('../models/init-models.js');
  initModels(sequelize, Sequelize.DataTypes);

  const service = new MiniAppService(db);

  const adminUserId = 'mn3l9nz0g3axvxwc12fp';
  const testUserId = 'mn3l9nz0bkukr8rs7jyb';

  console.log('Testing getAccessibleApps for admin...');
  try {
    const adminApps = await service.getAccessibleApps(adminUserId);
    console.log('Admin apps count:', adminApps.length);
    adminApps.forEach(a => console.log('  -', a.id, '|', a.name, '| visibility:', a.visibility));
  } catch (e) {
    console.error('Admin test error:', e.message);
  }

  console.log('\nTesting getAccessibleApps for test user...');
  try {
    const testApps = await service.getAccessibleApps(testUserId);
    console.log('Test user apps count:', testApps.length);
    testApps.forEach(a => console.log('  -', a.id, '|', a.name, '| visibility:', a.visibility));
  } catch (e) {
    console.error('Test user test error:', e.message);
  }

  await sequelize.close();
}

test().catch(console.error);