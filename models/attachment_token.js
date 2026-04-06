import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class attachment_token extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    token: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "Token字符串(随机生成，非JWT)",
      unique: "token"
    },
    source_tag: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "资源类型：kb_article_image, task_export 等"
    },
    source_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "资源ID：article_id, task_id 等"
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建Token的用户ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: "过期时间"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    last_access_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "最后访问时间（用于续期追踪）"
    }
  }, {
    sequelize,
    tableName: 'attachment_token',
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
        name: "token",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "token" },
        ]
      },
      {
        name: "idx_token",
        using: "BTREE",
        fields: [
          { name: "token" },
        ]
      },
      {
        name: "idx_source",
        using: "BTREE",
        fields: [
          { name: "source_tag" },
          { name: "source_id" },
        ]
      },
      {
        name: "idx_user_source",
        using: "BTREE",
        fields: [
          { name: "user_id" },
          { name: "source_tag" },
          { name: "source_id" },
        ]
      },
      {
        name: "idx_expires_at",
        using: "BTREE",
        fields: [
          { name: "expires_at" },
        ]
      },
    ]
  });
  }
}
