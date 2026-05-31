import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_document extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "文档ID"
    },
    doc_type: {
      type: DataTypes.ENUM('knowledge','contract','department_doc','standard'),
      allowNull: false,
      comment: "文档类型"
    },
    source_system: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: "来源系统(kb\/contract_mgr\/contract_mgr_v2)"
    },
    source_ref_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "来源主键(回溯旧系统)"
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: "文档标题"
    },
    owner_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所有者ID"
    },
    org_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "组织ID"
    },
    visibility: {
      type: DataTypes.ENUM('private','org','public'),
      allowNull: false,
      defaultValue: "private",
      comment: "可见范围"
    },
    current_version_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "当前版本ID"
    },
    lifecycle_status: {
      type: DataTypes.ENUM('active','archived'),
      allowNull: false,
      defaultValue: "active",
      comment: "文档级状态"
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "场景扩展字段"
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
    tableName: 'doc_documents',
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
        name: "idx_doc_type_org_status",
        using: "BTREE",
        fields: [
          { name: "doc_type" },
          { name: "org_id" },
          { name: "lifecycle_status" },
        ]
      },
      {
        name: "idx_source_system_ref",
        using: "BTREE",
        fields: [
          { name: "source_system" },
          { name: "source_ref_id" },
        ]
      },
      {
        name: "idx_owner_updated",
        using: "BTREE",
        fields: [
          { name: "owner_id" },
          { name: "updated_at" },
        ]
      },
    ]
  });
  }
}
