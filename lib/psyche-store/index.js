/**
 * Store Factory - 存储工厂
 * 根据配置自动创建合适的存储实例
 * 支持内存存储和 Redis 存储
 */

import { MemoryPsycheStore, MemoryNotesStore } from './memory-store.js';
import { RedisPsycheStore, RedisNotesStore } from './redis-store.js';
import logger from '../logger.js';

let redisClient = null;

/**
 * 初始化 Redis 客户端（延迟加载）
 */
async function getRedisClient(config) {
  if (redisClient) return redisClient;

  try {
    const { createClient } = await import('redis');
    redisClient = createClient({
      socket: {
        host: config.host || 'localhost',
        port: config.port || 6379
      },
      database: config.db || 0
    });

    redisClient.on('error', (err) => {
      logger.error('[Redis] 连接错误:', err.message);
    });

    await redisClient.connect();
    logger.info('[Redis] 连接成功');
    return redisClient;
  } catch (error) {
    logger.error('[Redis] 初始化失败:', error.message);
    throw error;
  }
}

/**
 * 存储工厂类
 * 根据配置创建 PsycheStore 和 NotesStore 实例
 */
export class StoreFactory {
  constructor(config = {}) {
    this.config = {
      psyche: {
        store: process.env.PSYCHE_STORE || 'memory',
        ttl: 3600,
        maxSize: 38400,
        ...config.psyche
      },
      notes: {
        store: process.env.NOTES_STORE || 'memory',
        ttl: 3600,
        maxCount: 100,
        ...config.notes
      },
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        db: parseInt(process.env.REDIS_DB || '0'),
        ...config.redis
      }
    };
    this._psycheStore = null;
    this._notesStore = null;
  }

  /**
   * 获取 PsycheStore 实例
   * @returns {Promise<IPsycheStore>}
   */
  async getPsycheStore() {
    if (this._psycheStore) return this._psycheStore;

    const storeType = this.config.psyche.store;
    logger.info(`[StoreFactory] 创建 PsycheStore: ${storeType}`);

    if (storeType === 'redis') {
      const client = await getRedisClient(this.config.redis);
      this._psycheStore = new RedisPsycheStore(client);
    } else {
      this._psycheStore = new MemoryPsycheStore();
    }

    return this._psycheStore;
  }

  /**
   * 获取 NotesStore 实例
   * @returns {Promise<INotesStore>}
   */
  async getNotesStore() {
    if (this._notesStore) return this._notesStore;

    const storeType = this.config.notes.store;
    logger.info(`[StoreFactory] 创建 NotesStore: ${storeType}`);

    if (storeType === 'redis') {
      const client = await getRedisClient(this.config.redis);
      this._notesStore = new RedisNotesStore(client);
    } else {
      this._notesStore = new MemoryNotesStore();
    }

    return this._notesStore;
  }

  /**
   * 获取配置
   */
  getConfig() {
    return this.config;
  }

  /**
   * 关闭所有存储连接
   */
  async close() {
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
      logger.info('[StoreFactory] Redis 连接已关闭');
    }
    this._psycheStore = null;
    this._notesStore = null;
  }
}

// 默认导出工厂实例创建函数
export function createStoreFactory(config) {
  return new StoreFactory(config);
}

export default { StoreFactory, createStoreFactory }; 
