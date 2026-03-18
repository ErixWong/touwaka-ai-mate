import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class assistant extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    assistant_type: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "显示名称"
    },
    icon: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "图标"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "能力描述"
    },
    model_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "关联 ai_models.id"
    },
    prompt_template: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "系统提示词模板"
    },
    max_tokens: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 4096
    },
    temperature: {
      type: DataTypes.DECIMAL(3,2),
      allowNull: true,
      defaultValue: 0.70
    },
    estimated_time: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 30,
      comment: "预估执行时间（秒）"
    },
    timeout: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 120,
      comment: "超时时间（秒）"
    },
    tool_name: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "工具名称，如 ocr_analyze"
    },
    tool_description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "工具描述"
    },
    tool_parameters: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "JSON Schema 格式的参数定义"
    },
    can_use_skills: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否允许助理调用技能"
    },
    execution_mode: {
      type: DataTypes.ENUM('direct','llm'),
      allowNull: true,
      defaultValue: "llm",
      comment: "执行模式"
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      comment: "是否启用"
    },
    is_builtin: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否为内置助理（不可删除）"
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
    tableName: 'assistants',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "assistant_type" },
        ]
      },
      {
        name: "idx_assistant_active",
        using: "BTREE",
        fields: [
          { name: "is_active" },
        ]
      },
      {
        name: "idx_assistant_mode",
        using: "BTREE",
        fields: [
          { name: "execution_mode" },
        ]
      },
      {
        name: "idx_assistant_builtin",
        using: "BTREE",
        fields: [
          { name: "is_builtin" },
        ]
      },
    ]
  });
  }
}
