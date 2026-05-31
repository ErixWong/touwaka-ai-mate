import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_permission extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "权限ID"
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
    subject_type: {
      type: DataTypes.ENUM('user','role','org_unit'),
      allowNull: false,
      comment: "主体类型"
    },
    subject_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "主体ID"
    },
    permission_type: {
      type: DataTypes.ENUM('read','write','approve','admin'),
      allowNull: false,
      comment: "权限类型"
    },
    granted_by: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "授权者ID"
    },
    granted_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "授权时间"
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "过期时间"
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
    tableName: 'doc_permissions',
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
        name: "idx_doc_subject_perm",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "subject_type" },
          { name: "subject_id" },
          { name: "permission_type" },
        ]
      },
    ]
  });
  }
}
