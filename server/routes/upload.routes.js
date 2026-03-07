/**
 * Upload Routes - 图片上传路由
 */

import Router from '@koa/router';
import multer from '@koa/multer';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads', 'temp');
    // 确保目录存在
    const fs = await import('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

export default (controller) => {
  const router = new Router({ prefix: '/api/upload' });

  // 上传图片
  router.post('/image', upload.single('image'), controller.uploadImage.bind(controller));

  return router;
};
