/**
 * Psyche store interface.
 *
 * Phase 3 阶段二：INotesStore / RedisNotesStore / MemoryNotesStore / getSharedNotesStore
 * 已退役（notes 迁移至 lib/notes 的 erix NoteRecord + MariaDB 乐观锁 CAS 实现）。
 * 本文件仅保留 Psyche 本身的存储契约。
 */

export class IPsycheStore {
  async get(userId, expertId) {
    throw new Error('must implement get method');
  }

  async set(userId, expertId, psyche, ttl = 3600) {
    throw new Error('must implement set method');
  }

  async delete(userId, expertId) {
    throw new Error('must implement delete method');
  }

  async exists(userId, expertId) {
    throw new Error('must implement exists method');
  }
}

export default { IPsycheStore };
