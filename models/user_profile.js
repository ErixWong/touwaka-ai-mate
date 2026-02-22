import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class user_profile extends Model {
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
      references: {
        model: 'users',
        key: 'id'
      }
    },
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      references: {
        model: 'experts',
        key: 'id'
      }
    },
    preferred_name: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    introduction: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    background: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    first_met: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_active: {
      type: DataTypes.DATE,
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
    tableName: 'user_profiles',
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
        name: "uk_user_expert",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "user_id" },
          { name: "expert_id" },
        ]
      },
      {
        name: "idx_expert",
        using: "BTREE",
        fields: [
          { name: "expert_id" },
        ]
      },
      {
        name: "idx_last_active",
        using: "BTREE",
        fields: [
          { name: "last_active" },
        ]
      },
    ]
  });
  }
}
