import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class system_setting extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    setting_key: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: "setting_key"
    },
    setting_value: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    value_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "string"
    },
    description: {
      type: DataTypes.STRING(500),
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
    tableName: 'system_settings',
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
        name: "setting_key",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "setting_key" },
        ]
      },
    ]
  });
  }
}
