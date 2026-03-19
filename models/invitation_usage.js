import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class invitation_usage extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    invitation_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "邀请ID",
      references: {
        model: 'invitations',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "注册用户ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    used_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'invitation_usages',
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
        name: "idx_invitation",
        using: "BTREE",
        fields: [
          { name: "invitation_id" },
        ]
      },
      {
        name: "idx_user",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
    ]
  });
  }
}
