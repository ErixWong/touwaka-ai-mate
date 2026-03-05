import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class knowledge_point extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true
      },
      knowledge_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: 'knowledges',
          key: 'id'
        },
        comment: '所属文章'
      },
      title: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: '知识点标题'
      },
      content: {
        type: DataTypes.TEXT('medium'),
        allowNull: false,
        comment: 'Markdown 格式内容'
      },
      context: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '上下文信息（用于向量化）'
      },
      embedding: {
        type: DataTypes.BLOB,
        allowNull: true,
        comment: '向量（JSON 序列化）'
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: '排序位置'
      },
      token_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: 'Token 数量'
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
      tableName: 'knowledge_points',
      timestamps: false,
      freezeTableName: true,
      indexes: [
        {
          name: 'PRIMARY',
          unique: true,
          using: 'BTREE',
          fields: [{ name: 'id' }]
        },
        {
          name: 'idx_kp_knowledge',
          using: 'BTREE',
          fields: [{ name: 'knowledge_id' }]
        }
      ]
    });
  }
}