import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mini_app extends Model {
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
        comment: '小程序/表名称',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      icon: {
        type: DataTypes.STRING(16),
        allowNull: true,
        defaultValue: '📱',
        comment: '图标（emoji）',
      },
      type: {
        type: DataTypes.ENUM('document', 'workflow', 'data', 'utility'),
        allowNull: false,
        comment: '类型',
      },
      component: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: '前端组件名，NULL=使用GenericMiniApp',
      },
      fields: {
        type: DataTypes.JSON,
        allowNull: false,
        comment: '字段定义列表',
      },
      views: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: '视图配置',
      },
      config: {
        type: DataTypes.JSON,
        allowNull: true,
        comment: '功能配置',
      },
      visibility: {
        type: DataTypes.ENUM('owner', 'department', 'all', 'role'),
        allowNull: true,
        defaultValue: 'all',
        comment: '可见范围',
      },
      owner_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: 'App管理员',
        references: {
          model: 'users',
          key: 'id',
        },
      },
      creator_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '创建者',
        references: {
          model: 'users',
          key: 'id',
        },
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: '排序',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: 1,
        comment: '是否启用',
      },
      revision: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1,
        comment: '版本号',
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
      tableName: 'mini_apps',
      timestamps: false,
      freezeTableName: true,
    });
  }
}
