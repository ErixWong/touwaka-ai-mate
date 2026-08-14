import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_invoice_mgr_item extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "关联 app_invoice_mgr_records.id",
      references: {
        model: 'app_invoice_mgr_records',
        key: 'id'
      }
    },
    page_number: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
      comment: "所在页码"
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "行内排序"
    },
    category: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "商品分类"
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "商品名称"
    },
    model: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "规格型号"
    },
    unit: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: "单位"
    },
    quantity: {
      type: DataTypes.DECIMAL(12,4),
      allowNull: true,
      comment: "数量"
    },
    price: {
      type: DataTypes.DECIMAL(12,4),
      allowNull: true,
      comment: "单价"
    },
    amount: {
      type: DataTypes.DECIMAL(12,2),
      allowNull: true,
      comment: "金额"
    },
    tax_rate: {
      type: DataTypes.STRING(8),
      allowNull: true,
      comment: "税率"
    },
    tax_amount: {
      type: DataTypes.DECIMAL(12,2),
      allowNull: true,
      comment: "税额"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'app_invoice_mgr_items',
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
        name: "idx_row_id",
        using: "BTREE",
        fields: [
          { name: "row_id" },
        ]
      },
    ]
  });
  }
}
