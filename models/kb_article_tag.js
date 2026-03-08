import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class kb_article_tag extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true
      },
      article_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: 'kb_articles',
          key: 'id'
        },
        comment: '文章ID'
      },
      tag_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        references: {
          model: 'kb_tags',
          key: 'id'
        },
        comment: '标签ID'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      }
    }, {
      sequelize,
      tableName: 'kb_article_tags',
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
          name: 'uk_article_tag',
          unique: true,
          using: 'BTREE',
          fields: [{ name: 'article_id' }, { name: 'tag_id' }]
        },
        {
          name: 'idx_at_article',
          using: 'BTREE',
          fields: [{ name: 'article_id' }]
        },
        {
          name: 'idx_at_tag',
          using: 'BTREE',
          fields: [{ name: 'tag_id' }]
        }
      ]
    });
  }
}
