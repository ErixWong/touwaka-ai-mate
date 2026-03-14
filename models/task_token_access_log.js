import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class task_token_access_log extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    token_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "关联的Token ID",
      references: {
        model: 'task_token',
        key: 'id'
      }
    },
    file_path: {
      type: DataTypes.STRING(512),
      allowNull: false,
      comment: "访问的文件路径"
    },
    ip_address: {
      type: DataTypes.STRING(45),
      allowNull: false,
      comment: "访问者IP地址"
    },
    user_agent: {
      type: DataTypes.STRING(512),
      allowNull: true,
      comment: "浏览器User-Agent"
    },
    accessed_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'task_token_access_log',
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
        name: "idx_token_id",
        using: "BTREE",
        fields: [
          { name: "token_id" },
        ]
      },
      {
        name: "idx_accessed_at",
        using: "BTREE",
        fields: [
          { name: "accessed_at" },
        ]
      },
    ]
  });
  }
}
