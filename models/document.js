import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class document extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "文档ID",
      references: {
        model: 'document_revisions',
        key: 'document_id'
      }
    },
    collection_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所属文档集合ID",
      references: {
        model: 'document_collections',
        key: 'id'
      }
    },
    current_revision_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "当前版本ID",
      references: {
        model: 'document_revisions',
        key: 'id'
      }
    },
    doc_type: {
      type: DataTypes.ENUM('knowledge','contract','department_doc','standard'),
      allowNull: false,
      comment: "文档类型"
    },
    source_system: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "来源系统"
    },
    source_ref_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "来源主键"
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: "文档标题"
    },
    processing_status: {
      type: DataTypes.ENUM('pending_ocr','ocr_processing','pending_clean','pending_outline','pending_chunk','pending_embedding','ready','error'),
      allowNull: false,
      defaultValue: "pending_ocr",
      comment: "处理状态"
    },
    processing_error_code: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "错误码"
    },
    processing_error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "错误信息"
    },
    processing_retry_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "重试次数"
    },
    processing_updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "处理状态更新时间"
    },
    current_stage_started_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "进入当前处理阶段的时间点"
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "扩展字段"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'documents',
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
        name: "uk_document_source",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "source_system" },
          { name: "source_ref_id" },
        ]
      },
      {
        name: "idx_document_collection",
        using: "BTREE",
        fields: [
          { name: "collection_id" },
        ]
      },
      {
        name: "idx_document_current_revision",
        using: "BTREE",
        fields: [
          { name: "current_revision_id" },
        ]
      },
      {
        name: "idx_document_processing",
        using: "BTREE",
        fields: [
          { name: "processing_status" },
          { name: "processing_updated_at" },
        ]
      },
      {
        name: "idx_document_type_status",
        using: "BTREE",
        fields: [
          { name: "doc_type" },
          { name: "processing_status" },
        ]
      },
      {
        name: "fk_document_current_revision",
        using: "BTREE",
        fields: [
          { name: "id" },
          { name: "current_revision_id" },
        ]
      },
    ]
  });
  }
}
