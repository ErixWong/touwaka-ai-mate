import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class app_els_material extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    library_id: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    owner_user_id: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    source_type: {
      type: DataTypes.ENUM('news','passage','curated','user_upload'),
      allowNull: false
    },
    source_name: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    source_url: {
      type: DataTypes.STRING(512),
      allowNull: true
    },
    external_source_id: {
      type: DataTypes.STRING(128),
      allowNull: true
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    language: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: "en"
    },
    processing_status: {
      type: DataTypes.ENUM('processing','ready','rejected','failed'),
      allowNull: false,
      defaultValue: "processing"
    },
    status_reason: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    topic: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    difficulty_level: {
      type: DataTypes.ENUM('A1','A2','B1','B2','C1','C2'),
      allowNull: true
    },
    quiz_status: {
      type: DataTypes.ENUM('pending','ready','failed'),
      allowNull: false,
      defaultValue: "pending"
    },
    quiz_payload: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    cleaning_version: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    metadata: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    published_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    imported_at: {
      type: DataTypes.DATE,
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
    tableName: 'app_els_materials',
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
        name: "idx_els_materials_library_id",
        using: "BTREE",
        fields: [
          { name: "library_id" },
        ]
      },
      {
        name: "idx_els_materials_owner_user_id",
        using: "BTREE",
        fields: [
          { name: "owner_user_id" },
        ]
      },
      {
        name: "idx_els_materials_source_type",
        using: "BTREE",
        fields: [
          { name: "source_type" },
        ]
      },
      {
        name: "idx_els_materials_processing_status",
        using: "BTREE",
        fields: [
          { name: "processing_status" },
        ]
      },
      {
        name: "idx_els_materials_difficulty_level",
        using: "BTREE",
        fields: [
          { name: "difficulty_level" },
        ]
      },
      {
        name: "idx_els_materials_published_at",
        using: "BTREE",
        fields: [
          { name: "published_at" },
        ]
      },
      {
        name: "idx_els_materials_quiz_status",
        using: "BTREE",
        fields: [
          { name: "quiz_status" },
        ]
      },
      {
        name: "idx_els_materials_topic",
        using: "BTREE",
        fields: [
          { name: "topic" },
        ]
      },
    ]
  });
  }
}
