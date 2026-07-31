import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_compare_item extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "比对明细ID"
    },
    run_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "比对任务ID",
      references: {
        model: 'doc_compare_runs',
        key: 'id'
      }
    },
    base_unit_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "基准内容单元ID",
      references: {
        model: 'doc_chunks',
        key: 'id'
      }
    },
    target_unit_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "目标内容单元ID",
      references: {
        model: 'doc_chunks',
        key: 'id'
      }
    },
    change_type: {
      type: DataTypes.ENUM('identical','modified','semantic_change','added','removed'),
      allowNull: false,
      comment: "变更类型"
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "变更摘要"
    },
    risk_level: {
      type: DataTypes.ENUM('none','low','medium','high'),
      allowNull: true,
      comment: "风险等级"
    },
    key_changes_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "关键变更"
    },
    evidence_unit_ids_json: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "依据内容单元IDs"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'doc_compare_items',
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
        name: "idx_run",
        using: "BTREE",
        fields: [
          { name: "run_id" },
        ]
      },
      {
        name: "idx_change_type",
        using: "BTREE",
        fields: [
          { name: "run_id" },
          { name: "change_type" },
        ]
      },
      {
        name: "fk_comp_items_base_chunk",
        using: "BTREE",
        fields: [
          { name: "base_unit_id" },
        ]
      },
      {
        name: "fk_comp_items_target_chunk",
        using: "BTREE",
        fields: [
          { name: "target_unit_id" },
        ]
      },
    ]
  });
  }
}
