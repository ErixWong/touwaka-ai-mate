import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_contract_mgr_v2_content extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    process_step: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: "pending_ocr"
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "Doc平台文档ID"
    },
    ocr_task_id: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    file_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    ocr_text: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    ocr_service: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    ocr_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    filtered_text: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    filter_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    filter_carried_over: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    filter_chunk_index: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    sections: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    extract_prompt: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "提取提示词"
    },
    classification_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "版本识别建议"
    },
    extract_json: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    extract_model: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    extract_temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true
    },
    extract_at: {
      type: DataTypes.DATE,
      allowNull: true
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
      {
        name: "idx_process_step",
        using: "BTREE",
        fields: [
          { name: "process_step" },
        ]
      },
      {
        name: "idx_document_id",
        using: "BTREE",
        fields: [
          { name: "document_id" },
        ]
      },
    ]
  });
  }
}
