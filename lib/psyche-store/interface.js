/**
 * Psyche Store Interface - Psyche 存储抽象接口
 * 定义 Psyche 和 Notes 存储的标准接口，支持多种存储后端
 */

/**
 * Psyche 数据结构
 * @typedef {Object} Psyche
 * @property {Object} session_meta - 会话元数据
 * @property {Object} methodology - 方法论
 * @property {Object} conversation_digest - 对话摘要
 * @property {Array} notes_refs - 笔记引用
 * @property {Array} topics_context - 话题上下文
 * @property {Object} working_memory - 工作记忆
 */

/**
 * Note 数据结构
 * @typedef {Object} Note
 * @property {string} content - 笔记内容
 * @property {string} type - 笔记类型
 * @property {Object} metadata - 元数据 { size, relevance, access_count, saved_at, last_accessed }
 */

/**
 * Psyche 存储接口
 * 所有 Psyche 存储实现必须遵循此接口
 */
export class IPsycheStore {
  /**
   * 获取 Psyche
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @returns {Promise<Psyche|null>} Psyche 对象，不存在返回 null
   */
  async get(userId, expertId) {
    throw new Error('必须实现 get 方法');
  }

  /**
   * 保存 Psyche
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @param {Psyche} psyche - Psyche 对象
   * @param {number} ttl - 过期时间（秒），默认 3600
   * @returns {Promise<void>}
   */
  async set(userId, expertId, psyche, ttl = 3600) {
    throw new Error('必须实现 set 方法');
  }

  /**
   * 删除 Psyche
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @returns {Promise<void>}
   */
  async delete(userId, expertId) {
    throw new Error('必须实现 delete 方法');
  }

  /**
   * 检查 Psyche 是否存在
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @returns {Promise<boolean>}
   */
  async exists(userId, expertId) {
    throw new Error('必须实现 exists 方法');
  }
}

/**
 * Notes 存储接口
 * 所有 Notes 存储实现必须遵循此接口
 */
export class INotesStore {
  /**
   * 读取笔记
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @param {string} key - 笔记标识
   * @returns {Promise<Note|null>} Note 对象，不存在返回 null
   */
  async read(userId, expertId, key) {
    throw new Error('必须实现 read 方法');
  }

  /**
   * 保存笔记
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @param {string} key - 笔记标识
   * @param {Note} note - Note 对象
   * @param {number} ttl - 过期时间（秒），默认 3600
   * @returns {Promise<void>}
   */
  async take(userId, expertId, key, note, ttl = 3600) {
    throw new Error('必须实现 take 方法');
  }

  /**
   * 列出所有笔记 key
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @returns {Promise<string[]>} 笔记 key 列表
   */
  async list(userId, expertId) {
    throw new Error('必须实现 list 方法');
  }

  /**
   * 删除笔记
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @param {string} key - 笔记标识
   * @returns {Promise<void>}
   */
  async delete(userId, expertId, key) {
    throw new Error('必须实现 delete 方法');
  }

  /**
   * 批量删除笔记
   * @param {string} userId - 用户ID
   * @param {string} expertId - 专家ID
   * @param {string[]} keys - 笔记标识列表
   * @returns {Promise<void>}
   */
  async deleteMany(userId, expertId, keys) {
    throw new Error('必须实现 deleteMany 方法');
  }
}

export default { IPsycheStore, INotesStore };
