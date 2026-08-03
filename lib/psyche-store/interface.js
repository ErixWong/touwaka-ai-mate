/**
 * Psyche and Notes store interfaces.
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

export class INotesStore {
  async read(userId, expertId, key) {
    throw new Error('must implement read method');
  }

  async take(userId, expertId, key, note, ttl = 3600) {
    throw new Error('must implement take method');
  }

  async touch(userId, expertId, key, ttl = 3600) {
    throw new Error('must implement touch method');
  }

  async list(userId, expertId) {
    throw new Error('must implement list method');
  }

  async listWithDetails(userId, expertId) {
    throw new Error('must implement listWithDetails method');
  }

  async delete(userId, expertId, key) {
    throw new Error('must implement delete method');
  }

  async deleteMany(userId, expertId, keys) {
    throw new Error('must implement deleteMany method');
  }
}

export default { IPsycheStore, INotesStore };
