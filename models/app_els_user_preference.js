import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_els_user_preference extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: "uk_els_prefs_user_id"
    },
    selected_library_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    selected_notebook_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    default_tts_voice: {
      type: DataTypes.STRING(16),
      allowNull: true,
      defaultValue: "female"
    },
    default_tts_speed: {
      type: DataTypes.DECIMAL(3,1),
      allowNull: true,
      defaultValue: 1.0
    },
    daily_goal_reading: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1
    },
    daily_goal_review: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 5
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true
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
    tableName: 'app_els_user_preferences',
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
        name: "uk_els_prefs_user_id",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_els_prefs_selected_library",
        using: "BTREE",
        fields: [
          { name: "selected_library_id" },
        ]
      },
      {
        name: "idx_els_prefs_selected_notebook",
        using: "BTREE",
        fields: [
          { name: "selected_notebook_id" },
        ]
      },
    ]
  });
  }
}
