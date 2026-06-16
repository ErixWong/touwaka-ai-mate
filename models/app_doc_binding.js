import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_doc_binding extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "绑定ID"
    },
    app_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "App ID"
    },
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "App行ID"
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "文档ID",
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    current_revision_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "当前版本ID",
      references: {
        model: 'document_revisions',
        key: 'id'
      }
    },
    binding_status: {
      type: DataTypes.ENUM('active','archived'),
      allowNull: false,
      defaultValue: "active",
      comment: "绑定状态"
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "扩展字段"
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
    tableName: 'app_doc_bindings',
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
        name: "uk_app_row",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "app_id" },
          { name: "row_id" },
        ]
      },
      {
        name: "idx_document",
        using: "BTREE",
        fields: [
          { name: "document_id" },
        ]
      },
      {
        name: "idx_revision",
        using: "BTREE",
        fields: [
          { name: "current_revision_id" },
        ]
      },
      {
        name: "idx_status",
        using: "BTREE",
        fields: [
          { name: "binding_status" },
        ]
      },
    ]
  });
  }
}
