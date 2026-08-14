import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_collection extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true,
      comment: "集合ID"
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: "集合名称"
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "集合描述"
    },
    owner_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "所有者ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    created_by: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建者ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    department_id: {
      type: DataTypes.STRING(20),
      allowNull: false,
      comment: "所属部门ID",
      references: {
        model: 'departments',
        key: 'id'
      }
    },
    visibility: {
      type: DataTypes.ENUM('private','department','public'),
      allowNull: false,
      defaultValue: "private",
      comment: "可见范围"
    },
    department_scope: {
      type: DataTypes.ENUM('self','self_and_descendants'),
      allowNull: true,
      defaultValue: "self",
      comment: "部门范围(仅department可见时生效)"
    },
    embedding_model_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "嵌入模型ID",
      references: {
        model: 'ai_models',
        key: 'id'
      }
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
    tableName: 'doc_collections',
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
        name: "idx_coll_owner",
        using: "BTREE",
        fields: [
          { name: "owner_id" },
        ]
      },
      {
        name: "idx_coll_dept_vis",
        using: "BTREE",
        fields: [
          { name: "department_id" },
          { name: "visibility" },
        ]
      },
      {
        name: "idx_coll_created_by",
        using: "BTREE",
        fields: [
          { name: "created_by" },
        ]
      },
      {
        name: "fk_coll_emb_model",
        using: "BTREE",
        fields: [
          { name: "embedding_model_id" },
        ]
      },
    ]
  });
  }
}
