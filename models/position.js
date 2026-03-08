import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class position extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: '职位名称'
      },
      department_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: '所属部门'
      },
      is_manager: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
        comment: '是否为负责人职位'
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: '排序'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '职位描述'
      },
      status: {
        type: DataTypes.ENUM('active', 'inactive'),
        allowNull: true,
        defaultValue: 'active',
        comment: '状态'
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
      tableName: 'positions',
      timestamps: false,
      freezeTableName: true,
      indexes: [
        {
          name: 'idx_department',
          fields: ['department_id']
        },
        {
          name: 'idx_status',
          fields: ['status']
        }
      ]
    });
  }
}
