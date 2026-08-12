import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_els_user_review extends Model {
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
    word_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    material_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    session_id: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    review_bucket: {
      type: DataTypes.ENUM('today','new','wrong'),
      allowNull: false
    },
    review_type: {
      type: DataTypes.ENUM('meaning_choice','listen_pick','sentence_fill'),
      allowNull: false
    },
    question_payload: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    user_answer: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    correct_answer: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_correct: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    self_rating: {
      type: DataTypes.ENUM('easy','normal','hard','forgot'),
      allowNull: true
    },
    stage_before: {
      type: DataTypes.ENUM('D0','D1','D3','D7','D15','D30','D60','mastered'),
      allowNull: true
    },
    stage_after: {
      type: DataTypes.ENUM('D0','D1','D3','D7','D15','D30','D60','mastered'),
      allowNull: true
    },
    answered_at: {
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
    tableName: 'app_els_user_reviews',
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
        name: "idx_els_user_reviews_user_id",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_els_user_reviews_word_id",
        using: "BTREE",
        fields: [
          { name: "word_id" },
        ]
      },
      {
        name: "idx_els_user_reviews_material_id",
        using: "BTREE",
        fields: [
          { name: "material_id" },
        ]
      },
      {
        name: "idx_els_user_reviews_bucket",
        using: "BTREE",
        fields: [
          { name: "review_bucket" },
        ]
      },
      {
        name: "idx_els_user_reviews_answered_at",
        using: "BTREE",
        fields: [
          { name: "answered_at" },
        ]
      },
      {
        name: "idx_els_user_reviews_session_id",
        using: "BTREE",
        fields: [
          { name: "session_id" },
        ]
      },
    ]
  });
  }
}
