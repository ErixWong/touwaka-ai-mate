import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_current_feature_rule_set extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "主键ID，使用 Utils.newID()"
    },
    rule_set_name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      comment: "规则集名称"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "规则集描述"
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "是否默认规则集"
    },
    is_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      comment: "是否启用"
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "创建人ID"
    },
    updated_by: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "更新人ID"
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
    tableName: 'app_current_feature_rule_sets',
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
        name: "idx_app_current_feature_rule_sets_default",
        using: "BTREE",
        fields: [
          { name: "is_default" },
        ]
      },
      {
        name: "idx_app_current_feature_rule_sets_enabled",
        using: "BTREE",
        fields: [
          { name: "is_enabled" },
        ]
      },
    ]
  });
  }
}
