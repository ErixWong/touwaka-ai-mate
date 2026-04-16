import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mcp_credential extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    mcp_server_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "MCP Server ID",
      references: {
        model: 'mcp_servers',
        key: 'id'
      },
      unique: "1"
    },
    credentials: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "系统默认凭证（加密存储）"
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      comment: "是否启用"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "创建者（管理员）"
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
    tableName: 'mcp_credentials',
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
        name: "uk_server",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "mcp_server_id" },
        ]
      },
      {
        name: "idx_is_enabled",
        using: "BTREE",
        fields: [
          { name: "is_enabled" },
        ]
      },
    ]
  });
  }
}
