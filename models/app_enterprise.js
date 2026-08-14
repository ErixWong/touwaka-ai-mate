import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_enterprise extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "主键，Utils.newID(32)"
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "企业名称（如：吉利、小鹏、比亚迪）",
      unique: "uk_app_enterprise_name"
    },
    name_en: {
      type: DataTypes.STRING(200),
      allowNull: true,
      comment: "企业英文名"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "备注"
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      comment: "是否启用"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "创建人 users.id"
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
    },
    code_prefixes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "标准编号前缀（逗号分隔，如 Q-JL,Q-JLY；用于企业标准识别与归属推断）"
    }
  }, {
    sequelize,
    tableName: 'app_enterprise',
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
        name: "uk_app_enterprise_name",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "name" },
        ]
      },
    ]
  });
  }
}
