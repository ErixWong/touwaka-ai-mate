/**
 * Redis Store - Redis 存储实现
 * 使用 Redis 存储数据，支持分布式部署
 * 适用于生产环境和多实例部署
 */

import { IPsycheStore, INotesStore } from './interface.js';
import logger from '../logger.js';

/**
 * Redis Psyche 存储实现
 * 使用 Hash 结构存储 Psyche 的各个字段
 */
export class RedisPsycheStore extends IPsycheStore {
  constructor(redisClient) {
    super();
    this.redis = redisClient;
  }

  _getKey(userId, expertId) {
    return `psyche:${userId}:${expertId}`;
  }

  async get(userId, expertId) {
    const key = this._getKey(userId, expertId);
    try {
      const data = await this.redis.hGetAll(key);
      if (!data || Object.keys(data).length === 0) return null;

      return {
        session_meta: this._safeJsonParse(data.session_meta),
        methodology: this._safeJsonParse(data.methodology),
        conversation_digest: this._safeJsonParse(data.conversation_digest),
        notes_refs: this._safeJsonParse(data.notes_refs),
        topics_context: this._safeJsonParse(data.topics_context),
        working_memory: this._safeJsonParse(data.working_memory)
      };
    } catch (error) {
      logger.error(`[RedisPsycheStore] 获取失败: ${key}`, error.message);
      return null;
    }
  }

  async set(userId, expertId, psyche, ttl = 3600) {
    const key = this._getKey(userId, expertId);
    try {
      await this.redis.hSet(key, {
        session_meta: JSON.stringify(psyche.session_meta || {}),
        methodology: JSON.stringify(psyche.methodology || {}),
        conversation_digest: JSON.stringify(psyche.conversation_digest || {}),
        notes_refs: JSON.stringify(psyche.notes_refs || []),
        topics_context: JSON.stringify(psyche.topics_context || []),
        working_memory: JSON.stringify(psyche.working_memory || {})
      });
      await this.redis.expire(key, ttl);
      logger.debug(`[RedisPsycheStore] 保存: ${key}, TTL: ${ttl}s`);
    } catch (error) {
      logger.error(`[RedisPsycheStore] 保存失败: ${key}`, error.message);
      throw error;
    }
  }

  async delete(userId, expertId) {
    await this.redis.del(this._getKey(userId, expertId));
  }

  async exists(userId, expertId) {
    const exists = await this.redis.exists(this._getKey(userId, expertId));
    return exists === 1;
  }

  _safeJsonParse(value) {
    if (!value) return null;
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
  }
}

/**
 * Redis Notes 存储实现
 * 使用 String 结构存储笔记
 */
export class RedisNotesStore extends INotesStore {
  constructor(redisClient) {
    super();
    this.redis = redisClient;
  }

  _getKey(userId, expertId, noteKey) {
    return `notes:${userId}:${expertId}:${noteKey}`;
  }

  async read(userId, expertId, key) {
    const fullKey = this._getKey(userId, expertId, key);
    try {
      const data = await this.redis.get(fullKey);
      if (!data) return null;

      const note = JSON.parse(data);
      note.metadata.access_count = (note.metadata.access_count || 0) + 1;
      note.metadata.last_accessed = new Date().toISOString();

      const ttl = await this.redis.ttl(fullKey);
      if (ttl > 0) {
        await this.redis.set(fullKey, JSON.stringify(note), { EX: ttl });
      }
      return note;
    } catch (error) {
      logger.error(`[RedisNotesStore] 读取失败: ${fullKey}`, error.message);
      return null;
    }
  }

  async take(userId, expertId, key, note, ttl = 3600) {
    const fullKey = this._getKey(userId, expertId, key);
    const data = {
      content: note.content,
      type: note.type || 'general',
      metadata: {
        size: note.content?.length || 0,
        relevance: note.relevance || 0.5,
        access_count: 0,
        saved_at: new Date().toISOString(),
        ...note.metadata
      }
    };
    await this.redis.set(fullKey, JSON.stringify(data), { EX: ttl });
    logger.debug(`[RedisNotesStore] 保存: ${fullKey}, TTL: ${ttl}s`);
  }

  async list(userId, expertId) {
    const pattern = `notes:${userId}:${expertId}:*`;
    const keys = await this.redis.keys(pattern);
    const prefix = `notes:${userId}:${expertId}:`;
    return keys.map(k => k.replace(prefix, ''));
  }

  async delete(userId, expertId, key) {
    await this.redis.del(this._getKey(userId, expertId, key));
  }

  async deleteMany(userId, expertId, keys) {
    if (keys.length === 0) return;
    const fullKeys = keys.map(key => this._getKey(userId, expertId, key));
    await this.redis.del(fullKeys);
  }
}

export default { RedisPsycheStore, RedisNotesStore }; 
