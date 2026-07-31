import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_standard_anchored_section extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    standard_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所属标准 app_standard.id",
      references: {
        model: 'app_standard',
        key: 'id'
      }
    },
    revision_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "来源版本 document_revisions.id"
    },
    outline_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "来源 section document_outlines.id"
    },
    anchored_text: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "插入 <document_id+revision_id(+outline_id)> 锚点后的文本"
    },
    source_text_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      comment: "对齐 document_outlines.text_hash，不符则副本失效"
    },
    anchor_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "本 section 内锚点数量"
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
    tableName: 'app_standard_anchored_section',
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
        name: "uk_anchored_section",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "revision_id" },
          { name: "outline_id" },
        ]
      },
      {
        name: "idx_standard",
        using: "BTREE",
        fields: [
          { name: "standard_id" },
        ]
      },
    ]
  });
  }
}
