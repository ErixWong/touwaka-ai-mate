/**
 * 系统设置布尔值类型修复脚本
 * 用于对账和修复 Issue #831 的历史脏数据
 * 
 * 运行方式:
 * - 预览模式: node scripts/fix-system-setting-boolean-type.js
 * - 修复模式: node scripts/fix-system-setting-boolean-type.js --fix
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from '../lib/db.js';
import logger from '../lib/logger.js';
import { DEFAULT_SETTINGS } from '../server/services/system-setting.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOOLEAN_CONFIG_KEYS = [];

for (const [section, keys] of Object.entries(DEFAULT_SETTINGS)) {
  for (const [key, config] of Object.entries(keys)) {
    if (config.type === 'boolean') {
      BOOLEAN_CONFIG_KEYS.push(`${section}.${key}`);
    }
  }
}

async function auditBooleanSettings(db) {
  const SystemSetting = db.getModel('system_setting');
  
  logger.info('=== 系统设置布尔配置对账清单 ===');
  logger.info(`预期布尔配置项数量: ${BOOLEAN_CONFIG_KEYS.length}`);
  logger.info(`布尔配置项列表: ${BOOLEAN_CONFIG_KEYS.join(', ')}`);
  
  const records = await SystemSetting.findAll({
    where: { setting_key: BOOLEAN_CONFIG_KEYS },
    raw: true
  });
  
  const auditResult = [];
  
  for (const expectedKey of BOOLEAN_CONFIG_KEYS) {
    const record = records.find(r => r.setting_key === expectedKey);
    const [section, key] = expectedKey.split('.');
    const expectedConfig = DEFAULT_SETTINGS[section]?.[key];
    
    if (!record) {
      auditResult.push({
        setting_key: expectedKey,
        expected_type: 'boolean',
        db_value_type: null,
        db_setting_value: null,
        expected_value: String(expectedConfig.value),
        status: 'missing'
      });
    } else {
      const valueTypeMatch = record.value_type === 'boolean';
      const valueValid = record.setting_value === 'true' || record.setting_value === 'false';
      
      let status = 'ok';
      if (!valueTypeMatch) status = 'mismatch';
      else if (!valueValid) status = 'invalid_value';
      
      auditResult.push({
        setting_key: expectedKey,
        expected_type: 'boolean',
        db_value_type: record.value_type || '(null)',
        db_setting_value: record.setting_value,
        expected_value: String(expectedConfig.value),
        status
      });
    }
  }
  
  logger.info('\n对账结果:');
  console.table(auditResult);
  
  const mismatchCount = auditResult.filter(r => r.status !== 'ok').length;
  logger.info(`\n异常记录数量: ${mismatchCount}`);
  
  return auditResult;
}

async function fixBooleanSettings(db, auditResult, dryRun = true) {
  const SystemSetting = db.getModel('system_setting');
  
  const mismatchRecords = auditResult.filter(r => r.status === 'mismatch' || r.status === 'invalid_value');
  
  if (mismatchRecords.length === 0) {
    logger.info('✅ 无需修复，所有布尔配置项类型一致');
    return;
  }
  
  logger.info(`\n待修复记录数量: ${mismatchRecords.length}`);
  
  for (const record of mismatchRecords) {
    if (dryRun) {
      logger.info(`[DRY RUN] 将修复: ${record.setting_key}`);
      logger.info(`  - 当前: value_type='${record.db_value_type}', setting_value='${record.db_setting_value}'`);
      logger.info(`  - 目标: value_type='boolean', setting_value='${record.expected_value}'`);
    } else {
      await SystemSetting.update(
        {
          value_type: 'boolean',
          setting_value: record.expected_value,
          updated_at: new Date()
        },
        { where: { setting_key: record.setting_key } }
      );
      logger.info(`[FIXED] 已修复: ${record.setting_key}`);
    }
  }
  
  if (dryRun) {
    logger.info('\n以上为预览模式，未实际修改数据');
    logger.info('如需执行修复，请运行: node scripts/fix-system-setting-boolean-type.js --fix');
  } else {
    logger.info('\n✅ 修复完成，请重启服务以清除缓存');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--fix');
  
  logger.info(`运行模式: ${dryRun ? '预览模式（不修改数据）' : '修复模式（将修改数据）'}`);
  
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME || 'touwaka',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: 10
  };
  
  const db = new Database(dbConfig);
  
  try {
    await db.connect();
    const auditResult = await auditBooleanSettings(db);
    await fixBooleanSettings(db, auditResult, dryRun);
  } catch (error) {
    logger.error('脚本执行失败:', error.message);
    process.exit(1);
  } finally {
    if (db.sequelize) {
      await db.sequelize.close();
    }
  }
}

main();