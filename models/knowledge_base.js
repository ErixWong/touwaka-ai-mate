import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class knowledge_base extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        primaryKey: true
      },
      name: {
        type: DataTypes.STRING(255),
        allowNull: false
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      owner_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: '创建者 user_id'
      },
      embedding_model_id: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: '关联 ai_models 表'
      },
      embedding_dim: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: 1536
      },
      is_public: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
        comment: '预留，暂不使用'
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
      tableName: 'knowledge_bases',
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
          name: 'idx_kb_owner',
          using: 'BTREE',
          fields: [{ name: 'owner_id' }]
        },
        {
          name: 'idx_kb_public',
          using: 'BTREE',
          fields: [{ name: 'is_public' }]
        }
      ]
    });
  }
}
