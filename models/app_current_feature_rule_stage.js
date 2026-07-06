import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_current_feature_rule_stage extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "主键ID，使用 Utils.newID()"
    },
    rule_set_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所属规则集ID"
    },
    stage_code: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "阶段编码"
    },
    stage_name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "阶段名称"
    },
    stage_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "阶段顺序"
    },
    semantic_definition: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "语义定义"
    },
    stage_color: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "阶段颜色"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "创建时间"
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp'),
      comment: "更新时间"
    }
  }, {
    sequelize,
    tableName: 'app_current_feature_rule_stages',
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
        name: "idx_app_current_feature_rule_stages_rule_set_id",
        using: "BTREE",
        fields: [
          { name: "rule_set_id" },
        ]
      },
      {
        name: "idx_app_current_feature_rule_stages_stage_order",
        using: "BTREE",
        fields: [
          { name: "rule_set_id" },
          { name: "stage_order" },
        ]
      },
    ]
  });
  }
}
