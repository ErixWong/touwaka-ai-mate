import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class skill_tool extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    skill_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    name: {
      type: DataTypes.STRING(64),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    parameters: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "JSON Schema 格式的参数定义"
    },
    script_path: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: "index.js",
      comment: "工具入口脚本路径（相对于技能目录）"
    },
    is_resident: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否驻留进程：0=普通工具，1=驻留工具"
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
    tableName: 'skill_tools',
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
        name: "idx_skill_name",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "skill_id" },
          { name: "name" },
        ]
      },
      {
        name: "idx_skill_id",
        using: "BTREE",
        fields: [
          { name: "skill_id" },
        ]
      },
    ]
  });
  }
}
