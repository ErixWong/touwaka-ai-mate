import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class kb_article extends Model {
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
      title: {
        type: DataTypes.STRING(500),
        allowNull: false,
        comment: '文章标题'
      },
      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '文章摘要'
      },
      source_type: {
        type: DataTypes.ENUM('upload', 'url', 'manual'),
        allowNull: true,
        defaultValue: 'manual',
        comment: '来源类型：upload/url/manual'
      },
      source_url: {
        type: DataTypes.STRING(1000),
        allowNull: true,
        comment: '来源URL'
      },
      file_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: '本地文件路径'
      },
      status: {
        type: DataTypes.ENUM('pending', 'processing', 'ready', 'error'),
        allowNull: true,
        defaultValue: 'pending',
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
      tableName: 'kb_articles',
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
          name: 'idx_article_kb',
          using: 'BTREE',
          fields: [{ name: 'kb_id' }]
        },
        {
          name: 'idx_article_status',
          using: 'BTREE',
          fields: [{ name: 'status' }]
        }
      ]
    });
  }
}
