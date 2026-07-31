import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_version extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "版本ID"
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
    version_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "机器版号"
    },
    version_label: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "展示版号(v1.0)"
    },
    version_status: {
      type: DataTypes.ENUM('draft','review','approved','effective','expired','archived'),
      allowNull: false,
      defaultValue: "draft",
      comment: "版本状态"
    },
    is_current: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "是否当前版本"
    },
    change_summary: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "变更摘要"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建者ID"
    },
    approved_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "审批者ID"
    },
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "审批时间"
    },
    effective_from: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "生效起始日期"
    },
    effective_to: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "生效截止日期"
    },
    published_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "发布时间"
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
    tableName: 'doc_versions',
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
        name: "idx_doc_version_no",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "version_no" },
        ]
      },
      {
        name: "idx_doc_current",
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "is_current" },
        ]
      },
      {
        name: "idx_status_effective",
        using: "BTREE",
        fields: [
          { name: "version_status" },
          { name: "effective_from" },
          { name: "effective_to" },
        ]
      },
    ]
  });
  }
}
