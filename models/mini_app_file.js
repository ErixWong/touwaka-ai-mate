import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mini_app_file extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    record_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "关联记录ID",
      references: {
        model: 'mini_app_rows',
        key: 'id'
      }
    },
    app_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "小程序ID（冗余）"
    },
    attachment_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "附件ID（关联attachments表）",
      references: {
        model: 'attachments',
        key: 'id'
      }
    },
    field_name: {
      type: DataTypes.STRING(64),
      allowNull: true,
      comment: "对应的字段名"
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'mini_app_files',
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
        name: "idx_app",
        using: "BTREE",
        fields: [
          { name: "app_id" },
        ]
      },
      {
        name: "idx_attachment",
        using: "BTREE",
        fields: [
          { name: "attachment_id" },
        ]
      },
      {
        name: "record_id",
        using: "BTREE",
        fields: [
          { name: "record_id" },
        ]
      },
    ]
  });
  }
}
