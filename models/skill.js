import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class skill extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    source_type: {
      type: DataTypes.ENUM('database','filesystem'),
      allowNull: true,
      defaultValue: "filesystem"
    },
    source_path: {
      type: DataTypes.STRING(256),
      allowNull: true
    },
    skill_md: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    index_js: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    config: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true
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
    },
    version: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    author: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    tags: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    source_url: {
      type: DataTypes.STRING(512),
      allowNull: true
    },
    security_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 100
    },
    security_warnings: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'skills',
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
    ]
  });
  }
}
