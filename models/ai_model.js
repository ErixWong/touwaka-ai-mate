import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class ai_model extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    model_name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "API调用使用的模型标识符"
    },
    model_type: {
      type: DataTypes.ENUM('text','multimodal','embedding'),
      allowNull: true,
      defaultValue: "text",
      comment: "模型类型: text=文本, multimodal=多模态, embedding=向量化"
    },
    provider_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      references: {
        model: 'providers',
        key: 'id'
      }
    },
    max_tokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 4096
    },
    max_output_tokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 4096,
      comment: "每次请求最多生成的 token 数"
    },
    embedding_dim: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "向量化模型的嵌入维度（仅 embedding 类型模型使用）"
    },
    cost_per_1k_input: {
      type: DataTypes.DECIMAL(10,6),
      allowNull: true,
      defaultValue: 0.000000
    },
    cost_per_1k_output: {
      type: DataTypes.DECIMAL(10,6),
      allowNull: true,
      defaultValue: 0.000000
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
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
    tableName: 'ai_models',
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
        name: "idx_provider",
        using: "BTREE",
        fields: [
          { name: "provider_id" },
        ]
      },
      {
        name: "idx_active",
        using: "BTREE",
        fields: [
          { name: "is_active" },
        ]
      },
      {
        name: "idx_model_type",
        using: "BTREE",
        fields: [
          { name: "model_type" },
        ]
      },
    ]
  });
  }
}
