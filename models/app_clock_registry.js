import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_clock_registry extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true
      },
      app_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: "关联 mini_apps.id",
        references: {
          model: 'mini_apps',
          key: 'id'
        }
      },
      tick_script: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: "自定义脚本名，空则用默认 tick"
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: true
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      }
    }, {
      sequelize,
      tableName: 'app_clock_registry',
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
          name: "idx_active",
          using: "BTREE",
          fields: [
            { name: "is_active" },
          ]
        },
      ]
    });
  }
}