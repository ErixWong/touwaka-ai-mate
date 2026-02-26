import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class role_expert extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    role_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      references: {
        model: 'roles',
        key: 'id'
      }
    },
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      references: {
        model: 'experts',
        key: 'id'
      }
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'role_experts',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "role_id" },
          { name: "expert_id" },
        ]
      },
      {
        name: "expert_id",
        using: "BTREE",
        fields: [
          { name: "expert_id" },
        ]
      },
    ]
  });
  }
}