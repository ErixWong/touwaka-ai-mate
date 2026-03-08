import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class kb_section extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      primaryKey: true
    },
    article_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "所属文章",
      references: {
        model: 'kb_articles',
        key: 'id'
      }
    },
    parent_id: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: "父节ID（自指向，形成无限层级）",
      references: {
        model: 'kb_sections',
        key: 'id'
      }
    },
    title: {
      type: DataTypes.STRING(500),
      allowNull: false,
      comment: "节标题"
    },
    level: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
      comment: "层级深度（1=章, 2=节, 3=小节...）"
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 0,
      comment: "排序位置（同级内的顺序）"
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
    tableName: 'kb_sections',
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
        name: "idx_section_article",
        using: "BTREE",
        fields: [
          { name: "article_id" },
        ]
      },
      {
        name: "idx_section_parent",
        using: "BTREE",
        fields: [
          { name: "parent_id" },
        ]
      },
      {
        name: "idx_section_level",
        using: "BTREE",
        fields: [
          { name: "level" },
        ]
      },
      {
        name: "idx_section_position",
        using: "BTREE",
        fields: [
          { name: "position" },
        ]
      },
    ]
  });
  }
}
