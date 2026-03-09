import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class knowledge extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      primaryKey: true
    },
    kb_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      references: {
        model: 'knowledge_bases',
        key: 'id'
      }
    },
    parent_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "自关联，形成树状结构",
      references: {
        model: 'knowledges',
        key: 'id'
      }
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "LLM 生成的摘要"
    },
    source_type: {
      type: DataTypes.ENUM('file','web','manual'),
      allowNull: true,
      defaultValue: "manual"
    },
    source_url: {
      type: DataTypes.STRING(1000),
      allowNull: true
    },
    file_path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "原始文件存储路径"
    },
    status: {
      type: DataTypes.ENUM('pending','processing','ready','failed'),
      allowNull: true,
      defaultValue: "pending"
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "同级排序"
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
    tableName: 'knowledges',
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
        name: "idx_knowledge_kb",
        using: "BTREE",
        fields: [
          { name: "kb_id" },
        ]
      },
      {
        name: "idx_knowledge_parent",
        using: "BTREE",
        fields: [
          { name: "parent_id" },
        ]
      },
      {
        name: "idx_knowledge_status",
        using: "BTREE",
        fields: [
          { name: "status" },
        ]
      },
    ]
  });
  }
}
