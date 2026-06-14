import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class document_outline extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true,
        comment: '章节提取结果ID'
      },
      revision_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '所属版本ID',
        references: {
          model: 'document_revisions',
          key: 'id'
        }
      },
      title: {
        type: DataTypes.STRING(500),
        allowNull: false,
        comment: '章节标题'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '章节摘要说明'
      },
      seq: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: '顺序号'
      },
      from_line: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '起始行号'
      },
      to_line: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '结束行号'
      },
      original_text: {
        type: DataTypes.TEXT('long'),
        allowNull: true,
        comment: '对应原文片段'
      },
      text_hash: {
        type: DataTypes.STRING(128),
        allowNull: true,
        comment: '文本哈希'
      },
      byte_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '字节数'
      },
      token_count: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Token数'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      },
      updated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      }
    }, {
      sequelize,
      tableName: 'document_outlines',
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
          name: 'uk_outline_revision_seq',
          unique: true,
          using: 'BTREE',
          fields: [{ name: 'revision_id' }, { name: 'seq' }]
        },
        {
          name: 'idx_outline_revision',
          using: 'BTREE',
          fields: [{ name: 'revision_id' }]
        }
      ]
    });
  }
}
