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
      }
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "Markdown 格式"
    },
    context: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "上下文信息（用于向量化）"
    },
    embedding: {
      type: "VECTOR(1024)",
      allowNull: true,
      comment: "向量（1024维）"
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
    },
    token_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0
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
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "idx_kp_knowledge",
        using: "BTREE",
        fields: [
          { name: "knowledge_id" },
        ]
      },
    ]
  });
  }
}
