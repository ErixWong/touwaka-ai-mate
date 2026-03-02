/**
 * Task Controller - 任务工作空间控制器
 * 
 * 管理用户任务和工作空间
 * 
 * 关系：messages → topics → tasks
 */

import Utils from '../../lib/utils.js';
import logger from '../../lib/logger.js';
import fs from 'fs/promises';
import path from 'path';
import {
  buildQueryOptions,
  buildPaginatedResponse,
} from '../../lib/query-builder.js';

// 工作空间根目录
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './data/work';

// 允许过滤的字段白名单
const ALLOWED_FILTER_FIELDS = [
  'id', 'task_id', 'title', 'description', 'workspace_path',
  'status', 'created_by', 'created_at', 'updated_at',
];

// 允许排序的字段白名单
const ALLOWED_SORT_FIELDS = [
  'id', 'title', 'status', 'created_at', 'updated_at',
];

// 工作空间目录结构
const WORKSPACE_DIRS = ['input', 'output', 'temp', 'logs'];

// README 模板
const README_TEMPLATE = `# Task Workspace

## 目录结构

| 目录 | 用途 |
|------|------|
| input/ | 用户上传的输入文件 |
| output/ | 专家生成的输出文件 |
| temp/ | 临时文件（可清理） |
| logs/ | 执行日志 |

## 注意事项

- 请将需要处理的文件放入 \`input/\` 目录
- 处理结果将输出到 \`output/\` 目录
- 临时文件存放在 \`temp/\` 目录，可定期清理
- 执行日志记录在 \`logs/\` 目录

---
*Created at: {created_at}*
*Task ID: {task_id}*
`;

class TaskController {
  constructor(db) {
    this.db = db;
    this.Task = null; // 将在模型初始化后设置
  }

  /**
   * 确保 Task 模型已初始化
   */
  ensureModel() {
    if (!this.Task) {
      this.Task = this.db.getModel('task');
    }
  }

  /**
   * 生成任务 ID
   * 使用 newID 生成唯一标识符
   */
  generateTaskId() {
    return Utils.newID(12).toLowerCase();
  }

  /**
   * 创建工作空间目录结构
   */
  async createWorkspaceDirectories(userId, taskId) {
    const workspacePath = path.join(WORKSPACE_ROOT, userId, taskId);
    
    // 创建目录结构
    for (const dir of WORKSPACE_DIRS) {
      const dirPath = path.join(workspacePath, dir);
      await fs.mkdir(dirPath, { recursive: true });
    }

    // 创建 README.md
    const readmePath = path.join(workspacePath, 'README.md');
    const readmeContent = README_TEMPLATE
      .replace('{created_at}', new Date().toISOString())
      .replace('{task_id}', taskId);
    await fs.writeFile(readmePath, readmeContent, 'utf-8');

    return workspacePath;
  }

  /**
   * 复杂查询任务列表（POST /query）
   */
  async query(ctx) {
    const startTime = Date.now();
    try {
      this.ensureModel();
      const queryRequest = ctx.request.body || {};

      // 构建查询选项，自动添加用户ID过滤
      const { queryOptions, pagination } = buildQueryOptions(queryRequest, {
        baseWhere: { created_by: ctx.state.userId },
        filterOptions: { allowedFields: ALLOWED_FILTER_FIELDS },
        sortOptions: { allowedFields: ALLOWED_SORT_FIELDS },
        pageOptions: { defaultSize: 10, maxSize: 100 },
        fieldsOptions: { allowedFields: ALLOWED_FILTER_FIELDS },
      });

      // 执行查询
      const result = await this.Task.findAndCountAll({
        ...queryOptions,
        raw: true,
      });

      // 构建响应
      const response = buildPaginatedResponse(result, pagination, startTime);
      ctx.success(response);
    } catch (error) {
      logger.error('Query tasks error:', error);
      ctx.error('查询任务失败', 500);
    }
  }

  /**
   * 获取任务列表（简单 GET 查询）
   */
  async list(ctx) {
    try {
      this.ensureModel();
      const { status, page = 1, pageSize = 20 } = ctx.query;

      const where = { created_by: ctx.state.userId };
      if (status) {
        where.status = status;
      }

      const offset = (parseInt(page) - 1) * parseInt(pageSize);

      // 获取任务列表
      const { count, rows } = await this.Task.findAndCountAll({
        where,
        order: [['updated_at', 'DESC']],
        limit: parseInt(pageSize),
        offset,
        raw: true,
      });

      ctx.success({
        items: rows,
        pagination: {
          page: parseInt(page),
          size: parseInt(pageSize),
          total: count,
          pages: Math.ceil(count / parseInt(pageSize)),
        },
      });
    } catch (error) {
      logger.error('Get tasks error:', error);
      ctx.error('获取任务失败', 500);
    }
  }

