import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class message extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    topic_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      references: {
        model: 'topics',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "消息所属用户ID，便于直接查询",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "专家ID，便于直接查询",
      references: {
        model: 'experts',
        key: 'id'
      }
    },
    role: {
      type: DataTypes.ENUM('system','user','assistant'),
      allowNull: false
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    content_type: {
      type: DataTypes.BLOB,
      allowNull: true,
      defaultValue: "text"
    },
    tokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    cost: {
      type: DataTypes.DECIMAL(10,6),
      allowNull: true,
      defaultValue: 0.000000
    },
    latency_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    provider_name: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    model_name: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    inner_voice: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    tool_calls: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    error_info: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'messages',
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
        name: "idx_topic",
        using: "BTREE",
        fields: [
          { name: "topic_id" },
        ]
      },
      {
        name: "idx_user",
        using: "BTREE",
        fields: [
          { name: "user_id" },
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
        name: "idx_role",
        using: "BTREE",
        fields: [
          { name: "role" },
        ]
      },
      {
        name: "idx_created",
        using: "BTREE",
        fields: [
          { name: "created_at" },
        ]
      },
    ]
  });
  }
}
