import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mcp_user_credential extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "用户ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    mcp_server_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "MCP Server ID",
      references: {
        model: 'mcp_servers',
        key: 'id'
      }
    },
    credentials: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "用户凭证（加密存储）"
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      comment: "是否启用"
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
    tableName: 'mcp_user_credentials',
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
        name: "uk_user_server",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "user_id" },
          { name: "mcp_server_id" },
        ]
      },
      {
        name: "idx_user_id",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_mcp_server_id",
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
