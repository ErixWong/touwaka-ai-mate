import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_tick_run extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.CHAR(20),
      allowNull: false,
      primaryKey: true,
      comment: "运行记录ID，使用 Utils.newID()"
    },
    app_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "app标识，如 doc-ocr-pipeline"
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "本轮tick开始时间"
    },
    finished_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "本轮tick结束时间，NULL表示仍未闭合"
    },
    status: {
      type: DataTypes.ENUM('running','success','failed','interrupted_by_restart','terminated_by_admin'),
      allowNull: false,
      defaultValue: "running",
      comment: "运行状态"
    },
    final_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "最终说明\/遗言：成功摘要、失败错误、重启中断说明等"
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
    tableName: 'app_tick_run',
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
        name: "idx_app_tick_run_app_id_started_at",
        using: "BTREE",
        fields: [
          { name: "app_id" },
          { name: "started_at" },
        ]
      },
      {
        name: "idx_app_tick_run_finished_at",
        using: "BTREE",
        fields: [
          { name: "finished_at" },
        ]
      },
      {
        name: "idx_app_tick_run_status",
        using: "BTREE",
        fields: [
          { name: "status" },
        ]
      },
      {
        name: "idx_app_tick_run_open",
        using: "BTREE",
        fields: [
          { name: "app_id" },
          { name: "finished_at" },
        ]
      },
    ]
  });
  }
}
