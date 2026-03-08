import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class kb_tag extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true
      },
      kb_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: 'knowledge_bases',
          key: 'id'
        },
        comment: '所属知识库'
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: '标签名'
      },
      description: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: '标签描述'
      },
      article_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: '关联文章数（缓存）'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      }
    }, {
      sequelize,
      tableName: 'kb_tags',
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
          name: 'uk_kb_tag',
          unique: true,
          using: 'BTREE',
          fields: [{ name: 'kb_id' }, { name: 'name' }]
        },
        {
          name: 'idx_tag_kb',
          using: 'BTREE',
          fields: [{ name: 'kb_id' }]
        }
      ]
    });
  }
}
