import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class skill_parameter extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    skill_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "技能ID",
      references: {
        model: 'skills',
        key: 'id'
      }
    },
    param_name: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "参数名（如 api_key, base_url）"
    },
    param_value: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "参数值"
    },
    is_secret: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: 0,
      comment: "是否敏感参数（前端显示\/隐藏）"
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
    tableName: 'skill_parameters',
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
        name: "uk_skill_param",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "skill_id" },
          { name: "param_name" },
        ]
      },
    ]
  });
  }
}
