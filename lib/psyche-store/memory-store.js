/**
 * Memory Store - 内存存储实现
 * 使用 Map 存储数据，支持 TTL 自动过期
 * 适用于开发环境和单实例部署
 */

import { IPsycheStore, INotesStore } from './interface.js';
import logger from '../logger.js';

/**
 * 内存 Psyche 存储实现
 */
export class MemoryPsycheStore extends IPsycheStore {
  constructor() {
    super();
    this.store = new Map(); // key -> { data, expireAt }
    this.cleanupInterval = null;
    this.startCleanupTimer();
  }

  _getKey(userId, expertId) {
    return `psyche:${userId}:${expertId}`;
  }

  async get(userId, expertId) {
    const key = this._getKey(userId, expertId);
    const item = this.store.get(key);
    if (!item) return null;
    if (Date.now() > item.expireAt) {
      this.store.delete(key);
      return null;
    }
    return item.data;
  }

  async set(userId, expertId, psyche, ttl = 3600) {
    const key = this._getKey(userId, expertId);
    this.store.set(key, {
      data: psyche,
      expireAt: Date.now() + (ttl * 1000)
    });
    logger.debug(`[MemoryPsycheStore] 保存 Psyche: ${key}, TTL: ${ttl}s`);
  }

  async delete(userId, expertId) {
    this.store.delete(this._getKey(userId, expertId));
  }

  async exists(userId, expertId) {
    const key = this._getKey(userId, expertId);
    const item = this.store.get(key);
    if (!item) return false;
    if (Date.now() > item.expireAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  startCleanupTimer() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.store.entries()) {
        if (now > item.expireAt) this.store.delete(key);
      }
    }, 60000);
    logger.info('[MemoryPsycheStore] 清理定时器已启动');
  }

  stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/**
 * 内存 Notes 存储实现
 */
export class MemoryNotesStore extends INotesStore {
  constructor() {
    super();
    this.store = new Map(); // key -> { content, type, metadata, expireAt }
    this.cleanupInterval = null;
    this.startCleanupTimer();
  }

  _getKey(userId, expertId, noteKey) {
    return `notes:${userId}:${expertId}:${noteKey}`;
  }

  async read(userId, expertId, key) {
    const fullKey = this._getKey(userId, expertId, key);
    const item = this.store.get(fullKey);
    if (!item) return null;
    if (Date.now() > item.expireAt) {
      this.store.delete(fullKey);
      return null;
    }
    item.metadata.access_count = (item.metadata.access_count || 0) + 1;
    item.metadata.last_accessed = new Date().toISOString();
    return { content: item.content, type: item.type, metadata: { ...item.metadata } };
  }

  async take(userId, expertId, key, note, ttl = 3600) {
    const fullKey = this._getKey(userId, expertId, key);
    this.store.set(fullKey, {
      content: note.content,
      type: note.type || 'general',
      metadata: {
        size: note.content?.length || 0,
        relevance: note.relevance || 0.5,
        access_count: 0,
        saved_at: new Date().toISOString(),
        ...note.metadata
      },
      expireAt: Date.now() + (ttl * 1000)
    });
    logger.debug(`[MemoryNotesStore] 保存笔记: ${fullKey}, TTL: ${ttl}s`);
  }

  async list(userId, expertId) {
    const prefix = `notes:${userId}:${expertId}:`;
    const keys = [];
    const now = Date.now();
    for (const [key, item] of this.store.entries()) {
      if (key.startsWith(prefix) && now <= item.expireAt) {
        keys.push(key.replace(prefix, ''));
      }
    }
    return keys;
  }

  async delete(userId, expertId, key) {
    this.store.delete(this._getKey(userId, expertId, key));
  }

  async deleteMany(userId, expertId, keys) {
    for (const key of keys) {
      this.store.delete(this._getKey(userId, expertId, key));
    }
  }

  startCleanupTimer() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.store.entries()) {
        if (now > item.expireAt) this.store.delete(key);
      }
    }, 60000);
    logger.info('[MemoryNotesStore] 清理定时器已启动');
  }

  stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export default { MemoryPsycheStore, MemoryNotesStore }; 
