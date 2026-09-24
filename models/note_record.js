import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class note_record extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    scope: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "run"
    },
    scope_ref: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    note_key: {
      type: DataTypes.STRING(191),
      allowNull: false
    },
    record: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    record_version: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    expires_at: {
      type: DataTypes.BIGINT,
      allowNull: true
    },
    created_at: {
      type: DataTypes.BIGINT,
      allowNull: false
    },
    updated_at: {
      type: DataTypes.BIGINT,
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'note_record',
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
        name: "uk_scope_ref_key",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "scope_ref" },
          { name: "note_key" },
        ]
      },
      {
        name: "idx_expires_at",
        using: "BTREE",
        fields: [
          { name: "expires_at" },
        ]
      },
    ]
  });
  }
}
