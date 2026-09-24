/**
 * Store Factory - 存储工厂
 * 根据配置自动创建合适的 PsycheStore 实例（内存或 Redis）
 *
 * Phase 3 阶段二：NotesStore 全家（INotesStore/RedisNotesStore/MemoryNotesStore/
 * getSharedNotesStore）已退役——notes 迁移至 lib/notes 的 erix NoteRecord +
 * MariaDB 乐观锁 CAS 实现（ErixNotesStoreAdapter / PsycheNotesFacade）。
 */

import { MemoryPsycheStore } from './memory-store.js';
import { RedisPsycheStore } from './redis-store.js';
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
 * 根据配置创建 PsycheStore 实例
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
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        db: parseInt(process.env.REDIS_DB || '0'),
        ...config.redis
      }
    };
    this._psycheStore = null;
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
  }
}

// 默认导出工厂实例创建函数
export function createStoreFactory(config) {
  return new StoreFactory(config);
}

export default { StoreFactory, createStoreFactory };
