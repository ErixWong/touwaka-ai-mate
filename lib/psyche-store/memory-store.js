import { IPsycheStore } from './interface.js';
import logger from '../logger.js';

export class MemoryPsycheStore extends IPsycheStore {
  constructor() {
    super();
    this.store = new Map();
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
      expireAt: Date.now() + ttl * 1000,
    });
    logger.debug(`[MemoryPsycheStore] saved Psyche: ${key}, TTL: ${ttl}s`);
  }

  async delete(userId, expertId) {
    this.store.delete(this._getKey(userId, expertId));
  }

  async exists(userId, expertId) {
    return (await this.get(userId, expertId)) !== null;
  }

  startCleanupTimer() {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.store.entries()) {
        if (now > item.expireAt) this.store.delete(key);
      }
    }, 60000);
    this.cleanupInterval.unref?.();
    logger.info('[MemoryPsycheStore] cleanup timer started');
  }

  stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export default { MemoryPsycheStore };
