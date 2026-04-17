import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_action_log extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true,
      },
      handler_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '处理器ID',
        references: {
          model: 'app_row_handlers',
          key: 'id',
        },
      },
      record_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '行ID',
        references: {
          model: 'mini_app_rows',
          key: 'id',
        },
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
      trigger_status: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '触发时的状态',
      },
      result_status: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: '执行后的状态',
      },
      success: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        comment: '是否成功',
      },
      output_data: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: '处理器输出的数据',
      },
      error_message: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '错误信息',
      },
      duration: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '执行耗时（毫秒）',
      },
      retry_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: '重试次数',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      },
    }, {
      sequelize,
      tableName: 'app_action_logs',
      timestamps: false,
      freezeTableName: true,
    });
  }
}
