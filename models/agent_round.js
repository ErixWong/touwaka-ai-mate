import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class agent_round extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    request_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "erix runId，即 chat_requests.request_id"
    },
    round_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "轮次序号"
    },
    dedup_key: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: "erix RoundRecord.dedupKey，幂等键",
      unique: "uk_agent_rounds_dedup_key"
    },
    stop_reason: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    usage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    latency_ms: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    folded: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "是否已折叠（compaction）"
    },
    folded_range: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "折叠范围"
    },
    record_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "RoundRecord 其余字段（load() 重组往返保真）"
    },
    ts: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "erix record.ts ISO 字符串原样存"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: "应用侧写入"
    }
  }, {
    sequelize,
    tableName: 'agent_rounds',
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
        name: "uk_agent_rounds_dedup_key",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "dedup_key" },
        ]
      },
      {
        name: "idx_agent_rounds_request",
        using: "BTREE",
        fields: [
          { name: "request_id" },
        ]
      },
    ]
  });
  }
}