  /**
   * 创建任务
   */
  async create(ctx) {
    try {
      this.ensureModel();
      const { title, description } = ctx.request.body;

      if (!title) {
        ctx.error('标题不能为空');
        return;
      }

      const userId = ctx.state.userId;
      const taskId = this.generateTaskId();
      const id = Utils.newID(20);

      // 创建工作空间目录
      const workspacePath = await this.createWorkspaceDirectories(userId, taskId);

      // 相对路径存储
      const relativePath = path.join(userId, taskId);

      // 创建数据库记录
      await this.Task.create({
        id,
        task_id: taskId,
        title,
        description: description || null,
        workspace_path: relativePath,
        status: 'active',
        created_by: userId,
      });

      const task = await this.Task.findOne({
        where: { id },
        raw: true,
      });

      logger.info(`Task created: ${taskId} by user ${userId}`);

      ctx.status = 201;
      ctx.success(task, '任务创建成功');
    } catch (error) {
      logger.error('Create task error:', error);
      ctx.error('创建任务失败', 500);
    }
  }

  /**
   * 获取任务详情
   */
  async get(ctx) {
    try {
      this.ensureModel();
      const { id } = ctx.params;

      const task = await this.Task.findOne({
        where: { id },
        raw: true,
      });

      if (!task) {
        ctx.error('任务不存在', 404);
        return;
      }

      // 检查权限：只有创建者可以查看
      if (task.created_by !== ctx.state.userId) {
        ctx.error('无权限访问此任务', 403);
        return;
      }

      ctx.success(task);
    } catch (error) {
      logger.error('Get task error:', error);
      ctx.error('获取任务失败', 500);
    }
  }

  /**
   * 更新任务
   */
  async update(ctx) {
    try {
      this.ensureModel();
      const { id } = ctx.params;
      const { title, description, status } = ctx.request.body;

      const updates = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (status !== undefined) updates.status = status;

      if (Object.keys(updates).length === 0) {
        ctx.error('没有要更新的字段');
        return;
      }

      const result = await this.Task.update(updates, {
        where: {
          id,
          created_by: ctx.state.userId,
        },
      });

      if (result[0] === 0) {
        ctx.error('任务不存在或无权限', 404);
        return;
      }

      ctx.success(null, '更新成功');
    } catch (error) {
      logger.error('Update task error:', error);
      ctx.error('更新任务失败', 500);
    }
  }

  /**
   * 删除任务（软删除，标记为 deleted）
   */
  async delete(ctx) {
    try {
      this.ensureModel();
      const { id } = ctx.params;

      // 软删除：标记为 deleted
      const result = await this.Task.update(
        { status: 'deleted' },
        {
          where: {
            id,
            created_by: ctx.state.userId,
          },
        }
      );

      if (result[0] === 0) {
        ctx.error('任务不存在或无权限', 404);
        return;
      }

      ctx.status = 204;
    } catch (error) {
      logger.error('Delete task error:', error);
      ctx.error('删除任务失败', 500);
    }
  }

