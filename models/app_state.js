import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_state extends Model {
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
      name: {
        type: DataTypes.STRING(64),
        allowNull: false,
        comment: '状态名（如pending_ocr）',
      },
      label: {
        type: DataTypes.STRING(128),
        allowNull: false,
        comment: '显示名（如待OCR）',
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: '流转顺序（0=初始）',
      },
      is_initial: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: 0,
        comment: '是否初始状态',
      },
      is_terminal: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: 0,
        comment: '是否终态',
      },
      is_error: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: 0,
        comment: '是否错误状态',
      },
      handler_id: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: '处理脚本ID',
        references: {
          model: 'app_row_handlers',
          key: 'id',
        },
      },
      success_next_state: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: '成功后转到什么状态',
      },
      failure_next_state: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: '失败后转到什么状态',
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      },
    }, {
      sequelize,
      tableName: 'app_state',
      timestamps: false,
      freezeTableName: true,
    });
  }
}
