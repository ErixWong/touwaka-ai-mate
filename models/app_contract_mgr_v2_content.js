import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_contract_mgr_v2_content extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "关联 mini_app_rows.id"
    },
    content_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "",
      unique: "uk_content_id"
    },
    process_step: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "处理步骤"
    },
    file_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "文件ID"
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "Doc平台文档ID"
    },
    ocr_task_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "OCR任务ID"
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
      comment: "提取JSON"
    },
    extract_model: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "提取模型"
    },
    extract_temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      comment: "提取温度"
    },
    extract_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "提取时间"
    },
    classification_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "分类结果"
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
    ]
  });
  }
}
