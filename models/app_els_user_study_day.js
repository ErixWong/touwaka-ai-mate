import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_els_user_study_day extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    study_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    completed_reading: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    completed_review: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    is_checked_in: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    streak_snapshot: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    first_completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: Sequelize.Sequelize.fn('current_timestamp')
    }
  }, {
    sequelize,
    tableName: 'app_els_user_study_days',
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
        name: "uk_els_user_study_days_user_date",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "user_id" },
          { name: "study_date" },
        ]
      },
      {
        name: "idx_els_user_study_days_study_date",
        using: "BTREE",
        fields: [
          { name: "study_date" },
        ]
      },
      {
        name: "idx_els_user_study_days_checked_in",
        using: "BTREE",
        fields: [
          { name: "is_checked_in" },
        ]
      },
    ]
  });
  }
}
