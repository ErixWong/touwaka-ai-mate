/**
 * 数据库迁移脚本：重命名 roles 表字段
 * 
 * 变更：
 * - name → mark（角色标识，不可编辑）
 * - label → name（角色显示名称）
 * 
 * 使用方式：node scripts/migrate-role-fields.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
  // 动态导入数据库模块
  const { default: Database } = await import('../lib/db.js');
  
  const db = new Database();
  await db.initialize();
  
  const sequelize = db.sequelize;
  
  console.log('[Migration] 开始迁移 roles 表字段...');
  
  try {
    // 检查是否已经迁移过（检查 mark 列是否存在）
    const [columns] = await sequelize.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'roles' 
      AND COLUMN_NAME = 'mark'
    `);
    
    if (columns.length > 0) {
      console.log('[Migration] 已经迁移过，跳过');
      await sequelize.close();
      return;
    }
    
    // 开始事务
    const transaction = await sequelize.transaction();
    
    try {
      // 1. 重命名 name → mark
      console.log('[Migration] 重命名 name → mark...');
      await sequelize.query(`
        ALTER TABLE roles CHANGE COLUMN name mark VARCHAR(50) NOT NULL COMMENT '角色标识（不可编辑）：admin/creator/user'
      `, { transaction });
      
      // 2. 重命名 label → name
      console.log('[Migration] 重命名 label → name...');
      await sequelize.query(`
        ALTER TABLE roles CHANGE COLUMN label name VARCHAR(100) NOT NULL COMMENT '角色显示名称'
      `, { transaction });
      
      // 3. 删除旧索引
      console.log('[Migration] 删除旧索引...');
      await sequelize.query(`
        ALTER TABLE roles DROP INDEX name
      `, { transaction }).catch(() => console.log('[Migration] 索引 name 不存在，跳过'));
      
      // 4. 创建新索引
      console.log('[Migration] 创建新索引...');
      await sequelize.query(`
        ALTER TABLE roles ADD UNIQUE INDEX mark (mark)
      `, { transaction });
      
      // 5. 删除 idx_name 索引（如果存在）
      await sequelize.query(`
        ALTER TABLE roles DROP INDEX idx_name
      `, { transaction }).catch(() => console.log('[Migration] 索引 idx_name 不存在，跳过'));
      
      await transaction.commit();
      console.log('[Migration] 迁移完成！');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    
  } catch (error) {
    console.error('[Migration] 迁移失败:', error.message);
    process.exit(1);
  }
  
  await sequelize.close();
}

migrate();
