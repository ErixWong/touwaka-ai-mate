import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class expert extends Model {
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
    introduction: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    speaking_style: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    core_values: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    behavioral_guidelines: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    taboos: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    emotional_tone: {
      type: DataTypes.STRING(256),
      allowNull: true
    },
    expressive_model_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      references: {
        model: 'ai_models',
        key: 'id'
      }
    },
    reflective_model_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      references: {
        model: 'ai_models',
        key: 'id'
      }
    },
    prompt_template: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
    },
    avatar_base64: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "小头像Base64（日常使用，约2-5KB）"
    },
    avatar_large_base64: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "大头像Base64（对话框背景，约20-50KB）"
    },
    context_threshold: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.70,
      comment: "上下文压缩阈值，Token >= 阈值 × context_size 时触发压缩"
    },
    context_strategy: {
      type: DataTypes.ENUM('full','simple','minimal'),
      allowNull: true,
      defaultValue: "full",
      comment: "上下文组织策略：full=完整上下文，simple=简单上下文，minimal=Psyche精简上下文"
    },
    temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.70,
      comment: "Expressive模型温度"
    },
    reflective_temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.30,
      comment: "Reflective模型温度"
    },
    top_p: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 1.00,
      comment: "Top-p采样"
    },
    frequency_penalty: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.00,
      comment: "频率惩罚"
    },
    presence_penalty: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.00,
      comment: "存在惩罚"
    },
    knowledge_config: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "知识库配置（JSON格式）：{enabled, kb_id, top_k, threshold, max_tokens, style}"
    },
    max_tool_rounds: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "最大工具调用轮数（NULL表示使用系统默认，范围 1-50）"
    },
    psyche_config: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Psyche配置（JSON格式）：{max_tokens_ratio, reflection_lookback, enable_notes}"
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
    tableName: 'experts',
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
        name: "expressive_model_id",
        using: "BTREE",
        fields: [
          { name: "expressive_model_id" },
        ]
      },
      {
        name: "reflective_model_id",
        using: "BTREE",
        fields: [
          { name: "reflective_model_id" },
        ]
      },
      {
        name: "idx_active",
        using: "BTREE",
        fields: [
          { name: "is_active" },
        ]
      },
    ]
  });
  }
}
