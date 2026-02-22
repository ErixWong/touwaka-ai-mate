import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class topic extends Model {
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
      allowNull: true,
      references: {
        model: 'experts',
        key: 'id'
      }
    },
    provider_name: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    model_name: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    title: {
      type: DataTypes.STRING(256),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    category: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('active','archived','deleted'),
      allowNull: true,
      defaultValue: "active"
    },
    message_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
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
    tableName: 'topics',
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
        name: "idx_user_status",
        using: "BTREE",
        fields: [
          { name: "user_id" },
          { name: "status" },
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
        name: "idx_updated",
        using: "BTREE",
        fields: [
          { name: "updated_at" },
        ]
      },
    ]
  });
  }
}
