import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class task_token extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "Token字符串(随机生成，非JWT)",
      unique: "token"
    },
    task_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "关联的任务ID",
      references: {
        model: 'tasks',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建Token的用户ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: "过期时间"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'task_token',
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
        name: "token",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "token" },
        ]
      },
      {
        name: "idx_token",
        using: "BTREE",
        fields: [
          { name: "token" },
        ]
      },
      {
        name: "idx_task_user",
        using: "BTREE",
        fields: [
          { name: "task_id" },
          { name: "user_id" },
        ]
      },
      {
        name: "idx_expires_at",
        using: "BTREE",
        fields: [
          { name: "expires_at" },
        ]
      },
      {
        name: "fk_task_token_user",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
    ]
  });
  }
}
