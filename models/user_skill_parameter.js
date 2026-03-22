import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class user_skill_parameter extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "用户ID"
    },
    skill_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "技能ID"
    },
    param_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "参数名"
    },
    param_value: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "参数值"
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
    tableName: 'user_skill_parameters',
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
        name: "uk_user_skill_param",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "user_id" },
          { name: "skill_id" },
          { name: "param_name" },
        ]
      },
      {
        name: "idx_user_id",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_skill_id",
        using: "BTREE",
        fields: [
          { name: "skill_id" },
        ]
      },
    ]
  });
  }
}
