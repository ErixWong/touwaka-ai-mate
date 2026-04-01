/**
 * Notes Manager - Notes 管理器
 * 封装 Notes 的高级操作，包括排序、遗忘等
 */

import logger from '../logger.js';

/**
 * Notes 管理器类
 * 提供 Notes 的增删改查和自动遗忘功能
 */
export class NotesManager {
  constructor(notesStore, config = {}) {
    this.notesStore = notesStore;
    this.config = {
      maxCount: config.maxCount || 100,      // 最大笔记数
      forgetThreshold: config.forgetThreshold || 0.3,  // 遗忘阈值
      ...config
    };
  }

  /**
   * 读取笔记
   */
  async read(userId, expertId, key) {
    return await this.notesStore.read(userId, expertId, key);
  }

  /**
   * 保存笔记
   */
  async take(userId, expertId, key, note, ttl = 3600) {
    await this.notesStore.take(userId, expertId, key, note, ttl);
    logger.debug(`[NotesManager] 保存笔记: ${key}`);

    // 检查是否需要遗忘
    await this._checkAndForget(userId, expertId);
  }

  /**
   * 列出所有笔记
   */
  async list(userId, expertId) {
    return await this.notesStore.list(userId, expertId);
  }

  /**
   * 删除笔记
   */
  async delete(userId, expertId, key) {
    await this.notesStore.delete(userId, expertId, key);
    logger.debug(`[NotesManager] 删除笔记: ${key}`);
  }

  /**
   * 批量删除笔记
   */
  async deleteMany(userId, expertId, keys) {
    await this.notesStore.deleteMany(userId, expertId, keys);
    logger.debug(`[NotesManager] 批量删除笔记: ${keys.length} 个`);
  }

  /**
   * 获取笔记详情列表（带排序）
   */
  async listWithDetails(userId, expertId) {
    const keys = await this.list(userId, expertId);
    const notes = [];

    for (const key of keys) {
      const note = await this.read(userId, expertId, key);
      if (note) {
        notes.push({
          key,
          ...note,
          score: this._calculateScore(note)
        });
      }
    }

    // 按分数排序
    return notes.sort((a, b) => b.score - a.score);
  }

  /**
   * 计算笔记分数（用于排序）
   * 分数 = 访问次数*2 + 相关性*1.5 + 新鲜度*1
   */
  _calculateScore(note) {
    const metadata = note.metadata || {};
    const accessCount = metadata.access_count || 0;
    const relevance = metadata.relevance || 0.5;
    
    // 计算年龄（天数）
    const savedAt = metadata.saved_at ? new Date(metadata.saved_at) : new Date();
    const ageDays = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60 * 24);
    const freshness = ageDays > 0 ? 1 / ageDays : 1;

    return accessCount * 2 + relevance * 1.5 + freshness * 1;
  }

  /**
   * 检查并执行遗忘
   * 当笔记数量超过限制时，删除分数最低的 10%
   */
  async _checkAndForget(userId, expertId) {
    const notes = await this.listWithDetails(userId, expertId);
    
    if (notes.length > this.config.maxCount) {
      const deleteCount = Math.ceil(notes.length * 0.1);
      const toDelete = notes.slice(-deleteCount); // 分数最低的
      
      const keysToDelete = toDelete.map(n => n.key);
      await this.deleteMany(userId, expertId, keysToDelete);
      
      logger.info(`[NotesManager] 自动遗忘 ${deleteCount} 个笔记`);
    }
  }

  /**
   * 清理临时笔记
   */
  async cleanupTempNotes(userId, expertId) {
    const notes = await this.listWithDetails(userId, expertId);
    const tempNotes = notes.filter(n => n.type === 'working_memory');
    
    if (tempNotes.length > 0) {
      const keysToDelete = tempNotes.map(n => n.key);
      await this.deleteMany(userId, expertId, keysToDelete);
      logger.info(`[NotesManager] 清理 ${tempNotes.length} 个临时笔记`);
    }
  }

  /**
   * 获取统计信息
   */
  async getStats(userId, expertId) {
    const notes = await this.listWithDetails(userId, expertId);
    const totalSize = notes.reduce((sum, n) => sum + (n.metadata?.size || 0), 0);

    return {
      count: notes.length,
      totalSize,
      byType: notes.reduce((acc, n) => {
        acc[n.type || 'general'] = (acc[n.type || 'general'] || 0) + 1;
        return acc;
      }, {})
    };
  }
}

export default NotesManager;  
