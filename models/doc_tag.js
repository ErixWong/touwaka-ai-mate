import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_tag extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "标签ID"
    },
    department_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "部门ID"
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "标签名称"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "标签描述"
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
    tableName: 'doc_tags',
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
        name: "idx_dept_name",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "department_id" },
          { name: "name" },
        ]
      },
      {
        name: "idx_dept",
        using: "BTREE",
        fields: [
          { name: "department_id" },
        ]
      },
    ]
  });
  }
}
