import logger from '../logger.js';

const DEFAULT_NOTES_TTL_SECONDS = Number.parseInt(process.env.NOTES_TTL_SECONDS || '86400', 10);

export class NotesManager {
  constructor(notesStore, config = {}) {
    this.notesStore = notesStore;
    this.config = {
      maxCount: config.maxCount || 100,
      ttl: config.ttl || DEFAULT_NOTES_TTL_SECONDS,
      touchOnRead: config.touchOnRead !== false,
      ...config,
    };
  }

  async read(userId, expertId, key) {
    const note = await this.notesStore.read(userId, expertId, key);
    if (note && this.config.touchOnRead && typeof this.notesStore.touch === 'function') {
      await this.notesStore.touch(userId, expertId, key, this.config.ttl);
    }
    return note;
  }

  async take(userId, expertId, key, note, ttl = this.config.ttl) {
    const result = await this.notesStore.take(userId, expertId, key, note, ttl);
    logger.debug(`[NotesManager] saved note: ${key}`);
    await this._checkAndForget(userId, expertId);
    return result || { overwritten: false };
  }

  async list(userId, expertId) {
    return await this.notesStore.list(userId, expertId);
  }

  async delete(userId, expertId, key) {
    await this.notesStore.delete(userId, expertId, key);
    logger.debug(`[NotesManager] deleted note: ${key}`);
  }

  async deleteMany(userId, expertId, keys) {
    await this.notesStore.deleteMany(userId, expertId, keys);
    logger.debug(`[NotesManager] deleted notes: ${keys.length}`);
  }

  async listWithDetails(userId, expertId) {
    const notes = typeof this.notesStore.listWithDetails === 'function'
      ? await this.notesStore.listWithDetails(userId, expertId)
      : await this._listWithDetailsFallback(userId, expertId);

    return notes
      .map(note => ({
        ...note,
        score: this._calculateScore(note),
      }))
      .sort((a, b) => b.score - a.score);
  }

  async _listWithDetailsFallback(userId, expertId) {
    const keys = await this.list(userId, expertId);
    const notes = [];

    for (const key of keys) {
      const note = await this.read(userId, expertId, key);
      if (note) {
        notes.push({ key, ...note });
      }
    }
    return notes;
  }

  _calculateScore(note) {
    const metadata = note.metadata || {};
    const accessCount = metadata.access_count || 0;
    const relevance = metadata.relevance ?? 0.5;
    const savedAt = metadata.saved_at ? new Date(metadata.saved_at) : new Date();
    const lastAccessed = metadata.last_accessed ? new Date(metadata.last_accessed) : savedAt;
    const ageDays = Math.max(0.01, (Date.now() - savedAt.getTime()) / 86400000);
    const idleDays = Math.max(0.01, (Date.now() - lastAccessed.getTime()) / 86400000);
    const freshness = 1 / ageDays;
    const recentUse = 1 / idleDays;

    return accessCount * 2 + relevance * 3 + freshness + recentUse;
  }

  async _checkAndForget(userId, expertId) {
    const notes = await this.listWithDetails(userId, expertId);

    if (notes.length > this.config.maxCount) {
      const deleteCount = Math.ceil(notes.length * 0.1);
      const toDelete = notes.slice(-deleteCount);
      const keysToDelete = toDelete.map(n => n.key);
      await this.deleteMany(userId, expertId, keysToDelete);
      logger.info(`[NotesManager] auto-forgot ${deleteCount} notes`);
    }
  }

  async cleanupTempNotes(userId, expertId) {
    const notes = await this.listWithDetails(userId, expertId);
    const tempNotes = notes.filter(n => n.type === 'working_memory');

    if (tempNotes.length > 0) {
      const keysToDelete = tempNotes.map(n => n.key);
      await this.deleteMany(userId, expertId, keysToDelete);
      logger.info(`[NotesManager] cleaned ${tempNotes.length} temporary notes`);
    }
  }

  async getStats(userId, expertId) {
    const notes = await this.listWithDetails(userId, expertId);
    const totalSize = notes.reduce((sum, n) => sum + (n.metadata?.size || 0), 0);

    return {
      count: notes.length,
      totalSize,
      byType: notes.reduce((acc, n) => {
        acc[n.type || 'general'] = (acc[n.type || 'general'] || 0) + 1;
        return acc;
      }, {}),
    };
  }
}

export default NotesManager;
