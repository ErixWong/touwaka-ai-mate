import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_row_handler extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '脚本名称',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      handler: {
        type: DataTypes.STRING(255),
        allowNull: false,
        comment: '处理函数路径',
      },
      handler_function: {
        type: DataTypes.STRING(128),
        allowNull: true,
        defaultValue: 'process',
        comment: '处理函数名',
      },
      concurrency: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 3,
        comment: '最大并发数',
      },
      timeout: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 60,
        comment: '超时时间（秒）',
      },
      max_retries: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 2,
        comment: '最大重试次数',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: 1,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      },
    }, {
      sequelize,
      tableName: 'app_row_handlers',
      timestamps: false,
      freezeTableName: true,
    });
  }
}
