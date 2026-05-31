import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_collection_document extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "关联ID"
    },
    collection_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "集合ID",
      references: {
        model: 'doc_collections',
        key: 'id'
      },
      unique: "idx_coll_doc"
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "文档ID",
      references: {
        model: 'doc_documents',
        key: 'id'
      },
      unique: "fk_coldoc_document"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'doc_collection_documents',
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
        name: "idx_coll_doc",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "collection_id" },
          { name: "document_id" },
        ]
      },
      {
        name: "idx_doc_unique",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "document_id" },
        ]
      },
    ]
  });
  }
}
