import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_standard_ref_anchor extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    standard_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所属标准 app_standard.id",
      references: {
        model: 'app_standard',
        key: 'id'
      }
    },
    source_revision_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "引用所在版本 document_revisions.id"
    },
    source_outline_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "引用所在 section document_outlines.id"
    },
    occurrence_index: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "同一引用片段在该 section 内第几次出现，从 0 起"
    },
    source_text: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: "原文引用片段（如 GB\/T 2001），兼作 gap 回填预筛线索"
    },
    context_text: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "引用片段上下文快照，供人工修正界面展示"
    },
    ref_type: {
      type: DataTypes.ENUM('explicit','implicit'),
      allowNull: false,
      comment: "显式\/隐式引用"
    },
    status: {
      type: DataTypes.ENUM('valid','suspected','gap','invalid'),
      allowNull: false,
      comment: "有效\/存疑\/待回填\/无效"
    },
    source: {
      type: DataTypes.ENUM('auto','user_confirmed','manual','auto_backfill'),
      allowNull: false,
      defaultValue: "auto",
      comment: "来源：自动识别\/用户确认候选\/人工新建\/自动回填"
    },
    target_document_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "目标文档 documents.id，未定目标为 NULL"
    },
    target_revision_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "目标版本 document_revisions.id"
    },
    target_outline_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "目标 section document_outlines.id"
    },
    candidates_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "存疑候选列表 [{document_id,revision_id,outline_id,reason,score}]"
    },
    status_reason: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "状态原因元数据"
    },
    retry_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "gap 回填已重试次数"
    },
    last_retry_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "最近回填重试时间"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "写入入口标识（清洗运行ID\/用户ID\/回填任务ID）"
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
    tableName: 'app_standard_ref_anchor',
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
        name: "uk_ref_anchor_occurrence",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "source_revision_id" },
          { name: "source_outline_id" },
          { name: "occurrence_index" },
        ]
      },
      {
        name: "idx_standard_status",
        using: "BTREE",
        fields: [
          { name: "standard_id" },
          { name: "status" },
        ]
      },
      {
        name: "idx_target_document",
        using: "BTREE",
        fields: [
          { name: "target_document_id" },
        ]
      },
      {
        name: "idx_source_outline",
        using: "BTREE",
        fields: [
          { name: "source_outline_id" },
        ]
      },
    ]
  });
  }
}
