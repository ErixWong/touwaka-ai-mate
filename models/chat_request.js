import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class chat_request extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    request_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true
    },
    original_request_id: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    topic_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    model_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    task_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    user_message_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    assistant_message_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('accepted','running','completed','failed','stopped','timeout'),
      allowNull: false,
      defaultValue: "accepted"
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    working_path: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true
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
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'chat_requests',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "request_id" },
        ]
      },
      {
        name: "idx_chat_request_user",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_chat_request_expert",
        using: "BTREE",
        fields: [
          { name: "expert_id" },
        ]
      },
      {
        name: "idx_chat_request_topic",
        using: "BTREE",
        fields: [
          { name: "topic_id" },
        ]
      },
      {
        name: "idx_chat_request_status",
        using: "BTREE",
        fields: [
          { name: "status" },
        ]
      },
      {
        name: "idx_chat_request_created",
        using: "BTREE",
        fields: [
          { name: "created_at" },
        ]
      },
      {
        name: "idx_chat_request_original",
        using: "BTREE",
        fields: [
          { name: "original_request_id" },
        ]
      },
      {
        name: "idx_chat_request_user_message",
        using: "BTREE",
        fields: [
          { name: "user_message_id" },
        ]
      },
      {
        name: "idx_chat_request_assistant_message",
        using: "BTREE",
        fields: [
          { name: "assistant_message_id" },
        ]
      },
    ]
  });
  }
}
