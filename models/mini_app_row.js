import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class mini_app_row extends Model {
  static init(sequelize, DataTypes) {
  return super.init({
    id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      primaryKey: true
    },
    app_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "小程序ID",
      references: {
        model: 'mini_apps',
        key: 'id'
      }
    },
    user_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      comment: "创建用户ID",
      references: {
        model: 'users',
        key: 'id'
      }
    },
    data: {
      type: DataTypes.TEXT('long'),
      allowNull: false,
      comment: "行数据（字段名→值的映射）",
      get() {
        const value = this.getDataValue('data');
        if (!value) return {};
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      },
      set(value) {
        if (typeof value === 'object') {
          this.setDataValue('data', JSON.stringify(value));
        } else {
          this.setDataValue('data', value || '{}');
        }
      }
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: "记录标题（冗余，便于列表展示）"
    },
    ai_extracted: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      comment: "是否由AI提取"
    },
    ai_confidence: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
      comment: "各字段的AI置信度",
      get() {
        const value = this.getDataValue('ai_confidence');
        if (!value) return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
      set(value) {
        if (value === null || value === undefined) {
          this.setDataValue('ai_confidence', null);
        } else if (typeof value === 'object') {
          this.setDataValue('ai_confidence', JSON.stringify(value));
        } else {
          this.setDataValue('ai_confidence', value);
        }
      }
    },
    version: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "版本号"
    },
    previous_version_id: {
      type: DataTypes.STRING(32),
      allowNull: true,
      comment: "上一版本ID"
    },
    revision: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1,
      comment: "数据版本号（乐观锁）"
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
    },
    _status: {
      type: DataTypes.VIRTUAL(DataTypes.STRING(64)),
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'mini_app_rows',
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
        name: "idx_app_user",
        using: "BTREE",
        fields: [
          { name: "app_id" },
          { name: "user_id" },
        ]
      },
      {
        name: "idx_created_at",
        using: "BTREE",
        fields: [
          { name: "created_at" },
        ]
      },
      {
        name: "user_id",
        using: "BTREE",
        fields: [
          { name: "user_id" },
        ]
      },
      {
        name: "idx_app_status",
        using: "BTREE",
        fields: [
          { name: "app_id" },
          { name: "_status" },
        ]
      },
    ]
  });
  }
}
