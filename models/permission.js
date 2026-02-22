import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class permission extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    code: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "权限码：user:create, expert:edit等",
      unique: "code"
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "权限名称"
    },
    type: {
      type: DataTypes.ENUM('menu','button','api'),
      allowNull: true,
      defaultValue: "api",
      comment: "权限类型"
    },
    parent_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "父权限ID，用于菜单层级",
      references: {
        model: 'permissions',
        key: 'id'
      }
    },
    route_path: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Vue路由路径，菜单权限用"
    },
    route_component: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "Vue组件路径"
    },
    route_icon: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "菜单图标"
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "排序顺序"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'permissions',
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
        name: "code",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "code" },
        ]
      },
      {
        name: "parent_id",
        using: "BTREE",
        fields: [
          { name: "parent_id" },
        ]
      },
      {
        name: "idx_code",
        using: "BTREE",
        fields: [
          { name: "code" },
        ]
      },
      {
        name: "idx_type",
        using: "BTREE",
        fields: [
          { name: "type" },
        ]
      },
    ]
  });
  }
}
