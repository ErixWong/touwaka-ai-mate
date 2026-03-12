import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class kb_paragraph extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      primaryKey: true
    },
    section_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "所属节",
      references: {
        model: 'kb_sections',
        key: 'id'
      }
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "段落标题（可选）"
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "段落内容"
    },
    is_knowledge_point: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: 0,
      comment: "是否是知识点"
    },
    embedding: {
      type: "VECTOR(1024)",
      allowNull: true,
      comment: "向量（只有知识点才向量化）"
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "排序位置（同一节内的顺序）"
    },
    token_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "Token 数量"
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
    tableName: 'kb_paragraphs',
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
        name: "idx_paragraph_section",
        using: "BTREE",
        fields: [
          { name: "section_id" },
        ]
      },
      {
        name: "idx_paragraph_kp",
        using: "BTREE",
        fields: [
          { name: "is_knowledge_point" },
        ]
      },
      {
        name: "idx_paragraph_position",
        using: "BTREE",
        fields: [
          { name: "position" },
        ]
      },
    ]
  });
  }
}
