import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class assistant_request extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    request_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      primaryKey: true
    },
    assistant_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "助理ID"
    },
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "调用专家ID"
    },
    contact_id: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "联系人ID"
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "用户ID"
    },
    topic_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "话题ID"
    },
    status: {
      type: DataTypes.ENUM('pending','running','completed','failed','timeout','cancelled'),
      allowNull: true,
      defaultValue: "pending"
    },
    input: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "输入参数"
    },
    result: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "执行结果"
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "错误信息"
    },
    tokens_input: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "输入 Token 数"
    },
    tokens_output: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "输出 Token 数"
    },
    model_used: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "实际使用的模型"
    },
    latency_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "执行耗时（毫秒）"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "开始执行时间"
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "完成时间"
    },
    is_archived: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否已归档"
    },
    notification_status: {
      type: DataTypes.ENUM('pending','sent','failed','skipped'),
      allowNull: true,
      defaultValue: "pending",
      comment: "通知专家状态: pending=待发送, sent=已发送, failed=发送失败, skipped=跳过(无SSE连接)"
    },
    notification_error: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "通知失败时的错误信息"
    },
    notification_sent_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "通知发送时间"
    }
  }, {
    sequelize,
    tableName: 'assistant_requests',
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
        name: "idx_request_expert",
        using: "BTREE",
        fields: [
          { name: "expert_id" },
        ]
      },
      {
        name: "idx_request_user",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_request_status",
        using: "BTREE",
        fields: [
          { name: "status" },
        ]
      },
      {
        name: "idx_request_created",
        using: "BTREE",
        fields: [
          { name: "created_at" },
        ]
      },
      {
        name: "idx_notification_status",
        using: "BTREE",
        fields: [
          { name: "notification_status" },
        ]
      },
    ]
  });
  }
}
