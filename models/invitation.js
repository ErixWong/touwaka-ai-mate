import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class invitation extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    code: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "邀请码",
      unique: "code"
    },
    creator_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建者用户ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    max_uses: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 5,
      comment: "最大使用次数"
    },
    used_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "已使用次数"
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "过期时间，NULL表示永不过期"
    },
    status: {
      type: DataTypes.ENUM('active','exhausted','expired','revoked'),
      allowNull: true,
      defaultValue: "active"
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
    tableName: 'invitations',
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
        name: "code",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "code" },
        ]
      },
      {
        name: "idx_code",
        using: "BTREE",
        fields: [
          { name: "code" },
        ]
      },
      {
        name: "idx_creator",
        using: "BTREE",
        fields: [
          { name: "creator_id" },
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
