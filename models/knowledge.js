import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class knowledge extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true
      },
      kb_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'knowledge_bases',
          key: 'id'
        },
        comment: '所属知识库'
      },
      parent_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: 'knowledges',
          key: 'id'
        },
        comment: '父文章 ID（树状结构）'
      },
      title: {
        type: DataTypes.STRING(500),
        allowNull: false,
        comment: '文章标题'
      },
      summary: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'LLM 生成的摘要'
      },
      source_type: {
        type: DataTypes.ENUM('file', 'web', 'manual'),
        allowNull: true,
        defaultValue: 'manual',
        comment: '来源类型'
      },
      source_url: {
        type: DataTypes.STRING(1000),
        allowNull: true,
        comment: '来源 URL'
      },
      file_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: '原始文件存储路径'
      },
      status: {
        type: DataTypes.ENUM('pending', 'processing', 'ready', 'failed'),
        allowNull: true,
        defaultValue: 'pending',
        comment: '处理状态'
      },
      position: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 0,
        comment: '同级排序'
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
      tableName: 'knowledges',
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
          name: 'idx_knowledge_kb',
          using: 'BTREE',
          fields: [{ name: 'kb_id' }]
        },
        {
          name: 'idx_knowledge_parent',
          using: 'BTREE',
          fields: [{ name: 'parent_id' }]
        },
        {
          name: 'idx_knowledge_status',
          using: 'BTREE',
          fields: [{ name: 'status' }]
        }
      ]
    });
  }
}