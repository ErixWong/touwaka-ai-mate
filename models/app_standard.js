import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_standard extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "文档平台 documents.id，一份文档只纳管一次",
      unique: "uk_app_standard_document"
    },
    standard_type: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "标准类型，当前取值 national\/industry\/enterprise\/international，应用层校验，可扩展"
    },
    standard_code: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "标准编号，如 GB\/T 19001-2016"
    },
    standard_name: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: "标准名称"
    },
    enterprise_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "归属企业；NULL=公共标准库（承接国家\/行业\/国际标准），企业表建立后迁移为企业记录",
      references: {
        model: 'app_enterprise',
        key: 'id'
      }
    },
    current_revision_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "当前采用版本 document_revisions.id"
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      comment: "是否启用"
    },
    anchor_build_status: {
      type: DataTypes.ENUM('pending','processing','done','error'),
      allowNull: true,
      defaultValue: "pending",
      comment: "引用清洗状态"
    },
    last_anchor_build_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "最近一次清洗完成时间"
    },
    last_anchor_build_error: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "最近一次清洗错误信息"
    },
    needs_review: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否存在待人工处理的存疑\/gap\/无效引用"
    },
    reference_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "引用总数"
    },
    valid_reference_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "有效引用数"
    },
    suspected_reference_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "存疑引用数"
    },
    gap_reference_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "待回填缺口数"
    },
    invalid_reference_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "无效引用数"
    },
    has_manual_fix: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否存在人工修正"
    },
    manual_fix_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "人工修正次数"
    },
    last_manual_fix_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "最近人工修正时间"
    },
    last_manual_fix_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "最近人工修正人 users.id"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "创建人"
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
    tableName: 'app_standard',
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
        name: "uk_app_standard_document",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "document_id" },
        ]
      },
      {
        name: "idx_standard_code",
        using: "BTREE",
        fields: [
          { name: "standard_code" },
        ]
      },
      {
        name: "idx_enterprise",
        using: "BTREE",
        fields: [
          { name: "enterprise_id" },
        ]
      },
      {
        name: "idx_build_status",
        using: "BTREE",
        fields: [
          { name: "anchor_build_status" },
        ]
      },
      {
        name: "idx_current_revision",
        using: "BTREE",
        fields: [
          { name: "current_revision_id" },
        ]
      },
    ]
  });
  }
}
