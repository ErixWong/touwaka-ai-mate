import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_contract_mgr_v2_content extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "兼容旧 mini_app_rows ID（Phase 6 已移除 FK 绑定）"
    },
    content_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "app 自治内容主键",
      unique: "uk_content_id"
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
    classification_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "版本识别建议"
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
    },
    process_step: {
      type: DataTypes.STRING(32),
      allowNull: true,
      defaultValue: "pending_ocr",
      comment: "处理步骤"
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "Doc平台文档ID"
    },
    ocr_task_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "OCR任务ID"
    },
    filter_carried_over: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "滑动窗口中间状态"
    },
    filter_chunk_index: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "当前处理chunk索引"
    },
    file_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "关联文件ID"
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
        name: "uk_content_id",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "content_id" },
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
