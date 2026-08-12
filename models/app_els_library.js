import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_els_library extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    owner_user_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    library_type: {
      type: DataTypes.ENUM('public','personal','shared'),
      allowNull: false,
      defaultValue: "personal"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'app_els_libraries',
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
        name: "idx_els_libraries_owner_user_id",
        using: "BTREE",
        fields: [
          { name: "owner_user_id" },
        ]
      },
      {
        name: "idx_els_libraries_library_type",
        using: "BTREE",
        fields: [
          { name: "library_type" },
        ]
      },
      {
        name: "idx_els_libraries_is_active",
        using: "BTREE",
        fields: [
          { name: "is_active" },
        ]
      },
    ]
  });
  }
}
