import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class attachment extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      primaryKey: true,
      comment: "附件唯一ID（Utils.newID生成）"
    },
    source_tag: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "业务标识：kb_article_image, user_avatar, task_export 等"
    },
    source_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "关联资源ID"
    },
    file_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "原始文件名"
    },
    ext_name: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "扩展名（png, jpg, pdf等）"
    },
    mime_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "MIME类型"
    },
    file_size: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "文件大小（字节）"
    },
    file_path: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: "相对路径：2026\/04\/05\/abc123.png"
    },
    width: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "图片宽度（仅图片类型）"
    },
    height: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "图片高度"
    },
    alt_text: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "替代文本"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "文件描述（VL模型生成）"
    },
    created_by: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "上传者ID",
      references: {
        model: 'users',
        key: 'id'
      }
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
    tableName: 'attachments',
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
        name: "idx_source",
        using: "BTREE",
        fields: [
          { name: "source_tag" },
          { name: "source_id" },
        ]
      },
      {
        name: "idx_created_at",
        using: "BTREE",
        fields: [
          { name: "created_at" },
        ]
      },
      {
        name: "idx_created_by",
        using: "BTREE",
        fields: [
          { name: "created_by" },
        ]
      },
    ]
  });
  }
}
