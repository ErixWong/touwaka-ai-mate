import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_embedding extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "向量ID"
    },
    content_unit_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "内容单元ID",
      references: {
        model: 'doc_content_units',
        key: 'id'
      }
    },
    version_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "版本ID",
      references: {
        model: 'doc_versions',
        key: 'id'
      }
    },
    document_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "文档ID",
      references: {
        model: 'doc_documents',
        key: 'id'
      }
    },
    embedding_model_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "Embedding模型ID"
    },
    embedding_dim: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "向量维度"
    },
    embedding_vector: {
      type: "VECTOR(1536)",
      allowNull: true,
      comment: "向量数据"
    },
    embedding_status: {
      type: DataTypes.ENUM('pending','processing','ready','error'),
      allowNull: false,
      defaultValue: "pending",
      comment: "向量状态"
    },
    embedded_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "向量生成时间"
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
    tableName: 'doc_embeddings',
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
        name: "idx_version_emb_status",
        using: "BTREE",
        fields: [
          { name: "version_id" },
          { name: "embedding_status" },
        ]
      },
      {
        name: "idx_doc_model",
        using: "BTREE",
        fields: [
          { name: "document_id" },
          { name: "embedding_model_id" },
        ]
      },
      {
        name: "fk_emb_unit",
        using: "BTREE",
        fields: [
          { name: "content_unit_id" },
        ]
      },
    ]
  });
  }
}
