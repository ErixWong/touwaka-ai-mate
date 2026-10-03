import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class chat_tool_call extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    tool_use_id: {
      type: DataTypes.STRING(128),
      allowNull: false,
      primaryKey: true,
      comment: "provider 生成的 call id"
    },
    request_id: {
      type: DataTypes.STRING(64),
      allowNull: false
    },
    round_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "agent_rounds.id"
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    input_json: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    result_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "工具输出正身唯一存储"
    },
    is_error: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: "应用侧写入"
    }
  }, {
    sequelize,
    tableName: 'chat_tool_calls',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "tool_use_id" },
        ]
      },
      {
        name: "idx_chat_tool_calls_request",
        using: "BTREE",
        fields: [
          { name: "request_id" },
        ]
      },
      {
        name: "idx_chat_tool_calls_name",
        using: "BTREE",
        fields: [
          { name: "name" },
        ]
      },
      {
        name: "idx_chat_tool_calls_is_error",
        using: "BTREE",
        fields: [
          { name: "is_error" },
        ]
      },
    ]
  });
  }
}
