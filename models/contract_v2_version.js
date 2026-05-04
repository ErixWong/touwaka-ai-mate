import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class contract_v2_version extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    contract_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "合同主记录ID",
      references: {
        model: 'contract_v2_main_records',
        key: 'id'
      }
    },
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "mini_app_rows ID",
      references: {
        model: 'mini_app_rows',
        key: 'id'
      }
    },
    file_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "文件ID"
    },
    version_number: {
      type: DataTypes.STRING(16),
      allowNull: false,
      comment: "版本号"
    },
    version_name: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "版本名称"
    },
    version_type: {
      type: DataTypes.ENUM('draft','signed','amendment','supplement'),
      allowNull: true,
      comment: "版本类型"
    },
    version_status: {
      type: DataTypes.ENUM('draft','reviewing','approved','rejected','archived'),
      allowNull: true,
      defaultValue: "draft"
    },
    effective_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "生效日期"
    },
    expiry_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "失效日期"
    },
    contract_number: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "合同编号"
    },
    party_a: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "甲方"
    },
    party_b: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "乙方"
    },
    total_amount: {
      type: DataTypes.DECIMAL(15,2),
      allowNull: true,
      comment: "合同金额"
    },
    change_summary: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "变更说明"
    },
    is_current: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否当前版本"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "上传人"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'contract_v2_versions',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "uk_contract_version",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "contract_id" },
          { name: "version_number" },
        ]
      },
      {
        name: "idx_contract",
        using: "BTREE",
        fields: [
          { name: "contract_id" },
        ]
      },
      {
        name: "idx_row",
        using: "BTREE",
        fields: [
          { name: "row_id" },
        ]
      },
      {
        name: "idx_current",
        using: "BTREE",
        fields: [
          { name: "is_current" },
        ]
      },
      {
        name: "idx_status",
        using: "BTREE",
        fields: [
          { name: "version_status" },
        ]
      },
    ]
  });
  }
}
