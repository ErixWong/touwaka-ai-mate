import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_contract_row extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "关联 mini_app_rows.id",
      references: {
        model: 'mini_app_rows',
        key: 'id'
      }
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
    parent_company: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "上级公司"
    },
    contract_amount: {
      type: DataTypes.DECIMAL(15,2),
      allowNull: true,
      comment: "合同金额"
    },
    contract_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "签订日期"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "创建时间"
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "更新时间"
    }
  }, {
    sequelize,
    tableName: 'app_contract_rows',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "row_id" },
        ]
      },
      {
        name: "idx_contract_number",
        using: "BTREE",
        fields: [
          { name: "contract_number" },
        ]
      },
      {
        name: "idx_party_a",
        using: "BTREE",
        fields: [
          { name: "party_a" },
        ]
      },
      {
        name: "idx_parent_company",
        using: "BTREE",
        fields: [
          { name: "parent_company" },
        ]
      },
      {
        name: "idx_contract_amount",
        using: "BTREE",
        fields: [
          { name: "contract_amount" },
        ]
      },
      {
        name: "idx_contract_date",
        using: "BTREE",
        fields: [
          { name: "contract_date" },
        ]
      },
    ]
  });
  }
}
