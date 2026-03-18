import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class task extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    task_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "任务ID (12位随机字符)",
      unique: "task_id"
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: "任务标题"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "任务描述"
    },
    workspace_path: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: "工作目录路径（相对路径）"
    },
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "关联的专家ID（自主任务执行时使用）"
    },
    topic_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "关联的话题ID（自主任务执行时的对话）"
    },
    last_executed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "最后执行时间（自主任务执行器更新）"
    },
    solution_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "关联的解决方案ID",
      references: {
        model: 'solutions',
        key: 'id'
      }
    },
    status: {
      type: DataTypes.ENUM('active','autonomous','archived','deleted'),
      allowNull: true,
      defaultValue: "active"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建者 user_id",
      references: {
        model: 'users',
        key: 'id'
      }
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
    tableName: 'tasks',
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
        name: "task_id",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "task_id" },
        ]
      },
      {
        name: "idx_task_id",
        using: "BTREE",
        fields: [
          { name: "task_id" },
        ]
      },
      {
        name: "idx_user",
        using: "BTREE",
        fields: [
          { name: "created_by" },
        ]
      },
      {
        name: "idx_status",
        using: "BTREE",
        fields: [
          { name: "status" },
        ]
      },
      {
        name: "idx_expert",
        using: "BTREE",
        fields: [
          { name: "expert_id" },
        ]
      },
      {
        name: "idx_topic",
        using: "BTREE",
        fields: [
          { name: "topic_id" },
        ]
      },
      {
        name: "idx_solution",
        using: "BTREE",
        fields: [
          { name: "solution_id" },
        ]
      },
    ]
  });
  }
}
