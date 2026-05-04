import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_contract_mgr_v2_content extends Model {
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
      comment: "OCR 服务"
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
    sections: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "章节结构"
    },
    extract_prompt: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "提取提示词"
    },
    extract_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "提取的原始JSON"
    },
    extract_model: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "提取模型"
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
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'app_contract_mgr_v2_content',
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
