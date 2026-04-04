/**
 * 统一路径配置模块
 * 
 * 集中管理所有与文件路径相关的配置，避免在多个文件中重复定义
 */

import path from 'path';

/**
 * 获取数据基础路径
 * 优先从环境变量读取，否则使用默认值
 */
export function getDataBasePath() {
  const envPath = process.env.DATA_BASE_PATH;
  if (!envPath) {
    return path.join(process.cwd(), 'data');
  }
  return path.isAbsolute(envPath) ? envPath : path.join(process.cwd(), envPath);
}

/**
 * 获取工作空间根目录
 * 基于 DATA_BASE_PATH 派生
 */
export function getWorkspaceRoot() {
  return path.join(getDataBasePath(), 'work');
}

/**
 * 获取技能目录路径
 */
export function getSkillsPath() {
  return path.join(getDataBasePath(), 'skills');
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
  return path.isAbsolute(sourcePath) 
    ? sourcePath 
    : path.join(getDataBasePath(), sourcePath);
}
