import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_chunk extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "分块ID"
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
    chunk_type: {
      type: DataTypes.ENUM('chapter','section','paragraph','chunk'),
      allowNull: false,
      comment: "分块类型"
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
      comment: "全局序号"
    },
    chapter_title: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "所属章节标题"
    },
    section_title: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "所属节标题"
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
      comment: "Embedding模型ID"
    },
    embedded_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "向量生成时间"
    },
    token_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Token数量"
    },
    is_knowledge_point: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: "是否知识点"
    },
    metadata: {
      type: DataTypes.TEXT,
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
    tableName: 'doc_chunks',
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
        name: "idx_version_seq",
        using: "BTREE",
        fields: [
          { name: "version_id" },
          { name: "seq" },
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
