import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_document_content extends Model {
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
    ocr_text: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "OCR 原文"
    },
    ocr_service: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "OCR 服务名称"
    },
    ocr_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "OCR 时间"
    },
    filtered_text: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "过滤后文本"
    },
    filter_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "过滤时间"
    },
    extract_prompt: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "提取提示词"
    },
    extract_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "提取的原始 JSON"
    },
    extract_model: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "使用的模型"
    },
    extract_temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      comment: "模型温度"
    },
    extract_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "提取时间"
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
    tableName: 'app_document_content',
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
    ]
  });
  }
}
