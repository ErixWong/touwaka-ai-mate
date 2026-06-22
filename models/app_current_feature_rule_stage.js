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
    expected_signal_features: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "期望信号特征，可为 JSON 文本"
    },
    required: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "是否必选阶段"
    },
    allow_repeat: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "是否允许重复"
    },
    allow_overlap: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "是否允许与其他阶段重叠"
    },
    min_duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "最小时长毫秒"
    },
    max_duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "最大时长毫秒"
    },
    notes: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "备注"
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
