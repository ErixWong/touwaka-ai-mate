/**
 * Upload Controller - 图片上传控制器
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'images');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

class UploadController {
  /**
   * 上传图片
   */
  async uploadImage(ctx) {
    try {
      const file = ctx.file;

      if (!file) {
        ctx.error('请选择要上传的图片', 400);
        return;
      }

      // 检查文件类型
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        ctx.error('仅支持 jpg、png、gif、webp 格式的图片', 400);
        return;
      }

      // 生成唯一文件名
      const ext = path.extname(file.originalname);
      const filename = `${uuidv4()}${ext}`;
      const filepath = path.join(UPLOAD_DIR, filename);

      // 移动文件
      fs.renameSync(file.path, filepath);

      // 返回访问 URL
      const baseUrl = `${ctx.protocol}://${ctx.host}`;
      const url = `${baseUrl}/uploads/images/${filename}`;

      ctx.success({
        url,
        filename,
        size: file.size,
      });
    } catch (error) {
      logger.error('图片上传失败:', error.message);
      ctx.error('图片上传失败', 500);
    }
  }
}

export default new UploadController();