  /**
   * 进入任务（获取工作空间状态）
   */
  async enter(ctx) {
    try {
      this.ensureModel();
      const { id } = ctx.params;

      const task = await this.Task.findOne({
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

      // 获取工作空间状态
      const workspacePath = path.join(WORKSPACE_ROOT, task.workspace_path);
      const workspaceInfo = {
        exists: false,
        directories: {},
      };

      try {
        await fs.access(workspacePath);
        workspaceInfo.exists = true;

        // 检查各目录文件数量
        for (const dir of WORKSPACE_DIRS) {
          const dirPath = path.join(workspacePath, dir);
          try {
            const files = await fs.readdir(dirPath);
            workspaceInfo.directories[dir] = {
              count: files.length,
            };
          } catch {
            workspaceInfo.directories[dir] = { count: 0 };
          }
        }
      } catch {
        // 工作空间不存在，重新创建
        await this.createWorkspaceDirectories(task.created_by, task.task_id);
        workspaceInfo.exists = true;
        workspaceInfo.directories = {};
        for (const dir of WORKSPACE_DIRS) {
          workspaceInfo.directories[dir] = { count: 0 };
        }
      }

      ctx.success({
        task,
        workspace: workspaceInfo,
      });
    } catch (error) {
      logger.error('Enter task error:', error);
      ctx.error('进入任务失败', 500);
    }
  }

  /**
   * 获取工作空间文件列表
   */
  async listFiles(ctx) {
    try {
      this.ensureModel();
      const { id } = ctx.params;
      const { subdir = '' } = ctx.query;

      const task = await this.Task.findOne({
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

      const workspacePath = path.join(WORKSPACE_ROOT, task.workspace_path);
      const targetPath = path.join(workspacePath, subdir);

      // 安全检查：确保目标路径在工作空间内
      const resolvedPath = path.resolve(targetPath);
      const resolvedWorkspace = path.resolve(workspacePath);
      if (!resolvedPath.startsWith(resolvedWorkspace)) {
        ctx.error('非法路径访问', 403);
        return;
      }

      // 读取目录内容
      try {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const files = entries.map(entry => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          path: path.join(subdir, entry.name),
        }));

        ctx.success({
          workspace_path: task.workspace_path,
          current_dir: subdir,
          files,
        });
      } catch (err) {
        if (err.code === 'ENOENT') {
          ctx.error('目录不存在', 404);
        } else {
          throw err;
        }
      }
    } catch (error) {
      logger.error('List task files error:', error);
      ctx.error('获取文件列表失败', 500);
    }
  }

  /**
   * 上传文件到工作空间（仅允许上传到 input/ 目录）
   */
  async uploadFile(ctx) {
    try {
      this.ensureModel();
      const { id } = ctx.params;
      // subdir 通过 FormData 传递，multer 解析后放在 ctx.request.body
      const subdir = ctx.request.body?.subdir || 'input';

      const task = await this.Task.findOne({
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

      // 只允许上传到 input 目录
      if (subdir !== 'input' && !subdir.startsWith('input/')) {
        ctx.error('只能上传文件到 input 目录', 403);
        return;
      }

      // @koa/multer 使用 memoryStorage 时，文件在 ctx.file.buffer
      const file = ctx.file;
      if (!file) {
        ctx.error('请选择要上传的文件', 400);
        return;
      }

      const workspacePath = path.join(WORKSPACE_ROOT, task.workspace_path);
      const targetDir = path.join(workspacePath, subdir);

      // 安全检查
      const resolvedTarget = path.resolve(targetDir);
      const resolvedWorkspace = path.resolve(workspacePath);
      if (!resolvedTarget.startsWith(resolvedWorkspace)) {
        ctx.error('非法路径访问', 403);
        return;
      }

      // 确保目标目录存在
      await fs.mkdir(targetDir, { recursive: true });

      // 获取文件名
      const originalName = file.originalname || 'uploaded_file';
      const targetPath = path.join(targetDir, originalName);

      // 使用 buffer 写入文件（memoryStorage 模式）
      if (file.buffer) {
        await fs.writeFile(targetPath, file.buffer);
      } else if (file.path || file.filepath) {
        // 如果有临时文件路径（diskStorage 模式）
        const tempPath = file.path || file.filepath;
        await fs.copyFile(tempPath, targetPath);
        await fs.unlink(tempPath);
      }

      logger.info(`File uploaded to task ${task.task_id}: ${subdir}/${originalName}`);

      ctx.success({
        path: path.join(subdir, originalName),
        size: file.size,
      }, '文件上传成功');
    } catch (error) {
      logger.error('Upload file error:', error);
      ctx.error('文件上传失败', 500);
    }
  }

  /**
   * 下载工作空间文件
   */
  async downloadFile(ctx) {
    try {
      this.ensureModel();
      const { id } = ctx.params;
      const { path: filePath } = ctx.query;

      if (!filePath) {
        ctx.error('请指定要下载的文件路径', 400);
        return;
      }

      const task = await this.Task.findOne({
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

      const workspacePath = path.join(WORKSPACE_ROOT, task.workspace_path);
      const targetPath = path.join(workspacePath, filePath);

      // 安全检查
      const resolvedTarget = path.resolve(targetPath);
      const resolvedWorkspace = path.resolve(workspacePath);
      if (!resolvedTarget.startsWith(resolvedWorkspace)) {
        ctx.error('非法路径访问', 403);
        return;
      }

      // 检查文件是否存在
      try {
        const stats = await fs.stat(targetPath);
        if (!stats.isFile()) {
          ctx.error('只能下载文件', 400);
          return;
        }
      } catch {
        ctx.error('文件不存在', 404);
        return;
      }

      // 设置响应头并发送文件
      const fileName = path.basename(filePath);
      ctx.set('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      ctx.set('Content-Type', 'application/octet-stream');
      ctx.body = require('fs').createReadStream(targetPath);
    } catch (error) {
      logger.error('Download file error:', error);
      ctx.error('文件下载失败', 500);
    }
  }
}

export default TaskController;
