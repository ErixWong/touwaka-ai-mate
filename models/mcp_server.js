import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mcp_server extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "MCP Server 名称",
      unique: "name"
    },
    display_name: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "显示名称"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "描述"
    },
    command: {
      type: DataTypes.STRING(256),
      allowNull: false,
      comment: "启动命令"
    },
    args: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "命令参数"
    },
    env_template: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "环境变量模板，支持 ${user.xxx} 占位符"
    },
    is_public: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否公共（无需用户凭证）"
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      comment: "是否启用"
    },
    requires_credentials: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否需要用户凭证"
    },
    credential_fields: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "凭证字段定义"
    },
    icon: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "图标标识"
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "分类：search, storage, dev-tools, etc."
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "创建者"
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
    transport_type: {
      type: DataTypes.ENUM('stdio','http','sse'),
      allowNull: true,
      defaultValue: "stdio",
      comment: "MCP 传输类型：stdio=标准输入输出, http=HTTP Stream, sse=Server-Sent Events"
    },
    url: {
      type: DataTypes.STRING(512),
      allowNull: true,
      comment: "HTTP MCP Server URL（transport_type=http 时使用）"
    },
    headers: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "HTTP Headers，JSON 格式（transport_type=http 时使用）"
    }
  }, {
    sequelize,
    tableName: 'mcp_servers',
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
        name: "name",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "name" },
        ]
      },
      {
        name: "idx_name",
        using: "BTREE",
        fields: [
          { name: "name" },
        ]
      },
      {
        name: "idx_is_enabled",
        using: "BTREE",
        fields: [
          { name: "is_enabled" },
        ]
      },
      {
        name: "idx_category",
        using: "BTREE",
        fields: [
          { name: "category" },
        ]
      },
    ]
  });
  }
}
