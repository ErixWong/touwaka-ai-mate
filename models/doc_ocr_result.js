import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_ocr_result extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "OCR结果ID"
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "文档ID",
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    revision_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "文档版本ID",
      references: {
        model: 'document_revisions',
        key: 'id'
      }
    },
    provider: {
      type: DataTypes.STRING(64),
      allowNull: false,
      defaultValue: "mineru",
      comment: "OCR供应方标识"
    },
    task_id: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "上游任务ID"
    },
    status: {
      type: DataTypes.ENUM('pending','processing','completed','failed'),
      allowNull: false,
      defaultValue: "pending",
      comment: "OCR阶段归一化状态"
    },
    progress: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "OCR进度百分比"
    },
    main_markdown_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "平台主markdown附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    raw_result_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "OCR原始结果附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    deliverables_manifest_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "交付物清单附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    middle_json_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "middle_json附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    content_list_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "content_list附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    content_list_v2_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "content_list_v2附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    model_json_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "model_json附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    image_manifest_attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "图片清单附件ID",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    image_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "图片数量"
    },
    line_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "主markdown行数"
    },
    error_code: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "错误码"
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "错误信息"
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "开始时间"
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "完成时间"
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "轻量追溯信息"
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
    tableName: 'doc_ocr_results',
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
        name: "idx_doc_ocr_result_document",
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "revision_id" },
        ]
      },
      {
        name: "idx_doc_ocr_result_status",
        using: "BTREE",
        fields: [
          { name: "status" },
          { name: "updated_at" },
        ]
      },
      {
        name: "idx_doc_ocr_result_task",
        using: "BTREE",
        fields: [
          { name: "provider" },
          { name: "task_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_revision",
        using: "BTREE",
        fields: [
          { name: "revision_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_main_markdown_attachment",
        using: "BTREE",
        fields: [
          { name: "main_markdown_attachment_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_raw_result_attachment",
        using: "BTREE",
        fields: [
          { name: "raw_result_attachment_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_deliverables_manifest_attachment",
        using: "BTREE",
        fields: [
          { name: "deliverables_manifest_attachment_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_middle_json_attachment",
        using: "BTREE",
        fields: [
          { name: "middle_json_attachment_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_content_list_attachment",
        using: "BTREE",
        fields: [
          { name: "content_list_attachment_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_content_list_v2_attachment",
        using: "BTREE",
        fields: [
          { name: "content_list_v2_attachment_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_model_json_attachment",
        using: "BTREE",
        fields: [
          { name: "model_json_attachment_id" },
        ]
      },
      {
        name: "fk_doc_ocr_result_image_manifest_attachment",
        using: "BTREE",
        fields: [
          { name: "image_manifest_attachment_id" },
        ]
      },
    ]
  });
  }
}
