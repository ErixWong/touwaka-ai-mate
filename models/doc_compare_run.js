import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_compare_run extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "比对任务ID"
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
    base_version_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "基准版本ID",
      references: {
        model: 'document_revisions',
        key: 'id'
      }
    },
    target_version_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "目标版本ID",
      references: {
        model: 'document_revisions',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('pending','processing','completed','failed'),
      allowNull: false,
      defaultValue: "pending",
      comment: "任务状态"
    },
    summary_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "比对摘要"
    },
    model_info: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "使用的模型信息"
    },
    duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "执行时长(ms)"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建者ID"
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
    tableName: 'doc_compare_runs',
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
        name: "idx_doc_status",
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "status" },
        ]
      },
      {
        name: "idx_versions",
        using: "BTREE",
        fields: [
          { name: "base_version_id" },
          { name: "target_version_id" },
        ]
      },
      {
        name: "fk_comp_runs_target_rev",
        using: "BTREE",
        fields: [
          { name: "target_version_id" },
        ]
      },
    ]
  });
  }
}
