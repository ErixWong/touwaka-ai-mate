import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mcp_tools_cache extends Model {
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
      }
    },
    tool_name: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "工具名称"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "工具描述"
    },
    input_schema: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "输入参数定义"
    },
    cached_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'mcp_tools_cache',
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
        name: "uk_server_tool",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "mcp_server_id" },
          { name: "tool_name" },
        ]
      },
      {
        name: "idx_mcp_server_id",
        using: "BTREE",
        fields: [
          { name: "mcp_server_id" },
        ]
      },
    ]
  });
  }
}
