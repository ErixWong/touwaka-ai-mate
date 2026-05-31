import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_tag extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "标签ID"
    },
    org_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "组织ID"
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "标签名称"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "标签描述"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'doc_tags',
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
        name: "idx_org_name",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "org_id" },
          { name: "name" },
        ]
      },
      {
        name: "idx_org",
        using: "BTREE",
        fields: [
          { name: "org_id" },
        ]
      },
    ]
  });
  }
}
