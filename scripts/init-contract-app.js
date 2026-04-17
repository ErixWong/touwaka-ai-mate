/**
 * 初始化合同管理 App（通过 App Market 流程）
 * 
 * 使用方式：
 *   node scripts/init-contract-app.js
 * 
 * 已废弃旧的直接 SQL seed 方式，改为调用 AppMarketService.installApp()
 * 统一使用 apps/contract-manager/manifest.json 作为唯一真相源
 */

import dotenv from 'dotenv';
dotenv.config();

import { Sequelize } from 'sequelize';
import dbInit from '../server/models/init-models.js';
import AppMarketService from '../server/services/app-market.service.js';

const ADMIN_USER_ID = 'mn3l9nz0g3axvxwc10fp';

async function init() {
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

  try {
    const db = dbInit(sequelize);
    console.log('Connected to database:', process.env.DB_NAME);

    // 检查是否已安装
    const MiniApp = db.getModel('mini_app');
    const existing = await MiniApp.findByPk('contract-manager');
    if (existing) {
      console.log('contract-manager already installed, skipping.');
      await sequelize.close();
      return;
    }

    // 通过 App Market 服务安装
    const marketService = new AppMarketService(db);
    
    console.log('\n📦 Installing contract-manager from Registry...\n');
    
    const result = await marketService.installApp('contract-manager', {
      userId: ADMIN_USER_ID,
      visibility: 'all'
    });
    
    console.log('\n✅ Installation result:', JSON.stringify(result, null, 2));
    console.log('\n✅ Contract manager app installed successfully!');
  } catch (error) {
    console.error('Init error:', error.message);
    
    // 提示可能的解决方案
    if (error.message.includes('not found in Registry')) {
      console.error('\n💡 Tips:');
      console.error('   1. Check app_market.registry_url in system_settings');
      console.error('   2. Ensure apps/contract-manager/manifest.json exists in GitHub repo');
      console.error('   3. Run: node scripts/upgrade-database.js');
    }
    
    throw error;
  } finally {
    await sequelize.close();
  }
}

init().catch(err => {
  console.error(err);
  process.exit(1);
});
