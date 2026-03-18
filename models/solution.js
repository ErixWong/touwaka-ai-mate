import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class solution extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(200),
      allowNull: false,
      comment: "解决方案名称"
    },
    slug: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "URL友好标识",
      unique: "slug"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "简要描述（适用场景）"
    },
    guide: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "执行指南（Markdown）"
    },
    tags: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "标签数组"
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: 1,
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
    tableName: 'solutions',
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
        name: "slug",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "slug" },
        ]
      },
      {
        name: "idx_slug",
        using: "BTREE",
        fields: [
          { name: "slug" },
        ]
      },
      {
        name: "idx_active",
        using: "BTREE",
        fields: [
          { name: "is_active" },
        ]
      },
    ]
  });
  }
}
