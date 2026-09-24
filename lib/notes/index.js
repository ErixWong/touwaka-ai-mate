/**
 * Notes Module - Notes 模块入口（Phase 3 阶段二：erix NoteRecord + MariaDB 乐观锁 CAS）
 *
 * 结构（issue #1132 决策 3 修订，原 Redis 方案作废）：
 * - notes-policy.js：NOTES_TTL_SECONDS 单一来源 + buildNotesScopeRef + NoteRecord 校验
 * - db-note-record-store.js：MariaDB CAS（INSERT / UPDATE ... record_version=?
 *   影响行数=0 → notes_cas_conflict），expires_at 为 TTL 唯一权威，read/list 不续期
 * - erix-notes-store-adapter.js：erix 5 方法端口（revoked→物理删除；complete/janitor no-op）
 * - psyche-notes-facade.js：宿主唯一入口 take()（CAS，返回 {overwritten}）
 *
 * 共享单例复用应用既有 db 模块（lib/db.js 的 Database），不再动态 import 'redis'；
 * 存储库为 MariaDB（见 scripts/upgrade-database.js 的 note_record 建表迁移）。
 */

export {
  NOTES_TTL_SECONDS,
  buildNotesScopeRef,
  assertNoteRecord,
  withUniformExpiresAt,
  expiresAtIso,
} from './notes-policy.js';
export {
  DbNoteRecordStore,
  NOTES_CAS_CONFLICT,
  isNotesCasConflict,
} from './db-note-record-store.js';
export { NotesStoreError } from 'erix-agent';
export { ErixNotesStoreAdapter } from './erix-notes-store-adapter.js';
export { PsycheNotesFacade } from './psyche-notes-facade.js';

import logger from '../logger.js';
import { NOTES_TTL_SECONDS, buildNotesScopeRef } from './notes-policy.js';
import { DbNoteRecordStore } from './db-note-record-store.js';
import { PsycheNotesFacade } from './psyche-notes-facade.js';

let sharedDbPromise = null;
let sharedNoteRecordStore = null;
let sharedPsycheNotesFacade = null;

/**
 * 获取共享 Database 连接（延迟加载，与 lib/psyche-store 同模式）。
 * 连接信息取应用统一环境变量（DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD）。
 */
async function getNotesDb() {
  if (!sharedDbPromise) {
    sharedDbPromise = (async () => {
      const { default: Database } = await import('../db.js');
      const db = new Database({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '3306', 10),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionLimit: 5,
      });
      await db.connect();
      logger.info('[NotesDB] 连接成功');
      return db;
    })();
    sharedDbPromise.catch(() => {
      // 连接失败不缓存 rejected promise，允许下次重试
      sharedDbPromise = null;
    });
  }
  return sharedDbPromise;
}

/**
 * 获取共享 DbNoteRecordStore 单例。
 * @param {object} [db] - 外部注入的 Database 实例（如 ToolManager 持有的应用 db）；
 *   缺省时用环境变量自建延迟连接
 * @returns {Promise<DbNoteRecordStore>}
 */
export async function getSharedNoteRecordStore(db = null) {
  if (!sharedNoteRecordStore) {
    const resolvedDb = db || await getNotesDb();
    sharedNoteRecordStore = new DbNoteRecordStore({ db: resolvedDb });
  }
  return sharedNoteRecordStore;
}

/**
 * 获取共享 PsycheNotesFacade 单例（PsycheManager 宿主笔记入口）。
 * @param {object} [db] - 外部注入的 Database 实例，缺省时用环境变量自建延迟连接
 * @returns {Promise<PsycheNotesFacade>}
 */
export async function getSharedPsycheNotesFacade(db = null) {
  if (!sharedPsycheNotesFacade) {
    const store = await getSharedNoteRecordStore(db);
    sharedPsycheNotesFacade = new PsycheNotesFacade({ store, ttlSeconds: NOTES_TTL_SECONDS });
  }
  return sharedPsycheNotesFacade;
}

export default {
  NOTES_TTL_SECONDS,
  buildNotesScopeRef,
};
