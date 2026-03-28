import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class knowledge_basis extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    visibility: {
      type: DataTypes.ENUM('owner','department','all'),
      allowNull: true,
      defaultValue: "owner",
      comment: "公开级别：owner=仅管理员, department=部门可见, all=全员可见"
    },
    owner_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "知识库管理员ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    creator_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "",
      comment: "创建者ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    embedding_model_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: "关联 ai_models 表",
      references: {
        model: 'ai_models',
        key: 'id'
      }
    },
    embedding_dim: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1536
    },
    is_public: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "预留，暂不使用"
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
    tableName: 'knowledge_bases',
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
        name: "embedding_model_id",
        using: "BTREE",
        fields: [
          { name: "embedding_model_id" },
        ]
      },
      {
        name: "idx_kb_owner",
        using: "BTREE",
        fields: [
          { name: "owner_id" },
        ]
      },
      {
        name: "idx_kb_public",
        using: "BTREE",
        fields: [
          { name: "is_public" },
        ]
      },
      {
        name: "idx_kb_visibility",
        using: "BTREE",
        fields: [
          { name: "visibility" },
        ]
      },
      {
        name: "idx_kb_creator",
        using: "BTREE",
        fields: [
          { name: "creator_id" },
        ]
      },
    ]
  });
  }
}
