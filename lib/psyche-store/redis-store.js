import { IPsycheStore, INotesStore } from './interface.js';
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

export class RedisNotesStore extends INotesStore {
  constructor(redisClient) {
    super();
    this.redis = redisClient;
  }

  _getKey(userId, expertId, noteKey) {
    return `notes:${userId}:${expertId}:${noteKey}`;
  }

  async _scanKeys(pattern) {
    if (typeof this.redis.scanIterator === 'function') {
      const keys = [];
      for await (const key of this.redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        keys.push(key);
      }
      return keys;
    }

    const keys = [];
    let cursor = '0';
    do {
      const reply = await this.redis.scan(cursor, { MATCH: pattern, COUNT: 100 });
      if (Array.isArray(reply)) {
        cursor = String(reply[0]);
        keys.push(...(reply[1] || []));
      } else {
        cursor = String(reply.cursor || 0);
        keys.push(...(reply.keys || []));
      }
    } while (cursor !== '0');
    return keys;
  }

  _parseNote(data) {
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  async read(userId, expertId, key) {
    const fullKey = this._getKey(userId, expertId, key);
    try {
      const note = this._parseNote(await this.redis.get(fullKey));
      if (!note) return null;

      note.metadata = note.metadata || {};
      note.metadata.access_count = (note.metadata.access_count || 0) + 1;
      note.metadata.last_accessed = new Date().toISOString();

      const ttl = await this.redis.ttl(fullKey);
      if (ttl > 0) {
        await this.redis.set(fullKey, JSON.stringify(note), { EX: ttl });
      }
      return note;
    } catch (error) {
      logger.error(`[RedisNotesStore] read failed: ${fullKey}`, error.message);
      return null;
    }
  }

  async take(userId, expertId, key, note, ttl = 3600) {
    const fullKey = this._getKey(userId, expertId, key);
    const existing = this._parseNote(await this.redis.get(fullKey));
    const overwritten = Boolean(existing);
    const now = new Date().toISOString();
    const previousMetadata = existing?.metadata || {};
    const data = {
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
    };
    await this.redis.set(fullKey, JSON.stringify(data), { EX: ttl });
    logger.debug(`[RedisNotesStore] saved: ${fullKey}, TTL: ${ttl}s`);
    return { overwritten };
  }

  async touch(userId, expertId, key, ttl = 3600) {
    const fullKey = this._getKey(userId, expertId, key);
    const exists = await this.redis.exists(fullKey);
    if (exists !== 1) return false;
    await this.redis.expire(fullKey, ttl);
    return true;
  }

  async list(userId, expertId) {
    return (await this.listWithDetails(userId, expertId)).map(note => note.key);
  }

  async listWithDetails(userId, expertId) {
    const prefix = `notes:${userId}:${expertId}:`;
    const keys = await this._scanKeys(`${prefix}*`);
    if (keys.length === 0) return [];
    const values = typeof this.redis.mGet === 'function'
      ? await this.redis.mGet(keys)
      : await Promise.all(keys.map(key => this.redis.get(key)));

    return keys
      .map((fullKey, index) => {
        const note = this._parseNote(values[index]);
        if (!note) return null;
        return {
          key: fullKey.replace(prefix, ''),
          ...note,
        };
      })
      .filter(Boolean);
  }

  async delete(userId, expertId, key) {
    await this.redis.del(this._getKey(userId, expertId, key));
  }

  async deleteMany(userId, expertId, keys) {
    if (!Array.isArray(keys) || keys.length === 0) return;
    const fullKeys = keys.map(key => this._getKey(userId, expertId, key));
    await this.redis.del(fullKeys);
  }
}

export default { RedisPsycheStore, RedisNotesStore };
