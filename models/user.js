import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class user extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    username: {
      type: DataTypes.STRING(32),
      allowNull: true,
      unique: "username"
    },
    email: {
      type: DataTypes.STRING(256),
      allowNull: true,
      unique: "email"
    },
    password_hash: {
      type: DataTypes.STRING(256),
      allowNull: true
    },
    nickname: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    avatar: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    gender: {
      type: DataTypes.STRING(16),
      allowNull: true,
      comment: "性别：male\/female\/other"
    },
    birthday: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      comment: "生日"
    },
    occupation: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "职业"
    },
    location: {
      type: DataTypes.STRING(128),
      allowNull: true,
      comment: "所在地"
    },
    status: {
      type: DataTypes.ENUM('active','inactive','banned'),
      allowNull: true,
      defaultValue: "active"
    },
    preferences: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true
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
    tableName: 'users',
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
        name: "username",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "username" },
        ]
      },
      {
        name: "email",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "email" },
        ]
      },
      {
        name: "idx_username",
        using: "BTREE",
        fields: [
          { name: "username" },
        ]
      },
      {
        name: "idx_email",
        using: "BTREE",
        fields: [
          { name: "email" },
        ]
      },
      {
        name: "idx_status",
        using: "BTREE",
        fields: [
          { name: "status" },
        ]
      },
    ]
  });
  }
}
