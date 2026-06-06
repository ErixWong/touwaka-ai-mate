import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class document_chunk extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "分段ID"
    },
    revision_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所属版本ID",
      references: {
        model: 'document_revisions',
        key: 'id'
      }
    },
    chunk_type: {
      type: DataTypes.ENUM('paragraph','chunk'),
      allowNull: false,
      comment: "分段类型(两层结构)"
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "标题"
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "内容"
    },
    seq: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "顺序号"
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
    embedding_model_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "向量模型ID"
    },
    embedded_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "向量生成时间"
    },
    token_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Token数"
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: "扩展字段"
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
    tableName: 'document_chunks',
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
        name: "uk_revision_seq",
        unique: true,
        using: "BTREE",
        fields: [
          { name: "revision_id" },
          { name: "seq" },
        ]
      },
      {
        name: "idx_chunk_revision",
        using: "BTREE",
        fields: [
          { name: "revision_id" },
        ]
      },
      {
        name: "idx_chunk_emb_status",
        using: "BTREE",
        fields: [
          { name: "embedding_status" },
        ]
      },
    ]
  });
  }
}
