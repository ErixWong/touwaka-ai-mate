import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_tick_log extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true
      },
      registry_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: "关联 app_clock_registry.id",
        references: {
          model: 'app_clock_registry',
          key: 'id'
        }
      },
      app_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: "关联 mini_apps.id"
      },
      success: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: true
      },
      output_data: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: "JSON 输出"
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: "耗时(ms)"
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      }
    }, {
      sequelize,
      tableName: 'app_tick_log',
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
          name: "idx_registry",
          using: "BTREE",
          fields: [
            { name: "registry_id" },
          ]
        },
        {
          name: "idx_created",
          using: "BTREE",
          fields: [
            { name: "created_at" },
          ]
        },
      ]
    });
  }
}