import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class contract_v2_org_node extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    parent_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      references: {
        model: 'contract_v2_org_nodes',
        key: 'id'
      }
    },
    node_type: {
      type: DataTypes.ENUM('group','party','project'),
      allowNull: false,
      comment: "节点类型"
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "节点名称"
    },
    path: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "层级路径"
    },
    level: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
      comment: "层级深度"
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "同级排序"
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
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
    tableName: 'contract_v2_org_nodes',
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
        name: "idx_parent",
        using: "BTREE",
        fields: [
          { name: "parent_id" },
        ]
      },
      {
        name: "idx_type",
        using: "BTREE",
        fields: [
          { name: "node_type" },
        ]
      },
      {
        name: "idx_path",
        using: "BTREE",
        fields: [
          { name: "path" },
        ]
      },
      {
        name: "idx_level",
        using: "BTREE",
        fields: [
          { name: "level" },
        ]
      },
    ]
  });
  }
}
