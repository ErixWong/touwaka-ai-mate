/**
 * Task Routes - 任务工作空间路由
 *
 * 关系：messages → topics → tasks
 */

import Router from '@koa/router';
import { authenticate } from '../middlewares/auth.js';
import multer from '@koa/multer';
import path from 'path';
import { createReadStream } from 'fs';
import fs from 'fs/promises';

// 工作空间根目录
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

// 允许的文件类型
const ALLOWED_FILE_TYPES = [
  '.pdf', '.doc', '.docx', '.txt', '.md', '.csv', '.xlsx', '.xls',
  '.ppt', '.pptx', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.json'
];

// 创建上传中间件工厂函数
// 注意：subdir 通过 FormData 传递，multer 会将其解析到 ctx.request.body
const createUploadMiddleware = () => {
  // 预配置 multer（不指定固定目录，在 controller 中处理）
  const upload = multer({
    storage: multer.memoryStorage(), // 使用内存存储，在 controller 中写入文件
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_FILE_TYPES.includes(ext)) {
        return cb(new Error(`不支持的文件类型: ${ext}`), false);
      }
      cb(null, true);
    },
  });
  
  return upload.single('file');
};

export default (controller) => {
  const router = new Router({ prefix: '/api/tasks' });

  // 复杂查询任务列表（需要认证）
  router.post('/query', authenticate(), controller.query.bind(controller));

  // 获取任务列表（需要认证）
  router.get('/', authenticate(), controller.list.bind(controller));

  // 创建任务（需要认证）
  router.post('/', authenticate(), controller.create.bind(controller));

  // 获取任务详情（需要认证）
  router.get('/:id', authenticate(), controller.get.bind(controller));

  // 更新任务（需要认证）
  router.put('/:id', authenticate(), controller.update.bind(controller));

  // 删除任务（需要认证）
  router.delete('/:id', authenticate(), controller.delete.bind(controller));

  // 进入任务（需要认证）- 使用 POST 因为会改变用户状态
  router.post('/:id/enter', authenticate(), controller.enter.bind(controller));

  // 获取工作空间文件列表（需要认证）
  router.get('/:id/files', authenticate(), controller.listFiles.bind(controller));

  // 上传文件到工作空间（需要认证，只能上传到 input/ 目录）
  // 使用 Controller 处理，中间件只负责 multer 配置
  router.post(
    '/:id/files', 
    authenticate(), 
    createUploadMiddleware(),
    controller.uploadFile.bind(controller)
  );

  // 下载文件（需要认证）
  router.get('/:id/files/download', authenticate(), async (ctx) => {
    try {
      const { id } = ctx.params;
      const { path: filePath } = ctx.query;

      if (!filePath) {
        ctx.error('文件路径不能为空');
        return;
      }

      // 获取任务信息
      controller.ensureModel();
      const task = await controller.Task.findOne({
        where: { id },
        raw: true,
      });

      if (!task) {
        ctx.error('任务不存在', 404);
        return;
      }

      // 检查权限
      if (task.created_by !== ctx.state.userId) {
        ctx.error('无权限访问此任务', 403);
        return;
      }

      // 构建完整文件路径
      const fullPath = path.join(WORKSPACE_ROOT, task.workspace_path, filePath);
      
      // 安全检查：确保路径在工作空间内
      const resolvedPath = path.resolve(fullPath);
      const workspacePath = path.resolve(WORKSPACE_ROOT, task.workspace_path);
      if (!resolvedPath.startsWith(workspacePath)) {
        ctx.error('非法路径访问', 403);
        return;
      }

      // 检查文件是否存在
      try {
        await fs.access(resolvedPath);
      } catch {
        ctx.error('文件不存在', 404);
        return;
      }

      // 设置响应头并发送文件（使用 ES module import）
      ctx.attachment(path.basename(filePath));
      ctx.body = createReadStream(resolvedPath);
    } catch (error) {
      ctx.error('文件下载失败', 500);
    }
  });

  // 删除文件（需要认证，只能删除 input 目录下的文件）
  router.delete('/:id/files', authenticate(), async (ctx) => {
    try {
      const { id } = ctx.params;
      const { path: filePath } = ctx.query;

      if (!filePath) {
        ctx.error('文件路径不能为空');
        return;
      }

      // 统一路径分隔符（Windows 反斜杠转正斜杠），解决跨平台兼容问题
      const normalizedPath = filePath.replace(/\\/g, '/');
      
      // 只允许删除 input 目录下的文件
      if (!normalizedPath.startsWith('input/')) {
        ctx.error('只能删除 input 目录下的文件', 403);
        return;
      }

      // 获取任务信息
      controller.ensureModel();
      const task = await controller.Task.findOne({
        where: { id },
        raw: true,
      });

      if (!task) {
        ctx.error('任务不存在', 404);
        return;
      }

      // 检查权限
      if (task.created_by !== ctx.state.userId) {
        ctx.error('无权限访问此任务', 403);
        return;
      }

      // 构建完整文件路径
      const fullPath = path.join(WORKSPACE_ROOT, task.workspace_path, filePath);

      // 安全检查：确保路径在工作空间内
      const resolvedPath = path.resolve(fullPath);
      const workspacePath = path.resolve(WORKSPACE_ROOT, task.workspace_path);
      if (!resolvedPath.startsWith(workspacePath)) {
        ctx.error('非法路径访问', 403);
        return;
      }

      // 检查文件是否存在
      try {
        const stats = await fs.stat(resolvedPath);
        if (!stats.isFile()) {
          ctx.error('只能删除文件', 400);
          return;
        }
      } catch {
        ctx.error('文件不存在', 404);
        return;
      }

      // 删除文件
      await fs.unlink(resolvedPath);

      ctx.success({ message: '文件删除成功' });
    } catch (error) {
      ctx.error('文件删除失败', 500);
    }
  });

  // 保存文件内容（需要认证，只能保存到 input 目录）
  router.put('/:id/files/content', authenticate(), async (ctx) => {
    try {
      const { id } = ctx.params;
      const { path: filePath, content } = ctx.request.body;

      if (!filePath) {
        ctx.error('文件路径不能为空');
        return;
      }

      if (content === undefined) {
        ctx.error('文件内容不能为空');
        return;
      }

      // 统一路径分隔符（Windows 反斜杠转正斜杠），解决跨平台兼容问题
      const normalizedPath = filePath.replace(/\\/g, '/');
      
      // 只允许保存到 input 目录
      if (!normalizedPath.startsWith('input/')) {
        ctx.error('只能保存到 input 目录', 403);
        return;
      }

      // 获取任务信息
      controller.ensureModel();
      const task = await controller.Task.findOne({
        where: { id },
        raw: true,
      });

      if (!task) {
        ctx.error('任务不存在', 404);
        return;
      }

      // 检查权限
      if (task.created_by !== ctx.state.userId) {
        ctx.error('无权限访问此任务', 403);
        return;
      }

      // 构建完整文件路径
      const fullPath = path.join(WORKSPACE_ROOT, task.workspace_path, filePath);

      // 安全检查：确保路径在工作空间内
      const resolvedPath = path.resolve(fullPath);
      const workspacePath = path.resolve(WORKSPACE_ROOT, task.workspace_path);
      if (!resolvedPath.startsWith(workspacePath)) {
        ctx.error('非法路径访问', 403);
        return;
      }

      // 保存文件内容
      await fs.writeFile(resolvedPath, content, 'utf-8');

      ctx.success({ message: '文件保存成功' });
    } catch (error) {
      ctx.error('文件保存失败', 500);
    }
  });

  return router;
};
