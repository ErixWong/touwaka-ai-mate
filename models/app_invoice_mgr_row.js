import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_invoice_mgr_row extends Model {
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
    invoice_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "发票号码（20位），用于去重",
      unique: "uk_invoice_number"
    },
    invoice_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "开票日期"
    },
    invoice_type: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "发票类型"
    },
    seller_name: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "销售方名称"
    },
    seller_tax_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "销售方税号"
    },
    buyer_name: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "购买方名称"
    },
    buyer_tax_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "购买方税号"
    },
    total_amount: {
      type: DataTypes.DECIMAL(12,2),
      allowNull: true,
      defaultValue: 0.00,
      comment: "合计金额"
    },
    total_tax: {
      type: DataTypes.DECIMAL(12,2),
      allowNull: true,
      defaultValue: 0.00,
      comment: "税额"
    },
    total_with_tax: {
      type: DataTypes.DECIMAL(12,2),
      allowNull: true,
      defaultValue: 0.00,
      comment: "价税合计"
    },
    item_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "商品明细总数"
    },
    page_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "PDF页数"
    },
    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "备注"
    },
    ocr_method: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "识别方法：fapiao\/markitdown"
    },
    ocr_raw: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "OCR原始输出JSON"
    },
    extraction_status: {
      type: DataTypes.STRING(16),
      allowNull: true,
      defaultValue: "success",
      comment: "提取状态"
    },
    text_items_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "PDF文本项总数"
    },
    keyword_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "发票关键词匹配数"
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
    tableName: 'app_invoice_mgr_rows',
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
        name: "uk_invoice_number",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "invoice_number" },
        ]
      },
      {
        name: "idx_seller",
        using: "BTREE",
        fields: [
          { name: "seller_name" },
        ]
      },
      {
        name: "idx_buyer",
        using: "BTREE",
        fields: [
          { name: "buyer_name" },
        ]
      },
      {
        name: "idx_date",
        using: "BTREE",
        fields: [
          { name: "invoice_date" },
        ]
      },
      {
        name: "idx_amount",
        using: "BTREE",
        fields: [
          { name: "total_with_tax" },
        ]
      },
    ]
  });
  }
}
