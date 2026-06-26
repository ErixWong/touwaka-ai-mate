/**
 * 统一路径配置模块
 * 
 * 集中管理所有与文件路径相关的配置，避免在多个文件中重复定义
 */

import path from 'path';

function resolvePathValue(envPath, fallbackSegments = []) {
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
  }
  return path.join(process.cwd(), ...fallbackSegments);
}

/**
 * 获取数据基础路径
 * 严格从环境变量读取，未设置时报错
 */
export function getDataBasePath() {
  return resolvePathValue(process.env.DATA_BASE_PATH, ['data']);
}

/**
 * 获取工作空间根目录
 * 默认使用 DATA_BASE_PATH/work
 */
export function getWorkspaceRoot() {
  return path.join(getDataBasePath(), 'work');
}

/**
 * 获取技能目录路径
 * 优先使用 SKILLS_BASE_PATH，默认回退到 data/skills
 */
export function getSkillsPath() {
  return resolvePathValue(process.env.SKILLS_BASE_PATH, ['data', 'skills']);
}

/**
 * 获取字体目录路径
 * 优先使用 FONTS_BASE_PATH，默认回退到 data/fonts
 */
export function getFontsPath() {
  return resolvePathValue(process.env.FONTS_BASE_PATH, ['data', 'fonts']);
}

/**
 * 获取知识库图片目录路径
 */
export function getKbImagesPath() {
  return path.join(getDataBasePath(), 'kb-images');
}

/**
 * 获取工作空间根目录（所有用户的工作区根目录）
 * 默认使用 DATA_BASE_PATH/work
 * 注意：此函数不接收 userId，返回的是所有用户工作区的公共根目录
 */
export function getUserWorkspaceRoot() {
  return getWorkspaceRoot();
}

/**
 * 构建任务工作空间绝对路径
 * @param {string} userId - 用户ID
 * @param {string} taskId - 任务ID
 * @returns {string} 绝对路径
 */
export function getTaskWorkspaceAbsolutePath(userId, taskId) {
  return path.join(getWorkspaceRoot(), userId, taskId);
}

/**
 * 获取默认临时工作目录绝对路径
 * @param {string} userId - 用户ID
 * @returns {string} 绝对路径
 */
export function getDefaultWorkspaceAbsolutePath(userId) {
  return path.join(getWorkspaceRoot(), userId, 'temp');
}

/**
 * 统一解析运行时工作目录绝对路径
 * @param {string|null} input - 输入路径（必须是绝对路径或null）
 * @param {string} userId - 用户ID（用于生成默认目录）
 * @returns {string} 绝对路径
 * @throws {Error} 如果输入不是绝对路径且不是null
 */
export function resolveWorkspaceAbsolutePath(input, userId) {
  if (input === null || input === undefined || input === '') {
    return getDefaultWorkspaceAbsolutePath(userId);
  }

  if (!path.isAbsolute(input)) {
    throw new Error(`工作目录必须是绝对路径，收到: ${input}`);
  }

  return path.resolve(input);
}

/**
 * 将绝对路径转换为展示用逻辑路径
 * 注意：返回的是相对于工作区根目录的路径，不包含 "work/" 前缀
 * 例如：/data/work/user1/task1 -> user1/task1
 *      /data/work/user1/temp -> user1/temp
 * @param {string} absolutePath - 绝对路径
 * @returns {string} 逻辑路径（如 userId/taskId）
 */
export function toLogicalWorkspacePath(absolutePath) {
  if (!absolutePath) {
    return '';
  }

  const resolved = path.resolve(absolutePath);
  const workspaceRoot = getWorkspaceRoot();

  if (resolved.startsWith(workspaceRoot)) {
    return path.relative(workspaceRoot, resolved);
  }

  const dataBasePath = getDataBasePath();
  if (resolved.startsWith(dataBasePath)) {
    return path.relative(dataBasePath, resolved);
  }

  return resolved;
}

/**
 * 构建技能路径
 * @param {string} sourcePath - 技能的 source_path（相对或绝对）
 */
export function getSkillPath(sourcePath) {
  if (!sourcePath) {
    return null;
  }

  if (path.isAbsolute(sourcePath)) {
    return sourcePath;
  }

  const normalizedPath = sourcePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalizedPath.startsWith('skills/')) {
    return path.join(getSkillsPath(), normalizedPath.slice('skills/'.length));
  }

  if (normalizedPath.startsWith('data/skills/')) {
    return path.join(getSkillsPath(), normalizedPath.slice('data/skills/'.length));
  }

  return path.join(getSkillsPath(), normalizedPath);
}

/**
 * 统一生成工作目录展示文本
 * 
 * 这是展示层获取工作目录显示文本的唯一入口。
 * 执行层不应使用此函数，而应直接使用 absolute_workspace_path。
 * 
 * 协议区分：
 * - taskContext（运行时对象）：只认 logical_workspace_path，这是正确来源
 * - Task record（数据库记录）：兼容 workspace_path，这是旧协议遗留
 * 
 * @param {object} taskContextOrTask - taskContext 对象或 Task 数据库记录
 * @param {string} fallbackText - 当无法获取路径时显示的文本
 * @returns {string} 展示用工作目录文本
 * 
 * @example
 * // 从 taskContext 获取展示路径（推荐）
 * formatWorkspaceDisplayFromTask(taskContext, '（无）')
 * 
 * // 从 Task 数据库记录获取展示路径（旧协议兼容）
 * formatWorkspaceDisplayFromTask(taskRecord, '（无）')
 */
export function formatWorkspaceDisplayFromTask(taskContextOrTask, fallbackText = '（无）') {
  if (!taskContextOrTask) {
    return fallbackText;
  }

  // 判断输入类型：taskContext 必有 logical_workspace_path，Task record 没有
  const hasLogicalPath = 'logical_workspace_path' in taskContextOrTask;
  
  if (hasLogicalPath) {
    // taskContext 场景：只认 logical_workspace_path
    const logicalPath = taskContextOrTask.logical_workspace_path;
    if (logicalPath) {
      return logicalPath;
    }
  } else {
    // Task record 场景（旧协议兼容）：使用 workspace_path
    const workspacePath = taskContextOrTask.workspace_path;
    if (workspacePath) {
      return workspacePath;
    }
  }

  return fallbackText;
}
