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
    ]
  });
  }
}
