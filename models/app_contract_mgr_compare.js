import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_contract_mgr_compare extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "A合同 mini_app_rows.id",
      references: {
        model: 'mini_app_rows',
        key: 'id'
      }
    },
    target_row_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "B合同 mini_app_rows.id",
      references: {
        model: 'mini_app_rows',
        key: 'id'
      }
    },
    compare_result: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "完整比对结果（results数组）"
    },
    summary_identical: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "一致章节数"
    },
    summary_modified: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "修改章节数"
    },
    summary_added: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "新增章节数"
    },
    summary_removed: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "删除章节数"
    },
    model_name: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "使用的模型名称"
    },
    duration_ms: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "比对耗时（毫秒）"
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
    tableName: 'app_contract_mgr_compares',
    timestamps: false,
    freezeTableName: true,
    indexes: [
      {
        name: "PRIMARY",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "row_id" },
        ]
      },
      {
        name: "idx_target",
        using: "BTREE",
        fields: [
          { name: "target_row_id" },
        ]
      },
      {
        name: "idx_modified",
        using: "BTREE",
        fields: [
          { name: "summary_modified" },
        ]
      },
    ]
  });
  }
}
