import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class assistant_message extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      autoIncrement: true,
      type: DataTypes.BIGINT,
      allowNull: false,
      primaryKey: true
    },
    request_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "关联 assistant_requests.request_id"
    },
    parent_message_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "父消息 ID，用于树状结构"
    },
    role: {
      type: DataTypes.ENUM('expert','assistant','tool','system'),
      allowNull: false,
      comment: "消息角色"
    },
    message_type: {
      type: DataTypes.ENUM('task','context','assistant_response','tool_call','tool_result','final','error','retry','status','note'),
      allowNull: false,
      comment: "消息类型"
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "文本内容"
    },
    content_preview: {
      type: DataTypes.STRING(512),
      allowNull: true,
      comment: "摘要，用于列表展示"
    },
    tool_name: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "工具名称"
    },
    tool_call_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "工具调用链路 ID"
    },
    status: {
      type: DataTypes.ENUM('pending','running','completed','failed','skipped'),
      allowNull: true,
      comment: "消息状态"
    },
    sequence_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "同一 request 内顺序号"
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "扩展字段"
    },
    tokens_input: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "本条消息相关输入 token"
    },
    tokens_output: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "本条消息相关输出 token"
    },
    latency_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "本步骤耗时"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "创建时间"
    }
  }, {
    sequelize,
    tableName: 'assistant_messages',
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
        name: "idx_request_id",
        using: "BTREE",
        fields: [
          { name: "request_id" },
        ]
      },
      {
        name: "idx_request_seq",
        using: "BTREE",
        fields: [
          { name: "request_id" },
          { name: "sequence_no" },
        ]
      },
      {
        name: "idx_tool_call_id",
        using: "BTREE",
        fields: [
          { name: "tool_call_id" },
        ]
      },
    ]
  });
  }
}
