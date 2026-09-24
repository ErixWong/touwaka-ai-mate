import { IPsycheStore } from './interface.js';
import logger from '../logger.js';

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
        working_memory: this._safeJsonParse(data.working_memory),
      };
    } catch (error) {
      logger.error(`[RedisPsycheStore] get failed: ${key}`, error.message);
      return null;
    }
  }

  async set(userId, expertId, psyche, ttl = 3600) {
    const key = this._getKey(userId, expertId);
    await this.redis.hSet(key, {
      session_meta: JSON.stringify(psyche.session_meta || {}),
      methodology: JSON.stringify(psyche.methodology || {}),
      conversation_digest: JSON.stringify(psyche.conversation_digest || {}),
      notes_refs: JSON.stringify(psyche.notes_refs || []),
      topics_context: JSON.stringify(psyche.topics_context || []),
      working_memory: JSON.stringify(psyche.working_memory || {}),
    });
    await this.redis.expire(key, ttl);
    logger.debug(`[RedisPsycheStore] saved: ${key}, TTL: ${ttl}s`);
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
    } catch (error) {
      return value;
    }
  }
}

export default { RedisPsycheStore };
