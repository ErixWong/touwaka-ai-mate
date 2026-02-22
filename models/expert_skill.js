import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class expert_skill extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      references: {
        model: 'experts',
        key: 'id'
      }
    },
    skill_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      references: {
        model: 'skills',
        key: 'id'
      }
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    },
    config: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'expert_skills',
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
        name: "uk_expert_skill",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "expert_id" },
          { name: "skill_id" },
        ]
      },
      {
        name: "skill_id",
        using: "BTREE",
        fields: [
          { name: "skill_id" },
        ]
      },
    ]
  });
  }
}
