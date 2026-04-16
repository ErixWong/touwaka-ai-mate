import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mini_app_role_access extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true,
      },
      app_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '小程序ID',
        references: {
          model: 'mini_apps',
          key: 'id',
        },
      },
      role_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '角色ID',
        references: {
          model: 'roles',
          key: 'id',
        },
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      },
    }, {
      sequelize,
      tableName: 'mini_app_role_access',
      timestamps: false,
      freezeTableName: true,
    });
  }
}
