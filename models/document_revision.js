import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class document_revision extends Model {
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
      comment: "所属文档ID",
      references: {
        model: 'documents',
        key: 'id'
      }
    },
    revision_no: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "机器版号"
    },
    revision_label: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "展示版号(v1.0)"
    },
    revision_status: {
      type: DataTypes.ENUM('draft','review','approved','effective','expired','archived'),
      allowNull: false,
      defaultValue: "draft",
      comment: "版本状态"
    },
    is_current: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: 0,
      comment: "是否当前版本"
    },
    effective_from: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "生效日期"
    },
    effective_to: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "废止日期(NULL=长期有效)"
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
    diff_status: {
      type: DataTypes.ENUM('pending','processing','ready','error'),
      allowNull: false,
      defaultValue: "pending",
      comment: "版本差异状态(旁路)"
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
    tableName: 'document_revisions',
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
        name: "uk_revision_document_id",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "id" },
        ]
      },
      {
        name: "uk_document_revision_no",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "revision_no" },
        ]
      },
      {
        name: "idx_revision_document_current",
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "is_current" },
        ]
      },
      {
        name: "idx_revision_status",
        using: "BTREE",
        fields: [
          { name: "revision_status" },
        ]
      },
      {
        name: "idx_revision_diff_status",
        using: "BTREE",
        fields: [
          { name: "diff_status" },
        ]
      },
    ]
  });
  }
}
