import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class expert_skill extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    expert_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "专家ID",
      references: {
        model: 'experts',
        key: 'id'
      }
    },
    skill_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "技能ID",
      references: {
        model: 'skills',
        key: 'id'
      }
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      comment: "是否启用"
    },
    config: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "配置JSON"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'expert_skills',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "expert_id" },
          { name: "skill_id" },
        ]
      },
      {
        name: "idx_expert",
        using: "BTREE",
        fields: [
          { name: "expert_id" },
        ]
      },
      {
        name: "idx_skill",
        using: "BTREE",
        fields: [
          { name: "skill_id" },
        ]
      },
    ]
  });
  }
}
