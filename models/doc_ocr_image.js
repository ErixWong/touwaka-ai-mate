import _sequelize from 'sequelize';
const { Model, Sequelize } = _sequelize;

export default class doc_ocr_image extends Model {
  static init(sequelize, DataTypes) {
    return super.init({
      id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        primaryKey: true,
        comment: 'OCR图片关系ID'
      },
      ocr_result_id: {
        type: DataTypes.STRING(32),
        allowNull: false,
        comment: 'OCR结果ID',
        references: {
          model: 'doc_ocr_results',
          key: 'id'
        }
      },
      attachment_id: {
        type: DataTypes.STRING(20),
        allowNull: false,
        comment: '图片附件ID',
        references: {
          model: 'attachments',
          key: 'id'
        }
      },
      filename: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: '原始文件名'
      },
      media_type: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'MIME类型'
      },
      sort_order: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: '排序'
      },
      referenced_in_markdown: {
        type: DataTypes.TINYINT,
        allowNull: false,
        defaultValue: 0,
        comment: '是否在markdown中被引用'
      },
      markdown_path: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'markdown中的原始引用路径'
      },
      line_number: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '引用所在行号'
      },
      start_offset: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '起始偏移'
      },
      end_offset: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: '结束偏移'
      },
      alt_text: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'alt文本'
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: '图片描述'
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
      tableName: 'doc_ocr_images',
      timestamps: false,
      freezeTableName: true,
      indexes: [
        {
          name: 'PRIMARY',
          unique: true,
          using: 'BTREE',
          fields: [{ name: 'id' }]
        },
        {
          name: 'idx_doc_ocr_image_result',
          using: 'BTREE',
          fields: [{ name: 'ocr_result_id' }, { name: 'sort_order' }]
        },
        {
          name: 'idx_doc_ocr_image_attachment',
          using: 'BTREE',
          fields: [{ name: 'attachment_id' }]
        }
      ]
    });
  }
}