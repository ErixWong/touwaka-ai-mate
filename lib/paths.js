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
 * 构建任务工作空间路径
 * @param {string} userId - 用户ID
 * @param {string} taskId - 任务ID
 */
export function getTaskWorkspacePath(userId, taskId) {
  return path.join(getWorkspaceRoot(), userId, taskId);
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
