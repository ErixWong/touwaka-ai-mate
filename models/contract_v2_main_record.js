import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class contract_v2_main_record extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    org_node_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所属组织节点",
      references: {
        model: 'contract_v2_org_nodes',
        key: 'id'
      }
    },
    contract_name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "合同名称"
    },
    contract_type: {
      type: DataTypes.ENUM('strategy','framework','development','supply','purchase','quality','nda','technical','other'),
      allowNull: true,
      comment: "合同类型"
    },
    current_version_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "当前生效版本ID"
    },
    version_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "版本总数"
    },
    status: {
      type: DataTypes.ENUM('draft','active','expired','terminated'),
      allowNull: true,
      defaultValue: "active"
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
    tableName: 'contract_v2_main_records',
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
        name: "idx_org_node",
        using: "BTREE",
        fields: [
          { name: "org_node_id" },
        ]
      },
      {
        name: "idx_type",
        using: "BTREE",
        fields: [
          { name: "contract_type" },
        ]
      },
      {
        name: "idx_status",
        using: "BTREE",
        fields: [
          { name: "status" },
        ]
      },
    ]
  });
  }
}
