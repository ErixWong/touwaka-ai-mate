import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_document_tag extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "关联ID"
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "文档ID",
      references: {
        model: 'doc_documents',
        key: 'id'
      }
    },
    tag_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "标签ID",
      references: {
        model: 'doc_tags',
        key: 'id'
      }
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'doc_document_tags',
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
        name: "idx_doc_tag",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "tag_id" },
        ]
      },
      {
        name: "fk_doc_tag_tag",
        using: "BTREE",
        fields: [
          { name: "tag_id" },
        ]
      },
    ]
  });
  }
}
