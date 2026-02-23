import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class skill_tool extends Model {
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
      references: {
        model: 'skills',
        key: 'id'
      }
    },
    name: {
      type: DataTypes.STRING(64),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    type: {
      type: DataTypes.ENUM('http','script','builtin'),
      allowNull: true,
      defaultValue: "http"
    },
    usage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    command: {
      type: DataTypes.STRING(512),
      allowNull: true
    },
    endpoint: {
      type: DataTypes.STRING(512),
      allowNull: true
    },
    method: {
      type: DataTypes.STRING(16),
      allowNull: true
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
    tableName: 'skill_tools',
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
        name: "idx_skill_name",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "skill_id" },
          { name: "name" },
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
