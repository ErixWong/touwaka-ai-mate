import { Sequelize, DataTypes } from 'sequelize';
import { sequelize } from './index.js';

/**
 * SystemSetting 模型 - 系统配置
 */
export const SystemSetting = sequelize.define('SystemSetting', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  setting_key: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    field: 'setting_key',
  },
  setting_value: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'setting_value',
  },
  value_type: {
    type: DataTypes.STRING(20),
    defaultValue: 'string',
    field: 'value_type',
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'description',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at',
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'updated_at',
  },
}, {
  tableName: 'system_settings',
  timestamps: false,
});

export default SystemSetting;
