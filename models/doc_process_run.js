import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_process_run extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "处理运行记录ID"
    },
    revision_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所属版本ID",
      references: {
        model: 'document_revisions',
        key: 'id'
      }
    },
    subject_type: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "处理对象表名"
    },
    subject_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "处理对象ID"
    },
    pipeline_step: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "处理步骤"
    },
    operation: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "执行动作"
    },
    initiated_by_type: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "触发来源类型"
    },
    initiated_by_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "触发主体ID"
    },
    result_status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      comment: "运行结果状态"
    },
    attempt_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "第几次尝试"
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "结果说明"
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "结构化上下文（timeout\/cancel\/retry\/upstream summary）"
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "开始处理时间"
    },
    finished_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "结束处理时间"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'doc_process_runs',
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
        name: "idx_revision_started",
        using: "BTREE",
        fields: [
          { name: "revision_id" },
          { name: "started_at" },
        ]
      },
      {
        name: "idx_step_result",
        using: "BTREE",
        fields: [
          { name: "pipeline_step" },
          { name: "result_status" },
          { name: "started_at" },
        ]
      },
      {
        name: "idx_subject_started",
        using: "BTREE",
        fields: [
          { name: "subject_type" },
          { name: "subject_id" },
          { name: "started_at" },
        ]
      },
    ]
  });
  }
}
