import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class knowledge_relation extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true
      },
      source_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'knowledge_points',
          key: 'id'
        },
        comment: '源知识点'
      },
      target_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: 'knowledge_points',
          key: 'id'
        },
        comment: '目标知识点'
      },
      relation_type: {
        type: DataTypes.ENUM('depends_on', 'references', 'related_to', 'contradicts', 'extends', 'example_of'),
        allowNull: false,
        comment: '关系类型'
      },
      confidence: {
        type: DataTypes.DECIMAL(3, 2),
        allowNull: true,
        defaultValue: 1.00,
        comment: 'LLM 置信度 (0-1)'
      },
      created_by: {
        type: DataTypes.ENUM('llm', 'manual'),
        allowNull: true,
        defaultValue: 'llm',
        comment: '创建方式'
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.fn('current_timestamp')
      }
    }, {
      sequelize,
      tableName: 'knowledge_relations',
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
          name: 'unique_relation',
          unique: true,
          using: 'BTREE',
          fields: [{ name: 'source_id' }, { name: 'target_id' }, { name: 'relation_type' }]
        },
        {
          name: 'idx_kr_source',
          using: 'BTREE',
          fields: [{ name: 'source_id' }]
        },
        {
          name: 'idx_kr_target',
          using: 'BTREE',
          fields: [{ name: 'target_id' }]
        },
        {
          name: 'idx_kr_type',
          using: 'BTREE',
          fields: [{ name: 'relation_type' }]
        }
      ]
    });
  }
}