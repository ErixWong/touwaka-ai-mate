import { IPsycheStore, INotesStore } from './interface.js';
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

export class MemoryNotesStore extends INotesStore {
  constructor() {
    super();
    this.store = new Map();
    this.cleanupInterval = null;
    this.startCleanupTimer();
  }

  _getKey(userId, expertId, noteKey) {
    return `notes:${userId}:${expertId}:${noteKey}`;
  }

  _isExpired(item) {
    return !item || Date.now() > item.expireAt;
  }

  async read(userId, expertId, key) {
    const fullKey = this._getKey(userId, expertId, key);
    const item = this.store.get(fullKey);
    if (this._isExpired(item)) {
      this.store.delete(fullKey);
      return null;
    }
    item.metadata.access_count = (item.metadata.access_count || 0) + 1;
    item.metadata.last_accessed = new Date().toISOString();
    return { content: item.content, type: item.type, metadata: { ...item.metadata } };
  }

  async take(userId, expertId, key, note, ttl = 3600) {
    const fullKey = this._getKey(userId, expertId, key);
    const existing = this.store.get(fullKey);
    const overwritten = Boolean(existing && !this._isExpired(existing));
    const now = new Date().toISOString();
    const previousMetadata = overwritten ? existing.metadata || {} : {};
    this.store.set(fullKey, {
      content: note.content,
      type: note.type || 'general',
      metadata: {
        size: note.content?.length || 0,
        relevance: note.relevance ?? 0.5,
        access_count: overwritten ? previousMetadata.access_count || 0 : 0,
        saved_at: overwritten ? previousMetadata.saved_at || now : now,
        updated_at: now,
        overwritten,
        ...note.metadata,
      },
      expireAt: Date.now() + ttl * 1000,
    });
    logger.debug(`[MemoryNotesStore] saved note: ${fullKey}, TTL: ${ttl}s`);
    return { overwritten };
  }

  async touch(userId, expertId, key, ttl = 3600) {
    const fullKey = this._getKey(userId, expertId, key);
    const item = this.store.get(fullKey);
    if (this._isExpired(item)) {
      this.store.delete(fullKey);
      return false;
    }
    item.expireAt = Date.now() + ttl * 1000;
    return true;
  }

  async list(userId, expertId) {
    return (await this.listWithDetails(userId, expertId)).map(note => note.key);
  }

  async listWithDetails(userId, expertId) {
    const prefix = `notes:${userId}:${expertId}:`;
    const notes = [];
    for (const [fullKey, item] of this.store.entries()) {
      if (!fullKey.startsWith(prefix)) continue;
      if (this._isExpired(item)) {
        this.store.delete(fullKey);
        continue;
      }
      notes.push({
        key: fullKey.replace(prefix, ''),
        content: item.content,
        type: item.type,
        metadata: { ...item.metadata },
      });
    }
    return notes;
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
    this.cleanupInterval.unref?.();
    logger.info('[MemoryNotesStore] cleanup timer started');
  }

  stopCleanupTimer() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

export default { MemoryPsycheStore, MemoryNotesStore };
