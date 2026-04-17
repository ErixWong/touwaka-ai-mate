import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mini_app_row extends Model {
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
      user_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '创建用户ID',
        references: {
          model: 'users',
          key: 'id',
        },
      },
      data: {
        type: DataTypes.JSON,
        allowNull: false,
        comment: '行数据（字段名→值的映射）',
      },
      title: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: '记录标题（冗余，便于列表展示）',
      },
      ai_extracted: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: 0,
        comment: '是否由AI提取',
      },
      ai_confidence: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: '各字段的AI置信度',
      },
      version: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: '版本号',
      },
      previous_version_id: {
        type: DataTypes.STRING(32),
        allowNull: true,
        comment: '上一版本ID',
      },
      revision: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
        comment: '数据版本号（乐观锁）',
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
      tableName: 'mini_app_rows',
      timestamps: false,
      freezeTableName: true,
    });
  }
}
