import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_els_user_word extends Model {
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
    notebook_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    material_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    language: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "en"
    },
    word_text: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    word_lemma: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    phonetic: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    meaning: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    example_sentence: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    source_sentence: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    review_stage: {
      type: DataTypes.ENUM('D0','D1','D3','D7','D15','D30','D60','mastered'),
      allowNull: false,
      defaultValue: "D0"
    },
    next_review_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_review_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    wrong_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    consecutive_correct_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    is_in_wrong_bucket: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    is_mastered: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
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
    tableName: 'app_els_user_words',
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
        name: "uk_els_user_words_notebook_material_word",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "notebook_id" },
          { name: "material_id" },
          { name: "word_text" },
        ]
      },
      {
        name: "idx_els_user_words_user_id",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_els_user_words_notebook_id",
        using: "BTREE",
        fields: [
          { name: "notebook_id" },
        ]
      },
      {
        name: "idx_els_user_words_material_id",
        using: "BTREE",
        fields: [
          { name: "material_id" },
        ]
      },
      {
        name: "idx_els_user_words_language",
        using: "BTREE",
        fields: [
          { name: "language" },
        ]
      },
      {
        name: "idx_els_user_words_next_review_at",
        using: "BTREE",
        fields: [
          { name: "next_review_at" },
        ]
      },
      {
        name: "idx_els_user_words_review_stage",
        using: "BTREE",
        fields: [
          { name: "review_stage" },
        ]
      },
      {
        name: "idx_els_user_words_wrong_bucket",
        using: "BTREE",
        fields: [
          { name: "is_in_wrong_bucket" },
        ]
      },
      {
        name: "idx_els_user_words_is_mastered",
        using: "BTREE",
        fields: [
          { name: "is_mastered" },
        ]
      },
    ]
  });
  }
}
