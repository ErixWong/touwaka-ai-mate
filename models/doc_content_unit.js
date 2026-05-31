import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_content_unit extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "内容单元ID"
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
    parent_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "父单元ID(树结构)",
      references: {
        model: 'doc_content_units',
        key: 'id'
      }
    },
    unit_type: {
      type: DataTypes.ENUM('chapter','section','paragraph','chunk'),
      allowNull: false,
      comment: "单元类型"
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
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "位置序号"
    },
    level: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "层级深度"
    },
    path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "路径(如1.2.3)"
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
    tableName: 'doc_content_units',
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
        name: "idx_version_type_pos",
        using: "BTREE",
        fields: [
          { name: "version_id" },
          { name: "unit_type" },
          { name: "position" },
        ]
      },
      {
        name: "idx_version_parent_pos",
        using: "BTREE",
        fields: [
          { name: "version_id" },
          { name: "parent_id" },
          { name: "position" },
        ]
      },
      {
        name: "fk_unit_parent",
        using: "BTREE",
        fields: [
          { name: "parent_id" },
        ]
      },
    ]
  });
  }
}
