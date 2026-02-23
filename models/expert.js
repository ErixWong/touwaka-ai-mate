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
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    context_threshold: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.70,
      comment: "上下文压缩阈值，Token >= 阈值 × context_size 时触发压缩"
    },
    temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.70
    },
    reflective_temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.30
    },
    top_p: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 1.00
    },
    frequency_penalty: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.00
    },
    presence_penalty: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.00
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
