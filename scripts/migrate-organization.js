/**
 * 组织架构迁移脚本
 * 创建 departments 和 positions 表，修改 users 表
 * 
 * 使用方法: node scripts/migrate-organization.js
 */

import dotenv from 'dotenv';
dotenv.config();

import mysql from 'mysql2/promise';

async function migrate() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log('🔗 Connected to database');

  try {
    // 1. 创建 departments 表
    console.log('📦 Creating departments table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS departments (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(100) NOT NULL COMMENT '部门名称',
        parent_id VARCHAR(20) NULL COMMENT '父部门ID',
        path VARCHAR(255) NULL COMMENT '层级路径，如 /1/2/3',
        level INT DEFAULT 1 COMMENT '层级深度(1-4)',
        sort_order INT DEFAULT 0 COMMENT '同级排序',
        description TEXT NULL COMMENT '部门描述',
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_parent (parent_id),
        INDEX idx_path (path),
        INDEX idx_status (status),
        UNIQUE INDEX uk_path (path)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='部门表'
    `);
    console.log('✅ departments table created');

    // 2. 创建 positions 表
    console.log('📦 Creating positions table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS positions (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(100) NOT NULL COMMENT '职位名称',
        department_id VARCHAR(20) NOT NULL COMMENT '所属部门',
        is_manager BOOLEAN DEFAULT FALSE COMMENT '是否为负责人职位',
        sort_order INT DEFAULT 0 COMMENT '排序',
        description TEXT NULL COMMENT '职位描述',
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_department (department_id),
        INDEX idx_status (status),
        CONSTRAINT fk_position_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='职位表'
    `);
    console.log('✅ positions table created');

    // 3. 检查 users 表是否已有 department_id 字段
    console.log('📦 Checking users table columns...');
    const [columns] = await connection.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'department_id'
    `, [process.env.DB_NAME]);

    if (columns.length === 0) {
      // 步骤1：添加 department_id 字段（显式指定排序规则与departments表一致）
      console.log('📦 Adding department_id to users table...');
      await connection.execute(`
        ALTER TABLE users
        ADD COLUMN department_id VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '所属部门' AFTER status
      `);
      await connection.execute(`
        ALTER TABLE users ADD INDEX idx_department (department_id)
      `);
      console.log('✅ department_id added');

      // 步骤2：添加 position_id 字段
      console.log('📦 Adding position_id to users table...');
      await connection.execute(`
        ALTER TABLE users
        ADD COLUMN position_id VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL COMMENT '职位ID' AFTER department_id
      `);
      await connection.execute(`
        ALTER TABLE users ADD INDEX idx_position (position_id)
      `);
      console.log('✅ position_id added');

      // 步骤3：添加外键约束
      console.log('📦 Adding foreign key constraints...');
      await connection.execute(`
        ALTER TABLE users
        ADD CONSTRAINT fk_user_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      `);
      await connection.execute(`
        ALTER TABLE users
        ADD CONSTRAINT fk_user_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL
      `);
      console.log('✅ Foreign keys added');
    } else {
      console.log('⏭️  department_id already exists in users table');
    }

    console.log('\n🎉 Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await connection.end();
  }
}

migrate().catch(console.error);
